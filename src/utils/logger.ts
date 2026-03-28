import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  source: string;
  message: string;
  signals?: string[];
  data?: unknown;
}

const MEMORY_DIR = join(process.cwd(), 'memory');

/**
 * Write a structured log entry to console and memory/ directory.
 * Includes signal keywords that evolver can extract.
 */
export function log(entry: Omit<LogEntry, 'timestamp'>): void {
  const full: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    signals: ['pet_care', ...(entry.signals ?? [])],
  };
  console.log(`[${full.level.toUpperCase()}] [${full.source}] ${full.message}`);

  try {
    mkdirSync(MEMORY_DIR, { recursive: true });
    const filename = `agent_log_${new Date().toISOString().slice(0, 10)}.jsonl`;
    appendFileSync(
      join(MEMORY_DIR, filename),
      JSON.stringify(full) + '\n',
    );
  } catch {
    // Silently fail if write errors
  }
}

/**
 * Write a complete consult session log for evolver scanning.
 */
export function writeSessionLog(
  consultId: string,
  data: Record<string, unknown>,
): void {
  try {
    mkdirSync(MEMORY_DIR, { recursive: true });
    writeFileSync(
      join(MEMORY_DIR, `session_${consultId}.json`),
      JSON.stringify(data, null, 2),
    );
  } catch {
    console.error('[Logger] Failed to write session log');
  }
}

/**
 * Write a structured evolution event to the JSONL audit log.
 */
export function logEvolutionEvent(event: {
  type: string;
  geneId?: string;
  description: string;
  signals: string[];
  data?: unknown;
}): void {
  const entry = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  try {
    const eventsPath = join(process.cwd(), 'assets', 'gep', 'events.jsonl');
    mkdirSync(join(process.cwd(), 'assets', 'gep'), { recursive: true });
    appendFileSync(eventsPath, JSON.stringify(entry) + '\n');
  } catch {
    // Silently fail
  }

  log({
    level: 'info',
    source: 'evolution',
    message: `[evolution_event] ${event.type}: ${event.description}`,
    signals: event.signals,
    data: event.data,
  });
}
