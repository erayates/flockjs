import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CursorPosition } from '../types';
import { createCursorEngine } from './cursors';

type Listener = (event: unknown) => void;

class MockElement {
  public readonly children: MockElement[] = [];

  public readonly style: Record<string, string> = {};

  public readonly attributes = new Map<string, string>();

  public parentNode: MockElement | null = null;

  public ownerDocument: MockDocument;

  public textContent = '';

  public id = '';

  private rect = {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  };

  private readonly listeners = new Map<string, Set<Listener>>();

  public constructor(
    ownerDocument: MockDocument,
    public readonly tagName: string,
  ) {
    this.ownerDocument = ownerDocument;
  }

  public setBoundingRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.rect = rect;
  }

  public getBoundingClientRect(): DOMRect {
    return {
      ...this.rect,
      bottom: this.rect.top + this.rect.height,
      right: this.rect.left + this.rect.width,
      x: this.rect.left,
      y: this.rect.top,
      toJSON() {
        return { ...this };
      },
    } as DOMRect;
  }

  public addEventListener(type: string, listener: Listener): void {
    const listenersForType = this.listeners.get(type) ?? new Set<Listener>();
    listenersForType.add(listener);
    this.listeners.set(type, listenersForType);
  }

  public removeEventListener(type: string, listener: Listener): void {
    const listenersForType = this.listeners.get(type);
    if (!listenersForType) {
      return;
    }

    listenersForType.delete(listener);
    if (listenersForType.size === 0) {
      this.listeners.delete(type);
    }
  }

  public listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  public dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  public appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  public removeChild(child: MockElement): MockElement {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }

    return child;
  }

  public contains(child: MockElement): boolean {
    if (this.children.includes(child)) {
      return true;
    }

    return this.children.some((candidate) => candidate.contains(child));
  }

  public remove(): void {
    this.parentNode?.removeChild(this);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') {
      this.id = value;
    }
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

class MockDocument {
  public readonly body: MockElement;

  public constructor() {
    this.body = new MockElement(this, 'body');
  }

  public createElement(tagName: string): MockElement {
    return new MockElement(this, tagName);
  }

  public querySelector(selector: string): MockElement | null {
    if (!selector.startsWith('#')) {
      return null;
    }

    return this.findById(this.body, selector.slice(1));
  }

  private findById(root: MockElement, id: string): MockElement | null {
    if (root.id === id) {
      return root;
    }

    for (const child of root.children) {
      const match = this.findById(child, id);
      if (match) {
        return match;
      }
    }

    return null;
  }
}

function createRemoteCursor(overrides: Partial<CursorPosition> = {}): CursorPosition {
  return {
    userId: 'peer-a',
    name: 'Alice',
    color: '#111111',
    x: 0.25,
    y: 0.75,
    xAbsolute: 50,
    yAbsolute: 75,
    idle: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createCursorEngine', () => {
  it('mounts listeners and normalizes mouse and touch positions to a 0-1 range', () => {
    const context = {
      setSelfPosition: vi.fn(),
      getPositions: vi.fn(() => []),
      subscribe: vi.fn(() => {
        return () => {
          return undefined;
        };
      }),
    };

    const doc = new MockDocument();
    const board = doc.createElement('div');
    board.setBoundingRect({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    });

    const engine = createCursorEngine(context, {
      throttleMs: 0,
    });

    engine.mount(board as unknown as HTMLElement);

    expect(board.listenerCount('mousemove')).toBe(1);
    expect(board.listenerCount('touchmove')).toBe(1);
    expect(board.listenerCount('touchstart')).toBe(1);

    board.dispatch('mousemove', {
      clientX: 110,
      clientY: 70,
    });

    expect(context.setSelfPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0.5,
        y: 0.5,
        xAbsolute: 100,
        yAbsolute: 50,
        idle: false,
      }),
    );

    board.dispatch('touchmove', {
      touches: [
        {
          clientX: 1_000,
          clientY: -100,
        },
      ],
    });

    expect(context.setSelfPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 1,
        y: 0,
        xAbsolute: 200,
        yAbsolute: 0,
        idle: false,
      }),
    );

    engine.unmount();
    expect(board.listenerCount('mousemove')).toBe(0);
    expect(board.listenerCount('touchmove')).toBe(0);
    expect(board.listenerCount('touchstart')).toBe(0);
  });

  it('applies throttling with a trailing cursor update', async () => {
    vi.useFakeTimers();

    const context = {
      setSelfPosition: vi.fn(),
      getPositions: vi.fn(() => []),
      subscribe: vi.fn(() => {
        return () => {
          return undefined;
        };
      }),
    };

    const doc = new MockDocument();
    const board = doc.createElement('div');
    board.setBoundingRect({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    const engine = createCursorEngine(context, {
      throttleMs: 32,
      idleAfterMs: 10_000,
    });

    engine.mount(board as unknown as HTMLElement);

    board.dispatch('mousemove', {
      clientX: 10,
      clientY: 10,
    });
    expect(context.setSelfPosition).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    board.dispatch('mousemove', {
      clientX: 20,
      clientY: 20,
    });

    await vi.advanceTimersByTimeAsync(10);
    board.dispatch('mousemove', {
      clientX: 80,
      clientY: 40,
    });

    expect(context.setSelfPosition).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(11);
    expect(context.setSelfPosition).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(context.setSelfPosition).toHaveBeenCalledTimes(2);
    expect(context.setSelfPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0.8,
        y: 0.4,
      }),
    );

    engine.unmount();
  });

  it('marks the local cursor idle after inactivity and resets idle on movement', async () => {
    vi.useFakeTimers();

    const context = {
      setSelfPosition: vi.fn(),
      getPositions: vi.fn(() => []),
      subscribe: vi.fn(() => {
        return () => {
          return undefined;
        };
      }),
    };

    const doc = new MockDocument();
    const board = doc.createElement('div');
    board.setBoundingRect({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });

    const engine = createCursorEngine(context, {
      throttleMs: 0,
      idleAfterMs: 3_000,
    });

    engine.mount(board as unknown as HTMLElement);
    board.dispatch('mousemove', {
      clientX: 25,
      clientY: 75,
    });

    expect(context.setSelfPosition).toHaveBeenCalledTimes(1);
    expect(context.setSelfPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idle: false,
      }),
    );

    await vi.advanceTimersByTimeAsync(2_999);
    expect(context.setSelfPosition).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(context.setSelfPosition).toHaveBeenCalledTimes(2);
    expect(context.setSelfPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idle: true,
      }),
    );

    board.dispatch('mousemove', {
      clientX: 75,
      clientY: 25,
    });

    expect(context.setSelfPosition).toHaveBeenCalledTimes(3);
    expect(context.setSelfPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        x: 0.75,
        y: 0.25,
        idle: false,
      }),
    );

    engine.unmount();
  });

  it('auto-renders remote cursors with labels and cleans up on unmount', () => {
    const positions = [createRemoteCursor()];
    const unsubscribe = vi.fn();
    let subscriptionCallback: ((positions: CursorPosition[]) => void) | null = null;
    const context = {
      setSelfPosition: vi.fn(),
      getPositions: vi.fn(() => positions),
      subscribe: vi.fn((callback: (positions: CursorPosition[]) => void) => {
        subscriptionCallback = callback;
        return unsubscribe;
      }),
    };

    const doc = new MockDocument();
    const board = doc.createElement('div');
    board.setAttribute('id', 'board');
    doc.body.appendChild(board);

    const engine = createCursorEngine(context);
    engine.mount(board as unknown as HTMLElement);
    engine.render({
      container: board as unknown as HTMLElement,
      showName: true,
      zIndex: 42,
    });

    expect(board.children).toHaveLength(1);

    const overlayRoot = board.children[0];
    expect(overlayRoot.style.zIndex).toBe('42');
    expect(overlayRoot.children).toHaveLength(1);

    const cursorNode = overlayRoot.children[0];
    expect(cursorNode.style.left).toBe('25%');
    expect(cursorNode.style.top).toBe('75%');
    expect(cursorNode.getAttribute('data-idle')).toBe('false');
    expect(cursorNode.children[1]?.textContent).toBe('Alice');

    subscriptionCallback?.([
      createRemoteCursor({
        x: 0.5,
        y: 0.5,
        idle: true,
      }),
    ]);

    expect(cursorNode.style.left).toBe('50%');
    expect(cursorNode.style.top).toBe('50%');
    expect(cursorNode.getAttribute('data-idle')).toBe('true');

    subscriptionCallback?.([]);
    expect(overlayRoot.children).toHaveLength(0);

    engine.unmount();
    expect(board.children).toHaveLength(0);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
