import type { PresenceData, RoomOptions } from '../types';
import { createBroadcastTransportAdapter, isBroadcastChannelAvailable } from './broadcast';
import type { TransportAdapter, TransportSignal } from './transport';
import { createWebRTCTransportAdapter } from './webrtc';
import { isWebRTCSignalingFallbackEligibleError } from './webrtc.signaling';

export class WebRTCFallbackTransportAdapter<
  TPresence extends PresenceData = PresenceData,
> implements TransportAdapter {
  public readonly kind = 'webrtc' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private activeTransport: TransportAdapter;

  private transportUnsubscribe: (() => void) | null = null;

  private connected = false;

  public constructor(
    private readonly roomId: string,
    peerId: string,
    options: RoomOptions<TPresence>,
  ) {
    this.activeTransport = createWebRTCTransportAdapter(roomId, peerId, options);
    this.attachTransport(this.activeTransport);
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      await this.activeTransport.connect();
      this.connected = true;
      return;
    } catch (error) {
      await this.activeTransport.disconnect().catch(() => {
        return undefined;
      });

      if (!this.shouldFallback(error)) {
        throw error;
      }
    }

    const broadcastTransport = createBroadcastTransportAdapter(this.roomId);
    this.replaceTransport(broadcastTransport);

    try {
      await broadcastTransport.connect();
      this.connected = true;
    } catch (error) {
      await broadcastTransport.disconnect().catch(() => {
        return undefined;
      });
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    await this.activeTransport.disconnect();
  }

  public send(signal: TransportSignal): void {
    this.activeTransport.send(signal);
  }

  public subscribe(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private attachTransport(transport: TransportAdapter): void {
    this.transportUnsubscribe = transport.subscribe((signal) => {
      for (const listener of this.listeners) {
        listener(signal);
      }
    });
  }

  private replaceTransport(transport: TransportAdapter): void {
    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;
    this.activeTransport = transport;
    this.attachTransport(transport);
  }

  private shouldFallback(error: unknown): boolean {
    return isBroadcastChannelAvailable() && isWebRTCSignalingFallbackEligibleError(error);
  }
}

export function createWebRTCFallbackTransportAdapter<TPresence extends PresenceData = PresenceData>(
  roomId: string,
  peerId: string,
  options: RoomOptions<TPresence>,
): TransportAdapter {
  return new WebRTCFallbackTransportAdapter(roomId, peerId, options);
}
