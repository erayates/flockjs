import { createFlockError } from '../flock-error';
import { env } from '../internal/env';
import { logTransportSelection } from '../internal/logger';
import type { FlockError, PresenceData, RoomOptions } from '../types';
import { createBroadcastTransportAdapter, isBroadcastChannelAvailable } from './broadcast';
import { createInMemoryTransportAdapter } from './in-memory';
import type { TransportAdapter } from './transport';
import { createWebRTCFallbackTransportAdapter } from './webrtc-fallback';
import { createWebSocketTransportAdapter } from './websocket';

function hasRelayUrl<TPresence extends PresenceData>(options: RoomOptions<TPresence>): boolean {
  return typeof options.relayUrl === 'string' && options.relayUrl.trim().length > 0;
}

function createWebRTCTransportError(error: unknown): FlockError {
  return createFlockError(
    'NETWORK_ERROR',
    error instanceof Error ? error.message : 'Failed to initialize WebRTC transport.',
    false,
    error,
  );
}

function logSelection<TPresence extends PresenceData>(
  options: RoomOptions<TPresence>,
  requestedMode: string,
  selectedTransport: TransportAdapter,
  reason: string,
): TransportAdapter {
  logTransportSelection(options.debug, {
    requestedMode,
    selectedTransport: selectedTransport.kind,
    reason,
  });

  return selectedTransport;
}

export function selectTransportAdapter<TPresence extends PresenceData>(
  roomId: string,
  peerId: string,
  options: RoomOptions<TPresence>,
): TransportAdapter {
  const mode = options.transport ?? 'auto';

  if (mode === 'broadcast') {
    if (isBroadcastChannelAvailable()) {
      return logSelection(
        options,
        mode,
        createBroadcastTransportAdapter(roomId),
        'Explicit broadcast mode; BroadcastChannel available',
      );
    }

    return logSelection(
      options,
      mode,
      createInMemoryTransportAdapter(roomId, peerId),
      'Explicit broadcast mode; BroadcastChannel unavailable',
    );
  }

  if (mode === 'webrtc') {
    try {
      return logSelection(
        options,
        mode,
        createWebRTCFallbackTransportAdapter(roomId, peerId, options),
        'Explicit webrtc mode',
      );
    } catch (error) {
      throw createWebRTCTransportError(error);
    }
  }

  if (mode === 'websocket') {
    return logSelection(
      options,
      mode,
      createWebSocketTransportAdapter(roomId, peerId, options),
      'Explicit websocket mode',
    );
  }

  if (isBroadcastChannelAvailable()) {
    return logSelection(
      options,
      mode,
      createBroadcastTransportAdapter(roomId),
      'BroadcastChannel available',
    );
  }

  if (env.hasRTCPeerConnection && hasRelayUrl(options)) {
    try {
      return logSelection(
        options,
        mode,
        createWebRTCFallbackTransportAdapter(roomId, peerId, options),
        'BroadcastChannel unavailable; RTCPeerConnection + relayUrl available',
      );
    } catch (error) {
      throw createWebRTCTransportError(error);
    }
  }

  if (hasRelayUrl(options)) {
    return logSelection(
      options,
      mode,
      createWebSocketTransportAdapter(roomId, peerId, options),
      'BroadcastChannel unavailable; WebRTC unavailable; relayUrl available',
    );
  }

  return logSelection(
    options,
    mode,
    createInMemoryTransportAdapter(roomId, peerId),
    'No browser-capable transport available',
  );
}
