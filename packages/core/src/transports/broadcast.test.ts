import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBroadcastTransportAdapter } from './broadcast';
import type { TransportSignal } from './transport';

type MessageHandler = (event: MessageEvent<unknown>) => void;

class MockBroadcastChannel {
  private static channels = new Map<string, Set<MockBroadcastChannel>>();

  private static postedPayloads: unknown[] = [];

  public static reset(): void {
    this.channels.clear();
    this.postedPayloads = [];
  }

  public static getLastPostedPayload(): unknown {
    return this.postedPayloads.at(-1);
  }

  public static emitRaw(channelName: string, payload: unknown): void {
    this.dispatch(channelName, payload);
  }

  public static getChannelCount(channelName: string): number {
    return this.channels.get(channelName)?.size ?? 0;
  }

  private static dispatch(
    channelName: string,
    payload: unknown,
    sender?: MockBroadcastChannel,
  ): void {
    const channelsForName = this.channels.get(channelName);
    if (!channelsForName) {
      return;
    }

    for (const channel of channelsForName) {
      if (channel.closed || channel === sender) {
        continue;
      }

      channel.emit(payload);
    }
  }

  private readonly listeners = new Set<MessageHandler>();

  private closed = false;

  public constructor(public readonly name: string) {
    const channelsForName =
      MockBroadcastChannel.channels.get(name) ?? new Set<MockBroadcastChannel>();
    channelsForName.add(this);
    MockBroadcastChannel.channels.set(name, channelsForName);
  }

  public addEventListener(type: string, handler: MessageHandler): void {
    if (type === 'message') {
      this.listeners.add(handler);
    }
  }

  public removeEventListener(type: string, handler: MessageHandler): void {
    if (type === 'message') {
      this.listeners.delete(handler);
    }
  }

  public postMessage(payload: unknown): void {
    if (this.closed) {
      return;
    }

    MockBroadcastChannel.postedPayloads.push(payload);
    MockBroadcastChannel.dispatch(this.name, payload, this);
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const channelsForName = MockBroadcastChannel.channels.get(this.name);
    if (!channelsForName) {
      return;
    }

    channelsForName.delete(this);
    if (channelsForName.size === 0) {
      MockBroadcastChannel.channels.delete(this.name);
    }
  }

  private emit(payload: unknown): void {
    const event = { data: payload } as MessageEvent<unknown>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe('BroadcastTransportAdapter', () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  beforeEach(() => {
    MockBroadcastChannel.reset();
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: MockBroadcastChannel as unknown as typeof BroadcastChannel,
    });
  });

  afterEach(() => {
    MockBroadcastChannel.reset();
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
  });

  it('serializes outbound messages into a JSON envelope', async () => {
    const adapter = createBroadcastTransportAdapter('room-serialization');
    await adapter.connect();

    const signal: TransportSignal = {
      type: 'hello',
      roomId: 'room-serialization',
      fromPeerId: 'peer-a',
      payload: { role: 'editor' },
    };
    adapter.send(signal);

    const outbound = MockBroadcastChannel.getLastPostedPayload();
    expect(typeof outbound).toBe('string');
    expect(JSON.parse(outbound as string)).toEqual({
      source: 'flockjs',
      version: 1,
      signal,
    });

    await adapter.disconnect();
  });

  it('deserializes valid envelopes and notifies subscribers', async () => {
    const adapterA = createBroadcastTransportAdapter('room-deserialize');
    const adapterB = createBroadcastTransportAdapter('room-deserialize');
    const onMessage = vi.fn();
    adapterB.subscribe(onMessage);

    await adapterA.connect();
    await adapterB.connect();

    const signal: TransportSignal = {
      type: 'welcome',
      roomId: 'room-deserialize',
      fromPeerId: 'peer-a',
      payload: { id: 'peer-a' },
    };
    adapterA.send(signal);

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(signal);

    await adapterA.disconnect();
    await adapterB.disconnect();
  });

  it('ignores malformed JSON messages without throwing', async () => {
    const adapter = createBroadcastTransportAdapter('room-invalid-json');
    const onMessage = vi.fn();
    adapter.subscribe(onMessage);
    await adapter.connect();

    MockBroadcastChannel.emitRaw('flockjs:room-invalid-json', '{"source":"flockjs",');
    await Promise.resolve();

    expect(onMessage).not.toHaveBeenCalled();
    await adapter.disconnect();
  });

  it('ignores invalid envelope shapes', async () => {
    const adapter = createBroadcastTransportAdapter('room-invalid-shape');
    const onMessage = vi.fn();
    adapter.subscribe(onMessage);
    await adapter.connect();

    MockBroadcastChannel.emitRaw(
      'flockjs:room-invalid-shape',
      JSON.stringify({
        source: 'flockjs',
        version: 1,
        signal: {
          roomId: 'room-invalid-shape',
        },
      }),
    );

    await Promise.resolve();
    expect(onMessage).not.toHaveBeenCalled();
    await adapter.disconnect();
  });

  it('supports idempotent connect and disconnect', async () => {
    const adapter = createBroadcastTransportAdapter('room-idempotent');

    await adapter.connect();
    await adapter.connect();
    expect(MockBroadcastChannel.getChannelCount('flockjs:room-idempotent')).toBe(1);

    await adapter.disconnect();
    await adapter.disconnect();
    expect(MockBroadcastChannel.getChannelCount('flockjs:room-idempotent')).toBe(0);
  });
});
