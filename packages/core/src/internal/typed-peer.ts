import type { Peer, PresenceData } from '../types';

// Remote presence extras are runtime-opaque; this is a compile-time bridge from validated
// wire peers to the room's generic presence contract, not a trust-boundary validator.
export function coerceTypedPeer<TPresence extends PresenceData>(
  peer: Peer<PresenceData>,
): Peer<TPresence> {
  return peer as Peer<TPresence>;
}
