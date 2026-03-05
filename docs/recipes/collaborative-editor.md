# Recipe: Collaborative Editor

Audience: users.

Goal: combine room lifecycle, presence, awareness, and CRDT state for document editing.

## Scenario

A Notion-style editor where users can:

- edit content concurrently
- see collaborator cursors/identity
- view typing/focus signals

## Example (Planned API)

```ts
import { createRoom } from '@flockjs/core';
import * as Y from 'yjs';

const room = createRoom(`doc-${documentId}`, {
  transport: 'auto',
  presence: { name: user.name, color: user.color },
});

await room.connect();

const ydoc: Y.Doc = room.getYDoc();
const yText = ydoc.getText('content');
```

## Integration Notes

- Use CRDT strategy for concurrent text edits.
- Use awareness for cursor selection ranges.
- Keep document metadata in shared state if needed.

## Failure Modes

- Connection interruption: rely on reconnection and replay behavior.
- Conflicting metadata writes: use `lww` for simple title/tag fields.

## Related Docs

- [Advanced features](../reference/advanced.md)
- [State, awareness, events](../reference/engines-state-awareness-events.md)
- [Quickstart](../getting-started/quickstart.md)
- [Docs index](../README.md)
