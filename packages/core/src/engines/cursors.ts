import type {
  CursorEngine,
  CursorOptions,
  CursorPosition,
  CursorRenderOptions,
  Unsubscribe,
} from '../types';

const DEFAULT_THROTTLE_MS = 32;
const DEFAULT_IDLE_AFTER_MS = 3_000;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CURSOR_ROOT_ATTRIBUTE = 'data-flockjs-cursor-root';
const CURSOR_NODE_ATTRIBUTE = 'data-flockjs-peer-cursor';
const CURSOR_USER_ATTRIBUTE = 'data-user-id';
const CURSOR_IDLE_ATTRIBUTE = 'data-idle';
const CURSOR_STYLE_ATTRIBUTE = 'data-flockjs-cursor-style';
const CURSOR_MARKER_ATTRIBUTE = 'data-flockjs-cursor-marker';
const CURSOR_MARKER_STYLE_ATTRIBUTE = 'data-flockjs-cursor-marker-style';
const CURSOR_MARKER_COLOR_ATTRIBUTE = 'data-flockjs-cursor-marker-color';
const CURSOR_LABEL_ATTRIBUTE = 'data-flockjs-cursor-label';
const CURSOR_TRANSITION = 'left 120ms linear, top 120ms linear, opacity 160ms ease';
const DEFAULT_CURSOR_COLOR = '#111827';

type BuiltInCursorStyle = 'default' | 'dot' | 'pointer';

interface CursorEngineContext {
  setSelfPosition(position: Partial<CursorPosition>): void;
  getPositions(): CursorPosition[];
  subscribe(callback: (positions: CursorPosition[]) => void): Unsubscribe;
}

interface PointerPoint {
  clientX: number;
  clientY: number;
}

interface BuiltInCursorRenderer {
  gap: string;
  transform: string;
  createMarker(doc: Document): Element;
  updateMarker(marker: Element, position: CursorPosition): void;
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

  const list: unknown = Reflect.get(value, key);
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

function resolveCursorStyle(style: CursorRenderOptions['style']): BuiltInCursorStyle {
  if (style === 'dot' || style === 'pointer') {
    return style;
  }

  return 'default';
}

function getChildElements(parent: Element): Element[] {
  return Array.from(parent.children);
}

function getChildElement(parent: Element, index: number): Element | null {
  return getChildElements(parent)[index] ?? null;
}

function clearElementChildren(parent: Element): void {
  for (const child of getChildElements(parent)) {
    parent.removeChild(child);
  }
}

function setStyleValue(target: unknown, property: string, value: string): void {
  if (typeof target !== 'object' || target === null) {
    return;
  }

  const style: unknown = Reflect.get(target, 'style');
  if (typeof style !== 'object' || style === null) {
    return;
  }

  Reflect.set(style, property, value);
}

function setTextValue(target: unknown, value: string): void {
  if (typeof target !== 'object' || target === null) {
    return;
  }

  Reflect.set(target, 'textContent', value);
}

function createSvgElement(doc: Document, tagName: string): Element {
  return doc.createElementNS(SVG_NAMESPACE, tagName);
}

function createArrowMarker(doc: Document): Element {
  const svg = createSvgElement(doc, 'svg');
  svg.setAttribute(CURSOR_MARKER_ATTRIBUTE, 'true');
  svg.setAttribute(CURSOR_MARKER_STYLE_ATTRIBUTE, 'default');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  setStyleValue(svg, 'display', 'block');

  const path = createSvgElement(doc, 'path');
  path.setAttribute('d', 'M2 2L18 12L10.5 13.5L14 22L9 23L5.5 15L1.5 19L2 2Z');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);

  return svg;
}

function createDotMarker(doc: Document): Element {
  const marker = doc.createElement('span');
  marker.setAttribute(CURSOR_MARKER_ATTRIBUTE, 'true');
  marker.setAttribute(CURSOR_MARKER_STYLE_ATTRIBUTE, 'dot');
  setStyleValue(marker, 'display', 'inline-block');
  setStyleValue(marker, 'width', '10px');
  setStyleValue(marker, 'height', '10px');
  setStyleValue(marker, 'borderRadius', '9999px');
  setStyleValue(marker, 'boxShadow', '0 0 0 2px rgba(255,255,255,0.9)');
  setStyleValue(marker, 'flex', '0 0 auto');
  return marker;
}

function createPointerMarker(doc: Document): Element {
  const marker = doc.createElement('div');
  marker.setAttribute(CURSOR_MARKER_ATTRIBUTE, 'true');
  marker.setAttribute(CURSOR_MARKER_STYLE_ATTRIBUTE, 'pointer');
  setStyleValue(marker, 'display', 'inline-block');
  setStyleValue(marker, 'width', '12px');
  setStyleValue(marker, 'height', '12px');
  setStyleValue(marker, 'borderRadius', '9999px 9999px 9999px 0');
  setStyleValue(marker, 'boxShadow', '0 0 0 2px rgba(255,255,255,0.9)');
  setStyleValue(marker, 'transform', 'rotate(-45deg)');
  setStyleValue(marker, 'flex', '0 0 auto');
  return marker;
}

function updateSvgMarkerColor(marker: Element, color: string): void {
  marker.setAttribute(CURSOR_MARKER_COLOR_ATTRIBUTE, color);
  setStyleValue(marker, 'color', color);
}

function updateBlockMarkerColor(marker: Element, color: string): void {
  marker.setAttribute(CURSOR_MARKER_COLOR_ATTRIBUTE, color);
  setStyleValue(marker, 'backgroundColor', color);
}

const BUILT_IN_RENDERERS: Record<BuiltInCursorStyle, BuiltInCursorRenderer> = {
  default: {
    gap: '8px',
    transform: 'translate(-18%, -14%)',
    createMarker: createArrowMarker,
    updateMarker(marker, position) {
      updateSvgMarkerColor(marker, position.color || DEFAULT_CURSOR_COLOR);
    },
  },
  dot: {
    gap: '8px',
    transform: 'translate(-50%, -50%)',
    createMarker: createDotMarker,
    updateMarker(marker, position) {
      updateBlockMarkerColor(marker, position.color || DEFAULT_CURSOR_COLOR);
    },
  },
  pointer: {
    gap: '8px',
    transform: 'translate(-28%, -24%)',
    createMarker: createPointerMarker,
    updateMarker(marker, position) {
      updateBlockMarkerColor(marker, position.color || DEFAULT_CURSOR_COLOR);
    },
  },
};

function createLabelElement(doc: Document): Element {
  const label = doc.createElement('span');
  label.setAttribute(CURSOR_LABEL_ATTRIBUTE, 'true');
  setStyleValue(label, 'display', 'inline-flex');
  setStyleValue(label, 'alignItems', 'center');
  setStyleValue(label, 'padding', '3px 8px');
  setStyleValue(label, 'borderRadius', '9999px');
  setStyleValue(label, 'fontFamily', 'ui-sans-serif, system-ui, sans-serif');
  setStyleValue(label, 'fontSize', '12px');
  setStyleValue(label, 'fontWeight', '600');
  setStyleValue(label, 'lineHeight', '1');
  setStyleValue(label, 'whiteSpace', 'nowrap');
  setStyleValue(label, 'color', '#ffffff');
  setStyleValue(label, 'boxShadow', '0 1px 2px rgba(15, 23, 42, 0.2)');
  return label;
}

function getRenderablePositions(
  positions: CursorPosition[],
  options: CursorRenderOptions,
): CursorPosition[] {
  if (options.showIdle === false) {
    return positions.filter((position) => position.idle !== true);
  }

  return positions;
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

    if (typeof Reflect.get(mountedElement, 'removeEventListener') !== 'function') {
      return;
    }

    mountedElement.removeEventListener('mousemove', mouseMoveListener);
    mountedElement.removeEventListener('touchmove', touchMoveListener);
    mountedElement.removeEventListener('touchstart', touchStartListener);
  };

  const clearThrottleTimer = (): void => {
    if (throttleTimer === null) {
      return;
    }

    globalThis.clearTimeout(throttleTimer);
    throttleTimer = null;
    pendingPosition = null;
  };

  const ensureCursorNodeContents = (
    node: HTMLElement,
    doc: Document,
    style: BuiltInCursorStyle,
  ): void => {
    if (node.getAttribute(CURSOR_STYLE_ATTRIBUTE) === style) {
      const marker = getChildElement(node, 0);
      const label = getChildElement(node, 1);
      if (marker && label) {
        return;
      }
    }

    clearElementChildren(node);
    node.setAttribute(CURSOR_STYLE_ATTRIBUTE, style);
    node.appendChild(BUILT_IN_RENDERERS[style].createMarker(doc));
    node.appendChild(createLabelElement(doc));
  };

  const updateCursorNode = (
    node: HTMLElement,
    position: CursorPosition,
    currentOptions: CursorRenderOptions,
  ): void => {
    const doc = node.ownerDocument;
    const style = resolveCursorStyle(currentOptions.style);
    const renderer = BUILT_IN_RENDERERS[style];
    ensureCursorNodeContents(node, doc, style);

    node.style.position = 'absolute';
    node.style.left = `${position.x * 100}%`;
    node.style.top = `${position.y * 100}%`;
    node.style.transform = renderer.transform;
    node.style.transition = CURSOR_TRANSITION;
    node.style.pointerEvents = 'none';
    node.style.display = 'inline-flex';
    node.style.alignItems = 'center';
    node.style.gap = currentOptions.showName === false ? '0' : renderer.gap;
    node.style.opacity = position.idle ? '0.55' : '1';
    node.style.willChange = 'left, top, opacity';
    node.setAttribute(CURSOR_IDLE_ATTRIBUTE, String(position.idle));

    const marker = getChildElement(node, 0);
    const label = getChildElement(node, 1);
    if (marker) {
      renderer.updateMarker(marker, {
        ...position,
        color: position.color || DEFAULT_CURSOR_COLOR,
      });
    }

    if (label) {
      const labelText = currentOptions.showName === false ? '' : position.name;
      setTextValue(label, labelText);
      setStyleValue(label, 'display', currentOptions.showName === false ? 'none' : 'inline-flex');
      setStyleValue(label, 'backgroundColor', position.color || DEFAULT_CURSOR_COLOR);
    }
  };

  const teardownRenderer = (): void => {
    renderSubscription?.();
    renderSubscription = null;

    if (renderRoot && renderContainer && renderContainer.contains(renderRoot)) {
      renderContainer.removeChild(renderRoot);
    } else {
      renderRoot?.remove();
    }

    if (containerPositionMutated && renderContainer) {
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

    const doc = renderRoot.ownerDocument;
    const renderablePositions = getRenderablePositions(positions, renderOptions);
    const seenUserIds = new Set<string>();

    for (const position of renderablePositions) {
      seenUserIds.add(position.userId);
      const existing = renderedNodes.get(position.userId);
      if (existing) {
        updateCursorNode(existing, position, renderOptions);
        continue;
      }

      const created = doc.createElement('div');
      created.setAttribute(CURSOR_NODE_ATTRIBUTE, 'true');
      created.setAttribute(CURSOR_USER_ATTRIBUTE, position.userId);
      updateCursorNode(created, position, renderOptions);
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
        node.remove();
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
      renderRoot.style.overflow = 'hidden';
      renderRoot.style.zIndex = String(renderOptions.zIndex ?? 9999);

      previousContainerPosition = renderContainer.style.position;
      if (!previousContainerPosition || previousContainerPosition === 'static') {
        renderContainer.style.position = 'relative';
        containerPositionMutated = true;
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
