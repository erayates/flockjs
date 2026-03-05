# Recipe: Live Voting

Audience: users.

Goal: synchronize votes in real time with deterministic merge behavior.

## Pattern

Use CRDT-backed shared state for concurrent vote updates.

## Example (Planned API)

```ts
const poll = room.useState({
  initialValue: {
    question: 'Which feature should we build next?',
    options: ['Mobile app', 'API access', 'Relay auth'],
    votes: {} as Record<string, number>,
  },
  strategy: 'crdt',
});

function vote(userId: string, optionIndex: number) {
  const current = poll.get();
  poll.set({
    ...current,
    votes: { ...current.votes, [userId]: optionIndex },
  });
}
```

## Notes

- Use per-user vote keying to prevent accidental overcount.
- Derive totals from current vote map.

## Related Docs

- [State, awareness, events](../reference/engines-state-awareness-events.md)
- [React adapter](../reference/adapters-react.md)
- [Types](../reference/types.md)
- [Docs index](../README.md)
