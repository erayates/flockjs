# WebRTC Validation

Audience: contributors.

This checklist validates EP-02 `#011` acceptance behavior for `transport: 'webrtc'`:

- two-peer connection across machines
- STUN default and override behavior
- ICE gather default timeout (`5000ms`) and explicit timeout validation
- DataChannel defaults (`ordered: true`, reliable by default)
- room lifecycle events (`connected`, `peer:join`, `peer:leave`, `disconnected`, `error`)

## 1) Start Relay Signaling Server

From repo root:

```bash
pnpm install
pnpm --filter @flockjs/relay build
pnpm --filter @flockjs/relay start
```

Default address: `ws://127.0.0.1:8787`.

For cross-machine validation, use a reachable host/IP:

- Local machine relay example: `ws://<host-lan-ip>:8787`
- Cloud relay example: `wss://relay.example.com`

## 2) Configure Two Clients (Two Machines)

Open the same app build on machine A and machine B (different networks allowed).

Configure both clients with:

```ts
const room = createRoom('validation-room-1', {
  transport: 'webrtc',
  relayUrl: 'ws://<reachable-relay-host>:8787',
  webrtc: {
    // defaults shown explicitly for validation clarity
    iceGatherTimeoutMs: 5000,
    dataChannel: {
      ordered: true,
      protocol: 'flockjs-v1',
      // no maxRetransmits => reliable default
    },
  },
});
```

Default behavior if omitted:

- `stunUrls`: uses Google public STUN (`stun:stun.l.google.com:19302`)
- `webrtc.iceGatherTimeoutMs`: `5000`
- `webrtc.dataChannel.ordered`: `true`
- `webrtc.dataChannel.maxRetransmits`: unset (reliable)

## 3) Two-Machine Event Sequence Checklist

1. Connect machine A room instance.
2. Connect machine B room instance.
3. Expected:
   - both emit `connected`
   - both observe `peer:join`
   - `peerCount` increments to `1` on each side
4. Send event payload from A to B (`room.useEvents().emit(...)`), verify receipt on B.
5. Send event payload from B to A, verify receipt on A.
6. Close machine B tab/app.
7. Expected on A:
   - `peer:leave` emitted for B
   - `peerCount` decrements
8. If signaling disconnects while connected, expected on both affected clients:
   - room emits `disconnected` with reason
   - room status transitions to `disconnected`

## 4) ICE Timeout Verification

1. Temporarily set `webrtc.iceGatherTimeoutMs` to a low value (for example `25`).
2. Induce a gather timeout condition in the test environment/network.
3. Expected:
   - transport error path is triggered
   - room emits `error`
4. Reset timeout to default (`5000`) after validation.

## 5) maxPeers Verification

1. Configure `maxPeers` to a small value (for example `2` total peers including self).
2. Attempt to join additional peers.
3. Expected:
   - no new peer connection contexts created beyond limit
   - existing peers continue to function

## Related Docs

- [Development setup](development-setup.md)
- [Rooms and transports](../getting-started/rooms-and-transports.md)
- [Core API](../reference/core-api.md)
- [Type reference](../reference/types.md)
- [Docs index](../README.md)
