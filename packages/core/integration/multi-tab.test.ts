import net from 'node:net';

import { type BrowserContext, expect, type Page, test, type TestInfo } from '@playwright/test';

import { createRelayServer, type RelayServer } from '../../relay/src/index';

interface HarnessInitConfig {
  roomId: string;
  options: Record<string, unknown>;
  eventNames?: string[];
}

interface HarnessEventRecord {
  kind: 'room' | 'custom';
  name: string;
  payload: unknown;
  at: number;
  from?: {
    id: string;
  };
}

interface HarnessSnapshot {
  peerId: string | null;
  status: string | null;
  peerCount: number;
  peers: Array<{
    id: string;
  }>;
  roomEvents: HarnessEventRecord[];
  customEvents: HarnessEventRecord[];
  rtc: {
    available: boolean;
    peerConnectionsCreated: number;
    dataChannelsCreated: number;
    dataChannelsOpened: number;
    dataChannelOpened: boolean;
  };
}

interface CursorHarnessState {
  positions: Array<{
    userId: string;
    name: string;
    color: string;
    x: number;
    y: number;
    xAbsolute: number;
    yAbsolute: number;
    idle: boolean;
  }>;
  rendered: Array<{
    userId: string | null;
    text: string;
    left: string;
    top: string;
    idle: string | null;
    transition: string;
    style: string | null;
    markerTag: string | null;
    markerStyle: string | null;
    markerColor: string | null;
    labelDisplay: string | null;
  }>;
}

interface StateHarnessChange {
  value: unknown;
  meta: {
    reason: 'set' | 'patch' | 'undo' | 'reset';
    changedBy: string;
    timestamp: number;
  };
  at: number;
}

interface StateHarnessState {
  value: unknown;
  changes: StateHarnessChange[];
}

interface PageHarnessApi {
  initRoom(config: HarnessInitConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  emit(input: { name: string; payload: unknown }): void;
  emitTo(input: { peerId: string; name: string; payload: unknown }): void;
  mountCursors(config?: {
    render?: boolean;
    options?: Record<string, unknown>;
    renderOptions?: Record<string, unknown>;
  }): void;
  mountState(config?: {
    options?: Record<string, unknown>;
  }): void;
  unmountCursors(): void;
  dispatchCursorMove(input: { x: number; y: number; kind?: 'mouse' | 'touchstart' | 'touchmove' }): void;
  setState(value: unknown): void;
  patchState(value: unknown): void;
  undoState(): void;
  resetState(): void;
  getSnapshot(): HarnessSnapshot;
  getCursorState(): CursorHarnessState;
  getStateSnapshot(): StateHarnessState;
  getEvents(): HarnessEventRecord[];
  waitForEvent(input: {
    kind: 'room' | 'custom';
    name: string;
    timeoutMs?: number;
  }): Promise<HarnessEventRecord | null>;
}

declare global {
  interface Window {
    __flockjsIntegration: PageHarnessApi;
  }
}

const EVENT_WAIT_TIMEOUT_MS = 20_000;
function reserveRelayPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to resolve an ephemeral relay port.'));
        });
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function createRoomId(testInfo: TestInfo, suffix: string): string {
  const sanitizedProjectName = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const sanitizedSuffix = suffix.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `integration-${sanitizedProjectName}-${sanitizedSuffix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`;
}

async function getHarness(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveText('FlockJS integration fixture');
  await page.waitForFunction(() => {
    return typeof window.__flockjsIntegration !== 'undefined';
  });
}

async function initializeHarnessPage(
  context: BrowserContext,
  config: HarnessInitConfig,
): Promise<IntegrationPage> {
  const page = await context.newPage();
  await getHarness(page);
  await page.evaluate(async (value) => {
    await window.__flockjsIntegration.initRoom(value);
  }, config);
  return new IntegrationPage(page);
}

class IntegrationPage {
  public constructor(public readonly page: Page) {}

  public async connect(): Promise<void> {
    await this.page.evaluate(async () => {
      await window.__flockjsIntegration.connect();
    });
  }

  public async disconnect(): Promise<void> {
    await this.page.evaluate(async () => {
      await window.__flockjsIntegration.disconnect();
    });
  }

  public async emit(name: string, payload: unknown): Promise<void> {
    await this.page.evaluate(
      (value) => {
        window.__flockjsIntegration.emit(value);
      },
      { name, payload },
    );
  }

  public async emitTo(peerId: string, name: string, payload: unknown): Promise<void> {
    await this.page.evaluate(
      (value) => {
        window.__flockjsIntegration.emitTo(value);
      },
      { peerId, name, payload },
    );
  }

  public async getSnapshot(): Promise<HarnessSnapshot> {
    return this.page.evaluate(() => {
      return window.__flockjsIntegration.getSnapshot();
    });
  }

  public async mountCursors(config?: {
    render?: boolean;
    options?: Record<string, unknown>;
    renderOptions?: Record<string, unknown>;
  }): Promise<void> {
    await this.page.evaluate((value) => {
      window.__flockjsIntegration.mountCursors(value);
    }, config);
  }

  public async unmountCursors(): Promise<void> {
    await this.page.evaluate(() => {
      window.__flockjsIntegration.unmountCursors();
    });
  }

  public async mountState(config?: {
    options?: Record<string, unknown>;
  }): Promise<void> {
    await this.page.evaluate((value) => {
      window.__flockjsIntegration.mountState(value);
    }, config);
  }

  public async dispatchCursorMove(input: {
    x: number;
    y: number;
    kind?: 'mouse' | 'touchstart' | 'touchmove';
  }): Promise<void> {
    await this.page.evaluate((value) => {
      window.__flockjsIntegration.dispatchCursorMove(value);
    }, input);
  }

  public async setState(value: unknown): Promise<void> {
    await this.page.evaluate((nextValue) => {
      window.__flockjsIntegration.setState(nextValue);
    }, value);
  }

  public async patchState(value: unknown): Promise<void> {
    await this.page.evaluate((nextValue) => {
      window.__flockjsIntegration.patchState(nextValue);
    }, value);
  }

  public async undoState(): Promise<void> {
    await this.page.evaluate(() => {
      window.__flockjsIntegration.undoState();
    });
  }

  public async resetState(): Promise<void> {
    await this.page.evaluate(() => {
      window.__flockjsIntegration.resetState();
    });
  }

  public async getCursorState(): Promise<CursorHarnessState> {
    return this.page.evaluate(() => {
      return window.__flockjsIntegration.getCursorState();
    });
  }

  public async getStateSnapshot(): Promise<StateHarnessState> {
    return this.page.evaluate(() => {
      return window.__flockjsIntegration.getStateSnapshot();
    });
  }

  public async getEvents(): Promise<HarnessEventRecord[]> {
    return this.page.evaluate(() => {
      return window.__flockjsIntegration.getEvents();
    });
  }

  public async waitForEvent(
    kind: 'room' | 'custom',
    name: string,
    timeoutMs = EVENT_WAIT_TIMEOUT_MS,
  ): Promise<HarnessEventRecord | null> {
    return this.page.evaluate(
      (value) => {
        return window.__flockjsIntegration.waitForEvent(value);
      },
      { kind, name, timeoutMs },
    );
  }
}

class RelayController {
  private readonly server: RelayServer;

  public constructor(port: number) {
    this.server = createRelayServer({
      host: '127.0.0.1',
      port,
    });
  }

  public get url(): string {
    return this.server.getAddress();
  }

  public async start(): Promise<void> {
    await this.server.start();
  }

  public async stop(): Promise<void> {
    await this.server.stop();
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('multi-tab integration', () => {
  test('connects two BroadcastChannel tabs, exchanges events, and handles leave', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const roomId = createRoomId(testInfo, 'broadcast');
    const first = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
      },
      eventNames: ['alpha-message', 'beta-message'],
    });
    const second = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
      },
      eventNames: ['alpha-message', 'beta-message'],
    });

    try {
      await first.connect();
      await second.connect();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(1);
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).peerCount;
        })
        .toBe(1);

      await first.emit('alpha-message', { direction: 'first-to-second' });
      await expect
        .poll(async () => {
          const event = await second.waitForEvent('custom', 'alpha-message', 200);
          return event?.payload ?? null;
        })
        .toEqual({ direction: 'first-to-second' });

      await second.emit('beta-message', { direction: 'second-to-first' });
      await expect
        .poll(async () => {
          const event = await first.waitForEvent('custom', 'beta-message', 200);
          return event?.payload ?? null;
        })
        .toEqual({ direction: 'second-to-first' });

      await second.disconnect();

      await expect
        .poll(async () => {
          return (await first.waitForEvent('room', 'peer:leave', 200)) !== null;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(0);
    } finally {
      await context.close();
    }
  });

  test('fires peer:leave when a BroadcastChannel tab closes', async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const roomId = createRoomId(testInfo, 'broadcast-close');
    const first = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
      },
    });
    const second = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
      },
    });

    try {
      await first.connect();
      await second.connect();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(1);

      await second.page.close({ runBeforeUnload: true });

      await expect
        .poll(async () => {
          return (await first.waitForEvent('room', 'peer:leave', 200)) !== null;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(0);
    } finally {
      await context.close();
    }
  });

  test('syncs mouse and touch cursor updates, styles, and disconnect cleanup', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const roomId = createRoomId(testInfo, 'cursor-broadcast');
    const first = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
        presence: {
          name: 'First',
          color: '#111111',
        },
      },
    });
    const second = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
        presence: {
          name: 'Second',
          color: '#222222',
        },
      },
    });

    try {
      await first.connect();
      await second.connect();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(1);
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).peerCount;
        })
        .toBe(1);

      await first.mountCursors({
        render: false,
      });
      await second.mountCursors({
        render: true,
        renderOptions: {
          style: 'default',
          showName: true,
          showIdle: true,
        },
      });

      await first.dispatchCursorMove({
        x: 0.25,
        y: 0.5,
      });

      await expect
        .poll(async () => {
          const value = (await second.getCursorState()).positions[0]?.x;
          return typeof value === 'number' ? Math.abs(value - 0.25) < 0.01 : false;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const value = (await second.getCursorState()).positions[0]?.y;
          return typeof value === 'number' ? Math.abs(value - 0.5) < 0.01 : false;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.text ?? null;
        })
        .toContain('First');
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.style ?? null;
        })
        .toBe('default');
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.markerStyle ?? null;
        })
        .toBe('default');
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.markerTag ?? null;
        })
        .toBe('svg');
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.markerColor ?? null;
        })
        .toBe('#111111');
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.transition.includes('left') ?? false;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          return (await second.getCursorState()).rendered[0]?.labelDisplay ?? null;
        })
        .toBe('inline-flex');

      await first.dispatchCursorMove({
        x: 0.75,
        y: 0.25,
        kind: 'touchstart',
      });
      await first.dispatchCursorMove({
        x: 0.75,
        y: 0.25,
        kind: 'touchmove',
      });

      await expect
        .poll(async () => {
          const value = (await second.getCursorState()).positions[0]?.x;
          return typeof value === 'number' ? Math.abs(value - 0.75) < 0.01 : false;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const value = (await second.getCursorState()).positions[0]?.y;
          return typeof value === 'number' ? Math.abs(value - 0.25) < 0.01 : false;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const value = (await second.getCursorState()).rendered[0]?.left;
          const parsed = value ? Number.parseFloat(value) : Number.NaN;
          return Number.isFinite(parsed) ? Math.abs(parsed - 75) < 1 : false;
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const value = (await second.getCursorState()).rendered[0]?.top;
          const parsed = value ? Number.parseFloat(value) : Number.NaN;
          return Number.isFinite(parsed) ? Math.abs(parsed - 25) < 1 : false;
        })
        .toBe(true);

      await first.disconnect();
      await expect
        .poll(
          async () => {
            return (await second.getCursorState()).rendered.length;
          },
          {
            timeout: 1_000,
          },
        )
        .toBe(0);
      await expect
        .poll(
          async () => {
            return (await second.getSnapshot()).peerCount;
          },
          {
            timeout: 1_000,
          },
        )
        .toBe(0);

      await first.unmountCursors();
      await second.unmountCursors();
    } finally {
      await context.close();
    }
  });

  test('syncs shared state across tabs, late joiners, undo, and reset', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const roomId = createRoomId(testInfo, 'state-broadcast');
    const initialValue = {
      count: 0,
      nested: {
        label: 'initial',
        visible: true,
      },
      items: [1],
    };
    const first = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
      },
    });
    const second = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'broadcast',
      },
    });

    try {
      await first.mountState({
        options: {
          initialValue,
        },
      });
      await second.mountState({
        options: {
          initialValue,
        },
      });

      await first.connect();
      await second.connect();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(1);
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).peerCount;
        })
        .toBe(1);

      await first.setState({
        count: 1,
        nested: {
          label: 'set',
          visible: true,
        },
        items: [1],
      });

      await expect
        .poll(async () => {
          return (await second.getStateSnapshot()).value;
        })
        .toEqual({
          count: 1,
          nested: {
            label: 'set',
            visible: true,
          },
          items: [1],
        });

      await second.patchState({
        nested: {
          label: 'patched',
        },
        items: [2, 3],
      });

      await expect
        .poll(async () => {
          return (await first.getStateSnapshot()).value;
        })
        .toEqual({
          count: 1,
          nested: {
            label: 'patched',
            visible: true,
          },
          items: [2, 3],
        });

      const firstPeerId = (await first.getSnapshot()).peerId;
      await expect
        .poll(async () => {
          return (await second.getStateSnapshot()).changes.some((change) => {
            return change.meta.changedBy === firstPeerId && change.meta.reason === 'set';
          });
        })
        .toBe(true);

      const late = await initializeHarnessPage(context, {
        roomId,
        options: {
          transport: 'broadcast',
        },
      });

      await late.connect();
      await late.mountState({
        options: {
          initialValue: {
            count: 999,
            nested: {
              label: 'ignored',
              visible: false,
            },
            items: [9],
          },
        },
      });

      await expect
        .poll(
          async () => {
            return (await late.getStateSnapshot()).value;
          },
          {
            timeout: 1_000,
          },
        )
        .toEqual({
          count: 1,
          nested: {
            label: 'patched',
            visible: true,
          },
          items: [2, 3],
        });

      await late.undoState();

      await expect
        .poll(async () => {
          return (await first.getStateSnapshot()).value;
        })
        .toEqual({
          count: 1,
          nested: {
            label: 'set',
            visible: true,
          },
          items: [1],
        });

      await first.resetState();

      await expect
        .poll(async () => {
          return (await second.getStateSnapshot()).value;
        })
        .toEqual(initialValue);
      await expect
        .poll(async () => {
          return (await late.getStateSnapshot()).value;
        })
        .toEqual(initialValue);
    } finally {
      await context.close();
    }
  });

  test('establishes a real WebRTC data channel and exchanges data bidirectionally', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);

    const relay = new RelayController(await reserveRelayPort());
    await relay.start();

    const context = await browser.newContext();
    const roomId = createRoomId(testInfo, 'webrtc');
    const first = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'webrtc',
        relayUrl: relay.url,
      },
      eventNames: ['webrtc-first', 'webrtc-second'],
    });
    const second = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'webrtc',
        relayUrl: relay.url,
      },
      eventNames: ['webrtc-first', 'webrtc-second'],
    });

    try {
      const firstRtcAvailable = (await first.getSnapshot()).rtc.available;
      const secondRtcAvailable = (await second.getSnapshot()).rtc.available;
      // Playwright WebKit does not expose RTCPeerConnection on every platform build.
      test.skip(
        !firstRtcAvailable || !secondRtcAvailable,
        'RTCPeerConnection is unavailable in this browser runtime.',
      );

      await first.connect();
      await second.connect();

      await expect
        .poll(
          async () => {
            return (await first.getSnapshot()).peerCount;
          },
          {
            timeout: 40_000,
          },
        )
        .toBe(1);
      await expect
        .poll(
          async () => {
            return (await second.getSnapshot()).peerCount;
          },
          {
            timeout: 40_000,
          },
        )
        .toBe(1);

      await expect
        .poll(
          async () => {
            return (await first.getSnapshot()).rtc.dataChannelOpened;
          },
          {
            timeout: 40_000,
          },
        )
        .toBe(true);
      await expect
        .poll(
          async () => {
            return (await second.getSnapshot()).rtc.dataChannelOpened;
          },
          {
            timeout: 40_000,
          },
        )
        .toBe(true);

      await first.emit('webrtc-first', { direction: 'first-to-second' });
      await expect
        .poll(async () => {
          const event = await second.waitForEvent('custom', 'webrtc-first', 200);
          return event?.payload ?? null;
        })
        .toEqual({ direction: 'first-to-second' });

      await second.emit('webrtc-second', { direction: 'second-to-first' });
      await expect
        .poll(async () => {
          const event = await first.waitForEvent('custom', 'webrtc-second', 200);
          return event?.payload ?? null;
        })
        .toEqual({ direction: 'second-to-first' });
    } finally {
      await context.close();
      await relay.stop();
    }
  });

  test('reconnects websocket rooms after relay restart without recreating the room', async ({
    browser,
  }, testInfo) => {
    const relay = new RelayController(await reserveRelayPort());
    await relay.start();

    const context = await browser.newContext();
    const roomId = createRoomId(testInfo, 'reconnect');
    const reconnectOptions = {
      maxAttempts: 20,
      backoffMs: 100,
      backoffMultiplier: 1.5,
      maxBackoffMs: 500,
    };
    const first = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'websocket',
        relayUrl: relay.url,
        reconnect: reconnectOptions,
      },
      eventNames: ['after-reconnect'],
    });
    const second = await initializeHarnessPage(context, {
      roomId,
      options: {
        transport: 'websocket',
        relayUrl: relay.url,
        reconnect: reconnectOptions,
      },
      eventNames: ['after-reconnect'],
    });

    try {
      await first.connect();
      await second.connect();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(1);
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).peerCount;
        })
        .toBe(1);

      const firstInitialPeerId = (await first.getSnapshot()).peerId;
      const secondInitialPeerId = (await second.getSnapshot()).peerId;

      await relay.stop();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).status;
        })
        .toBe('reconnecting');
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).status;
        })
        .toBe('reconnecting');

      await relay.start();

      await expect
        .poll(async () => {
          return (await first.getSnapshot()).status;
        })
        .toBe('connected');
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).status;
        })
        .toBe('connected');
      await expect
        .poll(async () => {
          return (await first.getSnapshot()).peerCount;
        })
        .toBe(1);
      await expect
        .poll(async () => {
          return (await second.getSnapshot()).peerCount;
        })
        .toBe(1);

      const firstConnectedEvents = (await first.getSnapshot()).roomEvents.filter((event) => {
        return event.name === 'connected';
      });
      const secondConnectedEvents = (await second.getSnapshot()).roomEvents.filter((event) => {
        return event.name === 'connected';
      });
      const firstReconnectingEvents = (await first.getSnapshot()).roomEvents.filter((event) => {
        return event.name === 'reconnecting';
      });
      const secondReconnectingEvents = (await second.getSnapshot()).roomEvents.filter((event) => {
        return event.name === 'reconnecting';
      });

      expect(firstConnectedEvents).toHaveLength(2);
      expect(secondConnectedEvents).toHaveLength(2);
      expect(firstReconnectingEvents.length).toBeGreaterThan(0);
      expect(secondReconnectingEvents.length).toBeGreaterThan(0);
      expect((await first.getSnapshot()).peerId).toBe(firstInitialPeerId);
      expect((await second.getSnapshot()).peerId).toBe(secondInitialPeerId);

      await first.emit('after-reconnect', { ok: true });
      await expect
        .poll(async () => {
          const event = await second.waitForEvent('custom', 'after-reconnect', 200);
          return event?.payload ?? null;
        })
        .toEqual({ ok: true });
    } finally {
      await context.close();
      await relay.stop();
    }
  });
});
