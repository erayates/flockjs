import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compareStateSnapshots,
  createInitialStateSnapshot,
  patchStateSnapshot,
  setStateSnapshot,
} from '../internal/state';
import { createStateEngine } from './state';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createStateEngine', () => {
  it('supports get, set, patch, undo, and reset with changedBy metadata', () => {
    let now = 10;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const state = createStateEngine({
      initialValue: {
        count: 0,
        nested: {
          label: 'initial',
          visible: true,
        },
        items: [1],
      },
    });

    const subscriber = vi.fn();
    state.subscribe(subscriber);

    now = 11;
    state.set({
      count: 1,
      nested: {
        label: 'set',
        visible: true,
      },
      items: [1],
    });

    now = 12;
    state.patch({
      nested: {
        label: 'patched',
        visible: true,
      },
      items: [2, 3],
    });

    now = 13;
    state.undo();

    now = 14;
    state.reset();

    expect(state.get()).toEqual({
      count: 0,
      nested: {
        label: 'initial',
        visible: true,
      },
      items: [1],
    });

    expect(subscriber).toHaveBeenNthCalledWith(
      1,
      {
        count: 1,
        nested: {
          label: 'set',
          visible: true,
        },
        items: [1],
      },
      {
        reason: 'set',
        changedBy: 'local',
        timestamp: 11,
      },
    );
    expect(subscriber).toHaveBeenNthCalledWith(
      2,
      {
        count: 1,
        nested: {
          label: 'patched',
          visible: true,
        },
        items: [2, 3],
      },
      {
        reason: 'patch',
        changedBy: 'local',
        timestamp: 12,
      },
    );
    expect(subscriber).toHaveBeenNthCalledWith(
      3,
      {
        count: 1,
        nested: {
          label: 'set',
          visible: true,
        },
        items: [1],
      },
      {
        reason: 'undo',
        changedBy: 'local',
        timestamp: 13,
      },
    );
    expect(subscriber).toHaveBeenNthCalledWith(
      4,
      {
        count: 0,
        nested: {
          label: 'initial',
          visible: true,
        },
        items: [1],
      },
      {
        reason: 'reset',
        changedBy: 'local',
        timestamp: 14,
      },
    );
  });

  it('caps undo history at 20 entries', () => {
    const state = createStateEngine({
      initialValue: {
        count: 0,
      },
    });

    for (let index = 1; index <= 25; index += 1) {
      state.set({
        count: index,
      });
    }

    for (let index = 0; index < 20; index += 1) {
      state.undo();
    }

    expect(state.get()).toEqual({
      count: 5,
    });

    state.undo();
    expect(state.get()).toEqual({
      count: 5,
    });
  });

  it('deep merges plain objects and replaces arrays during patch operations', () => {
    const snapshot = createInitialStateSnapshot(
      {
        count: 1,
        nested: {
          appearance: {
            color: 'blue',
            size: 'm',
          },
        },
        items: [1, 2],
      },
      'peer-a',
      1,
    );

    const nextSnapshot = patchStateSnapshot(
      snapshot,
      {
        nested: {
          appearance: {
            color: 'red',
          },
        },
        items: [3],
      },
      'peer-a',
      2,
    );

    expect(nextSnapshot).not.toBeNull();
    expect(nextSnapshot?.value).toEqual({
      count: 1,
      nested: {
        appearance: {
          color: 'red',
          size: 'm',
        },
      },
      items: [3],
    });
  });

  it('rejects unsupported runtime strategies', () => {
    expect(() => {
      createStateEngine({
        initialValue: {
          count: 0,
        },
        strategy: 'crdt',
      });
    }).toThrowError(/not implemented/i);

    expect(() => {
      createStateEngine({
        initialValue: {
          count: 0,
        },
        strategy: 'custom',
      });
    }).toThrowError(/not implemented/i);
  });

  it('resolves LWW ordering with vector clocks, timestamps, and changedBy tie-breaks', () => {
    const initial = createInitialStateSnapshot(
      {
        count: 0,
      },
      'peer-a',
      1,
    );

    const fromPeerB = setStateSnapshot(
      initial,
      {
        count: 1,
      },
      'peer-b',
      10,
    );
    const fromPeerC = setStateSnapshot(
      initial,
      {
        count: 2,
      },
      'peer-c',
      20,
    );

    expect(compareStateSnapshots(fromPeerC, fromPeerB)).toBeGreaterThan(0);
    expect(compareStateSnapshots(fromPeerB, fromPeerC)).toBeLessThan(0);

    const dominating = setStateSnapshot(
      fromPeerC,
      {
        count: 3,
      },
      'peer-b',
      5,
    );
    expect(compareStateSnapshots(dominating, fromPeerC)).toBeGreaterThan(0);

    const lexicalWinner = {
      ...dominating,
      changedBy: 'peer-z',
    };
    expect(compareStateSnapshots(lexicalWinner, dominating)).toBeGreaterThan(0);
  });
});
