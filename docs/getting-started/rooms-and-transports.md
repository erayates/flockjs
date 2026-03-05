# Rooms and Transports

Audience: users.

## Room Model

A `room` is the primary collaboration scope in FlockJS.

- Peers with the same `roomId` join the same session.
- Rooms are ephemeral by default.
- Room IDs should map to app-level entities (for example: document ID, board ID, project ID).

## Transport Modes

| Transport   | Typical use                                 | Server required          | Notes                                                 |
| ----------- | ------------------------------------------- | ------------------------ | ----------------------------------------------------- |
| `webrtc`    | small collaborative rooms across machines   | Yes (signaling relay)    | P2P DataChannel mesh after signaling                  |
| `broadcast` | same-browser, same-origin tabs              | No                       | JSON-envelope messaging + unload-aware leave handling |
| `websocket` | larger rooms or strict network environments | Yes (`@flockjs/relay`)   | Planned transport mode                                |
| `auto`      | choose best available option                | Depends on fallback path | Recommended starting mode                             |

## Recommended Defaults

- Start with `transport: 'auto'` for same-tab baseline behavior.
- Use `transport: 'webrtc'` with `relayUrl` for cross-machine collaboration.
- Set explicit `maxPeers` for WebRTC mesh safety
- Configure your own STUN/TURN infrastructure for production
- Keep `websocket` mode reserved for future releases (planned).

## BroadcastChannel Notes

- Broadcast transport serializes each signal as a versioned JSON envelope before delivery.
- In browser contexts, rooms auto-handle `beforeunload` and `pagehide` to trigger disconnect and propagate peer leave events.

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

## Related Docs

- [Installation](installation.md)
- [Quickstart](quickstart.md)
- [Advanced features](../reference/advanced.md)
- [Performance](../reference/performance.md)
- [Docs index](../README.md)
