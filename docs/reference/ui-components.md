# UI Components (`@flockjs/cursors`)

Audience: users.

## Component Catalog

| Component            | Purpose                            |
| -------------------- | ---------------------------------- |
| `PeerCursor`         | animated cursor with label         |
| `PresenceBar`        | online user list                   |
| `PresenceAvatars`    | compact avatar stack               |
| `LiveIndicator`      | area-level activity marker         |
| `TypingIndicator`    | typing state visualization         |
| `CollaborationBadge` | peer activity indicator on element |
| `SelectionHighlight` | peer selection overlay             |
| `FloatingReaction`   | transient reaction animation       |

## Example: `PresenceBar`

```tsx
import { PresenceBar } from '@flockjs/cursors';

export function HeaderPresence() {
  return (
    <PresenceBar maxVisible={5} showNames size="md" onUserClick={(user) => console.log(user.id)} />
  );
}
```

## Example: `PeerCursor`

```tsx
import { PeerCursor } from '@flockjs/cursors';

{
  cursors.map((cursor) => (
    <PeerCursor
      key={cursor.userId}
      x={cursor.x}
      y={cursor.y}
      name={cursor.name}
      color={cursor.color}
      idle={cursor.idle}
      style="arrow"
    />
  ));
}
```

## Usage Notes

- Use kit components for faster integration.
- Use custom renderers for product-specific interaction design.

## Related Docs

- [Reference index](README.md)
- [Cursor engine](engines-cursors.md)
- [React adapter](adapters-react.md)
- [Multiplayer canvas recipe](../recipes/multiplayer-canvas.md)
- [Docs index](../README.md)
