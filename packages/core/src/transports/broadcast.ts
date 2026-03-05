import type { TransportAdapter, TransportSignal } from './transport';

const BROADCAST_SOURCE = 'flockjs';
const BROADCAST_VERSION = 1;
const TRANSPORT_SIGNAL_TYPES = new Set<TransportSignal['type']>([
  'hello',
  'welcome',
  'presence:update',
  'leave',
  'cursor:update',
  'awareness:update',
  'event',
]);

interface BroadcastEnvelope {
  source: typeof BROADCAST_SOURCE;
  version: typeof BROADCAST_VERSION;
  signal: TransportSignal;
}

function isTransportSignal(value: unknown): value is TransportSignal {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybeSignal = value as Partial<TransportSignal>;
  return (
    typeof maybeSignal.type === 'string' &&
    TRANSPORT_SIGNAL_TYPES.has(maybeSignal.type as TransportSignal['type']) &&
    typeof maybeSignal.roomId === 'string' &&
    typeof maybeSignal.fromPeerId === 'string' &&
    (maybeSignal.toPeerId === undefined || typeof maybeSignal.toPeerId === 'string')
  );
}

export function isBroadcastChannelAvailable(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function serializeSignal(signal: TransportSignal): string {
  const envelope: BroadcastEnvelope = {
    source: BROADCAST_SOURCE,
    version: BROADCAST_VERSION,
    signal,
  };

  return JSON.stringify(envelope);
}

function deserializeSignal(payload: unknown): TransportSignal | null {
  if (typeof payload !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const envelope = parsed as Partial<BroadcastEnvelope>;
  if (envelope.source !== BROADCAST_SOURCE || envelope.version !== BROADCAST_VERSION) {
    return null;
  }

  if (!isTransportSignal(envelope.signal)) {
    return null;
  }

  return envelope.signal;
}

export class BroadcastTransportAdapter implements TransportAdapter {
  public readonly kind = 'broadcast' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private channel: BroadcastChannel | null = null;

  private connected = false;

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const signal = deserializeSignal(event.data);
    if (!signal) {
      return;
    }

    for (const listener of this.listeners) {
      listener(signal);
    }
  };

  public constructor(private readonly roomId: string) {}

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.channel = new BroadcastChannel(`flockjs:${this.roomId}`);
    this.channel.addEventListener('message', this.onMessage);
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (!this.connected || !this.channel) {
      return;
    }

    this.channel.removeEventListener('message', this.onMessage);
    this.channel.close();

    this.channel = null;
    this.connected = false;
    this.listeners.clear();
  }

  public send(signal: TransportSignal): void {
    if (!this.connected || !this.channel) {
      return;
    }

    const serialized = serializeSignal(signal);
    this.channel.postMessage(serialized);
  }

  public subscribe(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
}

export function createBroadcastTransportAdapter(roomId: string): TransportAdapter {
  return new BroadcastTransportAdapter(roomId);
}
