import { logProtocolWarning } from '../internal/logger';
import {
  createProtocolCapabilities,
  LEGACY_PROTOCOL_SESSION,
  negotiatePeerProtocolSession,
  normalizePeerWireMessage,
  parsePeerWireEnvelope,
  type PeerProtocolCapabilities,
  type PeerProtocolNegotiationResult,
  type PeerProtocolSession,
  type PeerWireMessageType,
  serializePeerWireEnvelope,
  serializePeerWireEnvelopeObject,
} from '../protocol/peer-message';
import type { RoomTransportSignal, TransportKind } from './transport';

const ROOM_TRANSPORT_SIGNAL_TYPES = new Set<string>([
  'hello',
  'welcome',
  'presence:update',
  'leave',
  'cursor:update',
  'state:update',
  'awareness:update',
  'event',
  'crdt:sync',
  'crdt:awareness',
]);

const JSON_ONLY_CAPABILITIES = createProtocolCapabilities(['json'], 'json');
const JSON_AND_MSGPACK_CAPABILITIES = createProtocolCapabilities(['json', 'msgpack'], 'msgpack');

interface ParseOptions {
  transport: TransportKind | 'unknown';
  allowBinary?: boolean;
  now?: () => number;
}

function logRejectedMessage(
  transport: ParseOptions['transport'],
  reason: string,
  payload?: unknown,
): null {
  logProtocolWarning({
    transport,
    reason,
    ...(payload !== undefined ? { payload } : {}),
  });
  return null;
}

export type RoomTransportSignalType = PeerWireMessageType;

export function getTransportProtocolCapabilities(kind: TransportKind): PeerProtocolCapabilities {
  if (kind === 'broadcast' || kind === 'in-memory') {
    return JSON_ONLY_CAPABILITIES;
  }

  return JSON_AND_MSGPACK_CAPABILITIES;
}

export function getBootstrapProtocolSession(): PeerProtocolSession {
  return LEGACY_PROTOCOL_SESSION;
}

export function negotiateTransportProtocolSession(
  kind: TransportKind,
  remote: PeerProtocolCapabilities | undefined,
): PeerProtocolNegotiationResult {
  return negotiatePeerProtocolSession(getTransportProtocolCapabilities(kind), remote, {
    supportsBinary: kind === 'webrtc' || kind === 'websocket',
  });
}

export function isRoomTransportSignalType(value: unknown): value is RoomTransportSignalType {
  return typeof value === 'string' && ROOM_TRANSPORT_SIGNAL_TYPES.has(value);
}

export function isRoomTransportSignal(value: unknown): value is RoomTransportSignal {
  return normalizePeerWireMessage(value) !== null;
}

export function normalizeTransportSignal(
  signal: unknown,
  now: () => number = Date.now,
): RoomTransportSignal | null {
  return normalizePeerWireMessage(signal, now);
}

export function serializeTransportEnvelopeObject(
  signal: RoomTransportSignal,
  session: PeerProtocolSession = LEGACY_PROTOCOL_SESSION,
): object {
  return serializePeerWireEnvelopeObject(signal, session);
}

export function serializeTransportEnvelope(
  signal: RoomTransportSignal,
  options: {
    session?: PeerProtocolSession;
    transport: TransportKind | 'unknown';
  },
): string | Uint8Array | null {
  const serialized = serializePeerWireEnvelope(signal, options.session ?? LEGACY_PROTOCOL_SESSION);
  if (serialized !== null) {
    return serialized;
  }

  return logRejectedMessage(options.transport, 'Outbound message serialization failed.', signal);
}

export function parseTransportEnvelope(
  payload: unknown,
  options: ParseOptions,
): RoomTransportSignal | null {
  if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
    if (options.allowBinary === false) {
      return logRejectedMessage(
        options.transport,
        'Binary peer messages are not supported on this transport.',
      );
    }
  }

  const signal = parsePeerWireEnvelope(
    payload,
    options.now
      ? {
          now: options.now,
        }
      : undefined,
  );
  if (signal) {
    return signal;
  }

  return logRejectedMessage(options.transport, 'Malformed peer transport message.', payload);
}

export function parseTransportSignal(payload: unknown): RoomTransportSignal | null {
  return normalizePeerWireMessage(payload);
}
