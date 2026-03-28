import type {
  Conflict,
  Constraint,
  ConsultRequest,
  CounterProposal,
  PetProfile,
  Proposal,
  ProposalItem,
} from '../types.js';
import { BaseAgent } from './base.js';
import { log } from '../utils/logger.js';

const SYSTEM_PROMPT = `你是一个经验丰富的宠物医生，专注于症状分析、疾病诊断和治疗方案制定。

你的核心职责：
1. **症状分析**：根据主人描述的症状进行详细分析，列出可能的病因
2. **初步诊断**：基于症状、品种、年龄给出最可能的诊断
3. **就医建议**：评估是否需要去宠物医院，区分紧急和非紧急情况
4. **处理方案**：给出家庭护理建议或初步用药方案
5. **跨Agent协作**：
   - 向饮食Agent发送用药期间的饮食限制
   - 向健康Agent发送健康记录更新
   - 接收健康Agent的历史健康数据

你的专业知识包括：
- 犬猫常见疾病的症状鉴别诊断
- 常用宠物药物的用法用量和禁忌
- 紧急情况的识别和初步处理（中毒、骨折、出血等）
- 慢性病的长期管理（糖尿病、肾病、心脏病等）
- 术后护理和康复指导

安全原则：
- 始终建议严重症状去宠物医院就诊
- 不替代专业兽医的面诊
- 用药建议标注"请遵医嘱"
- 紧急情况（中毒、大量出血、呼吸困难等）立即标记为urgent`;

export class MedicalAgent extends BaseAgent {
  constructor() {
    super('medical-agent', 'medical', SYSTEM_PROMPT);
    this.capabilities = [{
      domain: 'medical',
      actions: ['symptom_analysis', 'diagnosis', 'treatment_plan', 'emergency_assessment'],
    }];
  }

  async propose(request: ConsultRequest, pet: PetProfile, constraints: Constraint[]): Promise<Proposal> {
    const constraintText = constraints.length > 0
      ? `\n来自其他Agent的约束：\n${constraints.map(c => `- [${c.source}][${c.priority}] ${c.description}`).join('\n')}`
      : '';

    const userMessage = `请为以下宠物提供医疗建议：

宠物信息：
- 名字：${pet.name}
- 物种：${pet.species}，品种：${pet.breed}
- 年龄：${pet.age}岁，体重：${pet.weight}kg
- 性别：${pet.gender}
- 过敏：${pet.allergies.join('、') || '无'}
- 当前用药：${pet.currentMedications.map(m => `${m.name}(${m.dosage}，${m.frequency}，用途：${m.purpose})`).join('、') || '无'}
- 病史：${pet.medicalHistory.map(r => `${r.condition}(${r.diagnosis}，${r.outcome}${r.notes ? '，备注：' + r.notes : ''})`).join('、') || '无'}
- 疫苗：${pet.vaccinations.map(v => v.name).join('、') || '无记录'}
${constraintText}

用户咨询：${request.text}
咨询类型：${request.type}
${request.parsedContext ? `紧急程度：${request.parsedContext.urgency}\n症状：${request.parsedContext.symptoms?.join('、') || '无明确症状'}\n关注点：${request.parsedContext.concerns.join('、')}` : ''}

请返回JSON格式的医疗建议：
{
  "items": [
    {
      "type": "medical_advice",
      "title": "建议标题",
      "description": "详细描述",
      "priority": "low/medium/high/urgent",
      "metadata": { "category": "diagnosis/treatment/medication/referral/emergency", "needsClinicVisit": true/false, "medications": [] }
    }
  ],
  "constraints": [
    {
      "type": "medication/diet/health",
      "description": "用药期间的约束（如饮食限制、活动限制）",
      "priority": "hard/soft"
    }
  ],
  "confidence": 0.0到1.0
}`;

    const result = await this.callLLMStructured<{
      items: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      constraints: Array<{ type: string; description: string; priority: string }>;
      confidence: number;
    }>(userMessage, { type: 'object' }, 'MedicalProposal');

    const items: ProposalItem[] = result.items.map(item => ({
      id: this.genId(),
      type: 'medical_advice' as ProposalItem['type'],
      title: item.title,
      description: item.description,
      priority: item.priority as ProposalItem['priority'],
      metadata: { ...item.metadata, source: 'medical-agent' },
    }));

    const proposalConstraints: Constraint[] = result.constraints.map(c => ({
      id: this.genId(),
      type: c.type as Constraint['type'],
      source: this.id,
      description: c.description,
      priority: c.priority as Constraint['priority'],
      value: c.description,
    }));

    // Broadcast medication constraints to diet and health agents
    if (proposalConstraints.length > 0) {
      this.send('diet-agent', 'constraint', {
        constraints: proposalConstraints.filter(c => c.type === 'diet' || c.type === 'medication'),
      }, 0);
      this.send('health-agent', 'constraint', {
        constraints: proposalConstraints.filter(c => c.type === 'health'),
      }, 0);
    }

    log({
      level: 'info',
      source: this.id,
      message: `Proposed ${items.length} medical items, ${proposalConstraints.length} constraints`,
      signals: ['medical', 'proposal'],
    });

    return {
      agentId: this.id,
      domain: this.domain,
      items,
      constraints: proposalConstraints,
      confidence: result.confidence ?? 0.7,
    };
  }

  async negotiate(conflict: Conflict, round: number): Promise<CounterProposal> {
    const userMessage = `作为宠物医生，你需要解决以下冲突：

冲突描述：${conflict.description}
冲突双方：${conflict.agentA} vs ${conflict.agentB}
建议A：${conflict.itemA.title} - ${conflict.itemA.description}
建议B：${conflict.itemB.title} - ${conflict.itemB.description}
严重程度：${conflict.severity}
当前轮次：${round}

医疗安全是最高优先级。如果涉及用药安全、过敏风险等，不可妥协。

返回JSON：
{
  "adjustedItems": [{ "type": "medical_advice", "title": "...", "description": "...", "priority": "...", "metadata": {} }],
  "concessions": ["做出的让步"],
  "explanation": "解释原因"
}`;

    const result = await this.callLLMStructured<{
      adjustedItems: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      concessions: string[];
      explanation: string;
    }>(userMessage, { type: 'object' }, 'MedicalCounterProposal');

    return {
      agentId: this.id,
      conflictId: conflict.id,
      adjustedItems: result.adjustedItems.map(item => ({
        id: this.genId(),
        type: item.type as ProposalItem['type'],
        title: item.title,
        description: item.description,
        priority: item.priority as ProposalItem['priority'],
        metadata: { ...item.metadata, source: 'medical-agent' },
      })),
      concessions: result.concessions,
      explanation: result.explanation,
    };
  }

}
