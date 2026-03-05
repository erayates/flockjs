# Rooms and Transports

Audience: users.

## Room Model

A `room` is the primary collaboration scope in FlockJS.

- Peers with the same `roomId` join the same session.
- Rooms are ephemeral by default.
- Room IDs should map to app-level entities (for example: document ID, board ID, project ID).

## Transport Modes

| Transport   | Typical use                                 | Server required          | Notes                                                                                                                              |
| ----------- | ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `webrtc`    | small collaborative rooms across machines   | Yes (relay for WebRTC)   | P2P DataChannel mesh after signaling; same-origin fallback uses BroadcastChannel only when signaling is unavailable during connect |
| `broadcast` | same-browser, same-origin tabs              | No                       | JSON-envelope messaging + unload-aware leave handling                                                                              |
| `websocket` | larger rooms or strict network environments | Yes (`@flockjs/relay`)   | Relay-backed room messaging with targeted send + broadcast support                                                                 |
| `auto`      | choose best available option                | Depends on fallback path | Ordered selection: `broadcast` -> `webrtc` -> `websocket` -> `in-memory`                                                           |

## Recommended Defaults

- Start with `transport: 'auto'` unless you have a specific network requirement.
- Use `transport: 'webrtc'` with `relayUrl` for cross-machine collaboration.
- Use `transport: 'websocket'` with `relayUrl` for larger rooms or constrained networks where direct peer mesh is not a fit.
- If initial signaling is unavailable and peers share the same origin, `transport: 'webrtc'` falls back to BroadcastChannel automatically.
- Keep `maxPeers` explicit for mesh safety (for example `maxPeers: 8`).
- Default STUN fallback is Google public STUN (`stun:stun.l.google.com:19302`) when `stunUrls` is omitted.
- Default ICE gather timeout is `5000ms` (`webrtc.iceGatherTimeoutMs`).
- Default DataChannel behavior is ordered and reliable (`ordered: true`, no `maxRetransmits` override).
- Configure your own STUN/TURN infrastructure for production.

## Auto Selection Order

- `broadcast` when `BroadcastChannel` is available.
- `webrtc` when BroadcastChannel is unavailable and both `RTCPeerConnection` and `relayUrl` are available.
- `websocket` when BroadcastChannel is unavailable, WebRTC is unavailable, and `relayUrl` is available.
- `in-memory` when no browser-capable transport is available.

## BroadcastChannel Notes

- Broadcast transport serializes each signal as a versioned JSON envelope before delivery.
- In browser contexts, rooms auto-handle `beforeunload` and `pagehide` to trigger disconnect and propagate peer leave events.
- WebRTC fallback uses the same BroadcastChannel transport semantics, but only during the initial connect attempt and only for same-origin peers.

## STUN/TURN Production Notes

WebRTC discovery uses ICE and commonly requires STUN/TURN:

- STUN helps with peer discovery and NAT traversal
- TURN relays traffic when direct peer connection fails
- TURN is strongly recommended for enterprise/private networks

WebRTC baseline example:

```ts
const room = createRoom('doc-123', {
  transport: 'webrtc',
  relayUrl: 'ws://localhost:8787',
  relayAuth: async () => {
    const token = await getRelayToken();
    return token;
  },
  stunUrls: ['stun:stun.example.com:3478'],
  maxPeers: 8,
  webrtc: {
    iceGatherTimeoutMs: 5000,
    dataChannel: { ordered: true, protocol: 'flockjs-v1' },
  },
});
```

## Scaling Guidance

- Up to about 8-12 peers: WebRTC mesh is usually acceptable
- 10+ peers consistently: evaluate relay mode
- 100+ peers: run multiple relay instances with shared backend coordination
- If rooms regularly exceed your `maxPeers` setting, move those workloads off mesh transport.

## Related Docs

- [Installation](installation.md)
- [Quickstart](quickstart.md)
- [Advanced features](../reference/advanced.md)
- [Performance](../reference/performance.md)
- [Docs index](../README.md)
