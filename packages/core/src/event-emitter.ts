import type { Unsubscribe } from './types';

type EventMapBase = object;
type EventHandler<TValue> = (payload: TValue) => void;

export class TypedEventEmitter<TEvents extends EventMapBase> {
  private listeners: {
    [TEvent in keyof TEvents]?: Set<EventHandler<TEvents[TEvent]>>;
  } = {};

  public on<TEvent extends keyof TEvents>(
    event: TEvent,
    handler: EventHandler<TEvents[TEvent]>,
  ): Unsubscribe {
    const listenersForEvent = this.listeners[event] ?? new Set<EventHandler<TEvents[TEvent]>>();
    listenersForEvent.add(handler);
    this.listeners[event] = listenersForEvent;

    return () => {
      this.off(event, handler);
    };
  }

  public off<TEvent extends keyof TEvents>(
    event: TEvent,
    handler: EventHandler<TEvents[TEvent]>,
  ): void {
    const listenersForEvent = this.listeners[event];
    if (!listenersForEvent) {
      return;
    }

    listenersForEvent.delete(handler);
    if (listenersForEvent.size === 0) {
      delete this.listeners[event];
    }
  }

  public emit<TEvent extends keyof TEvents>(event: TEvent, payload: TEvents[TEvent]): void {
    const listenersForEvent = this.listeners[event];
    if (!listenersForEvent || listenersForEvent.size === 0) {
      return;
    }

    for (const listener of listenersForEvent) {
      try {
        listener(payload);
      } catch {
        // Isolate consumer callback failures from emitter internals.
      }
    }
  }

  public clear(): void {
    this.listeners = {};
  }
}
