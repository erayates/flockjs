import { env } from '../internal/env';
import { toBroadcastSignal, type TransportAdapter, type TransportSignal } from './transport';
import {
  isRoomTransportSignal,
  parseTransportEnvelope,
  serializeTransportEnvelope,
} from './transport.protocol';

export function isBroadcastChannelAvailable(): boolean {
  return env.hasBroadcastChannel;
}

export class BroadcastTransportAdapter implements TransportAdapter {
  public readonly kind = 'broadcast' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private channel: BroadcastChannel | null = null;

  private connected = false;

  private readonly handleChannelMessage = (event: MessageEvent<unknown>): void => {
    const signal = parseTransportEnvelope(event.data, {
      transport: 'broadcast',
      allowBinary: false,
    });
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

    if (!env.hasBroadcastChannel) {
      return;
    }

    this.channel = new BroadcastChannel(`flockjs:${this.roomId}`);
    this.channel.addEventListener('message', this.handleChannelMessage);
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (!this.connected || !this.channel) {
      return;
    }

    this.channel.removeEventListener('message', this.handleChannelMessage);
    this.channel.close();

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

    const serialized = serializeTransportEnvelope(signal, {
      transport: 'broadcast',
    });
    if (!serialized) {
      return;
    }

    this.channel.postMessage(serialized);
  }

  public broadcast(signal: TransportSignal): void {
    if (!isRoomTransportSignal(signal)) {
      return;
    }

    this.send(toBroadcastSignal(signal));
  }

  public onMessage(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
}

export function createBroadcastTransportAdapter(roomId: string): TransportAdapter {
  return new BroadcastTransportAdapter(roomId);
}
