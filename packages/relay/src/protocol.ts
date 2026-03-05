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

function readSessionDescription(value: unknown): RTCSessionDescriptionInit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = readString(value.type);
  const sdp = readString(value.sdp);
  if (
    !type ||
    (type !== 'offer' && type !== 'answer' && type !== 'pranswer' && type !== 'rollback')
  ) {
    return undefined;
  }

  return {
    type,
    sdp: sdp ?? '',
  };
}

function readIceCandidate(value: unknown): RTCIceCandidateInit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = readString(value.candidate);
  if (!candidate) {
    return undefined;
  }

  const parsedCandidate: RTCIceCandidateInit = {
    candidate,
  };

  const sdpMid = value.sdpMid === null ? null : readOptionalString(value.sdpMid);
  if (sdpMid !== undefined) {
    parsedCandidate.sdpMid = sdpMid;
  }

  if (typeof value.sdpMLineIndex === 'number') {
    parsedCandidate.sdpMLineIndex = value.sdpMLineIndex;
  }

  const usernameFragment =
    value.usernameFragment === null ? null : readOptionalString(value.usernameFragment);
  if (usernameFragment !== undefined) {
    parsedCandidate.usernameFragment = usernameFragment;
  }

  return parsedCandidate;
}

export interface RelayJoinMessage {
  type: 'join';
  roomId: string;
  peerId: string;
  token?: string;
}

export interface RelaySignalMessage {
  type: 'signal';
  roomId: string;
  fromPeerId: string;
  toPeerId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface RelayLeaveMessage {
  type: 'leave';
  roomId: string;
  peerId: string;
}

export type RelayClientMessage = RelayJoinMessage | RelaySignalMessage | RelayLeaveMessage;

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
  | RelayErrorMessage;

export function serializeRelayServerMessage(message: RelayServerMessage): string {
  return JSON.stringify(message);
}

export function parseRelayClientMessage(payload: unknown): RelayClientMessage | null {
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

    const joinMessage: RelayJoinMessage = {
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

  if (type === 'signal') {
    const roomId = readString(parsed.roomId);
    const fromPeerId = readString(parsed.fromPeerId);
    const toPeerId = readString(parsed.toPeerId);
    if (!roomId || !fromPeerId || !toPeerId) {
      return null;
    }

    const description = readSessionDescription(parsed.description);
    const candidate = readIceCandidate(parsed.candidate);
    if (!description && !candidate) {
      return null;
    }

    const signalMessage: RelaySignalMessage = {
      type,
      roomId,
      fromPeerId,
      toPeerId,
    };

    if (description) {
      signalMessage.description = description;
    }

    if (candidate) {
      signalMessage.candidate = candidate;
    }

    return signalMessage;
  }

  return null;
}
