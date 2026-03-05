# Advanced Features

Audience: users.

## WebRTC with Relay Signaling (Available Baseline)

```ts
import { createRoom } from '@flockjs/core';

const room = createRoom('doc-room', {
  transport: 'webrtc',
  relayUrl: 'ws://localhost:8787',
  relayAuth: async () => {
    const res = await fetch('/api/flock-token');
    const body = await res.json();
    return body.token;
  },
  stunUrls: ['stun:stun.l.google.com:19302'],
  webrtc: {
    iceGatherTimeoutMs: 5000,
    dataChannel: { ordered: true, protocol: 'flockjs-v1' },
  },
});
```

## End-to-End Encryption

```ts
const room = createRoom('secure-room', {
  encryption: {
    algorithm: 'AES-GCM',
    passphrase: 'replace-with-secure-secret',
  },
});
```

Security notes:

- Distribute keys/passphrases out-of-band.
- Never hardcode production secrets in frontend code.
- End-to-end payload encryption semantics are planned for deeper EP-03/EP-05 implementation.

## Relay Signaling Server (`@flockjs/relay`)

```ts
import { createRelayServer } from '@flockjs/relay';

const relay = createRelayServer({
  port: 8787,
});

await relay.start();
```

The relay package is the self-hostable baseline for both:

- WebRTC SDP/ICE signaling
- WebSocket room message relay

WebSocket relay example:

```ts
const room = createRoom('doc-room', {
  transport: 'websocket',
  relayUrl: 'ws://localhost:8787',
});
```

## Reconnection

```ts
const room = createRoom('my-room', {
  reconnect: {
    maxAttempts: 10,
    backoffMs: 500,
    backoffMultiplier: 1.5,
    maxBackoffMs: 30000,
  },
});
```

Reconnect strategy fields are available in `RoomOptions`; automatic reconnection behavior is planned for subsequent transport hardening.

## CRDT with Yjs (Planned)

CRDT/Yjs runtime integration is not shipped in this baseline. Treat CRDT strategy references as forward-looking API direction.

## Auth Pattern

For private rooms in relay mode:

- validate token server-side
- map identity to peer metadata
- reject unauthorized joins before admission

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [Rooms and transports](../getting-started/rooms-and-transports.md)
- [Performance](performance.md)
- [Security policy](../../SECURITY.md)
- [Docs index](../README.md)
