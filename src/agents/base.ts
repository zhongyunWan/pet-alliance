import { v4 as uuid } from 'uuid';
import type {
  AgentCapability,
  AgentMessage,
  Constraint,
  Conflict,
  CounterProposal,
  GeneRecipe,
  Proposal,
  ConsultRequest,
  PetProfile,
  UserFeedback,
} from '../types.js';
import type { ConstraintBus } from '../orchestrator/constraintBus.js';
import { callClaude, callClaudeStructured } from '../utils/llm.js';
import { log } from '../utils/logger.js';

export abstract class BaseAgent {
  readonly id: string;
  readonly domain: string;
  capabilities: AgentCapability[];
  protected systemPrompt: string;
  protected baseSystemPrompt: string;
  protected bus: ConstraintBus | null = null;
  protected receivedMessages: AgentMessage[] = [];
  protected inheritedGenes: string[] = [];

  constructor(id: string, domain: string, systemPrompt: string) {
    this.id = id;
    this.domain = domain;
    this.capabilities = [{ domain, actions: [] }];
    this.systemPrompt = systemPrompt;
    this.baseSystemPrompt = systemPrompt;
  }

  abstract propose(request: ConsultRequest, pet: PetProfile, constraints: Constraint[]): Promise<Proposal>;
  abstract negotiate(conflict: Conflict, round: number): Promise<CounterProposal>;

  async applyFeedback(feedback: UserFeedback): Promise<void> {
    log({
      level: 'info',
      source: this.id,
      message: `Applying feedback: score=${feedback.overallScore}`,
      signals: [this.domain, 'feedback', 'optimize'],
    });
  }

  connectBus(bus: ConstraintBus): void {
    this.bus = bus;
    bus.subscribe(this.id, (msg: AgentMessage) => {
      this.receivedMessages.push(msg);
      this.onReceive(msg);
    });
  }

  send(to: string | 'broadcast', type: AgentMessage['type'], payload: unknown, round: number): void {
    if (!this.bus) {
      throw new Error(`Agent ${this.id} is not connected to a ConstraintBus`);
    }
    this.bus.send(this.id, to, type, payload, round);
  }

  protected onReceive(msg: AgentMessage): void {
    log({
      level: 'debug',
      source: this.id,
      message: `Received ${msg.type} from ${msg.from}`,
      signals: [msg.type],
    });
  }

  inheritGene(gene: GeneRecipe): void {
    const strategyText = gene.strategy.join('\n- ');
    const geneSection = `\n\n[Inherited Experience - ${gene.id} v${gene.version}]\n- ${strategyText}`;

    if (gene.petExperience) {
      const exp = gene.petExperience;
      const treatmentsText = exp.treatments.map(t => `${t.method} (effectiveness: ${t.effectiveness})`).join(', ');
      const tipsText = exp.preventionTips.join('\n  - ');
      this.systemPrompt += geneSection +
        `\n[Pet Experience: ${exp.condition} for ${exp.species}${exp.breed ? ' (' + exp.breed + ')' : ''}] (confidence: ${exp.confidence})` +
        `\nTreatments: ${treatmentsText}` +
        `\nDiet Adjustments: ${exp.dietAdjustments.join(', ')}` +
        `\nPrevention Tips:\n  - ${tipsText}`;
    } else {
      this.systemPrompt += geneSection;
    }

    this.inheritedGenes.push(gene.id);

    log({
      level: 'info',
      source: this.id,
      message: `Inherited gene: ${gene.id} v${gene.version}`,
      signals: ['optimize', 'gene_inherit'],
    });
  }

  // --- LLM helpers for subclasses ---

  protected async callLLM(userMessage: string): Promise<string> {
    return callClaude({
      systemPrompt: this.systemPrompt,
      userMessage,
    });
  }

  protected async callLLMStructured<T>(
    userMessage: string,
    schema: Record<string, unknown>,
    schemaName: string,
  ): Promise<T> {
    return callClaudeStructured<T>({
      systemPrompt: this.systemPrompt,
      userMessage,
      schema,
      schemaName,
    });
  }

  protected genId(): string {
    return uuid();
  }

  resetPrompt(): void {
    this.systemPrompt = this.baseSystemPrompt;
    this.inheritedGenes = [];
  }
}
