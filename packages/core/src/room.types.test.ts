import { describe, expect, expectTypeOf, it } from 'vitest';

import { createRoom } from './index';

interface PresenceShape {
  name: string;
  role: 'editor' | 'viewer';
  teamId: string;
}

describe('Room generics', () => {
  it('propagates generic presence shape through Room and engines', async () => {
    const room = createRoom<PresenceShape>('room-generic-shape', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
        role: 'editor',
      },
    });

    const presence = room.usePresence();
    const ydoc = room.getYDoc();
    const provider = room.getYProvider();

    expectTypeOf(room.peers).toEqualTypeOf<Array<Partial<PresenceShape> & { id: string }>>();
    expectTypeOf(presence.getSelf().role).toEqualTypeOf<'editor' | 'viewer' | undefined>();
    expectTypeOf(ydoc.clientID).toEqualTypeOf<number>();
    expectTypeOf(provider.synced).toEqualTypeOf<boolean>();

    await room.connect();
    presence.update({
      teamId: 'alpha',
    });

    expect(presence.getSelf().teamId).toBe('alpha');

    await room.disconnect();
  });
});
