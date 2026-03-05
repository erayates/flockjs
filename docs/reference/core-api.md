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
  reconnect?: boolean | ReconnectOptions;
  encryption?: boolean | EncryptionOptions;
  debug?: boolean | DebugOptions;
}
```

Transport support in EP-02 `#010`:

- Available baseline: `auto`, `broadcast`
- Planned: `webrtc`, `websocket`
- BroadcastChannel transport uses a serialized JSON envelope (`source: "flockjs"`, `version: 1`).
- In browser environments, room lifecycle automatically handles `beforeunload` and `pagehide` to trigger disconnect and propagate peer leave.

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

## Event Names

```ts
// Peer lifecycle
room.on('peer:join', (peer) => {});
room.on('peer:leave', (peer) => {});
room.on('peer:update', (peer) => {});

// Connection lifecycle
room.on('connected', () => {});
room.on('disconnected', (reason) => {});
room.on('reconnecting', (attempt) => {});
room.on('error', (error) => {});

// Room lifecycle
room.on('room:full', () => {});
room.on('room:empty', () => {});
```

## Minimal Flow

```ts
import { createRoom } from '@flockjs/core';

const room = createRoom('doc-abc123', {
  transport: 'auto',
  presence: { name: 'Alice', color: '#7C3AED' },
  maxPeers: 10,
  relayUrl: 'wss://relay.example.com',
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
