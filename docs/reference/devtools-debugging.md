# Devtools and Debugging

Audience: users and contributors.

## Debug Configuration

```ts
const room = createRoom('my-room', {
  debug: {
    transport: true,
    state: true,
    presence: false,
    events: true,
    performance: true,
  },
});
```

`debug.transport` writes `console.debug` entries for both transport selection and peer-protocol negotiation. Selection payloads include:

- requested mode
- selected transport
- selection reason

Negotiation payloads include:

- transport kind
- remote peer id
- negotiated protocol version
- negotiated codec (`json` or `msgpack`)
- downgrade or compatibility reason when applicable

Malformed peer protocol frames are reported through `console.warn` with transport and rejection context. They are ignored after logging instead of being delivered to the room.

## Diagnostics Snapshot

```ts
const diagnostics = await room.getDiagnostics();

console.log(diagnostics);
// {
//   transport: 'webrtc',
//   peerCount: 3,
//   latency: { 'peer-a': 12 },
//   stateSize: 1204,
//   messagesPerSecond: 8.3,
// }
```

## Common Issues

| Symptom                            | Likely cause                | Action                            |
| ---------------------------------- | --------------------------- | --------------------------------- |
| Cross-network peers do not connect | STUN/TURN path unavailable  | configure reliable STUN/TURN      |
| State sync feels slow              | oversized state payloads    | prefer `patch` and reduce payload |
| Cursor jitter                      | update frequency too high   | throttle cursor updates           |
| Room saturates quickly             | `maxPeers` too low for mesh | increase limit or move to relay   |
| Duplicate reconnect side effects   | stale lifecycle handling    | normalize reconnect transitions   |

## Triage Checklist

1. Verify all peers use the exact same `roomId`.
2. Inspect selected transport and fallback path.
3. Enable only required debug channels.
4. Re-test reconnection with controlled disconnect simulation.

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [Performance](performance.md)
- [Release process](../project/release-process.md)
- [Docs index](../README.md)
