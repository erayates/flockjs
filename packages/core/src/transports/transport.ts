import type { Unsubscribe } from '../types';

export type TransportKind = 'broadcast' | 'in-memory' | 'webrtc';

export type TransportSignalType =
  | 'hello'
  | 'welcome'
  | 'presence:update'
  | 'leave'
  | 'cursor:update'
  | 'awareness:update'
  | 'event';

export interface TransportSignal {
  type: TransportSignalType;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  payload?: unknown;
}

export interface TransportAdapter {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(signal: TransportSignal): void;
  subscribe(handler: (signal: TransportSignal) => void): Unsubscribe;
}
