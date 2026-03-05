import { createRoom } from './room';

export { createRoom };
export type {
  AwarenessEngine,
  AwarenessSelection,
  AwarenessState,
  CursorEngine,
  CursorOptions,
  CursorPosition,
  CursorRenderOptions,
  DebugOptions,
  EncryptionOptions,
  EventEngine,
  EventOptions,
  FlockError,
  Peer,
  PresenceData,
  PresenceEngine,
  ReconnectOptions,
  Room,
  RoomEventHandler,
  RoomEventMap,
  RoomEventName,
  RoomOptions,
  RoomStatus,
  StateChangeMeta,
  StateEngine,
  StateOptions,
  TransportMode,
  Unsubscribe,
} from './types';

export interface CoreHealth {
  packageName: '@flockjs/core';
  status: 'ok';
}

// Temporary compatibility export for early cross-package stub wiring.
export function createCoreHealth(): CoreHealth {
  return {
    packageName: '@flockjs/core',
    status: 'ok',
  };
}
