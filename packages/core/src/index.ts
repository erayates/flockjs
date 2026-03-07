import { FlockError } from './flock-error';
import { createRoom } from './room';

export { createRoom };
export { FlockError };
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
  FlockErrorCode,
  FlockYjsProvider,
  FlockYjsProviderEventHandler,
  FlockYjsProviderEventMap,
  FlockYjsProviderEventName,
  FlockYjsProviderStatus,
  Peer,
  PresenceData,
  PresenceEngine,
  ReconnectOptions,
  RelayAuthToken,
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
  WebRTCDataChannelOptions,
  WebRTCOptions,
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
