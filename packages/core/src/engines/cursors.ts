import type {
  CursorEngine,
  CursorOptions,
  CursorPosition,
  CursorRenderOptions,
  Unsubscribe,
} from '../types';

const DEFAULT_THROTTLE_MS = 32;
const DEFAULT_IDLE_AFTER_MS = 3_000;
const CURSOR_ROOT_ATTRIBUTE = 'data-flockjs-cursor-root';
const CURSOR_NODE_ATTRIBUTE = 'data-flockjs-peer-cursor';
const CURSOR_USER_ATTRIBUTE = 'data-user-id';
const CURSOR_IDLE_ATTRIBUTE = 'data-idle';

interface CursorEngineContext {
  setSelfPosition(position: Partial<CursorPosition>): void;
  getPositions(): CursorPosition[];
  subscribe(callback: (positions: CursorPosition[]) => void): Unsubscribe;
}

interface PointerPoint {
  clientX: number;
  clientY: number;
}

function clamp(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function isPointerPoint(value: unknown): value is PointerPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'clientX') === 'number' &&
    typeof Reflect.get(value, 'clientY') === 'number'
  );
}

function getTouchList(value: unknown, key: 'touches' | 'changedTouches'): PointerPoint[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }

  const list = Reflect.get(value, key);
  if (!Array.isArray(list)) {
    return [];
  }

  return list.filter(isPointerPoint);
}

function extractPointerPoint(event: unknown): PointerPoint | null {
  if (isPointerPoint(event)) {
    return event;
  }

  const touches = getTouchList(event, 'touches');
  if (touches.length > 0) {
    return touches[0] ?? null;
  }

  const changedTouches = getTouchList(event, 'changedTouches');
  return changedTouches[0] ?? null;
}

function isRenderableElement(value: unknown): value is HTMLElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'appendChild') === 'function' &&
    typeof Reflect.get(value, 'removeChild') === 'function'
  );
}

function resolveDocument(mountedElement: HTMLElement | null): Document | null {
  if (mountedElement?.ownerDocument) {
    return mountedElement.ownerDocument;
  }

  if (typeof document !== 'undefined') {
    return document;
  }

  return null;
}

function resolveRenderContainer(
  mountedElement: HTMLElement | null,
  options: CursorRenderOptions,
): HTMLElement | null {
  if (options.container && isRenderableElement(options.container)) {
    return options.container;
  }

  const doc = resolveDocument(mountedElement);
  if (typeof options.container === 'string') {
    const selected = doc?.querySelector(options.container);
    return isRenderableElement(selected) ? selected : null;
  }

  return mountedElement;
}

export function createCursorEngine(
  context: CursorEngineContext,
  options: CursorOptions = {},
): CursorEngine {
  const throttleMs = Math.max(0, options.throttleMs ?? DEFAULT_THROTTLE_MS);
  const idleAfterMs = Math.max(0, options.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS);

  let mountedElement: HTMLElement | null = null;
  let lastLocalPosition: Partial<CursorPosition> | null = null;
  let lastDispatchAt: number | null = null;
  let pendingPosition: Partial<CursorPosition> | null = null;
  let throttleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let idleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  let renderEnabled = false;
  let renderOptions: CursorRenderOptions = {};
  let renderContainer: HTMLElement | null = null;
  let renderRoot: HTMLElement | null = null;
  let renderSubscription: Unsubscribe | null = null;
  let containerPositionMutated = false;
  let previousContainerPosition = '';
  const renderedNodes = new Map<string, HTMLElement>();

  const dispatchPosition = (position: Partial<CursorPosition>, immediate = false): void => {
    const next = {
      ...lastLocalPosition,
      ...position,
    };
    lastLocalPosition = next;

    if (throttleTimer && immediate) {
      globalThis.clearTimeout(throttleTimer);
      throttleTimer = null;
      pendingPosition = null;
    }

    const shouldDispatchImmediately =
      immediate ||
      throttleMs === 0 ||
      lastDispatchAt === null ||
      Date.now() - lastDispatchAt >= throttleMs;

    if (shouldDispatchImmediately) {
      context.setSelfPosition(next);
      lastDispatchAt = Date.now();
      pendingPosition = null;
      return;
    }

    pendingPosition = next;

    if (throttleTimer !== null) {
      return;
    }

    const waitMs = Math.max(0, throttleMs - (Date.now() - (lastDispatchAt ?? 0)));
    throttleTimer = globalThis.setTimeout(() => {
      throttleTimer = null;
      if (!pendingPosition) {
        return;
      }

      context.setSelfPosition(pendingPosition);
      lastDispatchAt = Date.now();
      pendingPosition = null;
    }, waitMs);
  };

  const clearIdleTimer = (): void => {
    if (idleTimer === null) {
      return;
    }

    globalThis.clearTimeout(idleTimer);
    idleTimer = null;
  };

  const scheduleIdleTimer = (): void => {
    clearIdleTimer();
    if (idleAfterMs === 0 || !lastLocalPosition) {
      return;
    }

    idleTimer = globalThis.setTimeout(() => {
      idleTimer = null;
      if (!lastLocalPosition || lastLocalPosition.idle === true) {
        return;
      }

      dispatchPosition(
        {
          ...lastLocalPosition,
          idle: true,
        },
        true,
      );
    }, idleAfterMs);
  };

  const getMountedRect = (): DOMRect | DOMRectReadOnly | null => {
    if (!mountedElement || typeof mountedElement.getBoundingClientRect !== 'function') {
      return null;
    }

    return mountedElement.getBoundingClientRect();
  };

  const normalizePosition = (event: unknown): Partial<CursorPosition> | null => {
    const point = extractPointerPoint(event);
    const rect = getMountedRect();
    if (!point || !rect) {
      return null;
    }

    const width = rect.width <= 0 ? 1 : rect.width;
    const height = rect.height <= 0 ? 1 : rect.height;
    const x = clamp((point.clientX - rect.left) / width);
    const y = clamp((point.clientY - rect.top) / height);

    return {
      x,
      y,
      xAbsolute: x * width,
      yAbsolute: y * height,
      idle: false,
    };
  };

  const setActivePosition = (position: Partial<CursorPosition>): void => {
    const next = {
      ...position,
      idle: position.idle ?? false,
    };
    const shouldDispatchImmediately = lastLocalPosition?.idle === true && next.idle === false;
    dispatchPosition(next, shouldDispatchImmediately);

    if (next.idle === true) {
      clearIdleTimer();
      return;
    }

    scheduleIdleTimer();
  };

  const handlePointerMove = (event: unknown): void => {
    const normalized = normalizePosition(event);
    if (!normalized) {
      return;
    }

    setActivePosition(normalized);
  };

  const mouseMoveListener = (event: unknown): void => {
    handlePointerMove(event);
  };

  const touchMoveListener = (event: unknown): void => {
    handlePointerMove(event);
  };

  const touchStartListener = (event: unknown): void => {
    handlePointerMove(event);
  };

  const removeInputListeners = (): void => {
    if (!mountedElement) {
      return;
    }

    mountedElement.removeEventListener?.('mousemove', mouseMoveListener);
    mountedElement.removeEventListener?.('touchmove', touchMoveListener);
    mountedElement.removeEventListener?.('touchstart', touchStartListener);
  };

  const clearThrottleTimer = (): void => {
    if (throttleTimer === null) {
      return;
    }

    globalThis.clearTimeout(throttleTimer);
    throttleTimer = null;
    pendingPosition = null;
  };

  const createCursorNode = (doc: Document, position: CursorPosition): HTMLElement => {
    const node = doc.createElement('div');
    node.setAttribute(CURSOR_NODE_ATTRIBUTE, 'true');
    node.setAttribute(CURSOR_USER_ATTRIBUTE, position.userId);
    node.style.position = 'absolute';
    node.style.transform = 'translate(-50%, -50%)';
    node.style.pointerEvents = 'none';
    node.style.display = 'flex';
    node.style.alignItems = 'center';
    node.style.gap = '6px';
    node.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
    node.style.fontSize = '12px';
    node.style.lineHeight = '1';
    node.style.whiteSpace = 'nowrap';

    const marker = doc.createElement('span');
    marker.style.display = 'inline-block';
    marker.style.width = '10px';
    marker.style.height = '10px';
    marker.style.borderRadius = '9999px';
    marker.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.9)';
    marker.style.flex = '0 0 auto';

    const label = doc.createElement('span');

    node.appendChild(marker);
    node.appendChild(label);
    updateCursorNode(node, position, renderOptions);
    return node;
  };

  const updateCursorNode = (
    node: HTMLElement,
    position: CursorPosition,
    currentOptions: CursorRenderOptions,
  ): void => {
    node.style.left = `${position.x * 100}%`;
    node.style.top = `${position.y * 100}%`;
    node.setAttribute(CURSOR_IDLE_ATTRIBUTE, String(position.idle));
    node.style.opacity = position.idle ? '0.6' : '1';

    const marker = node.children[0] as HTMLElement | undefined;
    const label = node.children[1] as HTMLElement | undefined;

    if (marker) {
      marker.style.background = position.color;
    }

    if (label) {
      label.textContent = currentOptions.showName === false ? '' : position.name;
      label.style.display = currentOptions.showName === false ? 'none' : 'inline-block';
    }
  };

  const teardownRenderer = (): void => {
    renderSubscription?.();
    renderSubscription = null;

    if (renderRoot && renderContainer?.contains?.(renderRoot)) {
      renderContainer.removeChild(renderRoot);
    } else {
      renderRoot?.remove?.();
    }

    if (containerPositionMutated && renderContainer?.style) {
      renderContainer.style.position = previousContainerPosition;
    }

    renderRoot = null;
    renderContainer = null;
    containerPositionMutated = false;
    previousContainerPosition = '';
    renderedNodes.clear();
  };

  const renderSnapshot = (positions: CursorPosition[]): void => {
    if (!renderRoot) {
      return;
    }

    const doc = renderRoot.ownerDocument ?? resolveDocument(mountedElement);
    if (!doc) {
      return;
    }

    const seenUserIds = new Set<string>();
    for (const position of positions) {
      seenUserIds.add(position.userId);
      const existing = renderedNodes.get(position.userId);
      if (existing) {
        updateCursorNode(existing, position, renderOptions);
        continue;
      }

      const created = createCursorNode(doc, position);
      renderedNodes.set(position.userId, created);
      renderRoot.appendChild(created);
    }

    for (const [userId, node] of Array.from(renderedNodes.entries())) {
      if (seenUserIds.has(userId)) {
        continue;
      }

      if (renderRoot.contains(node)) {
        renderRoot.removeChild(node);
      } else {
        node.remove?.();
      }
      renderedNodes.delete(userId);
    }
  };

  const ensureRenderer = (): void => {
    if (!renderEnabled) {
      return;
    }

    const container = resolveRenderContainer(mountedElement, renderOptions);
    const doc = resolveDocument(container ?? mountedElement);
    if (!container || !doc || typeof doc.createElement !== 'function') {
      return;
    }

    if (renderContainer !== container || !renderRoot) {
      teardownRenderer();

      renderContainer = container;
      renderRoot = doc.createElement('div');
      renderRoot.setAttribute(CURSOR_ROOT_ATTRIBUTE, 'true');
      renderRoot.style.position = 'absolute';
      renderRoot.style.inset = '0';
      renderRoot.style.pointerEvents = 'none';
      renderRoot.style.zIndex = String(renderOptions.zIndex ?? 9999);

      if (renderContainer.style) {
        previousContainerPosition = renderContainer.style.position ?? '';
        if (!previousContainerPosition || previousContainerPosition === 'static') {
          renderContainer.style.position = 'relative';
          containerPositionMutated = true;
        }
      }

      renderContainer.appendChild(renderRoot);
      renderSubscription = context.subscribe((positions) => {
        renderSnapshot(positions);
      });
    }

    renderRoot.style.zIndex = String(renderOptions.zIndex ?? 9999);
    renderSnapshot(context.getPositions());
  };

  return {
    mount(el) {
      removeInputListeners();
      mountedElement = el;

      if (typeof mountedElement.addEventListener !== 'function') {
        ensureRenderer();
        return;
      }

      mountedElement.addEventListener('mousemove', mouseMoveListener);
      mountedElement.addEventListener('touchmove', touchMoveListener);
      mountedElement.addEventListener('touchstart', touchStartListener);
      ensureRenderer();
    },
    unmount() {
      removeInputListeners();
      mountedElement = null;
      clearIdleTimer();
      clearThrottleTimer();
      lastLocalPosition = null;
      lastDispatchAt = null;
      renderEnabled = false;
      renderOptions = {};
      teardownRenderer();
    },
    render(nextOptions) {
      renderEnabled = true;
      renderOptions = {
        ...renderOptions,
        ...nextOptions,
      };
      ensureRenderer();
    },
    subscribe(cb) {
      return context.subscribe(cb);
    },
    getPositions() {
      return context.getPositions();
    },
    setPosition(position) {
      const rect = getMountedRect();
      const next: Partial<CursorPosition> = {
        ...position,
      };

      if (typeof next.x === 'number') {
        next.x = clamp(next.x);
      }

      if (typeof next.y === 'number') {
        next.y = clamp(next.y);
      }

      if (rect && typeof next.x === 'number' && next.xAbsolute === undefined) {
        next.xAbsolute = next.x * rect.width;
      }

      if (rect && typeof next.y === 'number' && next.yAbsolute === undefined) {
        next.yAbsolute = next.y * rect.height;
      }

      setActivePosition(next);
    },
  };
}
