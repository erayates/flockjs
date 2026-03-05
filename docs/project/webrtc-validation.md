# WebRTC Validation

Audience: contributors.

This checklist validates EP-02 `#011` baseline behavior for `transport: 'webrtc'`.

## 1) Start Relay Signaling Server

From repo root:

```bash
pnpm install
pnpm --filter @flockjs/relay build
pnpm --filter @flockjs/relay start
```

Default address: `ws://127.0.0.1:8787`.

## 2) Run Two Clients

Use two browser tabs on the same origin, or two machines opening the same app build.

Configure both clients with:

```ts
const room = createRoom('validation-room-1', {
  transport: 'webrtc',
  relayUrl: 'ws://127.0.0.1:8787',
  stunUrls: ['stun:stun.l.google.com:19302'],
  webrtc: {
    iceGatherTimeoutMs: 5000,
    dataChannel: { ordered: true, protocol: 'flockjs-v1' },
  },
});
```

## 3) Validate Join and Data Flow

- Connect client A, then client B.
- Verify each client observes `peer:join` and `peerCount` increments.
- Send event payloads (`room.useEvents().emit(...)`) and verify delivery.
- Confirm initial `hello/welcome` discovery results in populated `room.peers`.

## 4) Validate Leave and Cleanup

- Close client B tab/window.
- Verify client A receives `peer:leave` and `peerCount` decrements.
- Reopen client B and reconnect with same room ID.
- Verify reconnect path re-establishes peer discovery and data flow.

## 5) Validate Timeout Behavior

- Temporarily set `webrtc.iceGatherTimeoutMs` to a low value (for example `10`).
- Confirm a transport error path is observable (room `error` event and/or debug logs).
- Reset timeout to production default (`5000`) after validation.

## Related Docs

- [Development setup](development-setup.md)
- [Rooms and transports](../getting-started/rooms-and-transports.md)
- [Core API](../reference/core-api.md)
- [Type reference](../reference/types.md)
- [Docs index](../README.md)
