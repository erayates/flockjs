import { isObject, readBoolean, readNumber, readRecord, readString } from '../internal/guards';
import type { AwarenessState, CursorPosition, Peer, PresenceData } from '../types';
import {
  decodeMessagePack,
  encodeMessagePack,
  normalizeProtocolValue,
  type ProtocolSerializableValue,
} from './messagepack';

export type PeerProtocolVersion = 1 | 2;
export type PeerProtocolCodec = 'json' | 'msgpack';

export interface PeerProtocolCapabilities {
  minVersion: 1;
  maxVersion: 2;
  codecs: PeerProtocolCodec[];
  preferredCodec: PeerProtocolCodec;
}

export interface PeerProtocolSession {
  version: PeerProtocolVersion;
  codec: PeerProtocolCodec;
  legacy: boolean;
}

export type PeerWireMessageType =
  | 'hello'
  | 'welcome'
  | 'presence:update'
  | 'leave'
  | 'cursor:update'
  | 'awareness:update'
  | 'event';

export interface EventWirePayload {
  name: string;
  payload: unknown;
  loopback?: boolean;
}

export interface HelloWirePayload {
  peer: Peer<PresenceData>;
  protocol?: PeerProtocolCapabilities;
}

export interface WelcomeWirePayload {
  peer: Peer<PresenceData>;
  protocol?: PeerProtocolCapabilities;
}

export interface PresenceWirePayload {
  peer: Peer<PresenceData>;
}

export interface LeaveWirePayload {
  peer?: Peer<PresenceData>;
}

export interface CursorWirePayload {
  cursor: CursorPosition;
}

export interface AwarenessWirePayload {
  awareness: AwarenessState;
}

export type PeerWirePayloadByType = {
  hello: HelloWirePayload;
  welcome: WelcomeWirePayload;
  'presence:update': PresenceWirePayload;
  leave: LeaveWirePayload;
  'cursor:update': CursorWirePayload;
  'awareness:update': AwarenessWirePayload;
  event: EventWirePayload;
};

type PeerWireMessageBase<TType extends PeerWireMessageType> = {
  type: TType;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  timestamp: number;
  payload: PeerWirePayloadByType[TType];
};

export type HelloWireMessage = PeerWireMessageBase<'hello'>;
export type WelcomeWireMessage = PeerWireMessageBase<'welcome'>;
export type PresenceWireMessage = PeerWireMessageBase<'presence:update'>;
export type LeaveWireMessage = PeerWireMessageBase<'leave'>;
export type CursorWireMessage = PeerWireMessageBase<'cursor:update'>;
export type AwarenessWireMessage = PeerWireMessageBase<'awareness:update'>;
export type EventWireMessage = PeerWireMessageBase<'event'>;

export type PeerWireMessage =
  | HelloWireMessage
  | WelcomeWireMessage
  | PresenceWireMessage
  | LeaveWireMessage
  | CursorWireMessage
  | AwarenessWireMessage
  | EventWireMessage;

interface LegacyPeerTransportEnvelope {
  source: 'flockjs';
  version: 1;
  signal: {
    type: PeerWireMessageType;
    roomId: string;
    fromPeerId: string;
    toPeerId?: string;
    payload?: unknown;
  };
}

interface ModernPeerTransportEnvelope<TType extends PeerWireMessageType = PeerWireMessageType> {
  source: 'flockjs';
  protocolVersion: 2;
  codec: PeerProtocolCodec;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  timestamp: number;
  type: TType;
  payload: PeerWirePayloadByType[TType];
}

export type PeerTransportEnvelope = LegacyPeerTransportEnvelope | ModernPeerTransportEnvelope;

export type PeerProtocolNegotiationResult =
  | {
      compatible: true;
      session: PeerProtocolSession;
      reason: string;
    }
  | {
      compatible: false;
      reason: string;
    };

interface ParseEnvelopeOptions {
  now?: () => number;
  carrier?: 'json' | 'msgpack' | 'object';
}

interface BinaryCarrierOptions extends ParseEnvelopeOptions {
  carrier: 'msgpack';
}

const MODERN_SOURCE = 'flockjs';
const LEGACY_VERSION = 1;
const MODERN_VERSION = 2;
const JSON_CODEC = 'json';
const MSGPACK_CODEC = 'msgpack';
const PEER_MESSAGE_TYPES = new Set<string>([
  'hello',
  'welcome',
  'presence:update',
  'leave',
  'cursor:update',
  'awareness:update',
  'event',
]);
const RESERVED_PEER_KEYS = new Set(['id', 'joinedAt', 'lastSeen', 'name', 'color', 'avatar']);

interface ParsedBaseSignal {
  type: PeerWireMessageType;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  timestamp?: number;
  payload?: unknown;
}

function isPeerWireMessageType(value: unknown): value is PeerWireMessageType {
  return typeof value === 'string' && PEER_MESSAGE_TYPES.has(value);
}

function isPeerProtocolCodec(value: unknown): value is PeerProtocolCodec {
  return value === JSON_CODEC || value === MSGPACK_CODEC;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBinaryPayload(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function hasBinaryValue(value: ProtocolSerializableValue): boolean {
  if (value instanceof Uint8Array) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasBinaryValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasBinaryValue(item));
  }

  return false;
}

function parsePeerCapabilitiesCodecs(value: unknown): PeerProtocolCodec[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const codecs = value.filter(isPeerProtocolCodec);
  if (codecs.length === 0) {
    return null;
  }

  return Array.from(new Set(codecs));
}

function parsePeer(value: unknown): Peer<PresenceData> | null {
  if (!isObject(value)) {
    return null;
  }

  const id = readString(value, 'id');
  const joinedAt = readNumber(value, 'joinedAt');
  const lastSeen = readNumber(value, 'lastSeen');
  if (!id || !isFiniteNumber(joinedAt) || !isFiniteNumber(lastSeen)) {
    return null;
  }

  const peer: Peer<PresenceData> = {
    id,
    joinedAt,
    lastSeen,
  };

  for (const [key, entry] of Object.entries(value)) {
    if (RESERVED_PEER_KEYS.has(key)) {
      continue;
    }

    peer[key] = entry;
  }

  const name = readString(value, 'name');
  if (name !== undefined) {
    peer.name = name;
  }

  const color = readString(value, 'color');
  if (color !== undefined) {
    peer.color = color;
  }

  const avatar = readString(value, 'avatar');
  if (avatar !== undefined) {
    peer.avatar = avatar;
  }

  return peer;
}

function parseCursor(value: unknown, fromPeerId: string): CursorPosition | null {
  if (!isObject(value)) {
    return null;
  }

  const x = readNumber(value, 'x');
  const y = readNumber(value, 'y');
  const xAbsolute = readNumber(value, 'xAbsolute');
  const yAbsolute = readNumber(value, 'yAbsolute');
  const name = readString(value, 'name');
  const color = readString(value, 'color');
  const element = readString(value, 'element');
  const idle = readBoolean(value, 'idle');

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(xAbsolute) ||
    !isFiniteNumber(yAbsolute) ||
    typeof name !== 'string' ||
    typeof color !== 'string' ||
    typeof idle !== 'boolean'
  ) {
    return null;
  }

  const cursor: CursorPosition = {
    userId: fromPeerId,
    name,
    color,
    x,
    y,
    xAbsolute,
    yAbsolute,
    idle,
  };

  if (element !== undefined) {
    cursor.element = element;
  }

  return cursor;
}

function parseAwareness(value: unknown, fromPeerId: string): AwarenessState | null {
  if (!isObject(value)) {
    return null;
  }

  return {
    ...value,
    peerId: fromPeerId,
  };
}

function parseEventPayload(value: unknown): EventWirePayload | null {
  if (!isObject(value)) {
    return null;
  }

  const name = readString(value, 'name');
  if (!name) {
    return null;
  }

  const loopback = readBoolean(value, 'loopback');
  return {
    name,
    payload: value.payload,
    ...(loopback !== undefined ? { loopback } : {}),
  };
}

function parseLegacyEventPayload(value: unknown): EventWirePayload | null {
  if (!isObject(value)) {
    return null;
  }

  const event = readRecord(value, 'event');
  if (!event) {
    return null;
  }

  return parseEventPayload(event);
}

function parseHelloOrWelcomePayload(
  value: unknown,
  requireProtocol: boolean,
): HelloWirePayload | WelcomeWirePayload | null {
  if (!isObject(value)) {
    return null;
  }

  const peer = parsePeer(readRecord(value, 'peer'));
  if (!peer) {
    return null;
  }

  const protocolValue = value.protocol;
  const protocol =
    protocolValue === undefined ? undefined : parsePeerProtocolCapabilities(protocolValue);
  if (protocolValue !== undefined && !protocol) {
    return null;
  }

  if (requireProtocol && !protocol) {
    return null;
  }

  return protocol
    ? {
        peer,
        protocol,
      }
    : {
        peer,
      };
}

function parsePresencePayload(value: unknown): PresenceWirePayload | null {
  if (!isObject(value)) {
    return null;
  }

  const peer = parsePeer(readRecord(value, 'peer'));
  if (!peer) {
    return null;
  }

  return {
    peer,
  };
}

function parseLeavePayload(value: unknown): LeaveWirePayload | null {
  if (value === undefined) {
    return {};
  }

  if (!isObject(value)) {
    return null;
  }

  const peerValue = value.peer;
  if (peerValue === undefined) {
    return {};
  }

  const peer = parsePeer(peerValue);
  if (!peer) {
    return null;
  }

  return {
    peer,
  };
}

function parseCursorPayload(value: unknown, fromPeerId: string): CursorWirePayload | null {
  if (!isObject(value)) {
    return null;
  }

  const cursor = parseCursor(readRecord(value, 'cursor'), fromPeerId);
  if (!cursor) {
    return null;
  }

  return {
    cursor,
  };
}

function parseAwarenessPayload(value: unknown, fromPeerId: string): AwarenessWirePayload | null {
  if (!isObject(value)) {
    return null;
  }

  const awareness = parseAwareness(readRecord(value, 'awareness'), fromPeerId);
  if (!awareness) {
    return null;
  }

  return {
    awareness,
  };
}

function parseBaseSignal(value: unknown): ParsedBaseSignal | null {
  if (!isObject(value)) {
    return null;
  }

  const type = value.type;
  const roomId = value.roomId;
  const fromPeerId = value.fromPeerId;
  const toPeerId = value.toPeerId;
  const timestamp = value.timestamp;

  if (
    !isPeerWireMessageType(type) ||
    typeof roomId !== 'string' ||
    typeof fromPeerId !== 'string' ||
    (toPeerId !== undefined && typeof toPeerId !== 'string') ||
    (timestamp !== undefined && !isFiniteNumber(timestamp))
  ) {
    return null;
  }

  return {
    type,
    roomId,
    fromPeerId,
    ...(toPeerId !== undefined ? { toPeerId } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...('payload' in value ? { payload: value.payload } : {}),
  };
}

function createMessageBase(
  signal: ParsedBaseSignal,
  timestamp: number,
): {
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  timestamp: number;
} {
  return {
    roomId: signal.roomId,
    fromPeerId: signal.fromPeerId,
    ...(signal.toPeerId !== undefined ? { toPeerId: signal.toPeerId } : {}),
    timestamp,
  };
}

function parseSignalMessage(
  signal: ParsedBaseSignal,
  timestamp: number,
  mode: 'legacy' | 'modern',
): PeerWireMessage | null {
  const base = createMessageBase(signal, timestamp);

  switch (signal.type) {
    case 'hello': {
      const payload = parseHelloOrWelcomePayload(signal.payload, mode === 'modern');
      if (!payload) {
        return null;
      }

      return {
        type: 'hello',
        ...base,
        payload,
      };
    }
    case 'welcome': {
      const payload = parseHelloOrWelcomePayload(signal.payload, mode === 'modern');
      if (!payload) {
        return null;
      }

      return {
        type: 'welcome',
        ...base,
        payload,
      };
    }
    case 'presence:update': {
      const payload = parsePresencePayload(signal.payload);
      if (!payload) {
        return null;
      }

      return {
        type: 'presence:update',
        ...base,
        payload,
      };
    }
    case 'leave': {
      const payload = parseLeavePayload(signal.payload);
      if (!payload) {
        return null;
      }

      return {
        type: 'leave',
        ...base,
        payload,
      };
    }
    case 'cursor:update': {
      const payload = parseCursorPayload(signal.payload, signal.fromPeerId);
      if (!payload) {
        return null;
      }

      return {
        type: 'cursor:update',
        ...base,
        payload,
      };
    }
    case 'awareness:update': {
      const payload = parseAwarenessPayload(signal.payload, signal.fromPeerId);
      if (!payload) {
        return null;
      }

      return {
        type: 'awareness:update',
        ...base,
        payload,
      };
    }
    case 'event': {
      const payload =
        mode === 'legacy'
          ? parseLegacyEventPayload(signal.payload)
          : parseEventPayload(signal.payload);
      if (!payload) {
        return null;
      }

      return {
        type: 'event',
        ...base,
        payload,
      };
    }
    default:
      return null;
  }
}

function parseLegacyEnvelopeObject(value: unknown, now: () => number): PeerWireMessage | null {
  if (!isObject(value) || value.source !== MODERN_SOURCE || value.version !== LEGACY_VERSION) {
    return null;
  }

  const signal = parseBaseSignal(value.signal);
  if (!signal) {
    return null;
  }

  return parseSignalMessage(signal, signal.timestamp ?? now(), 'legacy');
}

function parseModernEnvelopeObject(
  value: unknown,
  options: ParseEnvelopeOptions,
): PeerWireMessage | null {
  if (!isObject(value)) {
    return null;
  }

  if (value.source !== MODERN_SOURCE || value.protocolVersion !== MODERN_VERSION) {
    return null;
  }

  const codec = value.codec;
  if (!isPeerProtocolCodec(codec)) {
    return null;
  }

  if (options.carrier === 'json' && codec !== JSON_CODEC) {
    return null;
  }

  if (options.carrier === 'msgpack' && codec !== MSGPACK_CODEC) {
    return null;
  }

  const signal = parseBaseSignal(value);
  if (!signal || !isFiniteNumber(signal.timestamp)) {
    return null;
  }

  return parseSignalMessage(signal, signal.timestamp, 'modern');
}

function tryParseJson(payload: string): unknown | null {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function encodeEnvelopeAsJson(envelope: PeerTransportEnvelope): string | null {
  const normalized = normalizeProtocolValue(envelope);
  if (!normalized.ok || hasBinaryValue(normalized.value)) {
    return null;
  }

  return JSON.stringify(normalized.value);
}

function buildLegacyPayload(message: PeerWireMessage): Record<string, unknown> | undefined {
  switch (message.type) {
    case 'hello':
    case 'welcome':
      return {
        peer: message.payload.peer,
        protocol: message.payload.protocol,
      };
    case 'presence:update':
      return {
        peer: message.payload.peer,
      };
    case 'leave':
      return message.payload.peer ? { peer: message.payload.peer } : {};
    case 'cursor:update':
      return {
        cursor: message.payload.cursor,
      };
    case 'awareness:update':
      return {
        awareness: message.payload.awareness,
      };
    case 'event':
      return {
        event: message.payload,
      };
    default:
      return undefined;
  }
}

function buildModernPayload(message: PeerWireMessage): PeerWirePayloadByType[PeerWireMessageType] {
  return message.payload;
}

function parseDirectSignal(value: unknown, now: () => number): PeerWireMessage | null {
  const signal = parseBaseSignal(value);
  if (!signal) {
    return null;
  }

  return parseSignalMessage(signal, signal.timestamp ?? now(), 'modern');
}

export const LEGACY_PROTOCOL_SESSION: PeerProtocolSession = {
  version: 1,
  codec: 'json',
  legacy: true,
};

export function createProtocolCapabilities(
  codecs: PeerProtocolCodec[],
  preferredCodec: PeerProtocolCodec,
): PeerProtocolCapabilities {
  const uniqueCodecs = Array.from(new Set(codecs.filter(isPeerProtocolCodec)));
  const preferred = uniqueCodecs.includes(preferredCodec)
    ? preferredCodec
    : (uniqueCodecs[0] ?? 'json');

  return {
    minVersion: 1,
    maxVersion: 2,
    codecs: uniqueCodecs.length > 0 ? uniqueCodecs : ['json'],
    preferredCodec: preferred,
  };
}

export function parsePeerProtocolCapabilities(value: unknown): PeerProtocolCapabilities | null {
  if (!isObject(value)) {
    return null;
  }

  const minVersion = value.minVersion;
  const maxVersion = value.maxVersion;
  const codecs = parsePeerCapabilitiesCodecs(value.codecs);
  const preferredCodec = value.preferredCodec;

  if (
    minVersion !== 1 ||
    maxVersion !== 2 ||
    !codecs ||
    !isPeerProtocolCodec(preferredCodec) ||
    !codecs.includes(preferredCodec)
  ) {
    return null;
  }

  return {
    minVersion,
    maxVersion,
    codecs,
    preferredCodec,
  };
}

export function negotiatePeerProtocolSession(
  local: PeerProtocolCapabilities,
  remote: PeerProtocolCapabilities | undefined,
  options: {
    supportsBinary: boolean;
  },
): PeerProtocolNegotiationResult {
  if (!remote) {
    return {
      compatible: true,
      session: LEGACY_PROTOCOL_SESSION,
      reason: 'Remote peer did not advertise protocol capabilities; using legacy v1/json.',
    };
  }

  const sharedMin = Math.max(local.minVersion, remote.minVersion);
  const sharedMax = Math.min(local.maxVersion, remote.maxVersion);
  if (sharedMin > sharedMax) {
    return {
      compatible: false,
      reason: `No compatible protocol version. local=${local.minVersion}-${local.maxVersion} remote=${remote.minVersion}-${remote.maxVersion}.`,
    };
  }

  const version: PeerProtocolVersion = sharedMax === 1 ? 1 : 2;
  const localSupportsMsgPack = local.codecs.includes(MSGPACK_CODEC);
  const remoteSupportsMsgPack = remote.codecs.includes(MSGPACK_CODEC);
  const useMessagePack =
    version >= 2 && options.supportsBinary && localSupportsMsgPack && remoteSupportsMsgPack;

  return {
    compatible: true,
    session: {
      version,
      codec: useMessagePack ? 'msgpack' : 'json',
      legacy: false,
    },
    reason: useMessagePack
      ? 'Negotiated v2/msgpack.'
      : version === 2
        ? 'Negotiated v2/json fallback.'
        : 'Negotiated v1/json compatibility session.',
  };
}

export function normalizePeerWireMessage(
  value: unknown,
  now: () => number = Date.now,
): PeerWireMessage | null {
  return parseDirectSignal(value, now);
}

export function serializePeerWireEnvelopeObject(
  message: PeerWireMessage,
  session: PeerProtocolSession,
): PeerTransportEnvelope {
  if (session.version === 1 || session.legacy) {
    return {
      source: 'flockjs',
      version: 1,
      signal: {
        type: message.type,
        roomId: message.roomId,
        fromPeerId: message.fromPeerId,
        ...(message.toPeerId !== undefined ? { toPeerId: message.toPeerId } : {}),
        ...(buildLegacyPayload(message) !== undefined
          ? { payload: buildLegacyPayload(message) }
          : {}),
      },
    };
  }

  return {
    source: 'flockjs',
    protocolVersion: 2,
    codec: session.codec,
    roomId: message.roomId,
    fromPeerId: message.fromPeerId,
    ...(message.toPeerId !== undefined ? { toPeerId: message.toPeerId } : {}),
    timestamp: message.timestamp,
    type: message.type,
    payload: buildModernPayload(message),
  };
}

export function serializePeerWireEnvelope(
  message: PeerWireMessage,
  session: PeerProtocolSession,
): string | Uint8Array | null {
  const envelope = serializePeerWireEnvelopeObject(message, session);

  if (session.version === 1 || session.legacy || session.codec === 'json') {
    return encodeEnvelopeAsJson(envelope);
  }

  const encoded = encodeMessagePack(envelope);
  return encoded.ok ? encoded.value : null;
}

export function parsePeerWireEnvelope(
  payload: unknown,
  options: ParseEnvelopeOptions = {},
): PeerWireMessage | null {
  const now = options.now ?? Date.now;

  if (typeof payload === 'string') {
    const decoded = tryParseJson(payload);
    if (!decoded) {
      return null;
    }

    return parsePeerWireEnvelope(decoded, {
      ...options,
      carrier: 'json',
      now,
    });
  }

  if (isBinaryPayload(payload)) {
    const decoded = decodeMessagePack(payload);
    if (!decoded.ok) {
      return null;
    }

    return parsePeerWireEnvelope(decoded.value, {
      ...options,
      carrier: 'msgpack',
      now,
    } satisfies BinaryCarrierOptions);
  }

  return (
    parseModernEnvelopeObject(payload, {
      ...options,
      now,
      carrier: options.carrier ?? 'object',
    }) ?? parseLegacyEnvelopeObject(payload, now)
  );
}
