import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

export type TransportMode = 'file' | 'http';

export type A2AMessageType = 'hello' | 'publish' | 'fetch' | 'report' | 'heartbeat' | 'validate';

export interface A2AEnvelope {
  protocol: string;
  protocol_version: string;
  message_type: A2AMessageType;
  message_id: string;
  sender_id?: string;
  timestamp: string;
  payload: unknown;
}

export interface A2AMessage {
  id: string;
  type: A2AMessageType;
  fromNodeId: string;
  toNodeId?: string;
  payload: unknown;
  timestamp: number;
}

export interface A2AConfig {
  mode: TransportMode;
  nodeId: string;
  hubUrl?: string;
  inboxDir?: string;
  outboxDir?: string;
  heartbeatIntervalMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000; // 5 min as required by EvoMap

export class A2ABridge {
  private config: A2AConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registered: boolean = false;
  private capabilities: string[] = [];

  private nodeSecret: string = process.env.EVOMAP_NODE_SECRET ?? '';
  private hubNodeId: string = '';

  constructor(config: A2AConfig) {
    this.config = {
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
      inboxDir: join(process.cwd(), 'a2a', 'inbox'),
      outboxDir: join(process.cwd(), 'a2a', 'outbox'),
      ...config,
    };

    if (this.config.mode === 'file') {
      mkdirSync(this.config.inboxDir!, { recursive: true });
      mkdirSync(this.config.outboxDir!, { recursive: true });
    }
  }

  private makeMessageId(): string {
    return `msg_${Date.now()}_${uuid().replace(/-/g, '').slice(0, 4)}`;
  }

  private envelope(messageType: A2AMessageType, payload: unknown): A2AEnvelope {
    const env: A2AEnvelope = {
      protocol: 'gep-a2a',
      protocol_version: '1.0.0',
      message_type: messageType,
      message_id: this.makeMessageId(),
      timestamp: new Date().toISOString(),
      payload,
    };
    if (this.config.nodeId) {
      env.sender_id = this.config.nodeId;
    }
    return env;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.nodeSecret) {
      headers['Authorization'] = `Bearer ${this.nodeSecret}`;
    }
    return headers;
  }

  async hello(capabilities: string[]): Promise<void> {
    this.capabilities = capabilities;

    // EvoMap requires capabilities as object, plus model and env_fingerprint
    const payload: Record<string, unknown> = {
      capabilities: {},
      model: process.env.LLM_MODEL || 'minimax-m2.5',
      env_fingerprint: { platform: process.platform, arch: process.arch },
    };

    const env = this.envelope('hello', payload);
    // sender_id is omitted on first hello (Hub assigns node_id)
    if (!this.config.nodeId || this.config.nodeId === 'petalliance-main') {
      delete env.sender_id;
    }

    if (this.config.mode === 'file') {
      await this.fileSend(this.envelopeToLegacy(env));
    } else {
      const response = await this.httpSendRaw('/a2a/hello', env, false);
      if (response) {
        const result = (response.payload ?? response) as Record<string, unknown>;
        if (result.your_node_id) {
          this.config.nodeId = result.your_node_id as string;
        }
        if (result.node_secret) {
          this.nodeSecret = result.node_secret as string;
        }
        if (result.hub_node_id) {
          this.hubNodeId = result.hub_node_id as string;
        }
        if (result.heartbeat_interval_ms) {
          this.config.heartbeatIntervalMs = result.heartbeat_interval_ms as number;
        }

        // Persist credentials to .env for next restart
        this.persistCredentials();

        // Log claim URL for user to link their EvoMap account
        if (result.claim_url) {
          log({
            level: 'info',
            source: 'a2a_bridge',
            message: `Claim your node at: ${result.claim_url}`,
            signals: ['a2a_claim', 'user_action'],
          });
        }
      }
    }

    this.registered = true;

    log({
      level: 'info',
      source: 'a2a_bridge',
      message: `Registered with Hub as node ${this.config.nodeId}`,
      signals: ['a2a_hello', 'collaboration'],
    });
  }

  async publish(assets: Record<string, unknown>[]): Promise<unknown> {
    const env = this.envelope('publish', { assets });

    if (this.config.mode === 'file') {
      await this.fileSend(this.envelopeToLegacy(env));
      return undefined;
    }

    return this.httpSendRaw('/a2a/publish', env, true);
  }

  async validate(assets: Record<string, unknown>[]): Promise<unknown> {
    const env = this.envelope('validate', { assets });

    if (this.config.mode === 'file') {
      await this.fileSend(this.envelopeToLegacy(env));
      return undefined;
    }

    return this.httpSendRaw('/a2a/validate', env, true);
  }

  async fetch(query: { signals: string[]; category?: string }): Promise<unknown[]> {
    const env = this.envelope('fetch', query);

    if (this.config.mode === 'file') {
      await this.fileSend(this.envelopeToLegacy(env));
      return this.readInbox('fetch');
    }

    const response = await this.httpSendRaw('/a2a/fetch', env, true);
    if (!response) return [];
    const data = response as { genes?: unknown[] };
    return data.genes ?? [];
  }

  async report(feedback: {
    geneId: string;
    score: number;
    context: string;
  }): Promise<void> {
    const env = this.envelope('report', feedback);

    if (this.config.mode === 'file') {
      await this.fileSend(this.envelopeToLegacy(env));
    } else {
      await this.httpSendRaw('/a2a/report', env, true);
    }

    log({
      level: 'info',
      source: 'a2a_bridge',
      message: `Reported feedback for Gene ${feedback.geneId}: score=${feedback.score}`,
      signals: ['a2a_report', 'feedback', 'gene_feedback'],
    });
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    const sendHeartbeat = async () => {
      try {
        if (this.config.mode === 'file') {
          const env = this.envelope('heartbeat', {
            node_id: this.config.nodeId,
            status: 'active',
            capabilities: this.capabilities,
            uptime: process.uptime(),
          });
          await this.fileSend(this.envelopeToLegacy(env));
        } else {
          // EvoMap heartbeat is REST format (no envelope), just node_id + auth header
          const url = `${this.config.hubUrl}/a2a/heartbeat`;
          const response = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({ node_id: this.config.nodeId }),
          });

          if (response.ok) {
            const data = (await response.json()) as Record<string, unknown>;
            // Use server-suggested interval if provided
            if (data.next_heartbeat_ms) {
              this.config.heartbeatIntervalMs = data.next_heartbeat_ms as number;
              this.restartHeartbeatTimer();
            }
          }
        }
      } catch (err) {
        log({
          level: 'warn',
          source: 'a2a_bridge',
          message: `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
          signals: ['a2a_heartbeat_fail', 'error'],
        });
      }
    };

    // Send first heartbeat immediately
    sendHeartbeat();
    this.heartbeatTimer = setInterval(sendHeartbeat, this.config.heartbeatIntervalMs);

    log({
      level: 'info',
      source: 'a2a_bridge',
      message: `Heartbeat started (interval: ${this.config.heartbeatIntervalMs}ms)`,
      signals: ['a2a_heartbeat_start'],
    });
  }

  private restartHeartbeatTimer(): void {
    if (!this.heartbeatTimer) return;
    // Will take effect on next cycle naturally; just log the change
    log({
      level: 'info',
      source: 'a2a_bridge',
      message: `Heartbeat interval updated to ${this.config.heartbeatIntervalMs}ms`,
      signals: ['a2a_heartbeat_interval_update'],
    });
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async destroy(): Promise<void> {
    this.stopHeartbeat();
    this.registered = false;
  }

  // --- Private transport methods ---

  private persistCredentials(): void {
    try {
      const envPath = join(process.cwd(), '.env');
      let content = '';
      if (existsSync(envPath)) {
        content = readFileSync(envPath, 'utf-8');
      }

      // Update or add GEP_NODE_ID
      if (content.includes('GEP_NODE_ID=')) {
        content = content.replace(/GEP_NODE_ID=.*/, `GEP_NODE_ID=${this.config.nodeId}`);
      } else {
        content += `\nGEP_NODE_ID=${this.config.nodeId}`;
      }

      // Update or add EVOMAP_NODE_SECRET
      if (content.includes('EVOMAP_NODE_SECRET=')) {
        content = content.replace(/EVOMAP_NODE_SECRET=.*/, `EVOMAP_NODE_SECRET=${this.nodeSecret}`);
      } else {
        content += `\nEVOMAP_NODE_SECRET=${this.nodeSecret}`;
      }

      writeFileSync(envPath, content);
      log({
        level: 'info',
        source: 'a2a_bridge',
        message: 'Credentials persisted to .env',
        signals: ['credentials_saved'],
      });
    } catch (err) {
      log({
        level: 'warn',
        source: 'a2a_bridge',
        message: `Failed to persist credentials: ${err instanceof Error ? err.message : String(err)}`,
        signals: ['credentials_save_error', 'error'],
      });
    }
  }

  private envelopeToLegacy(env: A2AEnvelope): A2AMessage {
    return {
      id: env.message_id,
      type: env.message_type,
      fromNodeId: env.sender_id ?? this.config.nodeId,
      payload: env.payload,
      timestamp: Date.now(),
    };
  }

  private async fileSend(msg: A2AMessage): Promise<void> {
    const filename = `${msg.type}_${msg.id}.json`;
    const filepath = join(this.config.outboxDir!, filename);
    writeFileSync(filepath, JSON.stringify(msg, null, 2));
  }

  private async httpSendRaw(
    path: string,
    env: A2AEnvelope,
    useAuth: boolean,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.config.hubUrl) {
      throw new Error('A2A Hub URL not configured for HTTP transport');
    }

    const url = `${this.config.hubUrl}${path}`;
    const headers = useAuth ? this.authHeaders() : { 'Content-Type': 'application/json' };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(env),
    });

    if (!response.ok) {
      throw new Error(`A2A HTTP send failed: ${response.status} ${response.statusText}`);
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private readInbox(typeFilter?: string): unknown[] {
    try {
      const files = readdirSync(this.config.inboxDir!);
      const results: unknown[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (typeFilter && !file.startsWith(`${typeFilter}_`)) continue;

        const filepath = join(this.config.inboxDir!, file);
        const content = readFileSync(filepath, 'utf-8');
        const msg = JSON.parse(content) as A2AMessage;
        results.push(msg.payload);

        unlinkSync(filepath);
      }

      return results;
    } catch {
      return [];
    }
  }

}
