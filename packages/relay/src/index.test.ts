import { describe, expect, it } from 'vitest';

import { createRelayStub } from './index';

describe('createRelayStub', () => {
  it('returns relay stub identifier', () => {
    expect(createRelayStub()).toBe('@flockjs/relay-stub');
  });
});
