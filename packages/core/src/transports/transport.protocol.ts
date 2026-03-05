import { isObject } from '../internal/guards';
import type { TransportSignal } from './transport';

const TRANSPORT_SOURCE = 'flockjs';
const TRANSPORT_VERSION = 1;
const ROOM_TRANSPORT_SIGNAL_TYPES = new Set<string>([
  'hello',
  'welcome',
  'presence:update',
  'leave',
  'cursor:update',
  'awareness:update',
  'event',
]);

interface TransportEnvelope {
  source: typeof TRANSPORT_SOURCE;
  version: typeof TRANSPORT_VERSION;
  signal: RoomTransportSignal;
}

export type RoomTransportSignalType = Exclude<
  TransportSignal['type'],
  'transport:error' | 'transport:disconnected'
>;

export type RoomTransportSignal = TransportSignal & {
  type: RoomTransportSignalType;
};

export function isRoomTransportSignalType(value: unknown): value is RoomTransportSignalType {
  return typeof value === 'string' && ROOM_TRANSPORT_SIGNAL_TYPES.has(value);
}

export function isRoomTransportSignal(value: unknown): value is RoomTransportSignal {
  if (!isObject(value)) {
    return false;
  }

  const type = value.type;
  const roomId = value.roomId;
  const fromPeerId = value.fromPeerId;
  const toPeerId = value.toPeerId;

  return (
    isRoomTransportSignalType(type) &&
    typeof roomId === 'string' &&
    typeof fromPeerId === 'string' &&
    (toPeerId === undefined || typeof toPeerId === 'string')
  );
}

export function serializeTransportEnvelope(signal: TransportSignal): string | null {
  if (!isRoomTransportSignal(signal)) {
    return null;
  }

  const envelope: TransportEnvelope = {
    source: TRANSPORT_SOURCE,
    version: TRANSPORT_VERSION,
    signal,
  };

  return JSON.stringify(envelope);
}

export function parseTransportEnvelope(payload: unknown): RoomTransportSignal | null {
  if (typeof payload !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isObject(parsed)) {
    return null;
  }

  if (parsed.source !== TRANSPORT_SOURCE || parsed.version !== TRANSPORT_VERSION) {
    return null;
  }

  return parseTransportSignal(parsed.signal);
}

export function parseTransportSignal(payload: unknown): RoomTransportSignal | null {
  if (!isRoomTransportSignal(payload)) {
    return null;
  }

  return payload;
}
