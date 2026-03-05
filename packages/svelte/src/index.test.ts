import { describe, expect, it } from 'vitest';

import { createSvelteAdapterStub } from './index';

describe('createSvelteAdapterStub', () => {
  it('returns svelte stub identifier', () => {
    expect(createSvelteAdapterStub()).toBe('@flockjs/svelte-stub');
  });
});
