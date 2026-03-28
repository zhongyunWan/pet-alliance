import OpenAI from 'openai';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.LLM_API_KEY;
    const baseURL = process.env.LLM_BASE_URL || 'https://maas.devops.xiaohongshu.com/v1';
    if (!apiKey) {
      throw new Error('LLM_API_KEY environment variable is required');
    }
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

function getModel(): string {
  return process.env.LLM_MODEL || 'minimax-m2.5';
}

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMStructuredRequest<T> extends LLMRequest {
  schema: Record<string, unknown>;
  schemaName: string;
}

/**
 * Call LLM API with plain text response.
 */
export async function callClaude(request: LLMRequest): Promise<string> {
  const openai = getClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: getModel(),
        max_tokens: request.maxTokens ?? 8192,
        temperature: request.temperature ?? 0.7,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      if (content) {
        return content;
      }
      throw new Error('Empty response from LLM');
    } catch (error) {
      lastError = error as Error;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new Error(`LLM API failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
}

/**
 * Call LLM API expecting a JSON-structured response.
 */
export async function callClaudeStructured<T>(request: LLMStructuredRequest<T>): Promise<T> {
  const augmentedPrompt = `${request.systemPrompt}

IMPORTANT: You must respond with a valid JSON object matching this schema:
${JSON.stringify(request.schema, null, 2)}

RULES:
- Output ONLY the raw JSON object, starting with { or [
- No markdown fences, no explanation, no thinking process, no <think> tags
- Keep responses concise: use short descriptions (under 50 chars each)
- Limit array items to at most 10 entries`;

  const raw = await callClaude({
    ...request,
    systemPrompt: augmentedPrompt,
    maxTokens: request.maxTokens ?? 8192,
    temperature: request.temperature ?? 0.3,
  });

  // Strip <think>...</think> tags (some models like minimax emit reasoning traces)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Strip potential markdown fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  // Extract JSON object/array if surrounded by extra text
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) {
      try {
        return JSON.parse(repaired) as T;
      } catch { /* fall through */ }
    }
    throw new Error(`Failed to parse LLM structured response: ${cleaned.slice(0, 200)}...`);
  }
}

function repairTruncatedJson(json: string): string | null {
  if (!json) return null;

  let repaired = json.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  repaired = repaired.replace(/,\s*$/, '');

  const closes: Record<string, string> = { '{': '}', '[': ']' };
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') { stack.push(ch); }
    if (ch === '}' || ch === ']') { stack.pop(); }
  }

  while (stack.length > 0) {
    const open = stack.pop()!;
    repaired += closes[open];
  }

  return repaired;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
