# Quickstart

Audience: users.

This walkthrough shows the intended first integration flow for FlockJS.

## 1) Install Core

```bash
npm install @flockjs/core
```

## 2) Create and Connect a Room

```ts
import { createRoom } from '@flockjs/core';

const room = createRoom('my-first-room', {
  transport: 'auto',
  presence: {
    name: 'Alice',
    color: '#4F46E5',
  },
});

await room.connect();
```

Transport support in the current baseline:

- Available: `auto`, `broadcast`, `webrtc`
- Planned: `websocket`

WebRTC cross-machine baseline:

```ts
const room = createRoom('my-first-room', {
  transport: 'webrtc',
  relayUrl: 'ws://localhost:8787',
  presence: { name: 'Alice', color: '#4F46E5' },
});
```

## 3) Track Peers with Presence

```ts
const presence = room.usePresence();

const unsubscribe = presence.subscribe((peers) => {
  console.log(`Peers online: ${peers.length}`);
});
```

## 4) Enable Cursor Sync

```ts
const board = document.getElementById('board');
const cursors = room.useCursors();

if (board) {
  cursors.mount(board);
  cursors.render({
    container: board,
    style: 'default',
    showName: true,
  });
}
```

## 5) Clean Up on Exit

```ts
window.addEventListener('beforeunload', () => {
  unsubscribe();
  void room.disconnect();
});
```

## React Quickstart (Planned Adapter API)

```tsx
import { FlockProvider, usePresence } from '@flockjs/react';

function App() {
  return (
    <FlockProvider roomId="my-first-room" presence={{ name: 'Alice', color: '#4F46E5' }}>
      <RoomPanel />
    </FlockProvider>
  );
}

function RoomPanel() {
  const { others } = usePresence();
  return <p>{others.length} peers in room</p>;
}
```

## Common Next Steps

- Add shared state with `room.useState(...)`
- Add awareness (typing/focus/selection) with `room.useAwareness()`
- Add event broadcasting with `room.useEvents()`

## Related Docs

- [Installation](installation.md)
- [Rooms and transports](rooms-and-transports.md)
- [Core API](../reference/core-api.md)
- [Docs index](../README.md)
