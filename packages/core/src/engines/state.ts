import type { StateChangeMeta, StateEngine, StateOptions } from '../types';

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return value;
}

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createStateEngine<T>(options: StateOptions<T>): StateEngine<T> {
  const initialValue = cloneValue(options.initialValue);
  let value = cloneValue(options.initialValue);
  const history: T[] = [];
  const subscribers = new Set<(value: T, meta: StateChangeMeta) => void>();

  const notify = (reason: StateChangeMeta['reason']): void => {
    const meta: StateChangeMeta = {
      reason,
      timestamp: Date.now(),
    };

    for (const subscriber of subscribers) {
      subscriber(value, meta);
    }
  };

  return {
    get() {
      return value;
    },
    set(nextValue) {
      history.push(cloneValue(value));
      value = cloneValue(nextValue);
      notify('set');
    },
    patch(partial) {
      if (!isMergeableObject(value) || !isMergeableObject(partial)) {
        return;
      }

      history.push(cloneValue(value));
      value = {
        ...value,
        ...partial,
      };
      notify('patch');
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    undo() {
      const previous = history.pop();
      if (previous === undefined) {
        return;
      }

      value = previous;
      notify('undo');
    },
    reset() {
      history.length = 0;
      value = cloneValue(initialValue);
      notify('reset');
    },
  };
}
