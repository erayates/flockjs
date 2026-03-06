import { decode, encode } from '@msgpack/msgpack';
import { z } from 'zod';

const peerProtocolCodecSchema = z.enum(['json', 'msgpack']);
const peerProtocolCapabilitiesSchema = z
  .object({
    minVersion: z.literal(1),
    maxVersion: z.union([z.literal(1), z.literal(2)]),
    codecs: z.array(peerProtocolCodecSchema).min(1),
    preferredCodec: peerProtocolCodecSchema,
  })
  .transform((value) => {
    return {
      ...value,
      codecs: Array.from(new Set(value.codecs)),
    };
  })
  .refine((value) => value.codecs.includes(value.preferredCodec));

const peerSchema = z
  .object({
    id: z.string().min(1),
    joinedAt: z.number().finite(),
    lastSeen: z.number().finite(),
  })
  .passthrough();

const cursorSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  color: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  xAbsolute: z.number().finite(),
  yAbsolute: z.number().finite(),
  element: z.string().optional(),
  idle: z.boolean(),
});

const awarenessSchema = z
  .object({
    peerId: z.string().min(1),
  })
  .passthrough();

const eventPayloadSchema = z.object({
  name: z.string().min(1),
  payload: z.unknown(),
  loopback: z.boolean().optional(),
});

function normalizeMaxPeers(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
}

const maxPeersSchema = z.preprocess((value) => {
  return normalizeMaxPeers(value);
}, z.number().int().min(1).optional());

const normalizedTransportSignalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: z.object({
      peer: peerSchema,
      protocol: peerProtocolCapabilitiesSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('welcome'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: z.object({
      peer: peerSchema,
      protocol: peerProtocolCapabilitiesSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('presence:update'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: z.object({
      peer: peerSchema,
    }),
  }),
  z.object({
    type: z.literal('leave'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: z.object({
      peer: peerSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('cursor:update'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: z.object({
      cursor: cursorSchema,
    }),
  }),
  z.object({
    type: z.literal('awareness:update'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: z.object({
      awareness: awarenessSchema,
    }),
  }),
  z.object({
    type: z.literal('event'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1).optional(),
    timestamp: z.number().finite(),
    payload: eventPayloadSchema,
  }),
]);

const sessionDescriptionSchema = z
  .object({
    type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
    sdp: z.string().optional(),
  })
  .transform((value): RTCSessionDescriptionInit => {
    return {
      type: value.type,
      sdp: value.sdp ?? '',
    };
  });

const iceCandidateSchema = z.object({
  candidate: z.string().min(1),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().optional(),
  usernameFragment: z.string().nullable().optional(),
});

const joinMessageSchema = z.object({
  type: z.literal('join'),
  roomId: z.string().min(1),
  peerId: z.string().min(1),
  token: z.string().optional(),
  protocol: peerProtocolCapabilitiesSchema.optional(),
  maxPeers: maxPeersSchema,
});

const leaveMessageSchema = z.object({
  type: z.literal('leave'),
  roomId: z.string().min(1),
  peerId: z.string().min(1),
});

const signalMessageSchema = z
  .object({
    type: z.literal('signal'),
    roomId: z.string().min(1),
    fromPeerId: z.string().min(1),
    toPeerId: z.string().min(1),
    description: sessionDescriptionSchema.optional(),
    candidate: iceCandidateSchema.optional(),
  })
  .refine((value) => {
    return value.description !== undefined || value.candidate !== undefined;
  });

const relayControlMessageSchema = z.union([
  joinMessageSchema,
  leaveMessageSchema,
  signalMessageSchema,
]);

type RelayTransportSignal = z.infer<typeof normalizedTransportSignalSchema>;

interface RelayTransportWrapper {
  type: 'transport';
  message: unknown;
}

export type RelayJoinMessage = z.infer<typeof joinMessageSchema>;
export type RelaySignalMessage = z.infer<typeof signalMessageSchema>;
export type RelayLeaveMessage = z.infer<typeof leaveMessageSchema>;

export interface RelayTransportMessage {
  type: 'transport';
  signal: RelayTransportSignal;
  encoding: 'json' | 'msgpack';
}

export type RelayClientMessage =
  | RelayJoinMessage
  | RelaySignalMessage
  | RelayLeaveMessage
  | RelayTransportMessage;

export interface RelayJoinedMessage {
  type: 'joined';
  roomId: string;
  peerId: string;
  peers: Array<{
    peerId: string;
    protocol?: z.infer<typeof peerProtocolCapabilitiesSchema>;
  }>;
}

export interface RelayPeerJoinedMessage {
  type: 'peer-joined';
  roomId: string;
  peerId: string;
  protocol?: z.infer<typeof peerProtocolCapabilitiesSchema>;
}

export interface RelayPeerLeftMessage {
  type: 'peer-left';
  roomId: string;
  peerId: string;
}

export interface RelayErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface RelayTransportSession {
  version: 1 | 2;
  codec: 'json' | 'msgpack';
  legacy: boolean;
}

export type RelayServerMessage =
  | RelayJoinedMessage
  | RelayPeerJoinedMessage
  | RelayPeerLeftMessage
  | RelaySignalMessage
  | RelayTransportMessage
  | RelayErrorMessage;
const RELAY_TRANSPORT_SIGNAL_TYPES = new Set<string>([
  'hello',
  'welcome',
  'presence:update',
  'leave',
  'cursor:update',
  'awareness:update',
  'event',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRelayTransportSignalType(value: unknown): value is RelayTransportSignal['type'] {
  return typeof value === 'string' && RELAY_TRANSPORT_SIGNAL_TYPES.has(value);
}

function parseBaseSignal(value: unknown): {
  type: RelayTransportSignal['type'];
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  timestamp?: number;
  payload?: unknown;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  const roomId = value.roomId;
  const fromPeerId = value.fromPeerId;
  const toPeerId = value.toPeerId;
  const timestamp = value.timestamp;

  if (
    !isRelayTransportSignalType(type) ||
    typeof roomId !== 'string' ||
    typeof fromPeerId !== 'string' ||
    (toPeerId !== undefined && typeof toPeerId !== 'string') ||
    (timestamp !== undefined && typeof timestamp !== 'number')
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

function parseLegacyTransportPayload(
  type: RelayTransportSignal['type'],
  payload: unknown,
): unknown {
  if (type !== 'event') {
    return payload ?? {};
  }

  if (!isRecord(payload) || !isRecord(payload.event)) {
    return null;
  }

  return payload.event;
}

function normalizeTransportEnvelope(
  value: unknown,
  now: () => number,
  carrier: 'json' | 'msgpack' | 'object',
): RelayTransportSignal | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.source === 'flockjs' && value.version === 1) {
    const signal = parseBaseSignal(value.signal);
    if (!signal) {
      return null;
    }

    const payload = parseLegacyTransportPayload(signal.type, signal.payload);
    if (payload === null) {
      return null;
    }

    const result = normalizedTransportSignalSchema.safeParse({
      type: signal.type,
      roomId: signal.roomId,
      fromPeerId: signal.fromPeerId,
      ...(signal.toPeerId !== undefined ? { toPeerId: signal.toPeerId } : {}),
      timestamp: signal.timestamp ?? now(),
      payload,
    });
    return result.success ? result.data : null;
  }

  if (
    value.source === 'flockjs' &&
    value.protocolVersion === 2 &&
    (carrier !== 'json' || value.codec === 'json') &&
    (carrier !== 'msgpack' || value.codec === 'msgpack')
  ) {
    const result = normalizedTransportSignalSchema.safeParse(value);
    return result.success ? result.data : null;
  }

  return null;
}

function parseTransportWrapper(
  value: unknown,
  carrier: 'json' | 'msgpack',
  now: () => number,
): RelayTransportMessage | null {
  if (!isRecord(value) || value.type !== 'transport') {
    return null;
  }

  const signal = normalizeTransportEnvelope(value.message, now, carrier);
  if (!signal) {
    return null;
  }

  return {
    type: 'transport',
    signal,
    encoding: carrier,
  };
}

function parseJsonPayload(payload: string): unknown | null {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function encodeLegacyTransportSignal(signal: RelayTransportSignal): Record<string, unknown> {
  return {
    source: 'flockjs',
    version: 1,
    signal: {
      type: signal.type,
      roomId: signal.roomId,
      fromPeerId: signal.fromPeerId,
      ...(signal.toPeerId !== undefined ? { toPeerId: signal.toPeerId } : {}),
      payload:
        signal.type === 'event'
          ? {
              event: signal.payload,
            }
          : signal.payload,
    },
  };
}

function encodeModernTransportSignal(
  signal: RelayTransportSignal,
  session: RelayTransportSession,
): Record<string, unknown> {
  return {
    source: 'flockjs',
    protocolVersion: 2,
    codec: session.codec,
    roomId: signal.roomId,
    fromPeerId: signal.fromPeerId,
    ...(signal.toPeerId !== undefined ? { toPeerId: signal.toPeerId } : {}),
    timestamp: signal.timestamp,
    type: signal.type,
    payload: signal.payload,
  };
}

export function resolveRelayTransportSession(
  protocol: z.infer<typeof peerProtocolCapabilitiesSchema> | undefined,
): RelayTransportSession {
  if (!protocol) {
    return {
      version: 1,
      codec: 'json',
      legacy: true,
    };
  }

  const version = protocol.maxVersion >= 2 ? 2 : 1;
  const codec = version >= 2 && protocol.codecs.includes('msgpack') ? 'msgpack' : 'json';

  return {
    version,
    codec,
    legacy: false,
  };
}

export function serializeRelayServerMessage(
  message: RelayServerMessage,
  options?: {
    transportSession?: RelayTransportSession;
  },
): string | Uint8Array {
  if (message.type !== 'transport') {
    return JSON.stringify(message);
  }

  const session = options?.transportSession ?? {
    version: 1,
    codec: 'json',
    legacy: true,
  };

  const envelope =
    session.version === 1 || session.legacy
      ? encodeLegacyTransportSignal(message.signal)
      : encodeModernTransportSignal(message.signal, session);

  const wrapped: RelayTransportWrapper = {
    type: 'transport',
    message: envelope,
  };

  if (session.version >= 2 && session.codec === 'msgpack') {
    return new Uint8Array(encode(wrapped));
  }

  return JSON.stringify(wrapped);
}

export function parseRelayClientMessage(
  payload: unknown,
  now: () => number = Date.now,
): RelayClientMessage | null {
  if (typeof payload === 'string') {
    const parsed = parseJsonPayload(payload);
    if (!parsed || !isRecord(parsed)) {
      return null;
    }

    const transport = parseTransportWrapper(parsed, 'json', now);
    if (transport) {
      return transport;
    }

    const result = relayControlMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  if (payload instanceof Uint8Array || payload instanceof ArrayBuffer || Buffer.isBuffer(payload)) {
    try {
      const decoded = decode(payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload);
      return parseTransportWrapper(decoded, 'msgpack', now);
    } catch {
      return null;
    }
  }

  return null;
}
