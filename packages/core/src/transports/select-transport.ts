import { createFlockError } from '../flock-error';
import type { FlockError, PresenceData, RoomOptions } from '../types';
import { createBroadcastTransportAdapter, isBroadcastChannelAvailable } from './broadcast';
import { createInMemoryTransportAdapter } from './in-memory';
import type { TransportAdapter } from './transport';
import { createWebRTCTransportAdapter } from './webrtc';

function createUnsupportedWebSocketTransportError(): FlockError {
  return createFlockError(
    'NETWORK_ERROR',
    'Transport mode "websocket" is planned but not implemented in EP-02 #011.',
    false,
  );
}

function createWebRTCTransportError(error: unknown): FlockError {
  return createFlockError(
    'NETWORK_ERROR',
    error instanceof Error ? error.message : 'Failed to initialize WebRTC transport.',
    false,
    error,
  );
}

export function selectTransportAdapter<TPresence extends PresenceData>(
  roomId: string,
  peerId: string,
  options: RoomOptions<TPresence>,
): TransportAdapter {
  const mode = options.transport ?? 'auto';

  if (mode === 'webrtc') {
    try {
      return createWebRTCTransportAdapter(roomId, peerId, options);
    } catch (error) {
      throw createWebRTCTransportError(error);
    }
  }

  if (mode === 'websocket') {
    throw createUnsupportedWebSocketTransportError();
  }

  if (isBroadcastChannelAvailable()) {
    return createBroadcastTransportAdapter(roomId);
  }

  return createInMemoryTransportAdapter(roomId, peerId);
}
