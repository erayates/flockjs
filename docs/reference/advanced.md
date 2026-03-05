# Advanced Features

Audience: users.

## CRDT with Yjs

Use CRDT mode when concurrent edits must survive merges.

```ts
import { createRoom } from '@flockjs/core';
import * as Y from 'yjs';

const room = createRoom('doc-room', { transport: 'auto' });
await room.connect();

const ydoc = room.getYDoc();
const yText = ydoc.getText('editor-content');
yText.insert(0, 'Hello');
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

## Relay Mode (`@flockjs/relay`)

```ts
const room = createRoom('large-room', {
  transport: 'websocket',
  relayUrl: 'wss://relay.example.com',
  relayAuth: async () => {
    const res = await fetch('/api/flock-token');
    const body = await res.json();
    return body.token;
  },
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
