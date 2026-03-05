import type { TransportAdapter, TransportSignal } from './transport';

function isTransportSignal(value: unknown): value is TransportSignal {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybeSignal = value as Partial<TransportSignal>;
  return (
    typeof maybeSignal.type === 'string' &&
    typeof maybeSignal.roomId === 'string' &&
    typeof maybeSignal.fromPeerId === 'string'
  );
}

export function isBroadcastChannelAvailable(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

export class BroadcastTransportAdapter implements TransportAdapter {
  public readonly kind = 'broadcast' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private channel: BroadcastChannel | null = null;

  private connected = false;

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const payload = event.data;
    if (!isTransportSignal(payload)) {
      return;
    }

    for (const listener of this.listeners) {
      listener(payload);
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

    this.channel.postMessage(signal);
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
