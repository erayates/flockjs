function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readIceCandidate(value: unknown): RTCIceCandidateInit | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = readString(value.candidate);
  const sdpMid = value.sdpMid === null ? null : readOptionalString(value.sdpMid);
  const sdpMLineIndex = typeof value.sdpMLineIndex === 'number' ? value.sdpMLineIndex : undefined;
  const usernameFragment =
    value.usernameFragment === null ? null : readOptionalString(value.usernameFragment);

  if (!candidate) {
    return undefined;
  }

  const parsedCandidate: RTCIceCandidateInit = {
    candidate,
  };

  if (sdpMid !== undefined) {
    parsedCandidate.sdpMid = sdpMid;
  }

  if (sdpMLineIndex !== undefined) {
    parsedCandidate.sdpMLineIndex = sdpMLineIndex;
  }

  if (usernameFragment !== undefined) {
    parsedCandidate.usernameFragment = usernameFragment;
  }

  return parsedCandidate;
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

export interface SignalingJoinMessage {
  type: 'join';
  roomId: string;
  peerId: string;
  token?: string;
}

export interface SignalingSignalMessage {
  type: 'signal';
  roomId: string;
  fromPeerId: string;
  toPeerId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface SignalingLeaveMessage {
  type: 'leave';
  roomId: string;
  peerId: string;
}

export type SignalingClientMessage =
  | SignalingJoinMessage
  | SignalingSignalMessage
  | SignalingLeaveMessage;

export interface SignalingJoinedMessage {
  type: 'joined';
  roomId: string;
  peerId: string;
  peers: string[];
}

export interface SignalingPeerJoinedMessage {
  type: 'peer-joined';
  roomId: string;
  peerId: string;
}

export interface SignalingPeerLeftMessage {
  type: 'peer-left';
  roomId: string;
  peerId: string;
}

export interface SignalingErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type SignalingServerMessage =
  | SignalingJoinedMessage
  | SignalingPeerJoinedMessage
  | SignalingPeerLeftMessage
  | SignalingSignalMessage
  | SignalingErrorMessage;

export function serializeSignalingMessage(message: SignalingClientMessage): string {
  return JSON.stringify(message);
}

export function parseSignalingServerMessage(payload: unknown): SignalingServerMessage | null {
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

    const signalMessage: SignalingSignalMessage = {
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

export function parseSignalingClientMessage(payload: unknown): SignalingClientMessage | null {
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

    const joinMessage: SignalingJoinMessage = {
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

    const signalMessage: SignalingSignalMessage = {
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
