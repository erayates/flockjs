# Type Reference

Audience: users and contributors.

Canonical type contracts for the pre-`v1.0` API surface.

## Core Types

```ts
export type RoomStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface Peer {
  id: string;
  joinedAt: number;
  lastSeen: number;
  name?: string;
  color?: string;
  avatar?: string;
  [key: string]: unknown;
}

export type PeerWithPresence<TPresence extends Record<string, unknown>> = Peer & Partial<TPresence>;

export interface FlockError extends Error {
  code: 'ROOM_FULL' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'ENCRYPTION_ERROR';
  recoverable: boolean;
}

export type Unsubscribe = () => void;

export type RelayAuthToken = string | (() => string | Promise<string>);

export interface WebRTCDataChannelOptions {
  ordered?: boolean;
  maxRetransmits?: number;
  protocol?: string;
}

export interface WebRTCOptions {
  iceGatherTimeoutMs?: number;
  dataChannel?: WebRTCDataChannelOptions;
}
```

EP-02 `#011` baseline note:

- `RoomStatus`, `Peer`, and `FlockError` are now implemented in the core runtime.
- Broadcast-based peer discovery is available via `transport: 'auto' | 'broadcast'`.
- WebRTC mesh transport is available via `transport: 'webrtc'` with relay signaling.
- BroadcastChannel payloads are serialized and validated via a versioned JSON envelope.
- Browser room instances auto-register unload handlers (`beforeunload`, `pagehide`) to propagate `peer:leave`.
- `websocket` transport path remains planned.

## Engine Option Types

```ts
export interface CursorOptions {
  throttleMs?: number;
  smoothing?: boolean;
  idleAfterMs?: number;
}

export interface StateOptions<T> {
  initialValue: T;
  strategy?: 'lww' | 'crdt' | 'custom';
  persist?: boolean;
  merge?: (a: T, b: T) => T;
}

export interface EventOptions {
  loopback?: boolean;
  reliable?: boolean;
}
```

## Change Discipline

- Keep this file synchronized with public API docs.
- Document type-level breaking changes in `CHANGELOG.md`.

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [Presence engine](engines-presence.md)
- [State, awareness, events](engines-state-awareness-events.md)
- [Docs index](../README.md)
