# Recipe: Multiplayer Canvas

Audience: users.

Goal: build a live canvas where strokes are broadcast instantly and persisted for late joiners.

## Pattern

- `events`: immediate stroke broadcast for low-latency rendering
- `state`: persistent stroke history
- `cursors`: collaborator pointer visibility

## Example (Planned API)

```ts
const room = createRoom(`canvas-${canvasId}`, {
  presence: { name: user.name, color: user.color },
});

await room.connect();

const events = room.useEvents();
const state = room.useState({
  initialValue: { strokes: [] as Stroke[] },
  strategy: 'crdt',
});

events.on<Stroke>('stroke', (stroke) => {
  drawStroke(stroke);
});

canvas.addEventListener('mouseup', () => {
  const stroke = captureStroke();
  events.emit('stroke', stroke);
  state.patch({ strokes: [...state.get().strokes, stroke] });
});
```

## Notes

- Keep stroke payload compact.
- Consider chunking for very long paths.
- Use relay mode for larger live sessions.

## Related Docs

- [Cursor engine](../reference/engines-cursors.md)
- [State, awareness, events](../reference/engines-state-awareness-events.md)
- [Performance](../reference/performance.md)
- [Docs index](../README.md)
