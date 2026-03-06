import { toBroadcastSignal, type TransportAdapter, type TransportSignal } from './transport';
import { isRoomTransportSignal, normalizeTransportSignal } from './transport.protocol';

interface InMemoryChannel {
  subscribers: Map<string, (signal: TransportSignal) => void>;
}

const inMemoryChannels = new Map<string, InMemoryChannel>();

function getChannel(roomId: string): InMemoryChannel {
  const existing = inMemoryChannels.get(roomId);
  if (existing) {
    return existing;
  }

  const created: InMemoryChannel = {
    subscribers: new Map(),
  };
  inMemoryChannels.set(roomId, created);
  return created;
}

export class InMemoryTransportAdapter implements TransportAdapter {
  public readonly kind = 'in-memory' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private channel: InMemoryChannel | null = null;

  private connected = false;

  private readonly subscriber = (signal: TransportSignal): void => {
    for (const listener of this.listeners) {
      listener(signal);
    }
  };

  public constructor(
    private readonly roomId: string,
    private readonly peerId: string,
  ) {}

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.channel = getChannel(this.roomId);
    this.channel.subscribers.set(this.peerId, this.subscriber);
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (!this.connected || !this.channel) {
      return;
    }

    this.channel.subscribers.delete(this.peerId);
    if (this.channel.subscribers.size === 0) {
      inMemoryChannels.delete(this.roomId);
    }

    this.channel = null;
    this.connected = false;
    this.listeners.clear();
  }

  public send(signal: TransportSignal): void {
    if (!this.connected || !this.channel) {
      return;
    }

    if (!isRoomTransportSignal(signal)) {
      return;
    }

    const normalizedSignal = normalizeTransportSignal(signal);
    if (!normalizedSignal) {
      return;
    }

    if (!normalizedSignal.toPeerId) {
      this.broadcast(normalizedSignal);
      return;
    }

    const subscriber = this.channel.subscribers.get(normalizedSignal.toPeerId);
    subscriber?.(normalizedSignal);
  }

  public broadcast(signal: TransportSignal): void {
    if (!this.connected || !this.channel) {
      return;
    }

    if (!isRoomTransportSignal(signal)) {
      return;
    }

    const normalizedSignal = normalizeTransportSignal(signal);
    if (!normalizedSignal) {
      return;
    }

    const outboundSignal = toBroadcastSignal(normalizedSignal);
    for (const subscriber of this.channel.subscribers.values()) {
      subscriber(outboundSignal);
    }
  }

  public onMessage(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
}

export function createInMemoryTransportAdapter(roomId: string, peerId: string): TransportAdapter {
  return new InMemoryTransportAdapter(roomId, peerId);
}
