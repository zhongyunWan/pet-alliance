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
