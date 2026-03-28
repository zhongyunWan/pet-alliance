import { createHash } from 'node:crypto';

/**
 * Recursively sort object keys for deterministic serialization.
 */
function sortRecursive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortRecursive);
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortRecursive((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Produce canonical JSON: recursively sorted keys, compact separators.
 * Matches Python's json.dumps(obj, separators=(",", ":"), ensure_ascii=False).
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortRecursive(obj));
}

/**
 * Compute asset_id = sha256(canonical_json(asset_without_asset_id)).
 * Returns "sha256:<hex_digest>".
 */
export function computeAssetId(asset: Record<string, unknown>): string {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(asset)) {
    if (k !== 'asset_id') cleaned[k] = v;
  }
  const canonical = canonicalJson(cleaned);
  const digest = createHash('sha256').update(canonical, 'utf-8').digest('hex');
  return `sha256:${digest}`;
}
