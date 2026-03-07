import { createFlockError } from '../flock-error';
import type { StateChangeMeta, StateOptions } from '../types';

export const STATE_HISTORY_LIMIT = 20;

export type StateChangeReason = StateChangeMeta['reason'];

export interface StateSnapshot {
  value: unknown;
  history: unknown[];
  vectorClock: Record<string, number>;
  changedBy: string;
  timestamp: number;
  reason: StateChangeReason;
}

type VectorClockComparison = 'after' | 'before' | 'equal' | 'concurrent';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trimHistory(history: unknown[]): unknown[] {
  if (history.length <= STATE_HISTORY_LIMIT) {
    return history;
  }

  return history.slice(history.length - STATE_HISTORY_LIMIT);
}

function createNextVectorClock(
  vectorClock: Record<string, number>,
  changedBy: string,
): Record<string, number> {
  return {
    ...vectorClock,
    [changedBy]: (vectorClock[changedBy] ?? 0) + 1,
  };
}

function createSnapshot(
  value: unknown,
  history: unknown[],
  vectorClock: Record<string, number>,
  changedBy: string,
  timestamp: number,
  reason: StateChangeReason,
): StateSnapshot {
  return {
    value: cloneStateValue(value),
    history: history.map((entry) => cloneStateValue(entry)),
    vectorClock: {
      ...vectorClock,
    },
    changedBy,
    timestamp,
    reason,
  };
}

function compareVectorClocks(
  left: Record<string, number>,
  right: Record<string, number>,
): VectorClockComparison {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let leftGreater = false;
  let rightGreater = false;

  for (const key of keys) {
    const leftValue = left[key] ?? 0;
    const rightValue = right[key] ?? 0;

    if (leftValue > rightValue) {
      leftGreater = true;
    }

    if (leftValue < rightValue) {
      rightGreater = true;
    }

    if (leftGreater && rightGreater) {
      return 'concurrent';
    }
  }

  if (leftGreater) {
    return 'after';
  }

  if (rightGreater) {
    return 'before';
  }

  return 'equal';
}

function mergeStateValue(current: unknown, partial: unknown): unknown {
  if (!isPlainObject(current) || !isPlainObject(partial)) {
    return cloneStateValue(partial);
  }

  const merged: Record<string, unknown> = {
    ...current,
  };

  for (const [key, partialValue] of Object.entries(partial)) {
    const currentValue = current[key];
    merged[key] =
      isPlainObject(currentValue) && isPlainObject(partialValue)
        ? mergeStateValue(currentValue, partialValue)
        : cloneStateValue(partialValue);
  }

  return merged;
}

export function cloneStateValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return value;
}

export function cloneStateSnapshot(snapshot: StateSnapshot): StateSnapshot {
  return createSnapshot(
    snapshot.value,
    snapshot.history,
    snapshot.vectorClock,
    snapshot.changedBy,
    snapshot.timestamp,
    snapshot.reason,
  );
}

export function isStateChangeReason(value: unknown): value is StateChangeReason {
  return value === 'set' || value === 'patch' || value === 'undo' || value === 'reset';
}

export function parseStateSnapshot(value: unknown): StateSnapshot | null {
  if (!isPlainObject(value)) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(value, 'value')) {
    return null;
  }

  const history = value.history;
  const changedBy = value.changedBy;
  const timestamp = value.timestamp;
  const reason = value.reason;
  const vectorClock = value.vectorClock;

  if (
    !Array.isArray(history) ||
    typeof changedBy !== 'string' ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    !isStateChangeReason(reason) ||
    !isPlainObject(vectorClock)
  ) {
    return null;
  }

  const normalizedVectorClock: Record<string, number> = {};
  for (const [key, entry] of Object.entries(vectorClock)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      return null;
    }

    normalizedVectorClock[key] = entry;
  }

  return createSnapshot(value.value, history, normalizedVectorClock, changedBy, timestamp, reason);
}

export function assertSupportedStateStrategy(
  strategy: StateOptions<unknown>['strategy'],
): 'lww' {
  const normalized = strategy ?? 'lww';
  if (normalized === 'lww') {
    return normalized;
  }

  throw createFlockError(
    'INVALID_STATE',
    `State strategy "${normalized}" is not implemented in this runtime. Use "lww".`,
    false,
    {
      strategy: normalized,
    },
  );
}

export function createInitialStateSnapshot(
  initialValue: unknown,
  changedBy: string,
  timestamp: number,
): StateSnapshot {
  return createSnapshot(initialValue, [], {}, changedBy, timestamp, 'reset');
}

export function setStateSnapshot(
  snapshot: StateSnapshot,
  nextValue: unknown,
  changedBy: string,
  timestamp: number,
): StateSnapshot {
  const nextHistory = trimHistory([...snapshot.history, cloneStateValue(snapshot.value)]);
  return createSnapshot(
    nextValue,
    nextHistory,
    createNextVectorClock(snapshot.vectorClock, changedBy),
    changedBy,
    timestamp,
    'set',
  );
}

export function patchStateSnapshot(
  snapshot: StateSnapshot,
  partial: unknown,
  changedBy: string,
  timestamp: number,
): StateSnapshot | null {
  if (!isPlainObject(snapshot.value) || !isPlainObject(partial)) {
    return null;
  }

  const nextHistory = trimHistory([...snapshot.history, cloneStateValue(snapshot.value)]);
  const nextValue = mergeStateValue(snapshot.value, partial);
  return createSnapshot(
    nextValue,
    nextHistory,
    createNextVectorClock(snapshot.vectorClock, changedBy),
    changedBy,
    timestamp,
    'patch',
  );
}

export function undoStateSnapshot(
  snapshot: StateSnapshot,
  changedBy: string,
  timestamp: number,
): StateSnapshot | null {
  const previousValue = snapshot.history[snapshot.history.length - 1];
  if (previousValue === undefined) {
    return null;
  }

  return createSnapshot(
    previousValue,
    snapshot.history.slice(0, -1),
    createNextVectorClock(snapshot.vectorClock, changedBy),
    changedBy,
    timestamp,
    'undo',
  );
}

export function resetStateSnapshot(
  snapshot: StateSnapshot,
  initialValue: unknown,
  changedBy: string,
  timestamp: number,
): StateSnapshot {
  return createSnapshot(
    initialValue,
    [],
    createNextVectorClock(snapshot.vectorClock, changedBy),
    changedBy,
    timestamp,
    'reset',
  );
}

export function compareStateSnapshots(left: StateSnapshot, right: StateSnapshot): number {
  const vectorOrder = compareVectorClocks(left.vectorClock, right.vectorClock);
  if (vectorOrder === 'after') {
    return 1;
  }

  if (vectorOrder === 'before') {
    return -1;
  }

  if (left.timestamp !== right.timestamp) {
    return left.timestamp > right.timestamp ? 1 : -1;
  }

  if (left.changedBy !== right.changedBy) {
    return left.changedBy > right.changedBy ? 1 : -1;
  }

  return 0;
}
