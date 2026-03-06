# Core API

Audience: users.

## Entry Point

```ts
function createRoom<TPresence extends Record<string, unknown> = Record<string, unknown>>(
  roomId: string,
  options?: RoomOptions<TPresence>,
): Room<TPresence>;
```

## `RoomOptions`

```ts
type TransportMode = 'auto' | 'webrtc' | 'websocket' | 'broadcast';

interface RoomOptions {
  transport?: TransportMode;
  presence?: Partial<PresenceData>;
  maxPeers?: number;
  stunUrls?: string[];
  relayUrl?: string;
  relayAuth?: string | (() => string | Promise<string>);
  webrtc?: {
    iceGatherTimeoutMs?: number;
    dataChannel?: {
      ordered?: boolean;
      maxRetransmits?: number;
      protocol?: string;
    };
  };
  reconnect?: boolean | ReconnectOptions;
  encryption?: boolean | EncryptionOptions;
  debug?: boolean | DebugOptions;
}
```

Transport support in the current baseline:

- Available baseline: `auto`, `broadcast`, `webrtc`, `websocket`
- `auto` selection order is `broadcast` -> `webrtc` -> `websocket` -> `in-memory`.
- `auto` chooses BroadcastChannel when available, even if `relayUrl` is configured.
- `webrtc` uses `relayUrl` for SDP/ICE signaling and falls back to BroadcastChannel during initial connect when signaling is unavailable and same-origin broadcast is available.
- `webrtc` still fails hard when `relayUrl` is missing, `RTCPeerConnection` is unavailable, or the relay rejects the join/auth request.
- `websocket` uses `relayUrl` and `@flockjs/relay` for generic room message relay.
- Broadcast fallback is connect-time only; later signaling disconnects still emit `disconnected`.
- Default STUN server: `stun:stun.l.google.com:19302` (override with `stunUrls`).
- Default ICE gather timeout: `5000ms` (override with `webrtc.iceGatherTimeoutMs`).
- DataChannel default: ordered and reliable delivery (`ordered: true`, no `maxRetransmits` set).
- `maxPeers` is a hard cap for WebRTC mesh peer-connection context creation.
- BroadcastChannel transport uses a serialized JSON envelope (`source: "flockjs"`, `version: 1`).
- Peer transport messages are schema-validated before room delivery.
- WebRTC data channels and relay websocket transport negotiate a peer protocol version and codec on connect.
- Binary-capable transports upgrade to MessagePack after negotiation when both peers support it; JSON remains the compatibility fallback.
- BroadcastChannel remains JSON-only by design.
- Malformed peer protocol frames are rejected at the transport boundary, logged with warn-level diagnostics, and ignored without crashing the room.
- In browser environments, room lifecycle automatically handles `beforeunload` and `pagehide` to trigger disconnect and propagate peer leave.
- `debug.transport` logs transport selection plus protocol negotiation and downgrade decisions via `console.debug`.

## `Room` Contract

```ts
interface Room<TPresence extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  peerId: string;
  status: RoomStatus;
  peers: Peer<TPresence>[];
  peerCount: number;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  usePresence(): PresenceEngine<TPresence>;
  useCursors(options?: CursorOptions): CursorEngine;
  useState<T>(options: StateOptions<T>): StateEngine<T>;
  useAwareness(): AwarenessEngine;
  useEvents(options?: EventOptions): EventEngine<TPresence>;

  on<T extends RoomEventName>(event: T, cb: RoomEventHandler<TPresence, T>): Unsubscribe;
  off<T extends RoomEventName>(event: T, cb: RoomEventHandler<TPresence, T>): void;
}
```

Peer lifecycle notes:

- `peerId` is generated as a collision-resistant UUID v4.
- `room.peers` and `peerCount` are backed by the internal peer registry used by presence lookups.
- Explicit peer leaves are removed immediately.
- Inferred disconnects keep the peer visible for up to `5000ms` so same-peer reconnect races can dedupe without emitting a spurious leave/join pair.

## Event Names

```ts
// Peer lifecycle
room.on('peer:join', (peer) => {});
room.on('peer:leave', (peer) => {});
room.on('peer:update', (peer) => {});

// Connection lifecycle
room.on('connected', () => {});
room.on('disconnected', ({ reason }) => {});
room.on('reconnecting', (attempt) => {});
room.on('error', (error) => {});

// Room lifecycle
room.on('room:full', () => {});
room.on('room:empty', () => {});
```

Connection event semantics:

- `error`: emitted when transport/runtime errors are surfaced to room lifecycle.
- `disconnected`: emitted for manual disconnect and transport-level disconnects with a reason payload.

## Minimal Flow

```ts
import { createRoom } from '@flockjs/core';

const room = createRoom('doc-abc123', {
  transport: 'webrtc',
  presence: { name: 'Alice', color: '#7C3AED' },
  maxPeers: 10,
  relayUrl: 'ws://localhost:8787',
  relayAuth: async () => 'signed-token',
  webrtc: {
    iceGatherTimeoutMs: 5000,
    dataChannel: { ordered: true, protocol: 'flockjs-v1' },
  },
  reconnect: { maxAttempts: 5, backoffMs: 1000 },
});

await room.connect();
```

## Related Docs

- [Reference index](README.md)
- [Presence engine](engines-presence.md)
- [Cursor engine](engines-cursors.md)
- [State, awareness, events](engines-state-awareness-events.md)
- [Types](types.md)
- [Docs index](../README.md)
