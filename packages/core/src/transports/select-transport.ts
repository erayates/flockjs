import { createFlockError } from '../flock-error';
import type { FlockError, PresenceData, RoomOptions, TransportMode } from '../types';
import { createBroadcastTransportAdapter, isBroadcastChannelAvailable } from './broadcast';
import { createInMemoryTransportAdapter } from './in-memory';
import type { TransportAdapter } from './transport';

function createUnsupportedTransportError(
  mode: Exclude<TransportMode, 'auto' | 'broadcast'>,
): FlockError {
  return createFlockError(
    'NETWORK_ERROR',
    `Transport mode "${mode}" is planned but not implemented in EP-02 #009.`,
    false,
  );
}

export function selectTransportAdapter<TPresence extends PresenceData>(
  roomId: string,
  peerId: string,
  options: RoomOptions<TPresence>,
): TransportAdapter {
  const mode = options.transport ?? 'auto';

  if (mode === 'webrtc' || mode === 'websocket') {
    throw createUnsupportedTransportError(mode);
  }

  if (isBroadcastChannelAvailable()) {
    return createBroadcastTransportAdapter(roomId);
  }

  return createInMemoryTransportAdapter(roomId, peerId);
}
