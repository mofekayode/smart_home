import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import type { CairoEvent, EventType } from './types.js';

export class EventBus {
  private redis: Redis;
  private subscribers: Map<EventType, Set<EventHandler>>;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.subscribers = new Map();
  }

  async connect(): Promise<void> {
    await this.redis.ping();
    console.log('Connected to Redis');
  }

  async publish(type: EventType, data: any): Promise<string> {
    const event: CairoEvent = {
      id: uuidv4(),
      type,
      timestamp: new Date().toISOString(),
      data
    } as CairoEvent;

    // Publish to Redis stream
    const streamKey = `stream:${type}`;
    const eventId = await this.redis.xadd(
      streamKey,
      'MAXLEN', '~', '10000',  // Keep last 10k events
      '*',  // Auto-generate ID
      'payload', JSON.stringify(event)
    );

    // Notify local subscribers
    await this.notifySubscribers(event);

    console.log(`Published ${type}: ${event.id}`);
    return eventId as string;
  }

  subscribe(type: EventType, handler: EventHandler): void {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
      this.startConsumer(type);
    }

    this.subscribers.get(type)!.add(handler);
    console.log(`Subscribed to ${type}`);
  }

  private async notifySubscribers(event: CairoEvent): Promise<void> {
    const handlers = this.subscribers.get(event.type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Handler error for ${event.type}:`, error);
      }
    }
  }

  private async startConsumer(type: EventType): Promise<void> {
    const streamKey = `stream:${type}`;
    const groupName = `group:${type}`;
    const consumerName = `consumer:${process.pid}`;

    // Create consumer group
    try {
      await this.redis.xgroup(
        'CREATE', streamKey, groupName, '0', 'MKSTREAM'
      );
    } catch (e) {
      // Group might already exist
    }

    // Start consuming
    this.consumeStream(streamKey, groupName, consumerName);
  }

  private async consumeStream(
    streamKey: string,
    groupName: string,
    consumerName: string
  ): Promise<void> {
    while (true) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP', groupName, consumerName,
          'COUNT', '10',
          'BLOCK', '1000',
          'STREAMS', streamKey, '>'
        ) as [string, [string, string[]][]][] | null;

        if (!results) continue;

        for (const [stream, messages] of results) {
          for (const [id, fields] of messages) {
            const payload = fields[1];  // fields is ['payload', '...']
            if (!payload) continue;

            const event = JSON.parse(payload);

            await this.notifySubscribers(event);

            // Acknowledge
            await this.redis.xack(streamKey, groupName, id);
          }
        }
      } catch (error) {
        console.error('Stream consumption error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
    console.log('Disconnected from Redis');
  }
}

type EventHandler = (event: CairoEvent) => Promise<void> | void;
