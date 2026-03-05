import { describe, expect, it } from 'vitest';

import { createReactHealth } from './index';

describe('createReactHealth', () => {
  it('returns expected React health metadata including core dependency', () => {
    expect(createReactHealth()).toEqual({
      packageName: '@flockjs/react',
      status: 'ok',
      dependencies: {
        core: {
          packageName: '@flockjs/core',
          status: 'ok',
        },
      },
    });
  });
});
