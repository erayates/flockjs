import { env } from './env';
import { isObject, readNumber, readRecord, readString } from './guards';
import { cloneStateSnapshot, parseStateSnapshot, type StateSnapshot } from './state';

const STATE_PERSISTENCE_PREFIX = 'flockjs';
const STATE_PERSISTENCE_KEY = 'state';
const STATE_PERSISTENCE_VERSION = 1;

type PersistedStateStrategy = 'lww';

type PersistedStateReadFailureReason =
  | 'unavailable'
  | 'access'
  | 'malformed'
  | 'version'
  | 'invalid';

type PersistedStateWriteFailureReason = 'unavailable' | 'serialize' | 'access';

type PersistedStateRemoveFailureReason = 'unavailable' | 'access';

interface PersistedStateEnvelope {
  version: number;
  strategy: PersistedStateStrategy;
  snapshot: StateSnapshot;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedStateReadResult {
  key: string;
  snapshot: StateSnapshot | null;
  reason?: PersistedStateReadFailureReason;
  error?: unknown;
}

export interface PersistedStateWriteResult {
  key: string;
  ok: boolean;
  reason?: PersistedStateWriteFailureReason;
  error?: unknown;
}

export interface PersistedStateRemoveResult {
  key: string;
  ok: boolean;
  reason?: PersistedStateRemoveFailureReason;
  error?: unknown;
}

function getLocalStorage(): StorageLike | null {
  if (!env.hasLocalStorage) {
    return null;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function createEnvelope(snapshot: StateSnapshot): PersistedStateEnvelope {
  return {
    version: STATE_PERSISTENCE_VERSION,
    strategy: 'lww',
    snapshot: cloneStateSnapshot(snapshot),
  };
}

export function createPersistedStateStorageKey(roomId: string): string {
  return `${STATE_PERSISTENCE_PREFIX}:${roomId}:${STATE_PERSISTENCE_KEY}`;
}

export function readPersistedLwwState(roomId: string): PersistedStateReadResult {
  const key = createPersistedStateStorageKey(roomId);
  const storage = getLocalStorage();
  if (!storage) {
    return {
      key,
      snapshot: null,
      reason: 'unavailable',
    };
  }

  let rawValue: string | null;
  try {
    rawValue = storage.getItem(key);
  } catch (error) {
    return {
      key,
      snapshot: null,
      reason: 'access',
      error,
    };
  }

  if (rawValue === null) {
    return {
      key,
      snapshot: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return {
      key,
      snapshot: null,
      reason: 'malformed',
    };
  }

  if (!isObject(parsed)) {
    return {
      key,
      snapshot: null,
      reason: 'invalid',
    };
  }

  const version = readNumber(parsed, 'version');
  if (version !== STATE_PERSISTENCE_VERSION) {
    return {
      key,
      snapshot: null,
      reason: 'version',
    };
  }

  const strategy = readString(parsed, 'strategy');
  if (strategy !== 'lww') {
    return {
      key,
      snapshot: null,
      reason: 'invalid',
    };
  }

  const snapshotValue = readRecord(parsed, 'snapshot');
  const snapshot = snapshotValue ? parseStateSnapshot(snapshotValue) : null;
  if (!snapshot) {
    return {
      key,
      snapshot: null,
      reason: 'invalid',
    };
  }

  return {
    key,
    snapshot,
  };
}

export function writePersistedLwwState(
  roomId: string,
  snapshot: StateSnapshot,
): PersistedStateWriteResult {
  const key = createPersistedStateStorageKey(roomId);
  const storage = getLocalStorage();
  if (!storage) {
    return {
      key,
      ok: false,
      reason: 'unavailable',
    };
  }

  let encoded: string;
  try {
    encoded = JSON.stringify(createEnvelope(snapshot));
  } catch (error) {
    return {
      key,
      ok: false,
      reason: 'serialize',
      error,
    };
  }

  try {
    storage.setItem(key, encoded);
    return {
      key,
      ok: true,
    };
  } catch (error) {
    return {
      key,
      ok: false,
      reason: 'access',
      error,
    };
  }
}

export function removePersistedLwwState(roomId: string): PersistedStateRemoveResult {
  const key = createPersistedStateStorageKey(roomId);
  const storage = getLocalStorage();
  if (!storage) {
    return {
      key,
      ok: false,
      reason: 'unavailable',
    };
  }

  try {
    storage.removeItem(key);
    return {
      key,
      ok: true,
    };
  } catch (error) {
    return {
      key,
      ok: false,
      reason: 'access',
      error,
    };
  }
}
