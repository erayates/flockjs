import { createRoom } from '/packages/core/dist/index.js';

const ROOM_EVENT_NAMES = [
  'connected',
  'disconnected',
  'reconnecting',
  'error',
  'peer:join',
  'peer:leave',
  'peer:update',
  'room:full',
  'room:empty',
];

const state = {
  room: null,
  eventEngine: null,
  cursorEngine: null,
  roomEventUnsubscribes: [],
  customEventUnsubscribes: [],
  cursorUnsubscribe: null,
  roomEvents: [],
  customEvents: [],
  cursorPositions: [],
  rtc: {
    available: typeof RTCPeerConnection === 'function',
    peerConnectionsCreated: 0,
    dataChannelsCreated: 0,
    dataChannelsOpened: 0,
  },
};

function snapshotValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      ...(typeof value.recoverable === 'boolean' ? { recoverable: value.recoverable } : {}),
      ...(value.cause !== undefined ? { cause: snapshotValue(value.cause) } : {}),
    };
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      return String(value);
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function recordRoomEvent(name, payload) {
  state.roomEvents.push({
    kind: 'room',
    name,
    payload: snapshotValue(payload),
    at: Date.now(),
  });
}

function recordCustomEvent(name, payload, from) {
  state.customEvents.push({
    kind: 'custom',
    name,
    payload: snapshotValue(payload),
    from: snapshotValue(from),
    at: Date.now(),
  });
}

function clearSubscriptions() {
  for (const unsubscribe of state.roomEventUnsubscribes) {
    unsubscribe();
  }

  for (const unsubscribe of state.customEventUnsubscribes) {
    unsubscribe();
  }

  state.cursorUnsubscribe?.();
  state.cursorUnsubscribe = null;

  state.roomEventUnsubscribes = [];
  state.customEventUnsubscribes = [];
}

function resetState() {
  clearSubscriptions();
  state.cursorEngine?.unmount();
  state.roomEvents = [];
  state.customEvents = [];
  state.cursorPositions = [];
  state.eventEngine = null;
  state.cursorEngine = null;
}

function getBoardElement() {
  const board = document.getElementById('board');
  if (!(board instanceof HTMLElement)) {
    throw new Error('Cursor board element is not available.');
  }

  return board;
}

function createSyntheticTouchEvent(type, clientX, clientY) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  });
  const touchPoint = {
    clientX,
    clientY,
  };

  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: [touchPoint],
  });
  Object.defineProperty(event, 'changedTouches', {
    configurable: true,
    value: [touchPoint],
  });

  return event;
}

function getRenderedCursorSnapshot() {
  const board = getBoardElement();
  return Array.from(board.querySelectorAll('[data-flockjs-peer-cursor]')).map((node) => {
    return {
      userId: node.getAttribute('data-user-id'),
      text: node.textContent ?? '',
      left: node.style.left,
      top: node.style.top,
      idle: node.getAttribute('data-idle'),
    };
  });
}

function instrumentRtcChannel(channel) {
  if (channel.__flockjsInstrumented) {
    return;
  }

  channel.__flockjsInstrumented = true;
  if (channel.readyState === 'open') {
    state.rtc.dataChannelsOpened += 1;
  }

  channel.addEventListener('open', () => {
    state.rtc.dataChannelsOpened += 1;
  });
}

function installRtcInstrumentation() {
  if (typeof RTCPeerConnection !== 'function') {
    return;
  }

  const NativeRTCPeerConnection = RTCPeerConnection;

  class InstrumentedRTCPeerConnection extends NativeRTCPeerConnection {
    constructor(...args) {
      super(...args);
      state.rtc.peerConnectionsCreated += 1;
      this.addEventListener('datachannel', (event) => {
        instrumentRtcChannel(event.channel);
      });
    }

    createDataChannel(label, options) {
      const channel = super.createDataChannel(label, options);
      state.rtc.dataChannelsCreated += 1;
      instrumentRtcChannel(channel);
      return channel;
    }
  }

  window.RTCPeerConnection = InstrumentedRTCPeerConnection;
}

installRtcInstrumentation();

window.__flockjsIntegration = {
  async initRoom(config) {
    if (state.room) {
      await state.room.disconnect();
    }

    resetState();

    state.room = createRoom(config.roomId, config.options ?? {});
    state.eventEngine = state.room.useEvents();

    for (const eventName of ROOM_EVENT_NAMES) {
      const unsubscribe = state.room.on(eventName, (payload) => {
        recordRoomEvent(eventName, payload);
      });
      state.roomEventUnsubscribes.push(unsubscribe);
    }

    for (const eventName of config.eventNames ?? []) {
      const unsubscribe = state.eventEngine.on(eventName, (payload, from) => {
        recordCustomEvent(eventName, payload, from);
      });
      state.customEventUnsubscribes.push(unsubscribe);
    }
  },

  async connect() {
    if (!state.room) {
      throw new Error('Room has not been initialized.');
    }

    await state.room.connect();
  },

  async disconnect() {
    if (!state.room) {
      return;
    }

    await state.room.disconnect();
  },

  emit({ name, payload }) {
    if (!state.eventEngine) {
      throw new Error('Event engine is not initialized.');
    }

    state.eventEngine.emit(name, payload);
  },

  emitTo({ peerId, name, payload }) {
    if (!state.eventEngine) {
      throw new Error('Event engine is not initialized.');
    }

    state.eventEngine.emitTo(peerId, name, payload);
  },

  mountCursors(config = {}) {
    if (!state.room) {
      throw new Error('Room has not been initialized.');
    }

    const board = getBoardElement();
    state.cursorEngine = state.room.useCursors(config.options ?? {});
    state.cursorEngine.mount(board);
    state.cursorUnsubscribe?.();
    state.cursorUnsubscribe = state.cursorEngine.subscribe((positions) => {
      state.cursorPositions = snapshotValue(positions);
    });

    if (config.render !== false) {
      state.cursorEngine.render({
        container: board,
        showName: true,
        ...(config.renderOptions ?? {}),
      });
    }
  },

  unmountCursors() {
    state.cursorUnsubscribe?.();
    state.cursorUnsubscribe = null;
    state.cursorPositions = [];
    state.cursorEngine?.unmount();
    state.cursorEngine = null;
  },

  dispatchCursorMove({ x, y, kind = 'mouse' }) {
    const board = getBoardElement();
    const rect = board.getBoundingClientRect();
    const clientX = rect.left + rect.width * x;
    const clientY = rect.top + rect.height * y;

    if (kind === 'touchstart' || kind === 'touchmove') {
      board.dispatchEvent(createSyntheticTouchEvent(kind, clientX, clientY));
      return;
    }

    board.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX,
        clientY,
      }),
    );
  },

  getSnapshot() {
    return {
      peerId: state.room ? state.room.peerId : null,
      status: state.room ? state.room.status : null,
      peerCount: state.room ? state.room.peerCount : 0,
      peers: state.room ? snapshotValue(state.room.peers) : [],
      roomEvents: snapshotValue(state.roomEvents),
      customEvents: snapshotValue(state.customEvents),
      rtc: {
        ...state.rtc,
        dataChannelOpened: state.rtc.dataChannelsOpened > 0,
      },
    };
  },

  getCursorState() {
    return {
      positions: snapshotValue(state.cursorPositions),
      rendered: snapshotValue(getRenderedCursorSnapshot()),
    };
  },

  getEvents() {
    return [...state.roomEvents, ...state.customEvents].map((event) => {
      return snapshotValue(event);
    });
  },

  async waitForEvent({ kind, name, timeoutMs = 5000 }) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const events = kind === 'custom' ? state.customEvents : state.roomEvents;
      const match = events.find((event) => {
        return event.name === name;
      });

      if (match) {
        return snapshotValue(match);
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 25);
      });
    }

    return null;
  },
};
