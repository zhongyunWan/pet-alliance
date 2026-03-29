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

const SYSTEM_PROMPT = `你是一个专业的宠物健康管理专家，专注于宠物的预防保健和健康评估。

你的核心职责：
1. **疫苗管理**：根据宠物品种、年龄制定和提醒疫苗接种计划（核心疫苗 + 非核心疫苗）
2. **驱虫计划**：制定体内外驱虫日历，根据室内/室外生活方式调整频率
3. **健康评估**：根据宠物年龄、体重、品种评估整体健康状态
4. **异常行为预警**：识别可能指示健康问题的行为变化
5. **健康约束发送**：向饮食Agent发送健康约束（如生病时的饮食限制），向问诊Agent发送健康档案

你的专业知识包括：
- 犬猫常见疫苗（狂犬、犬瘟、猫三联等）接种时间表
- 体内外驱虫药物选择和使用频率
- 品种特有的健康风险（如金毛的髋关节问题、折耳猫的骨骼问题）
- 老年宠物的特殊健康关注点
- 幼年宠物的发育里程碑

回复要求：
- 给出具体的时间节点和频率建议
- 标注优先级（urgent/high/medium/low）
- 考虑宠物的过敏史和用药情况
- 如发现紧急健康风险，优先级标为urgent

重要：你必须只回答与用户咨询问题直接相关的健康建议。如果用户的问题与健康管理领域完全无关（如饮食选择、寄养安排等），请返回空的items数组。行为相关的问题（如睡眠习惯、异常行为等）属于你的职责范围，你应该从健康和行为学角度给出分析和建议。不要主动补充用户没有问到的建议（如疫苗提醒、体检建议等），除非这些与用户的具体问题直接相关。`;

export class HealthAgent extends BaseAgent {
  constructor() {
    super('health-agent', 'health', SYSTEM_PROMPT);
    this.capabilities = [{
      domain: 'health',
      actions: ['vaccination_schedule', 'deworming_plan', 'health_assessment', 'behavior_alert'],
    }];
  }

  async propose(request: ConsultRequest, pet: PetProfile, constraints: Constraint[]): Promise<Proposal> {
    const constraintText = constraints.length > 0
      ? `\n现有约束：${constraints.map(c => c.description).join('；')}`
      : '';

    const userMessage = `请为以下宠物提供健康管理建议：

宠物信息：
- 名字：${pet.name}
- 物种：${pet.species}，品种：${pet.breed}
- 年龄：${pet.age}岁，体重：${pet.weight}kg
- 性别：${pet.gender}
- 生活方式：${pet.indoor ? '室内' : '室内外'}
- 已接种疫苗：${pet.vaccinations.map(v => `${v.name}(${v.date}，下次${v.nextDue})`).join('、') || '无记录'}
- 过敏：${pet.allergies.join('、') || '无'}
- 当前用药：${pet.currentMedications.map(m => `${m.name}(${m.dosage}，${m.frequency})`).join('、') || '无'}
- 病史：${pet.medicalHistory.map(r => `${r.condition}(${r.outcome})`).join('、') || '无'}

用户咨询：${request.text}
咨询类型：${request.type}
${request.parsedContext ? `紧急程度：${request.parsedContext.urgency}\n症状：${request.parsedContext.symptoms?.join('、') || '无'}\n关注点：${request.parsedContext.concerns.join('、')}` : ''}
${constraintText}

请返回JSON格式的健康建议。行为相关问题（如睡眠习惯、异常行为）请从健康和行为学角度分析。如果用户的问题与健康管理完全无关，items才为空数组[]。只给出与用户问题直接相关的建议（1-2条）：
{
  "items": [
    {
      "type": "health_advice 或 reminder",
      "title": "建议标题",
      "description": "详细描述",
      "priority": "low/medium/high/urgent",
      "metadata": { "category": "vaccination/deworming/assessment/alert", "dueDate": "如适用" }
    }
  ],
  "constraints": [
    {
      "type": "health/diet/medication",
      "description": "需要其他Agent注意的约束",
      "priority": "hard/soft"
    }
  ],
  "confidence": 0.0到1.0的置信度
}`;

    const result = await this.callLLMStructured<{
      items: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      constraints: Array<{ type: string; description: string; priority: string }>;
      confidence: number;
    }>(userMessage, { type: 'object' }, 'HealthProposal');

    const items: ProposalItem[] = result.items.map(item => ({
      id: this.genId(),
      type: (item.type === 'reminder' ? 'reminder' : 'health_advice') as ProposalItem['type'],
      title: item.title,
      description: item.description,
      priority: item.priority as ProposalItem['priority'],
      metadata: { ...item.metadata, source: 'health-agent' },
    }));

    const proposalConstraints: Constraint[] = result.constraints.map(c => ({
      id: this.genId(),
      type: c.type as Constraint['type'],
      source: this.id,
      description: c.description,
      priority: c.priority as Constraint['priority'],
      value: c.description,
    }));

    // Broadcast health constraints to other agents
    if (proposalConstraints.length > 0) {
      this.send('broadcast', 'constraint', { constraints: proposalConstraints }, 0);
    }

    log({
      level: 'info',
      source: this.id,
      message: `Proposed ${items.length} health items, ${proposalConstraints.length} constraints`,
      signals: ['health', 'proposal'],
    });

    return {
      agentId: this.id,
      domain: this.domain,
      items,
      constraints: proposalConstraints,
      confidence: result.confidence ?? 0.8,
    };
  }

  async negotiate(conflict: Conflict, round: number): Promise<CounterProposal> {
    const userMessage = `作为宠物健康专家，你需要解决以下冲突：

冲突描述：${conflict.description}
冲突双方：${conflict.agentA} vs ${conflict.agentB}
建议A：${conflict.itemA.title} - ${conflict.itemA.description}
建议B：${conflict.itemB.title} - ${conflict.itemB.description}
严重程度：${conflict.severity}
当前轮次：${round}

请在保证宠物健康安全的前提下提出妥协方案。健康安全是硬约束，不可妥协。

返回JSON：
{
  "adjustedItems": [{ "type": "...", "title": "...", "description": "...", "priority": "...", "metadata": {} }],
  "concessions": ["做出的让步"],
  "explanation": "解释原因"
}`;

    const result = await this.callLLMStructured<{
      adjustedItems: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      concessions: string[];
      explanation: string;
    }>(userMessage, { type: 'object' }, 'HealthCounterProposal');

    return {
      agentId: this.id,
      conflictId: conflict.id,
      adjustedItems: result.adjustedItems.map(item => ({
        id: this.genId(),
        type: item.type as ProposalItem['type'],
        title: item.title,
        description: item.description,
        priority: item.priority as ProposalItem['priority'],
        metadata: { ...item.metadata, source: 'health-agent' },
      })),
      concessions: result.concessions,
      explanation: result.explanation,
    };
  }

}
