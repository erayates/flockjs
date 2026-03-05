import type { Unsubscribe } from './types';

type EventMapBase = object;
type EventHandler<TValue> = TValue extends void ? () => void : (payload: TValue) => void;

export class TypedEventEmitter<TEvents extends EventMapBase> {
  private readonly listeners: {
    [TEvent in keyof TEvents]?: Set<EventHandler<TEvents[TEvent]>>;
  } = {};

  on<TEvent extends keyof TEvents>(
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

  off<TEvent extends keyof TEvents>(event: TEvent, handler: EventHandler<TEvents[TEvent]>): void {
    const listenersForEvent = this.listeners[event];
    if (!listenersForEvent) {
      return;
    }

    listenersForEvent.delete(handler);
    if (listenersForEvent.size === 0) {
      delete this.listeners[event];
    }
  }

  emit<TEvent extends keyof TEvents>(event: TEvent, payload?: TEvents[TEvent]): void {
    const listenersForEvent = this.listeners[event];
    if (!listenersForEvent || listenersForEvent.size === 0) {
      return;
    }

    for (const listener of listenersForEvent) {
      if (payload === undefined) {
        (listener as () => void)();
      } else {
        (listener as (value: TEvents[TEvent]) => void)(payload);
      }
    }
  }

  clear(): void {
    for (const key of Object.keys(this.listeners) as Array<keyof TEvents>) {
      delete this.listeners[key];
    }
  }
}
