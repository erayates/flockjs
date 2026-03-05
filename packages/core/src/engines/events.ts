import type { EventEngine, EventOptions, Peer, PresenceData, Unsubscribe } from '../types';

interface EventEngineContext<TPresence extends PresenceData> {
  emitEvent(name: string, payload: unknown, toPeerId: string | undefined, loopback: boolean): void;
  onEvent(name: string, cb: (payload: unknown, from: Peer<TPresence>) => void): Unsubscribe;
  offEvent(name: string, cb: (payload: unknown, from: Peer<TPresence>) => void): void;
}

export function createEventEngine<TPresence extends PresenceData>(
  context: EventEngineContext<TPresence>,
  options?: EventOptions,
): EventEngine<TPresence> {
  const defaultLoopback = options?.loopback ?? true;

  return {
    emit(name, payload) {
      context.emitEvent(name, payload, undefined, defaultLoopback);
    },
    emitTo(peerId, name, payload) {
      context.emitEvent(name, payload, peerId, defaultLoopback);
    },
    on(name, cb) {
      return context.onEvent(name, cb);
    },
    off(name, cb) {
      context.offEvent(name, cb);
    },
  };
}
