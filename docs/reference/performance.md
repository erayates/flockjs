# Performance Guide

Audience: users and contributors.

## Transport Characteristics

| Metric                    | WebRTC (P2P) | WebSocket relay | BroadcastChannel  |
| ------------------------- | ------------ | --------------- | ----------------- |
| Typical same-city latency | 8-30ms       | 15-50ms         | <1ms              |
| Recommended room size     | 8-12 peers   | 500+ peers      | same-browser only |
| Setup complexity          | low          | medium          | low               |

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
2. Move to relay for sustained 10+ peers.
3. Add horizontal relay scaling as concurrency grows.

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
