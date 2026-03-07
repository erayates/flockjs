# Presence Engine

Audience: users.

Presence tracks room participants and user-level metadata.

## Access

```ts
const presence = room.usePresence();
```

## Interface

```ts
interface PresenceEngine {
  update(data: Record<string, unknown>): void;
  replace(data: Record<string, unknown>): void;
  subscribe(cb: (peers: Peer[]) => void): Unsubscribe;
  get(peerId: string): Peer | null;
  getAll(): Peer[];
  getSelf(): Peer;
}
```

Lookup semantics:

- `update()` shallow-merges user fields into the local presence snapshot and broadcasts the full snapshot.
- `replace()` replaces user-defined presence fields entirely while preserving `id`, `joinedAt`, and managed `lastSeen`.
- `subscribe()` fires immediately and then on every peer snapshot change, including `lastSeen` refreshes.
- `getSelf()` always returns the local peer registry entry.
- `get(peerId)` and `getAll()` read from the same registry that powers `room.peers`.
- Local `lastSeen` is refreshed every `30000ms` while connected and propagated through presence updates.
- Newly connected peers receive current presence during the hello/welcome handshake rather than waiting for the next heartbeat.
- Peers inferred as disconnected may remain visible for up to `5000ms` before removal so reconnecting with the same peer ID does not churn presence state.

## Data Shape

```ts
interface PresenceData {
  id: string;
  joinedAt: number;
  lastSeen: number;
  name?: string;
  color?: string;
  avatar?: string;
  [key: string]: unknown;
}
```

## Example

```ts
const presence = room.usePresence();

presence.update({ page: '/dashboard', status: 'active' });

const unsubscribe = presence.subscribe((peers) => {
  for (const peer of peers) {
    console.log(peer.name, peer.page);
  }
});

unsubscribe();
```

## Usage Boundaries

- Store user-visible session metadata in presence.
- Do not store secrets or credentials.
- Use awareness for highly transient context.

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [State, awareness, events](engines-state-awareness-events.md)
- [Types](types.md)
- [Docs index](../README.md)
