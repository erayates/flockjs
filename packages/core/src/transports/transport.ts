import type {
  PeerProtocolCapabilities,
  PeerProtocolSession,
  PeerWireMessage,
  PeerWireMessageType,
} from '../protocol/peer-message';
import type { FlockError, Unsubscribe } from '../types';

export type TransportKind = 'broadcast' | 'in-memory' | 'webrtc' | 'websocket';

export type RoomTransportSignalType = PeerWireMessageType;
export type RoomTransportSignal = PeerWireMessage;

export interface TransportErrorSignal {
  type: 'transport:error';
  roomId: string;
  fromPeerId: string;
  payload: {
    error: FlockError;
  };
}

export interface TransportDisconnectedSignal {
  type: 'transport:disconnected';
  roomId: string;
  fromPeerId: string;
  payload: {
    reason?: string;
  };
}

export type TransportSignal =
  | RoomTransportSignal
  | TransportErrorSignal
  | TransportDisconnectedSignal;

export interface ITransport {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(signal: TransportSignal): void;
  broadcast(signal: TransportSignal): void;
  onMessage(handler: (signal: TransportSignal) => void): Unsubscribe;
}

export type TransportAdapter = ITransport;

export type TransportProtocolSupport = {
  capabilities: PeerProtocolCapabilities;
  bootstrapSession: PeerProtocolSession;
};

export function toBroadcastSignal(signal: RoomTransportSignal): RoomTransportSignal {
  if (signal.toPeerId === undefined) {
    return signal;
  }

  const broadcastSignal = { ...signal };
  delete broadcastSignal.toPeerId;
  return broadcastSignal;
}
