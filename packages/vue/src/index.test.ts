import { describe, expect, it } from 'vitest';

import { createVueAdapterStub } from './index';

describe('createVueAdapterStub', () => {
  it('returns vue stub identifier', () => {
    expect(createVueAdapterStub()).toBe('@flockjs/vue-stub');
  });
});
