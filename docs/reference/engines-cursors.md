# Cursor Engine

Audience: users.

Cursors synchronize pointer position across peers.

## Access

```ts
const cursors = room.useCursors();
```

## Interface

```ts
interface CursorEngine {
  mount(el: HTMLElement): void;
  unmount(): void;
  render(options?: CursorRenderOptions): void;
  subscribe(cb: (positions: CursorPosition[]) => void): Unsubscribe;
  getPositions(): CursorPosition[];
  setPosition(position: Partial<CursorPosition>): void;
}
```

## Position Shape

```ts
interface CursorPosition {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  xAbsolute: number;
  yAbsolute: number;
  element?: string;
  idle: boolean;
}
```

## Render Options

```ts
cursors.render({
  container: '#canvas',
  style: 'default',
  showName: true,
  showIdle: false,
  idleTimeout: 3000,
  zIndex: 9999,
});
```

## Custom Renderer Pattern

```ts
cursors.mount(document.getElementById('board') as HTMLElement);

cursors.subscribe((positions) => {
  for (const pos of positions) {
    const id = `cursor-${pos.userId}`;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      document.getElementById('board')?.appendChild(el);
    }

    el.style.position = 'absolute';
    el.style.left = `${pos.x * 100}%`;
    el.style.top = `${pos.y * 100}%`;
    el.textContent = pos.name;
  }
});
```

## Performance Boundaries

- Throttle high-frequency cursor updates.
- Keep cursor payloads small.
- Use awareness for semantic state, not pointer telemetry.

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [UI components](ui-components.md)
- [Performance](performance.md)
- [Docs index](../README.md)
