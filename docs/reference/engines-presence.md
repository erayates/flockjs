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
