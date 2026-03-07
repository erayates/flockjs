import type { StateChangeMeta } from '../types';

export class LocalCrdtTransactionOrigin {
  public constructor(public readonly meta: StateChangeMeta) {}
}

export class RemoteCrdtTransactionOrigin {
  public constructor(
    public readonly fromPeerId: string,
    public readonly receivedAt: number,
    public readonly meta?: StateChangeMeta,
  ) {}
}

export const REMOTE_AWARENESS_ORIGIN = Symbol('flockjs-remote-awareness');

export function readCrdtStateChangeMeta(
  origin: unknown,
  fallbackChangedBy: string,
  fallbackTimestamp: number,
): StateChangeMeta {
  if (origin instanceof LocalCrdtTransactionOrigin) {
    return origin.meta;
  }

  if (origin instanceof RemoteCrdtTransactionOrigin) {
    if (origin.meta) {
      return origin.meta;
    }

    return {
      reason: 'set',
      changedBy: origin.fromPeerId,
      timestamp: origin.receivedAt,
    };
  }

  return {
    reason: 'set',
    changedBy: fallbackChangedBy,
    timestamp: fallbackTimestamp,
  };
}
