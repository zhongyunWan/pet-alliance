import { join } from 'node:path';
import { log, logEvolutionEvent } from '../utils/logger.js';
import { A2ABridge, type A2AConfig } from './a2aBridge.js';
import { RecipeManager } from './recipes.js';
import { buildBundle } from './assetBuilder.js';
import type { GeneRecipe } from '../types.js';

export interface GepClientConfig {
  hubUrl: string;
  nodeId: string;
  transportMode: A2AConfig['mode'];
  genesPath?: string;
}

export class GepClient {
  private config: GepClientConfig;
  private bridge: A2ABridge;
  private recipes: RecipeManager;
  private initialized: boolean = false;

  constructor(config: GepClientConfig) {
    this.config = config;
    this.bridge = new A2ABridge({
      mode: config.transportMode,
      nodeId: config.nodeId,
      hubUrl: config.hubUrl,
    });
    this.recipes = new RecipeManager();
  }

  async init(): Promise<void> {
    const genesPath = this.config.genesPath ?? join(process.cwd(), 'assets', 'gep', 'genes.json');
    await this.recipes.loadFromFile(genesPath);

    await this.bridge.hello([
      'pet_care',
      'pet_health',
      'multi_agent_collaboration',
    ]);

    this.bridge.startHeartbeat();
    this.initialized = true;

    log({
      level: 'info',
      source: 'gep_client',
      message: 'GEP Client initialized',
      signals: ['gep_init', 'collaboration'],
    });
  }

  async publishGene(gene: GeneRecipe): Promise<void> {
    await this.recipes.addRecipe(gene);

    // Build complete bundle: Gene + Capsule + EvolutionEvent
    const assets = buildBundle(gene);

    await this.bridge.validate(assets);
    await this.bridge.publish(assets);

    const geneAssetId = assets[0].asset_id as string;
    logEvolutionEvent({
      type: 'gene_published',
      geneId: gene.id,
      description: `Published bundle for Gene ${gene.id} v${gene.version} (asset_id: ${geneAssetId}) to EvoMap network`,
      signals: ['gene_published', 'a2a_publish', gene.category],
    });
  }

  async fetchGene(condition: string): Promise<GeneRecipe | null> {
    // Match by symptom/condition signals
    const signals = ['pet_health', 'treatment_success', condition.toLowerCase()];
    const localMatches = this.recipes.findBySignals(signals);

    if (localMatches.length > 0) {
      const best = localMatches.sort((a, b) => b.version - a.version)[0];
      log({
        level: 'info',
        source: 'gep_client',
        message: `Found local Gene ${best.id} for condition: ${condition}`,
        signals: ['gene_fetched', 'local_hit'],
      });
      return best;
    }

    // Try A2A Hub fetch
    try {
      const remoteResults = await this.bridge.fetch({
        signals,
        category: 'optimize',
      });

      if (remoteResults.length > 0) {
        const remoteGene = this.normalizeRemoteGene(remoteResults[0] as Record<string, unknown>);
        log({
          level: 'info',
          source: 'gep_client',
          message: `Fetched remote Gene ${remoteGene.id} for condition: ${condition}`,
          signals: ['gene_fetched', 'remote_hit', 'cross_pet_transfer'],
        });
        return remoteGene;
      }
    } catch (err) {
      log({
        level: 'warn',
        source: 'gep_client',
        message: `A2A fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        signals: ['a2a_fetch_error', 'error'],
      });
    }

    log({
      level: 'info',
      source: 'gep_client',
      message: `No Gene found for condition: ${condition}`,
      signals: ['gene_miss', 'new_condition', 'no_local_experience'],
    });
    return null;
  }

  async clearAllGenes(): Promise<void> {
    await this.recipes.clearAll();
    log({
      level: 'info',
      source: 'gep_client',
      message: 'All genes cleared from local store',
      signals: ['genes_cleared'],
    });
  }

  async reportFeedback(geneId: string, score: number, context: string): Promise<void> {
    await this.bridge.report({ geneId, score, context });

    logEvolutionEvent({
      type: 'gene_feedback',
      geneId,
      description: `Feedback for Gene ${geneId}: score=${score}`,
      signals: ['feedback', 'user_feedback_positive', 'gene_feedback'],
      data: { score, context },
    });
  }

  private normalizeRemoteGene(raw: Record<string, unknown>): GeneRecipe {
    return {
      id: (raw.id as string) ?? 'remote_gene',
      category: (raw.category as GeneRecipe['category']) ?? 'optimize',
      signalsMatch: (raw.signals_match ?? raw.signalsMatch ?? []) as string[],
      preconditions: (raw.preconditions ?? []) as string[],
      strategy: (raw.strategy ?? []) as string[],
      constraints: (raw.constraints ?? {}) as Record<string, unknown>,
      validation: (raw.validation ?? []) as string[],
      version: (raw.version as number) ?? 1,
      petExperience: (raw.pet_experience ?? raw.petExperience) as GeneRecipe['petExperience'],
    };
  }
}
