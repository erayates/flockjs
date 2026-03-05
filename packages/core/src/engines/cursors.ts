import type { CursorEngine, CursorOptions, CursorPosition, Unsubscribe } from '../types';

interface CursorEngineContext {
  setSelfPosition(position: Partial<CursorPosition>): void;
  getPositions(): CursorPosition[];
  subscribe(callback: (positions: CursorPosition[]) => void): Unsubscribe;
}

export function createCursorEngine(
  context: CursorEngineContext,
  options?: CursorOptions,
): CursorEngine {
  void options;

  let mountedElement: HTMLElement | null = null;

  return {
    mount(el) {
      mountedElement = el;
    },
    unmount() {
      mountedElement = null;
    },
    render() {
      if (!mountedElement) {
        return;
      }
    },
    subscribe(cb) {
      return context.subscribe(cb);
    },
    getPositions() {
      return context.getPositions();
    },
    setPosition(position) {
      context.setSelfPosition(position);
    },
  };
}
