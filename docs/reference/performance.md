# Performance Guide

Audience: users and contributors.

## Transport Characteristics

| Metric                    | WebRTC (P2P) | WebSocket relay | BroadcastChannel  |
| ------------------------- | ------------ | --------------- | ----------------- |
| Typical same-city latency | 8-30ms       | 15-50ms         | <1ms              |
| Recommended room size     | 8-12 peers   | 500+ peers      | same-browser only |
| Setup complexity          | low          | medium          | low               |

Binary codec note:

- WebRTC and relay websocket transports can switch from JSON to MessagePack after peer negotiation.
- BroadcastChannel stays JSON-only so same-origin tabs share a stable text envelope.
- Mixed-version or json-only peers automatically downgrade to JSON rather than failing the room.

## Optimization

### Cursor Throughput

```ts
const cursors = room.useCursors({
  throttleMs: 16,
  smoothing: true,
});
```

### Shared State

- Prefer `patch` to reduce payload churn.
- Avoid synchronizing large nested objects.
- Keep transient data in `events`, not `state`.

### Awareness

- Keep awareness semantic (typing/focus/selection).
- Do not stream high-frequency pointer coordinates through awareness.

## Scaling Path

1. Start with `transport: 'auto'`.
2. Let `auto` stay on BroadcastChannel for same-origin browser contexts.
3. Use WebRTC for smaller cross-machine rooms when direct mesh is viable.
4. Move to websocket relay for sustained larger rooms or constrained networks.
5. Add horizontal relay scaling as concurrency grows.

## Validation Targets

- Stable cursor updates at expected peer count
- Predictable reconnect behavior under packet loss
- Controlled state payload growth over long sessions

## Related Docs

- [Reference index](README.md)
- [Rooms and transports](../getting-started/rooms-and-transports.md)
- [Advanced features](advanced.md)
- [Devtools and debugging](devtools-debugging.md)
- [Docs index](../README.md)
