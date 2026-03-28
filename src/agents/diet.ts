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

const SYSTEM_PROMPT = `你是一个专业的宠物营养师，专注于宠物饮食规划和营养管理。

你的核心职责：
1. **日常食谱推荐**：根据品种、年龄、体重推荐主粮和辅食搭配
2. **营养均衡评估**：确保蛋白质、脂肪、碳水、维生素矿物质的合理比例
3. **特殊饮食调整**：针对疾病恢复期、孕期、哺乳期、减肥等特殊时期的饮食方案
4. **禁忌食物提醒**：根据物种和品种提醒禁忌食物（如猫不能吃洋葱、葡萄对狗有毒等）
5. **喂食量和频率**：根据体重和活动量计算每日喂食量

你的专业知识包括：
- 犬猫不同生命阶段的营养需求（幼年/成年/老年）
- 常见宠物食品品牌和成分分析
- 自制宠物食谱的营养搭配
- 食物过敏的识别和替代方案
- 体重管理和减肥食谱

约束处理：
- 必须尊重健康Agent发来的饮食约束（如用药期间禁止某些食物）
- 必须考虑宠物的过敏信息
- 如果问诊Agent发来用药期间的饮食限制，优先遵守

回复要求：
- 给出具体的品牌/食材推荐和克数
- 标注每日喂食次数和时间
- 列出必须避免的食物`;

export class DietAgent extends BaseAgent {
  constructor() {
    super('diet-agent', 'diet', SYSTEM_PROMPT);
    this.capabilities = [{
      domain: 'diet',
      actions: ['diet_plan', 'nutrition_assessment', 'feeding_guide', 'food_allergy_check'],
    }];
  }

  async propose(request: ConsultRequest, pet: PetProfile, constraints: Constraint[]): Promise<Proposal> {
    const healthConstraints = constraints.filter(c => c.source === 'health-agent' || c.type === 'health' || c.type === 'medication');
    const constraintText = healthConstraints.length > 0
      ? `\n来自健康/问诊Agent的约束：\n${healthConstraints.map(c => `- [${c.priority}] ${c.description}`).join('\n')}`
      : '';

    const userMessage = `请为以下宠物制定饮食建议：

宠物信息：
- 名字：${pet.name}
- 物种：${pet.species}，品种：${pet.breed}
- 年龄：${pet.age}岁，体重：${pet.weight}kg
- 性别：${pet.gender}
- 生活方式：${pet.indoor ? '室内' : '室内外'}
- 过敏：${pet.allergies.join('、') || '无'}
- 当前用药：${pet.currentMedications.map(m => `${m.name}(${m.purpose})`).join('、') || '无'}
- 病史：${pet.medicalHistory.filter(r => r.outcome !== 'resolved').map(r => r.condition).join('、') || '无正在进行的疾病'}
${constraintText}

用户咨询：${request.text}
咨询类型：${request.type}
${request.parsedContext?.dietaryNeeds ? `饮食需求：${request.parsedContext.dietaryNeeds.join('、')}` : ''}

请返回JSON格式的饮食建议：
{
  "items": [
    {
      "type": "diet_plan",
      "title": "建议标题",
      "description": "详细描述（含具体食材/品牌、克数、频率）",
      "priority": "low/medium/high/urgent",
      "metadata": { "category": "main_food/supplement/treat/forbidden", "dailyAmount": "克", "frequency": "次/天" }
    }
  ],
  "constraints": [
    {
      "type": "diet/allergy",
      "description": "饮食约束",
      "priority": "hard/soft"
    }
  ],
  "confidence": 0.0到1.0
}`;

    const result = await this.callLLMStructured<{
      items: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      constraints: Array<{ type: string; description: string; priority: string }>;
      confidence: number;
    }>(userMessage, { type: 'object' }, 'DietProposal');

    const items: ProposalItem[] = result.items.map(item => ({
      id: this.genId(),
      type: 'diet_plan' as ProposalItem['type'],
      title: item.title,
      description: item.description,
      priority: item.priority as ProposalItem['priority'],
      metadata: { ...item.metadata, source: 'diet-agent' },
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
      message: `Proposed ${items.length} diet items, ${proposalConstraints.length} constraints`,
      signals: ['diet', 'proposal'],
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
    const userMessage = `作为宠物营养师，你需要解决以下冲突：

冲突描述：${conflict.description}
冲突双方：${conflict.agentA} vs ${conflict.agentB}
建议A：${conflict.itemA.title} - ${conflict.itemA.description}
建议B：${conflict.itemB.title} - ${conflict.itemB.description}
严重程度：${conflict.severity}
当前轮次：${round}

如果冲突涉及健康安全（如药物与食物冲突），以健康Agent的建议为准。
其他情况下，寻找营养学上的最优妥协方案。

返回JSON：
{
  "adjustedItems": [{ "type": "diet_plan", "title": "...", "description": "...", "priority": "...", "metadata": {} }],
  "concessions": ["做出的让步"],
  "explanation": "解释原因"
}`;

    const result = await this.callLLMStructured<{
      adjustedItems: Array<{ type: string; title: string; description: string; priority: string; metadata: Record<string, unknown> }>;
      concessions: string[];
      explanation: string;
    }>(userMessage, { type: 'object' }, 'DietCounterProposal');

    return {
      agentId: this.id,
      conflictId: conflict.id,
      adjustedItems: result.adjustedItems.map(item => ({
        id: this.genId(),
        type: item.type as ProposalItem['type'],
        title: item.title,
        description: item.description,
        priority: item.priority as ProposalItem['priority'],
        metadata: { ...item.metadata, source: 'diet-agent' },
      })),
      concessions: result.concessions,
      explanation: result.explanation,
    };
  }

}
