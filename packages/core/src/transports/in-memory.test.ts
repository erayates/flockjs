import { describe, expect, it, vi } from 'vitest';

import { createInMemoryTransportAdapter } from './in-memory';
import type { TransportSignal } from './transport';
import { getTransportProtocolCapabilities } from './transport.protocol';

async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for condition after ${timeoutMs}ms.`);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

describe('InMemoryTransportAdapter', () => {
  it('routes targeted sends to a single peer and broadcasts to the room', async () => {
    const protocol = getTransportProtocolCapabilities('in-memory');
    const adapterA = createInMemoryTransportAdapter('room-memory', 'peer-a');
    const adapterB = createInMemoryTransportAdapter('room-memory', 'peer-b');
    const adapterC = createInMemoryTransportAdapter('room-memory', 'peer-c');

    const onMessageB = vi.fn();
    const onMessageC = vi.fn();
    adapterB.onMessage(onMessageB);
    adapterC.onMessage(onMessageC);

    await adapterA.connect();
    await adapterB.connect();
    await adapterC.connect();

    const targetedSignal: TransportSignal = {
      type: 'event',
      roomId: 'room-memory',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: 1,
      payload: {
        name: 'targeted',
        payload: {
          targeted: true,
        },
      },
    };
    adapterA.send(targetedSignal);

    await waitFor(() => onMessageB.mock.calls.length === 1);
    expect(onMessageB).toHaveBeenCalledWith(targetedSignal);
    expect(onMessageC).not.toHaveBeenCalled();

    const broadcastSignal: TransportSignal = {
      type: 'hello',
      roomId: 'room-memory',
      fromPeerId: 'peer-a',
      timestamp: 2,
      payload: {
        peer: {
          id: 'peer-a',
          joinedAt: 1,
          lastSeen: 2,
        },
        protocol,
      },
    };
    adapterA.broadcast(broadcastSignal);

    await waitFor(() => onMessageB.mock.calls.length === 2 && onMessageC.mock.calls.length === 1);
    expect(onMessageB).toHaveBeenLastCalledWith(broadcastSignal);
    expect(onMessageC).toHaveBeenCalledWith(broadcastSignal);

    await adapterA.disconnect();
    await adapterB.disconnect();
    await adapterC.disconnect();
  });
});
