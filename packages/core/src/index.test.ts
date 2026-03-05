import { describe, expect, it } from 'vitest';

import { createCoreHealth } from './index';

describe('createCoreHealth', () => {
  it('returns the expected health object', () => {
    expect(createCoreHealth()).toEqual({
      packageName: '@flockjs/core',
      status: 'ok',
    });
  });
});
