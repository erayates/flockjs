# React Adapter (`@flockjs/react`)

Audience: users.

## Provider

```tsx
import { FlockProvider } from '@flockjs/react';

function App() {
  return (
    <FlockProvider
      roomId="my-room"
      transport="auto"
      presence={{ name: 'Alice', color: '#4F46E5' }}
      onConnect={() => console.log('connected')}
      onError={(error) => console.error(error)}
    >
      <Workspace />
    </FlockProvider>
  );
}
```

## Hooks

| Hook | Returns | Purpose |
|---|---|---|
| `useRoom()` | `Room` | access low-level room instance |
| `usePresence()` | `{ self, others, all }` | reactive participant data |
| `useCursors()` | `{ ref, cursors, mount }` | cursor tracking/rendering |
| `useSharedState(key, opts)` | `[value, setValue]` | synchronized state |
| `useAwareness()` | `{ set, others }` | ephemeral peer context |
| `useEvent(name, handler)` | `emit` function | subscribe and emit |
| `usePeers()` | `Peer[]` | connected peers |
| `useConnectionStatus()` | `RoomStatus` | current room status |

## Example

```tsx
import { useSharedState } from '@flockjs/react';

function PollWidget() {
  const [votes, setVotes] = useSharedState('poll-votes', {
    initialValue: { yes: 0, no: 0 },
    strategy: 'crdt',
  });

  return (
    <div>
      <p>Yes: {votes.yes} | No: {votes.no}</p>
      <button onClick={() => setVotes((v) => ({ ...v, yes: v.yes + 1 }))}>Vote Yes</button>
    </div>
  );
}
```

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [State, awareness, events](engines-state-awareness-events.md)
- [Quickstart](../getting-started/quickstart.md)
- [Docs index](../README.md)
