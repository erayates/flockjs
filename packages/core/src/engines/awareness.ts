import type { AwarenessEngine, AwarenessSelection, AwarenessState, Unsubscribe } from '../types';

interface AwarenessEngineContext {
  updateSelfAwareness(patch: Record<string, unknown>): void;
  getAllAwareness(): AwarenessState[];
  subscribeAwareness(callback: (peers: AwarenessState[]) => void): Unsubscribe;
}

export function createAwarenessEngine(context: AwarenessEngineContext): AwarenessEngine {
  return {
    set(value) {
      context.updateSelfAwareness(value);
    },
    setTyping(isTyping) {
      context.updateSelfAwareness({ typing: isTyping });
    },
    setFocus(elementId) {
      context.updateSelfAwareness({ focus: elementId });
    },
    setSelection(selection: AwarenessSelection | null) {
      context.updateSelfAwareness({ selection });
    },
    subscribe(cb) {
      return context.subscribeAwareness(cb);
    },
    getAll() {
      return context.getAllAwareness();
    },
  };
}
