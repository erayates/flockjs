import * as Y from 'yjs';

import { createFlockError } from '../flock-error';
import { cloneStateValue } from '../internal/state';
import type { StateChangeMeta, StateEngine, StateOptions } from '../types';
import { LocalCrdtTransactionOrigin, readCrdtStateChangeMeta } from '../yjs/origin';

export const CRDT_STATE_ROOT_NAME = '__flockjs__';
export const CRDT_STATE_KEY = 'state';

interface CrdtStateEngineContext<T> {
  actorId: string;
  doc: Y.Doc;
  now?: () => number;
  getInitialValue(): T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonCompatible(value: unknown, path = 'state'): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertJsonCompatible(value[index], `${path}[${index}]`);
    }

    return;
  }

  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonCompatible(entry, `${path}.${key}`);
    }

    return;
  }

  throw createFlockError(
    'INVALID_STATE',
    'CRDT state only supports plain JSON-compatible values.',
    false,
    {
      path,
      valueType:
        value === undefined
          ? 'undefined'
          : value instanceof Date
            ? 'Date'
            : ArrayBuffer.isView(value)
              ? value.constructor.name
              : typeof value,
    },
  );
}

function createSharedValue(value: unknown): Y.Map<unknown> | Y.Array<unknown> | unknown {
  assertJsonCompatible(value);

  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    if (value.length > 0) {
      array.insert(
        0,
        value.map((entry) => {
          return createSharedValue(entry);
        }),
      );
    }

    return array;
  }

  if (isPlainObject(value)) {
    const map = new Y.Map<unknown>();
    for (const [key, entry] of Object.entries(value)) {
      map.set(key, createSharedValue(entry));
    }

    return map;
  }

  return cloneStateValue(value);
}

function readSharedValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const entries: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      entries[key] = readSharedValue(entry);
    }

    return entries;
  }

  if (value instanceof Y.Array) {
    return value.toArray().map((entry) => {
      return readSharedValue(entry);
    });
  }

  if (value instanceof Y.Text) {
    return value.toJSON();
  }

  return cloneStateValue(value);
}

function readStateRoot(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(CRDT_STATE_ROOT_NAME);
}

function ensureInitialState<T>(doc: Y.Doc, initialValue: T): void {
  const root = readStateRoot(doc);
  if (root.has(CRDT_STATE_KEY)) {
    return;
  }

  doc.transact(() => {
    if (!root.has(CRDT_STATE_KEY)) {
      root.set(CRDT_STATE_KEY, createSharedValue(initialValue));
    }
  });
}

function readStateValue<T>(doc: Y.Doc, initialValue: T): T {
  const root = readStateRoot(doc);
  const value = root.get(CRDT_STATE_KEY);
  if (value === undefined) {
    return cloneStateValue(initialValue);
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return readSharedValue(value) as T;
}

function writeStateValue<T>(doc: Y.Doc, nextValue: T): void {
  const root = readStateRoot(doc);
  root.set(CRDT_STATE_KEY, createSharedValue(nextValue));
}

function mergePatchValue<T>(current: T, partial: Partial<T>): T | null {
  if (!isPlainObject(current) || !isPlainObject(partial)) {
    return null;
  }

  const mergeRecordValue = (left: Record<string, unknown>, right: Record<string, unknown>): T => {
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

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return merged as T;
  };

  return mergeRecordValue(current, partial);
}

function createMeta(
  reason: StateChangeMeta['reason'],
  actorId: string,
  timestamp: number,
): StateChangeMeta {
  return {
    reason,
    changedBy: actorId,
    timestamp,
  };
}

export function createCrdtStateEngine<T>(
  _options: StateOptions<T>,
  context: CrdtStateEngineContext<T>,
): StateEngine<T> {
  const now = context.now ?? Date.now;
  ensureInitialState(context.doc, context.getInitialValue());

  const subscribers = new Set<(value: T, meta: StateChangeMeta) => void>();
  const root = readStateRoot(context.doc);
  const undoManager = new Y.UndoManager(root, {
    trackedOrigins: new Set([LocalCrdtTransactionOrigin]),
  });

  let pendingMeta: StateChangeMeta | null = null;

  const notifySubscribers = (meta: StateChangeMeta): void => {
    const value = readStateValue(context.doc, context.getInitialValue());
    for (const subscriber of subscribers) {
      subscriber(value, meta);
    }
  };

  root.observeDeep((events) => {
    const transaction = events[0]?.transaction;
    const meta =
      pendingMeta ?? readCrdtStateChangeMeta(transaction?.origin, context.actorId, now());
    pendingMeta = null;
    notifySubscribers(meta);
  });

  const applyStateChange = (
    nextValue: T,
    reason: StateChangeMeta['reason'],
    useUndoManager = true,
  ): void => {
    const meta = createMeta(reason, context.actorId, now());
    context.doc.transact(() => {
      writeStateValue(context.doc, nextValue);
    }, new LocalCrdtTransactionOrigin(meta));

    if (useUndoManager) {
      undoManager.stopCapturing();
    }
  };

  return {
    get() {
      return readStateValue(context.doc, context.getInitialValue());
    },
    set(nextValue) {
      assertJsonCompatible(nextValue);
      applyStateChange(cloneStateValue(nextValue), 'set');
    },
    patch(partial) {
      const currentValue = readStateValue(context.doc, context.getInitialValue());
      const nextValue = mergePatchValue(currentValue, partial);
      if (nextValue === null) {
        return;
      }

      assertJsonCompatible(nextValue);
      applyStateChange(nextValue, 'patch');
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    undo() {
      const meta = createMeta('undo', context.actorId, now());
      pendingMeta = meta;
      if (undoManager.undoStack.length === 0) {
        pendingMeta = null;
        return;
      }

      context.doc.transact(() => {
        undoManager.undo();
      }, new LocalCrdtTransactionOrigin(meta));
    },
    reset() {
      const initialValue = cloneStateValue(context.getInitialValue());
      assertJsonCompatible(initialValue);
      applyStateChange(initialValue, 'reset');
    },
  };
}
