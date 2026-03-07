import { describe, expect, it, vi } from 'vitest';

import type { Peer } from '../types';
import {
  PeerRegistry,
  type PeerRegistryClock,
  type PeerRegistryTimerHandle,
} from './peer-registry';

interface TestPresence {
  name?: string;
  role?: 'editor' | 'viewer';
}

class ManualTimerHandle implements PeerRegistryTimerHandle {
  public constructor(
    public readonly id: number,
    private readonly clock: ManualClock,
  ) {}

  public cancel(): void {
    this.clock.clearTimeout(this);
  }
}

class ManualClock implements PeerRegistryClock {
  public nowValue = 1_000;

  private nextTimerId = 1;

  private readonly timerIds = new WeakMap<PeerRegistryTimerHandle, number>();

  private readonly tasks = new Map<
    number,
    {
      callback: () => void;
      dueAt: number;
      cancelled: boolean;
    }
  >();

  public getLastTimerHandle(): ManualTimerHandle | null {
    const lastTimerId = this.nextTimerId - 1;
    if (lastTimerId < 1) {
      return null;
    }

    return new ManualTimerHandle(lastTimerId, this);
  }

  public now(): number {
    return this.nowValue;
  }

  public setTimeout(callback: () => void, delayMs: number): PeerRegistryTimerHandle {
    const timerId = this.nextTimerId++;
    const handle = new ManualTimerHandle(timerId, this);
    this.tasks.set(timerId, {
      callback,
      dueAt: this.nowValue + delayMs,
      cancelled: false,
    });
    this.timerIds.set(handle, timerId);
    return handle;
  }

  public clearTimeout(timer: PeerRegistryTimerHandle): void {
    const timerId = this.timerIds.get(timer);
    if (timerId === undefined) {
      return;
    }

    const task = this.tasks.get(timerId);
    if (!task) {
      return;
    }

    task.cancelled = true;
  }

  public advanceBy(ms: number): void {
    this.nowValue += ms;

    for (const task of this.tasks.values()) {
      if (task.cancelled || task.dueAt > this.nowValue) {
        continue;
      }

      task.cancelled = true;
      task.callback();
    }
  }

  public runStale(timer: ManualTimerHandle): void {
    const task = this.tasks.get(timer.id);
    task?.callback();
  }
}

function createPeer(id: string, overrides: Partial<Peer<TestPresence>> = {}): Peer<TestPresence> {
  return {
    id,
    joinedAt: 10,
    lastSeen: 10,
    ...overrides,
  };
}

describe('PeerRegistry', () => {
  it('returns self, remote lookup, and all peers', () => {
    const registry = new PeerRegistry<TestPresence>(createPeer('self'));

    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
      }),
    );

    expect(registry.getSelf()).toEqual(expect.objectContaining({ id: 'self' }));
    expect(registry.get('self')).toEqual(expect.objectContaining({ id: 'self' }));
    expect(registry.get('peer-a')).toEqual(
      expect.objectContaining({ id: 'peer-a', name: 'Alice' }),
    );
    expect(registry.getAll()).toEqual([
      expect.objectContaining({ id: 'self' }),
      expect.objectContaining({ id: 'peer-a', name: 'Alice' }),
    ]);
  });

  it('deduplicates identical repeated joins', () => {
    const clock = new ManualClock();
    const onPeerJoin = vi.fn();
    const onPeerUpdate = vi.fn();
    const onSnapshotChange = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerJoin,
      onPeerUpdate,
      onSnapshotChange,
    });

    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
        role: 'editor',
      }),
    );

    clock.advanceBy(50);
    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
        role: 'editor',
      }),
    );

    expect(onPeerJoin).toHaveBeenCalledTimes(1);
    expect(onPeerUpdate).not.toHaveBeenCalled();
    expect(onSnapshotChange).toHaveBeenCalledTimes(2);
  });

  it('emits updates for meaningful peer changes', () => {
    const clock = new ManualClock();
    const onPeerUpdate = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerUpdate,
    });

    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
        role: 'editor',
      }),
    );

    clock.advanceBy(25);
    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
        role: 'viewer',
      }),
    );

    expect(onPeerUpdate).toHaveBeenCalledTimes(1);
    expect(registry.get('peer-a')).toEqual(
      expect.objectContaining({
        id: 'peer-a',
        role: 'viewer',
      }),
    );
  });

  it('emits snapshot changes for lastSeen-only updates without emitting peer:update', () => {
    const clock = new ManualClock();
    const onPeerUpdate = vi.fn();
    const onSnapshotChange = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerUpdate,
      onSnapshotChange,
    });

    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
        role: 'editor',
      }),
    );

    onPeerUpdate.mockClear();
    onSnapshotChange.mockClear();

    clock.advanceBy(25);
    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
        role: 'editor',
      }),
    );

    expect(onPeerUpdate).not.toHaveBeenCalled();
    expect(onSnapshotChange).toHaveBeenCalledTimes(1);
    expect(registry.get('peer-a')).toEqual(
      expect.objectContaining({
        id: 'peer-a',
        lastSeen: 1_025,
      }),
    );
  });

  it('removes disconnected peers after the grace period', () => {
    const clock = new ManualClock();
    const onPeerLeave = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerLeave,
    });

    registry.upsertRemote(createPeer('peer-a'));
    registry.markRemoteDisconnected('peer-a');

    clock.advanceBy(4_999);
    expect(registry.get('peer-a')).not.toBeNull();
    expect(onPeerLeave).not.toHaveBeenCalled();

    clock.advanceBy(1);
    expect(registry.get('peer-a')).toBeNull();
    expect(onPeerLeave).toHaveBeenCalledTimes(1);
  });

  it('cancels pending removal when the same peer rejoins within the grace window', () => {
    const clock = new ManualClock();
    const onPeerJoin = vi.fn();
    const onPeerLeave = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerJoin,
      onPeerLeave,
    });

    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
      }),
    );
    registry.markRemoteDisconnected('peer-a');

    clock.advanceBy(4_000);
    registry.upsertRemote(
      createPeer('peer-a', {
        name: 'Alice',
      }),
    );

    clock.advanceBy(1_000);

    expect(registry.get('peer-a')).toEqual(expect.objectContaining({ id: 'peer-a' }));
    expect(onPeerJoin).toHaveBeenCalledTimes(1);
    expect(onPeerLeave).not.toHaveBeenCalled();
  });

  it('ignores stale removal callbacks after a peer rejoins', () => {
    const clock = new ManualClock();
    const onPeerLeave = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerLeave,
    });

    registry.upsertRemote(createPeer('peer-a'));
    registry.markRemoteDisconnected('peer-a');

    const staleTimer = clock.getLastTimerHandle();
    expect(staleTimer).not.toBeNull();

    registry.upsertRemote(createPeer('peer-a'));
    if (staleTimer) {
      clock.runStale(staleTimer);
    }

    expect(registry.get('peer-a')).not.toBeNull();
    expect(onPeerLeave).not.toHaveBeenCalled();
  });

  it('removes peers immediately for explicit leave handling', () => {
    const onPeerLeave = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      onPeerLeave,
    });

    registry.upsertRemote(createPeer('peer-a'));
    registry.removeRemoteImmediately('peer-a');

    expect(registry.get('peer-a')).toBeNull();
    expect(onPeerLeave).toHaveBeenCalledTimes(1);
  });

  it('marks all remotes disconnected independently', () => {
    const clock = new ManualClock();
    const onPeerLeave = vi.fn();
    const registry = new PeerRegistry<TestPresence>(createPeer('self'), {
      clock,
      onPeerLeave,
    });

    registry.upsertRemote(createPeer('peer-a'));
    registry.upsertRemote(createPeer('peer-b'));
    registry.markAllRemotesDisconnected();

    clock.advanceBy(4_000);
    registry.upsertRemote(createPeer('peer-a'));

    clock.advanceBy(1_000);

    expect(registry.get('peer-a')).not.toBeNull();
    expect(registry.get('peer-b')).toBeNull();
    expect(onPeerLeave).toHaveBeenCalledTimes(1);
    expect(onPeerLeave).toHaveBeenCalledWith(expect.objectContaining({ id: 'peer-b' }));
  });
});
