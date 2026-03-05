# Rooms and Transports

Audience: users.

## Room Model

A `room` is the primary collaboration scope in FlockJS.

- Peers with the same `roomId` join the same session.
- Rooms are ephemeral by default.
- Room IDs should map to app-level entities (for example: document ID, board ID, project ID).

## Transport Modes

| Transport | Typical use | Server required | Notes |
|---|---|---|---|
| `webrtc` | small collaborative rooms | No app server (STUN/TURN infra still needed) | Best default for low-latency peer sync |
| `broadcast` | same-browser, same-origin tabs | No | Useful local/dev multi-tab behavior |
| `websocket` | larger rooms or strict network environments | Yes (`@flockjs/relay`) | Centralized relay path |
| `auto` | choose best available option | Depends on fallback path | Recommended starting mode |

## Recommended Defaults

- Start with `transport: 'auto'`
- Set explicit `maxPeers` for WebRTC mesh safety
- Configure your own STUN/TURN infrastructure for production
- Switch to relay mode as room sizes increase

## STUN/TURN Production Notes

WebRTC discovery uses ICE and commonly requires STUN/TURN:

- STUN helps with peer discovery and NAT traversal
- TURN relays traffic when direct peer connection fails
- TURN is strongly recommended for enterprise/private networks

Example:

```ts
const room = createRoom('doc-123', {
  transport: 'webrtc',
  stunUrls: [
    'stun:stun.example.com:3478',
    'turn:turn.example.com:3478?transport=udp',
  ],
});
```

## Scaling Guidance

- Up to about 8-12 peers: WebRTC mesh is usually acceptable
- 10+ peers consistently: evaluate relay mode
- 100+ peers: run multiple relay instances with shared backend coordination

## Related Docs

- [Installation](installation.md)
- [Quickstart](quickstart.md)
- [Advanced features](../reference/advanced.md)
- [Performance](../reference/performance.md)
- [Docs index](../README.md)
