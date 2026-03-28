import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import type { AgentMessage, MessageType } from '../types.js';
import { log } from '../utils/logger.js';

export type MessageHandler = (msg: AgentMessage) => void;

export class ConstraintBus extends EventEmitter {
  private messageLog: AgentMessage[] = [];
  private subscribers: Map<string, MessageHandler[]> = new Map();

  subscribe(agentId: string, handler: MessageHandler): void {
    const handlers = this.subscribers.get(agentId) ?? [];
    handlers.push(handler);
    this.subscribers.set(agentId, handlers);
  }

  publish(msg: AgentMessage): void {
    if (!msg.id) {
      msg.id = uuid();
    }
    if (!msg.timestamp) {
      msg.timestamp = Date.now();
    }

    this.messageLog.push(msg);

    log({
      level: 'info',
      source: 'ConstraintBus',
      message: `[Round ${msg.round}] ${msg.from} → ${msg.to}: ${msg.type}`,
      signals: ['constraint', 'collaboration', msg.type],
      data: { messageId: msg.id, from: msg.from, to: msg.to, type: msg.type },
    });

    this.emit('message', msg);

    if (msg.to === 'broadcast') {
      for (const [agentId, handlers] of this.subscribers) {
        if (agentId !== msg.from) {
          handlers.forEach(h => h(msg));
        }
      }
    } else {
      const handlers = this.subscribers.get(msg.to) ?? [];
      handlers.forEach(h => h(msg));
    }
  }

  send(
    from: string,
    to: string | 'broadcast',
    type: MessageType,
    payload: unknown,
    round: number,
  ): AgentMessage {
    const msg: AgentMessage = {
      id: uuid(),
      from,
      to,
      type,
      payload,
      round,
      timestamp: Date.now(),
    };
    this.publish(msg);
    return msg;
  }

  getLog(): AgentMessage[] {
    return [...this.messageLog];
  }

  clear(): void {
    this.messageLog = [];
  }
}
