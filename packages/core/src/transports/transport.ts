import type { Unsubscribe } from '../types';

export type TransportKind = 'broadcast' | 'in-memory' | 'webrtc' | 'websocket';

export type TransportSignalType =
  | 'hello'
  | 'welcome'
  | 'presence:update'
  | 'leave'
  | 'cursor:update'
  | 'awareness:update'
  | 'event'
  | 'transport:error'
  | 'transport:disconnected';

export interface TransportSignal {
  type: TransportSignalType;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  payload?: unknown;
}

export interface ITransport {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(signal: TransportSignal): void;
  broadcast(signal: TransportSignal): void;
  onMessage(handler: (signal: TransportSignal) => void): Unsubscribe;
}

export type TransportAdapter = ITransport;

export function toBroadcastSignal(signal: TransportSignal): TransportSignal {
  if (signal.toPeerId === undefined) {
    return signal;
  }

  const broadcastSignal = { ...signal };
  delete broadcastSignal.toPeerId;
  return broadcastSignal;
}
