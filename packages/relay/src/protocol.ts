import { z } from 'zod';

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

const transportSignalSchema = z.object({
  type: z.enum([
    'hello',
    'welcome',
    'presence:update',
    'leave',
    'cursor:update',
    'awareness:update',
    'event',
  ]),
  roomId: z.string().min(1),
  fromPeerId: z.string().min(1),
  toPeerId: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

const transportMessageSchema = z.object({
  type: z.literal('transport'),
  signal: transportSignalSchema,
});

const relayClientMessageSchema = z.discriminatedUnion('type', [
  joinMessageSchema,
  leaveMessageSchema,
  signalMessageSchema,
  transportMessageSchema,
]);

export type RelayJoinMessage = z.infer<typeof joinMessageSchema>;
export type RelaySignalMessage = z.infer<typeof signalMessageSchema>;
export type RelayLeaveMessage = z.infer<typeof leaveMessageSchema>;
export type RelayTransportMessage = z.infer<typeof transportMessageSchema>;
export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;

export interface RelayJoinedMessage {
  type: 'joined';
  roomId: string;
  peerId: string;
  peers: string[];
}

export interface RelayPeerJoinedMessage {
  type: 'peer-joined';
  roomId: string;
  peerId: string;
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

export type RelayServerMessage =
  | RelayJoinedMessage
  | RelayPeerJoinedMessage
  | RelayPeerLeftMessage
  | RelaySignalMessage
  | RelayTransportMessage
  | RelayErrorMessage;

export function serializeRelayServerMessage(message: RelayServerMessage): string {
  return JSON.stringify(message);
}

export function parseRelayClientMessage(payload: unknown): RelayClientMessage | null {
  if (typeof payload !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const result = relayClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  return result.data;
}
