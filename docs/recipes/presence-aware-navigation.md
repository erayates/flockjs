# Recipe: Presence-Aware Navigation

Audience: users.

Goal: show where teammates are currently active across app routes.

## Pattern

- Update presence on route change
- Aggregate peer presence by page
- Render live navigation activity map

## Example (Planned API)

```ts
const presence = room.usePresence();

router.afterEach((to) => {
  presence.update({
    page: to.path,
    pageTitle: String(to.meta?.title ?? to.path),
    timestamp: Date.now(),
  });
});

presence.subscribe((peers) => {
  const byPage = peers.reduce<Record<string, string[]>>((acc, peer) => {
    const key = String(peer.page ?? 'unknown');
    acc[key] = acc[key] ?? [];
    acc[key].push(String(peer.name ?? peer.id));
    return acc;
  }, {});

  renderPresenceMap(byPage);
});
```

## Notes

- Only include non-sensitive route metadata in presence.
- Presence should represent user-visible context, not private app state.

## Related Docs

- [Presence engine](../reference/engines-presence.md)
- [Rooms and transports](../getting-started/rooms-and-transports.md)
- [Security policy](../../SECURITY.md)
- [Docs index](../README.md)
