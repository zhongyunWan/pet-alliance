import { computeAssetId } from './hashUtils.js';
import type { GeneRecipe } from '../types.js';

export function buildGeneAsset(gene: GeneRecipe): Record<string, unknown> {
  const asset: Record<string, unknown> = {
    type: 'Gene',
    schema_version: '1.5.0',
    category: gene.category,
    signals_match: gene.signalsMatch,
    summary: `[${gene.category}] Pet care gene ${gene.id}: ${gene.strategy.slice(0, 3).join(', ')}`,
  };
  asset.asset_id = computeAssetId(asset);
  return asset;
}

export function buildCapsuleAsset(
  gene: GeneRecipe,
  geneAssetId: string,
): Record<string, unknown> {
  const strategyText = gene.strategy.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const content = [
    `Intent: ${gene.category} pet care for ${gene.signalsMatch.join(', ')}`,
    '',
    'Strategy:',
    strategyText,
    '',
    `Outcome score: ${gene.petExperience?.confidence ?? 0.8}`,
  ].join('\n');

  const asset: Record<string, unknown> = {
    type: 'Capsule',
    schema_version: '1.5.0',
    trigger: gene.signalsMatch,
    gene: geneAssetId,
    summary: `Pet care capsule: ${gene.id} (${gene.category})`,
    content,
    confidence: gene.petExperience?.confidence ?? 0.8,
    blast_radius: { files: 1, lines: gene.strategy.length * 2 + gene.preconditions.length },
    outcome: { status: 'success', score: gene.petExperience?.confidence ?? 0.8 },
    env_fingerprint: { platform: process.platform, arch: process.arch },
  };
  asset.asset_id = computeAssetId(asset);
  return asset;
}

export function buildEvolutionEventAsset(
  gene: GeneRecipe,
  capsuleAssetId: string,
  geneAssetId: string,
): Record<string, unknown> {
  const asset: Record<string, unknown> = {
    type: 'EvolutionEvent',
    intent: gene.category,
    capsule_id: capsuleAssetId,
    genes_used: [geneAssetId],
    outcome: { status: 'success', score: gene.petExperience?.confidence ?? 0.8 },
    mutations_tried: 1,
    total_cycles: 1,
  };
  asset.asset_id = computeAssetId(asset);
  return asset;
}

/**
 * Build a complete EvoMap bundle: [Gene, Capsule, EvolutionEvent]
 */
export function buildBundle(gene: GeneRecipe): Record<string, unknown>[] {
  const geneAsset = buildGeneAsset(gene);
  const capsuleAsset = buildCapsuleAsset(gene, geneAsset.asset_id as string);
  const eventAsset = buildEvolutionEventAsset(
    gene,
    capsuleAsset.asset_id as string,
    geneAsset.asset_id as string,
  );
  return [geneAsset, capsuleAsset, eventAsset];
}
