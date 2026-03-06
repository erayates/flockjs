import { isObject, readString } from '../internal/guards';
import { normalizeMaxPeers } from '../internal/max-peers';
import {
  decodeMessagePack,
  encodeMessagePack,
  normalizeProtocolValue,
} from '../protocol/messagepack';
import {
  parsePeerProtocolCapabilities,
  type PeerProtocolCapabilities,
  type PeerProtocolSession,
} from '../protocol/peer-message';
import type { RoomTransportSignal } from './transport';
import { parseTransportEnvelope, serializeTransportEnvelopeObject } from './transport.protocol';

function parseJson(payload: string): unknown | null {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function encodeJson(value: unknown): string | null {
  const normalized = normalizeProtocolValue(value);
  if (!normalized.ok) {
    return null;
  }

  return JSON.stringify(normalized.value);
}

function parsePeerDescriptor(value: unknown): WebSocketRelayPeerDescriptor | null {
  if (!isObject(value)) {
    return null;
  }

  const peerId = readString(value, 'peerId');
  if (!peerId) {
    return null;
  }

  const protocolValue = value.protocol;
  const protocol =
    protocolValue === undefined ? undefined : parsePeerProtocolCapabilities(protocolValue);
  if (protocolValue !== undefined && !protocol) {
    return null;
  }

  return protocol ? { peerId, protocol } : { peerId };
}

function parseRelayPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === 'string') {
    const parsed = parseJson(payload);
    return isObject(parsed) ? parsed : null;
  }

  if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
    const decoded = decodeMessagePack(payload);
    if (!decoded.ok || !isObject(decoded.value)) {
      return null;
    }

    return decoded.value;
  }

  return isObject(payload) ? payload : null;
}

export interface WebSocketRelayJoinMessage {
  type: 'join';
  roomId: string;
  peerId: string;
  token?: string;
  protocol?: PeerProtocolCapabilities;
  maxPeers?: number;
}

export interface WebSocketRelayLeaveMessage {
  type: 'leave';
  roomId: string;
  peerId: string;
}

export interface WebSocketRelayTransportMessage {
  type: 'transport';
  signal: RoomTransportSignal;
  encoding: 'json' | 'msgpack';
}

export type WebSocketRelayClientMessage =
  | WebSocketRelayJoinMessage
  | WebSocketRelayLeaveMessage
  | WebSocketRelayTransportMessage;

export interface WebSocketRelayPeerDescriptor {
  peerId: string;
  protocol?: PeerProtocolCapabilities;
}

export interface WebSocketRelayJoinedMessage {
  type: 'joined';
  roomId: string;
  peerId: string;
  peers: WebSocketRelayPeerDescriptor[];
}

export interface WebSocketRelayPeerJoinedMessage {
  type: 'peer-joined';
  roomId: string;
  peerId: string;
  protocol?: PeerProtocolCapabilities;
}

export interface WebSocketRelayPeerLeftMessage {
  type: 'peer-left';
  roomId: string;
  peerId: string;
}

export interface WebSocketRelayServerTransportMessage {
  type: 'transport';
  signal: RoomTransportSignal;
  encoding: 'json' | 'msgpack';
}

export interface WebSocketRelayErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type WebSocketRelayServerMessage =
  | WebSocketRelayJoinedMessage
  | WebSocketRelayPeerJoinedMessage
  | WebSocketRelayPeerLeftMessage
  | WebSocketRelayServerTransportMessage
  | WebSocketRelayErrorMessage;

export function serializeWebSocketRelayMessage(
  message:
    | WebSocketRelayJoinMessage
    | WebSocketRelayLeaveMessage
    | {
        type: 'transport';
        signal: RoomTransportSignal;
        session: PeerProtocolSession;
      },
): string | Uint8Array {
  if (message.type === 'join' || message.type === 'leave') {
    return JSON.stringify(message);
  }

  const envelope = serializeTransportEnvelopeObject(message.signal, message.session);
  const relayEnvelope = {
    type: 'transport',
    message: envelope,
  };

  if (message.session.version >= 2 && message.session.codec === 'msgpack') {
    const encoded = encodeMessagePack(relayEnvelope);
    if (encoded.ok) {
      return encoded.value;
    }
  }

  return encodeJson(relayEnvelope) ?? JSON.stringify({ type: 'transport' });
}

export function parseWebSocketRelayServerMessage(
  payload: unknown,
): WebSocketRelayServerMessage | null {
  const parsed = parseRelayPayload(payload);
  if (!parsed) {
    return null;
  }

  const type = readString(parsed, 'type');
  if (!type) {
    return null;
  }

  if (type === 'joined') {
    const roomId = readString(parsed, 'roomId');
    const peerId = readString(parsed, 'peerId');
    if (!roomId || !peerId || !Array.isArray(parsed.peers)) {
      return null;
    }

    const peers: WebSocketRelayPeerDescriptor[] = [];
    for (const value of parsed.peers) {
      const peer = parsePeerDescriptor(value);
      if (!peer) {
        continue;
      }

      peers.push(peer);
    }

    return {
      type,
      roomId,
      peerId,
      peers,
    };
  }

  if (type === 'peer-joined') {
    const roomId = readString(parsed, 'roomId');
    const peerId = readString(parsed, 'peerId');
    if (!roomId || !peerId) {
      return null;
    }

    const protocolValue = parsed.protocol;
    const protocol =
      protocolValue === undefined ? undefined : parsePeerProtocolCapabilities(protocolValue);
    if (protocolValue !== undefined && !protocol) {
      return null;
    }

    return protocol
      ? {
          type,
          roomId,
          peerId,
          protocol,
        }
      : {
          type,
          roomId,
          peerId,
        };
  }

  if (type === 'peer-left') {
    const roomId = readString(parsed, 'roomId');
    const peerId = readString(parsed, 'peerId');
    if (!roomId || !peerId) {
      return null;
    }

    return {
      type,
      roomId,
      peerId,
    };
  }

  if (type === 'transport') {
    const signal = parseTransportEnvelope(parsed.message, {
      transport: 'websocket',
      allowBinary: true,
    });
    if (!signal) {
      return null;
    }

    return {
      type,
      signal,
      encoding:
        payload instanceof Uint8Array || payload instanceof ArrayBuffer ? 'msgpack' : 'json',
    };
  }

  if (type === 'error') {
    const code = readString(parsed, 'code');
    const message = readString(parsed, 'message');
    if (!code || !message) {
      return null;
    }

    return {
      type,
      code,
      message,
    };
  }

  return null;
}

export function parseWebSocketRelayClientMessage(
  payload: unknown,
): WebSocketRelayClientMessage | null {
  const parsed = parseRelayPayload(payload);
  if (!parsed) {
    return null;
  }

  const type = readString(parsed, 'type');
  if (!type) {
    return null;
  }

  if (type === 'join') {
    const roomId = readString(parsed, 'roomId');
    const peerId = readString(parsed, 'peerId');
    if (!roomId || !peerId) {
      return null;
    }

    const protocolValue = parsed.protocol;
    const protocol =
      protocolValue === undefined ? undefined : parsePeerProtocolCapabilities(protocolValue);
    if (protocolValue !== undefined && !protocol) {
      return null;
    }

    const joinMessage: WebSocketRelayJoinMessage = {
      type,
      roomId,
      peerId,
      ...(protocol ? { protocol } : {}),
    };

    const token = readString(parsed, 'token');
    if (token !== undefined) {
      joinMessage.token = token;
    }

    const maxPeers = normalizeMaxPeers(parsed.maxPeers);
    if (maxPeers !== undefined) {
      joinMessage.maxPeers = maxPeers;
    }

    return joinMessage;
  }

  if (type === 'leave') {
    const roomId = readString(parsed, 'roomId');
    const peerId = readString(parsed, 'peerId');
    if (!roomId || !peerId) {
      return null;
    }

    return {
      type,
      roomId,
      peerId,
    };
  }

  if (type === 'transport') {
    const signal = parseTransportEnvelope(parsed.message, {
      transport: 'websocket',
      allowBinary: true,
    });
    if (!signal) {
      return null;
    }

    return {
      type,
      signal,
      encoding:
        payload instanceof Uint8Array || payload instanceof ArrayBuffer ? 'msgpack' : 'json',
    };
  }

  return null;
}
