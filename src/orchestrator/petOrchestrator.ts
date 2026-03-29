import { v4 as uuid } from 'uuid';
import type {
  Conflict,
  ConsultRequest,
  ConsultResult,
  Constraint,
  GeneRecipe,
  ParsedPetContext,
  PetProfile,
  Proposal,
  ProposalItem,
} from '../types.js';
import type { BaseAgent } from '../agents/base.js';
import { ConstraintBus } from './constraintBus.js';
import { callClaudeStructured } from '../utils/llm.js';
import { log, writeSessionLog } from '../utils/logger.js';

const MAX_NEGOTIATION_ROUNDS = 5;

// Per-agent proposal summary for frontend visualization
export interface AgentProposalSummary {
  agentId: string;
  domain: string;
  items: Array<{ title: string; description: string; priority: string; type: string }>;
  confidence: number;
  durationMs: number;
}

// Conflict info for frontend display
export interface ConflictInfo {
  type: string;
  description: string;
  resolution: string;
}

/**
 * Core orchestrator: 5-phase pet consultation pipeline.
 */
export class PetOrchestrator {
  private agents: BaseAgent[];
  private bus: ConstraintBus;
  private gepClient: { fetchGene: (context: ParsedPetContext) => Promise<GeneRecipe | null> } | null = null;

  constructor(agents: BaseAgent[]) {
    this.agents = agents;
    this.bus = new ConstraintBus();

    for (const agent of agents) {
      agent.connectBus(this.bus);
    }
  }

  setGepClient(client: { fetchGene: (context: ParsedPetContext) => Promise<GeneRecipe | null> }): void {
    this.gepClient = client;
  }

  getBus(): ConstraintBus {
    return this.bus;
  }

  /**
   * Main entry: orchestrate a full pet consultation session.
   */
  async consult(request: ConsultRequest, pet: PetProfile): Promise<ConsultResult & {
    agentProposals: AgentProposalSummary[];
    conflicts: ConflictInfo[];
  }> {
    const consultId = request.id || uuid();
    const startTime = Date.now();
    this.bus.clear();

    log({
      level: 'info',
      source: 'Orchestrator',
      message: `Starting consultation: ${request.text}`,
      signals: ['pet_care', 'start'],
      data: { consultId, petId: pet.id },
    });

    // === Phase 1: Parse NL → structured context ===
    const context = await this.parseContext(request);
    request.parsedContext = context;

    this.bus.send('orchestrator', 'broadcast', 'info',
      { phase: 'parse', message: `解析完成: 紧急程度=${context.urgency}, 关注点=${context.concerns.join('、')}` }, 0);

    log({
      level: 'info',
      source: 'Orchestrator',
      message: `Phase 1: urgency=${context.urgency}, concerns=${context.concerns.join(', ')}`,
      signals: ['parse'],
      data: context,
    });

    // Reset agent prompts to prevent gene accumulation across requests
    for (const agent of this.agents) {
      agent.resetPrompt();
    }

    // === Phase 2: Load pet experience Gene from EvoMap ===
    const genesApplied: string[] = [];
    if (this.gepClient && !request.skipGenes) {
      try {
        const petGene = await this.gepClient.fetchGene(context);
        if (petGene) {
          for (const agent of this.agents) {
            agent.inheritGene(petGene);
          }
          genesApplied.push(petGene.id);
          this.bus.send('orchestrator', 'broadcast', 'info',
            { phase: 'gene', message: `继承宠物经验: ${petGene.id}` }, 0);
        }
      } catch (error) {
        log({ level: 'warn', source: 'Orchestrator', message: `Gene fetch failed: ${(error as Error).message}`, signals: ['error'] });
      }
    }

    // === Phase 3: Only relevant agents propose in parallel ===
    const agentProposals: AgentProposalSummary[] = [];
    const proposals: Proposal[] = [];

    const relevantDomains = context.relevantDomains ?? [];
    const relevantAgents = relevantDomains.length > 0
      ? this.agents.filter(a => relevantDomains.includes(a.domain))
      : this.agents; // fallback: all agents if no domains specified

    log({
      level: 'info',
      source: 'Orchestrator',
      message: `Relevant domains: [${relevantDomains.join(', ')}], invoking ${relevantAgents.length}/${this.agents.length} agents`,
      signals: ['routing'],
    });

    // Record skipped agents
    for (const agent of this.agents) {
      if (!relevantAgents.includes(agent)) {
        agentProposals.push({
          agentId: agent.id,
          domain: agent.domain,
          items: [],
          confidence: 0,
          durationMs: 0,
        });
      }
    }

    const startTimes = relevantAgents.map(() => Date.now());
    const results = await Promise.allSettled(
      relevantAgents.map(agent => agent.propose(request, pet, [])),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const agent = relevantAgents[i];
      const durationMs = Date.now() - startTimes[i];

      if (result.status === 'fulfilled') {
        proposals.push(result.value);

        agentProposals.push({
          agentId: agent.id,
          domain: agent.domain,
          items: result.value.items.map(item => ({
            title: item.title,
            description: item.description,
            priority: item.priority,
            type: item.type,
          })),
          confidence: result.value.confidence,
          durationMs,
        });

        this.bus.send(agent.id, 'orchestrator', 'proposal',
          { itemCount: result.value.items.length, confidence: result.value.confidence }, 0);
      } else {
        log({ level: 'error', source: 'Orchestrator', message: `${agent.id} failed: ${result.reason}`, signals: ['error'] });
        agentProposals.push({
          agentId: agent.id,
          domain: agent.domain,
          items: [],
          confidence: 0,
          durationMs,
        });
      }
    }

    log({
      level: 'info',
      source: 'Orchestrator',
      message: `Phase 3: ${proposals.length} proposals collected`,
      signals: ['proposals'],
    });

    // === Phase 4: Detect conflicts and negotiate (max 5 rounds) ===
    const allItems = proposals.flatMap(p => p.items);
    const allConstraints = proposals.flatMap(p => p.constraints);
    const { fixedItems, conflicts, totalRounds } = await this.resolveConflicts(allItems, allConstraints, proposals);

    for (const c of conflicts) {
      this.bus.send('orchestrator', 'broadcast', 'info',
        { phase: 'conflict', message: `冲突修正: ${c.description} → ${c.resolution}` }, totalRounds);
    }

    // === Phase 5: Deduplicate and assemble final result ===
    const deduped = this.deduplicateItems(fixedItems);

    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const sorted = deduped.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
    const recommendations = sorted.slice(0, 2);
    const processingTimeMs = Date.now() - startTime;

    const consultResult: ConsultResult = {
      id: consultId,
      petId: pet.id,
      request,
      recommendations,
      agentMessages: this.bus.getLog(),
      negotiationRounds: totalRounds,
      genesApplied,
      metadata: {
        createdAt: Date.now(),
        processingTimeMs,
      },
    };

    // Log session for evolver
    writeSessionLog(consultId, {
      consultId,
      petId: pet.id,
      request: request.text,
      context,
      proposals: agentProposals.map(p => ({ agent: p.agentId, itemCount: p.items.length })),
      conflicts: conflicts.length,
      recommendations: recommendations.length,
      processingTimeMs,
      signals: ['pet_care', 'session_complete'],
    });

    log({
      level: 'info',
      source: 'Orchestrator',
      message: `Done: ${recommendations.length} recommendations, ${conflicts.length} conflicts resolved in ${totalRounds} rounds, ${processingTimeMs}ms`,
      signals: ['complete'],
    });

    return { ...consultResult, agentProposals, conflicts };
  }

  // --- Private helpers ---

  /**
   * Deduplicate items with similar titles/descriptions.
   * Keeps the item with the longer (more detailed) description.
   */
  private deduplicateItems(items: ProposalItem[]): ProposalItem[] {
    if (items.length <= 1) return items;

    const kept: ProposalItem[] = [];
    for (const item of items) {
      const duplicate = kept.find(existing => this.isSimilar(existing, item));
      if (duplicate) {
        // Keep the one with more detail
        if (item.description.length > duplicate.description.length) {
          const idx = kept.indexOf(duplicate);
          kept[idx] = item;
        }
      } else {
        kept.push(item);
      }
    }

    log({
      level: 'info',
      source: 'Orchestrator',
      message: `Dedup: ${items.length} items → ${kept.length} unique`,
      signals: ['dedup'],
    });

    return kept;
  }

  /**
   * Check if two items are semantically similar based on keyword overlap.
   */
  private isSimilar(a: ProposalItem, b: ProposalItem): boolean {
    const normalize = (s: string) => s.replace(/[，。、！？\s]/g, '');
    const titleA = normalize(a.title);
    const titleB = normalize(b.title);

    // Exact or near-exact title match
    if (titleA === titleB) return true;

    // Extract keywords (Chinese chars in chunks + meaningful segments)
    const getKeywords = (text: string): Set<string> => {
      const words = new Set<string>();
      // Split on common delimiters and collect 2-4 char segments
      const segments = text.split(/[，。、！？\s,.:;]+/).filter(s => s.length >= 2);
      for (const seg of segments) {
        words.add(seg);
        // Also add 2-char sliding window for Chinese text matching
        for (let i = 0; i <= seg.length - 2; i++) {
          words.add(seg.slice(i, i + 2));
        }
      }
      return words;
    };

    const kwA = getKeywords(a.title + a.description);
    const kwB = getKeywords(b.title + b.description);
    const intersection = [...kwA].filter(w => kwB.has(w)).length;
    const union = new Set([...kwA, ...kwB]).size;
    const similarity = union > 0 ? intersection / union : 0;

    return similarity > 0.5;
  }

  private async parseContext(request: ConsultRequest): Promise<ParsedPetContext> {
    if (request.parsedContext) {
      return request.parsedContext;
    }

    return callClaudeStructured<ParsedPetContext>({
      systemPrompt: '你是一个宠物咨询请求解析器。将用户的自然语言咨询解析为结构化数据。你需要精准判断用户问题涉及哪些专业领域。',
      userMessage: `解析以下宠物咨询请求：
"${request.text}"

返回JSON：
{
  "symptoms": ["症状列表，如无则为空数组"],
  "urgency": "low/medium/high/emergency",
  "concerns": ["用户关注点"],
  "dietaryNeeds": ["饮食需求，如无则为空数组"],
  "boardingDates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } 或 null,
  "specialRequirements": ["特殊要求"],
  "relevantDomains": ["相关领域数组"]
}

relevantDomains的取值范围和判断标准：
- "health"：涉及疫苗、驱虫、健康检查、行为异常、预防保健
- "diet"：涉及饮食、营养、喂食、猫粮狗粮、食物选择、体重管理
- "medical"：涉及生病症状、疾病诊断、用药、就医、受伤、中毒
- "boarding"：涉及寄养、托管、外出照顾、出差旅行期间宠物安排

只选择与用户问题直接相关的领域。例如：
- "猫为什么睡纸箱不睡猫窝" → ["health"]（行为问题属于健康领域）
- "猫拉稀怎么办" → ["medical", "diet"]（症状需要医疗，可能涉及饮食调整）
- "出差一周猫怎么安排" → ["boarding"]
- "猫粮推荐" → ["diet"]
不要添加用户没有问到的领域。`,
      schema: { type: 'object' },
      schemaName: 'ParsedPetContext',
    });
  }

  /**
   * Detect conflicts between proposals and negotiate resolution.
   * Uses LLM to identify conflicts, then agents negotiate up to MAX_NEGOTIATION_ROUNDS.
   */
  private async resolveConflicts(
    allItems: ProposalItem[],
    allConstraints: Constraint[],
    proposals: Proposal[],
  ): Promise<{ fixedItems: ProposalItem[]; conflicts: ConflictInfo[]; totalRounds: number }> {
    if (allItems.length === 0) {
      return { fixedItems: [], conflicts: [], totalRounds: 0 };
    }

    // Use LLM to detect conflicts
    const conflictDetection = await callClaudeStructured<{
      conflicts: Array<{
        type: string;
        description: string;
        agentA: string;
        agentB: string;
        itemAIndex: number;
        itemBIndex: number;
        severity: string;
      }>;
    }>({
      systemPrompt: '你是一个冲突检测专家。分析多个宠物护理建议之间的潜在冲突。',
      userMessage: `分析以下宠物护理建议之间的冲突：

建议列表：
${allItems.map((item, i) => `[${i}] (${item.metadata?.['source'] ?? 'unknown'}) ${item.title}: ${item.description}`).join('\n')}

约束列表：
${allConstraints.map(c => `[${c.source}][${c.priority}] ${c.description}`).join('\n')}

返回JSON：
{
  "conflicts": [
    {
      "type": "medication_diet/schedule/health_safety/redundancy",
      "description": "冲突描述",
      "agentA": "agent-id",
      "agentB": "agent-id",
      "itemAIndex": 0,
      "itemBIndex": 1,
      "severity": "low/medium/high"
    }
  ]
}
如果没有冲突，返回空数组。`,
      schema: { type: 'object' },
      schemaName: 'ConflictDetection',
    });

    const detectedConflicts = conflictDetection.conflicts ?? [];

    if (detectedConflicts.length === 0) {
      return { fixedItems: allItems, conflicts: [], totalRounds: 0 };
    }

    // Negotiate conflicts
    const resolvedConflicts: ConflictInfo[] = [];
    let currentItems = [...allItems];
    let totalRounds = 0;

    for (const detected of detectedConflicts) {
      if (totalRounds >= MAX_NEGOTIATION_ROUNDS) break;

      const itemA = allItems[detected.itemAIndex];
      const itemB = allItems[detected.itemBIndex];
      if (!itemA || !itemB) continue;

      const conflict: Conflict = {
        id: uuid(),
        type: detected.type,
        description: detected.description,
        agentA: detected.agentA,
        agentB: detected.agentB,
        itemA,
        itemB,
        severity: detected.severity as Conflict['severity'],
      };

      // Find the agent responsible for resolution (higher priority domain wins)
      const domainPriority = ['medical', 'health', 'diet', 'boarding'];
      const agentA = this.agents.find(a => a.id === detected.agentA);
      const agentB = this.agents.find(a => a.id === detected.agentB);
      const resolver = domainPriority.indexOf(agentA?.domain ?? '') <= domainPriority.indexOf(agentB?.domain ?? '')
        ? agentA : agentB;

      if (resolver) {
        try {
          totalRounds++;
          const counterProposal = await resolver.negotiate(conflict, totalRounds);

          // Replace conflicting items with adjusted ones
          currentItems = currentItems.filter(item => item.id !== itemA.id && item.id !== itemB.id);
          currentItems.push(...counterProposal.adjustedItems);

          this.bus.send(resolver.id, 'orchestrator', 'counter_proposal', {
            conflictId: conflict.id,
            adjustedCount: counterProposal.adjustedItems.length,
          }, totalRounds);

          resolvedConflicts.push({
            type: detected.type,
            description: detected.description,
            resolution: counterProposal.explanation,
          });
        } catch (err) {
          log({
            level: 'warn',
            source: 'Orchestrator',
            message: `Negotiation failed for conflict ${conflict.id}: ${(err as Error).message}`,
            signals: ['error', 'negotiation'],
          });
          // Keep both items if negotiation fails
          resolvedConflicts.push({
            type: detected.type,
            description: detected.description,
            resolution: '协商失败，保留双方建议',
          });
        }
      }
    }

    return { fixedItems: currentItems, conflicts: resolvedConflicts, totalRounds };
  }
}
