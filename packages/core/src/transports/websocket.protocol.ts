import { parseTransportSignal, type RoomTransportSignal } from './transport.protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseJson(payload: unknown): unknown | null {
  if (typeof payload !== 'string') {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export interface WebSocketRelayJoinMessage {
  type: 'join';
  roomId: string;
  peerId: string;
  token?: string;
}

export interface WebSocketRelayLeaveMessage {
  type: 'leave';
  roomId: string;
  peerId: string;
}

export interface WebSocketRelayTransportMessage {
  type: 'transport';
  signal: RoomTransportSignal;
}

export type WebSocketRelayClientMessage =
  | WebSocketRelayJoinMessage
  | WebSocketRelayLeaveMessage
  | WebSocketRelayTransportMessage;

export interface WebSocketRelayJoinedMessage {
  type: 'joined';
  roomId: string;
  peerId: string;
  peers: string[];
}

export interface WebSocketRelayPeerJoinedMessage {
  type: 'peer-joined';
  roomId: string;
  peerId: string;
}

export interface WebSocketRelayPeerLeftMessage {
  type: 'peer-left';
  roomId: string;
  peerId: string;
}

export interface WebSocketRelayServerTransportMessage {
  type: 'transport';
  signal: RoomTransportSignal;
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

export function serializeWebSocketRelayMessage(message: WebSocketRelayClientMessage): string {
  return JSON.stringify(message);
}

export function parseWebSocketRelayServerMessage(
  payload: unknown,
): WebSocketRelayServerMessage | null {
  const parsed = parseJson(payload);
  if (!isRecord(parsed)) {
    return null;
  }

  const type = readString(parsed.type);
  if (!type) {
    return null;
  }

  if (type === 'joined') {
    const roomId = readString(parsed.roomId);
    const peerId = readString(parsed.peerId);
    const peers = Array.isArray(parsed.peers)
      ? parsed.peers.filter((item) => typeof item === 'string')
      : null;
    if (!roomId || !peerId || peers === null) {
      return null;
    }

    return {
      type,
      roomId,
      peerId,
      peers,
    };
  }

  if (type === 'peer-joined' || type === 'peer-left') {
    const roomId = readString(parsed.roomId);
    const peerId = readString(parsed.peerId);
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
    const signal = parseTransportSignal(parsed.signal);
    if (!signal) {
      return null;
    }

    return {
      type,
      signal,
    };
  }

  if (type === 'error') {
    const code = readString(parsed.code);
    const message = readString(parsed.message);
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
  const parsed = parseJson(payload);
  if (!isRecord(parsed)) {
    return null;
  }

  const type = readString(parsed.type);
  if (!type) {
    return null;
  }

  if (type === 'join') {
    const roomId = readString(parsed.roomId);
    const peerId = readString(parsed.peerId);
    if (!roomId || !peerId) {
      return null;
    }

    const joinMessage: WebSocketRelayJoinMessage = {
      type,
      roomId,
      peerId,
    };

    const token = readOptionalString(parsed.token);
    if (token !== undefined) {
      joinMessage.token = token;
    }

    return joinMessage;
  }

  if (type === 'leave') {
    const roomId = readString(parsed.roomId);
    const peerId = readString(parsed.peerId);
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
    const signal = parseTransportSignal(parsed.signal);
    if (!signal) {
      return null;
    }

    return {
      type,
      signal,
    };
  }

  return null;
}
