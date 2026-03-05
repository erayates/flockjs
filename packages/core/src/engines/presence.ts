import type { Peer, PresenceData, PresenceEngine, Unsubscribe } from '../types';

interface PresenceEngineContext<TPresence extends PresenceData> {
  updateSelf(data: Partial<TPresence>): void;
  replaceSelf(data: Partial<TPresence>): void;
  getSelf(): Peer<TPresence>;
  getPeer(peerId: string): Peer<TPresence> | null;
  getAllPeers(): Peer<TPresence>[];
  subscribe(callback: (peers: Peer<TPresence>[]) => void): Unsubscribe;
}

export function createPresenceEngine<TPresence extends PresenceData>(
  context: PresenceEngineContext<TPresence>,
): PresenceEngine<TPresence> {
  return {
    update(data) {
      context.updateSelf(data);
    },
    replace(data) {
      context.replaceSelf(data);
    },
    subscribe(cb) {
      return context.subscribe(cb);
    },
    get(peerId) {
      return context.getPeer(peerId);
    },
    getAll() {
      return context.getAllPeers();
    },
    getSelf() {
      return context.getSelf();
    },
  };
}
