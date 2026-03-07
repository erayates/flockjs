import {
  assertSupportedStateStrategy,
  cloneStateValue,
  createInitialStateSnapshot,
  patchStateSnapshot,
  resetStateSnapshot,
  setStateSnapshot,
  STATE_HISTORY_LIMIT,
  type StateSnapshot,
  undoStateSnapshot,
} from '../internal/state';
import type { StateChangeMeta, StateEngine, StateOptions, Unsubscribe } from '../types';

interface StateEngineContext<T> {
  actorId: string;
  getInitialValue(): T;
  getValue(): T;
  getSnapshot(): StateSnapshot;
  subscribeSnapshots(callback: (snapshot: StateSnapshot) => void): Unsubscribe;
  commitSnapshot(snapshot: StateSnapshot): void;
  now?: () => number;
}

function createMeta(snapshot: StateSnapshot): StateChangeMeta {
  return {
    reason: snapshot.reason,
    changedBy: snapshot.changedBy,
    timestamp: snapshot.timestamp,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trimLocalHistory<T>(history: T[]): T[] {
  if (history.length <= STATE_HISTORY_LIMIT) {
    return history;
  }

  return history.slice(history.length - STATE_HISTORY_LIMIT);
}

function mergeLocalPatchValue<T>(current: T, partial: Partial<T>): T | null {
  if (!isPlainObject(current) || !isPlainObject(partial)) {
    return null;
  }

  const mergeRecordValue = <TRecord extends Record<string, unknown>>(
    left: TRecord,
    right: Record<string, unknown>,
  ): TRecord => {
    const merged: Record<string, unknown> = {
      ...left,
    };

    for (const [key, rightValue] of Object.entries(right)) {
      const leftValue = left[key];
      merged[key] =
        isPlainObject(leftValue) && isPlainObject(rightValue)
          ? mergeRecordValue(leftValue, rightValue)
          : cloneStateValue(rightValue);
    }

    return {
      ...left,
      ...merged,
    };
  };

  return mergeRecordValue(current, partial);
}

export function createStateEngine<T>(
  options: StateOptions<T>,
  context?: StateEngineContext<T>,
): StateEngine<T> {
  assertSupportedStateStrategy(options.strategy);

  const subscribers = new Set<(value: T, meta: StateChangeMeta) => void>();
  const now = context?.now ?? Date.now;
  let localValue = cloneStateValue(options.initialValue);
  let localHistory: T[] = [];
  let localSnapshot = context
    ? null
    : createInitialStateSnapshot(options.initialValue, 'local', now());

  const getSnapshot = (): StateSnapshot => {
    return context
      ? context.getSnapshot()
      : localSnapshot ?? createInitialStateSnapshot(options.initialValue, 'local', now());
  };

  const getValue = (): T => {
    return context ? cloneStateValue(context.getValue()) : cloneStateValue(localValue);
  };

  const notify = (snapshot: StateSnapshot): void => {
    const meta = createMeta(snapshot);
    const nextValue = getValue();

    for (const subscriber of subscribers) {
      subscriber(nextValue, meta);
    }
  };

  const applySnapshot = (snapshot: StateSnapshot): void => {
    if (context) {
      context.commitSnapshot(snapshot);
      return;
    }

    localSnapshot = snapshot;
    notify(snapshot);
  };

  const runtimeSubscription = context?.subscribeSnapshots((snapshot) => {
    notify(snapshot);
  });
  void runtimeSubscription;

  return {
    get() {
      return getValue();
    },
    set(nextValue) {
      if (!context) {
        localHistory = trimLocalHistory([...localHistory, cloneStateValue(localValue)]);
        localValue = cloneStateValue(nextValue);
      }

      applySnapshot(setStateSnapshot(getSnapshot(), nextValue, context?.actorId ?? 'local', now()));
    },
    patch(partial) {
      const nextSnapshot = patchStateSnapshot(
        getSnapshot(),
        partial,
        context?.actorId ?? 'local',
        now(),
      );
      if (!nextSnapshot) {
        return;
      }

      if (!context) {
        const mergedValue = mergeLocalPatchValue(localValue, partial);
        if (mergedValue === null) {
          return;
        }

        localHistory = trimLocalHistory([...localHistory, cloneStateValue(localValue)]);
        localValue = cloneStateValue(mergedValue);
      }

      applySnapshot(nextSnapshot);
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    undo() {
      const nextSnapshot = undoStateSnapshot(getSnapshot(), context?.actorId ?? 'local', now());
      if (!nextSnapshot) {
        return;
      }

      if (!context) {
        const previousValue = localHistory[localHistory.length - 1];
        if (previousValue === undefined) {
          return;
        }

        localHistory = localHistory.slice(0, -1);
        localValue = cloneStateValue(previousValue);
      }

      applySnapshot(nextSnapshot);
    },
    reset() {
      if (!context) {
        localHistory = [];
        localValue = cloneStateValue(options.initialValue);
      }

      applySnapshot(
        resetStateSnapshot(
          getSnapshot(),
          context ? context.getInitialValue() : options.initialValue,
          context?.actorId ?? 'local',
          now(),
        ),
      );
    },
  };
}
