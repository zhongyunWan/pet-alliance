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

const SYSTEM_PROMPT = `你是一个专业的宠物寄养服务专家，专注于为外出的宠物主人提供最佳寄养方案。

你的核心职责：
1. **寄养方案匹配**：根据出差/旅行日期和宠物特点推荐合适的寄养方式
   - 宠物酒店/寄养中心
   - 上门喂养服务
   - 朋友/家人代养
   - 宠物日托
2. **特殊需求处理**：
   - 需要每日用药的宠物的护理说明
   - 特殊饮食要求的交接
   - 行为习惯和禁忌的说明
3. **寄养须知生成**：生成完整的寄养交接清单
4. **应急方案**：制定寄养期间的应急联系和处理方案

你的专业知识包括：
- 不同类型寄养服务的优缺点对比
- 根据宠物性格（胆小/活泼/社交/独处）推荐寄养方式
- 寄养前的准备清单（疫苗、驱虫、物品准备）
- 减少寄养焦虑的建议
- 寄养期间的远程监护建议

协作要求：
- 接收健康Agent提供的特殊护理需求（如每日注射胰岛素）
- 接收饮食Agent提供的喂养说明（食物种类、用量、禁忌）
- 将寄养时间约束发送给其他Agent`;

export class BoardingAgent extends BaseAgent {
  constructor() {
    super('boarding-agent', 'boarding', SYSTEM_PROMPT);
    this.capabilities = [{
      domain: 'boarding',
      actions: ['boarding_plan', 'handover_checklist', 'emergency_plan', 'anxiety_reduction'],
    }];
  }

  async propose(request: ConsultRequest, pet: PetProfile, constraints: Constraint[]): Promise<Proposal> {
    const healthConstraints = constraints.filter(c => c.source === 'health-agent');
    const dietConstraints = constraints.filter(c => c.source === 'diet-agent');
    const medicalConstraints = constraints.filter(c => c.source === 'medical-agent');

    const constraintText = [
      healthConstraints.length > 0 ? `健康护理需求：\n${healthConstraints.map(c => `- ${c.description}`).join('\n')}` : '',
      dietConstraints.length > 0 ? `饮食要求：\n${dietConstraints.map(c => `- ${c.description}`).join('\n')}` : '',
      medicalConstraints.length > 0 ? `医疗注意事项：\n${medicalConstraints.map(c => `- ${c.description}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    const userMessage = `请为以下宠物制定寄养方案：

宠物信息：
- 名字：${pet.name}
- 物种：${pet.species}，品种：${pet.breed}
- 年龄：${pet.age}岁，体重：${pet.weight}kg
- 性别：${pet.gender}
- 生活方式：${pet.indoor ? '室内' : '室内外'}
- 过敏：${pet.allergies.join('、') || '无'}
- 当前用药：${pet.currentMedications.map(m => `${m.name}(${m.dosage}，${m.frequency})`).join('、') || '无'}

${constraintText ? `其他Agent提供的约束：\n${constraintText}` : ''}

用户咨询：${request.text}
咨询类型：${request.type}
${request.parsedContext?.boardingDates ? `寄养日期：${request.parsedContext.boardingDates.start} 至 ${request.parsedContext.boardingDates.end}` : ''}
${request.parsedContext?.specialRequirements ? `特殊要求：${request.parsedContext.specialRequirements.join('、')}` : ''}

请返回JSON格式的寄养建议：
{
  "items": [
    {
      "type": "boarding_plan",
      "title": "建议标题",
      "description": "详细描述",
      "priority": "low/medium/high/urgent",
      "metadata": { "category": "boarding_type/checklist/emergency/anxiety_tips", "boardingType": "hotel/home_visit/friend/daycare", "estimatedCost": "" }
    }
  ],
  "constraints": [
    {
      "type": "schedule",
      "description": "时间安排约束",
      "priority": "hard/soft"
    }
  ],
  "confidence": 0.0到1.0
}`;

    const result = await this.callLLMStructured<{
      items: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      constraints: Array<{ type: string; description: string; priority: string }>;
      confidence: number;
    }>(userMessage, { type: 'object' }, 'BoardingProposal');

    const items: ProposalItem[] = result.items.map(item => ({
      id: this.genId(),
      type: 'boarding_plan' as ProposalItem['type'],
      title: item.title,
      description: item.description,
      priority: item.priority as ProposalItem['priority'],
      metadata: { ...item.metadata, source: 'boarding-agent' },
    }));

    const proposalConstraints: Constraint[] = result.constraints.map(c => ({
      id: this.genId(),
      type: c.type as Constraint['type'],
      source: this.id,
      description: c.description,
      priority: c.priority as Constraint['priority'],
      value: c.description,
    }));

    if (proposalConstraints.length > 0) {
      this.send('broadcast', 'constraint', { constraints: proposalConstraints }, 0);
    }

    log({
      level: 'info',
      source: this.id,
      message: `Proposed ${items.length} boarding items, ${proposalConstraints.length} constraints`,
      signals: ['boarding', 'proposal'],
    });

    return {
      agentId: this.id,
      domain: this.domain,
      items,
      constraints: proposalConstraints,
      confidence: result.confidence ?? 0.75,
    };
  }

  async negotiate(conflict: Conflict, round: number): Promise<CounterProposal> {
    const userMessage = `作为宠物寄养专家，你需要解决以下冲突：

冲突描述：${conflict.description}
冲突双方：${conflict.agentA} vs ${conflict.agentB}
建议A：${conflict.itemA.title} - ${conflict.itemA.description}
建议B：${conflict.itemB.title} - ${conflict.itemB.description}
严重程度：${conflict.severity}
当前轮次：${round}

寄养方案应以宠物安全和舒适为第一考量。如果健康/医疗Agent有硬约束，必须遵守。

返回JSON：
{
  "adjustedItems": [{ "type": "boarding_plan", "title": "...", "description": "...", "priority": "...", "metadata": {} }],
  "concessions": ["做出的让步"],
  "explanation": "解释原因"
}`;

    const result = await this.callLLMStructured<{
      adjustedItems: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      concessions: string[];
      explanation: string;
    }>(userMessage, { type: 'object' }, 'BoardingCounterProposal');

    return {
      agentId: this.id,
      conflictId: conflict.id,
      adjustedItems: result.adjustedItems.map(item => ({
        id: this.genId(),
        type: item.type as ProposalItem['type'],
        title: item.title,
        description: item.description,
        priority: item.priority as ProposalItem['priority'],
        metadata: { ...item.metadata, source: 'boarding-agent' },
      })),
      concessions: result.concessions,
      explanation: result.explanation,
    };
  }

}
