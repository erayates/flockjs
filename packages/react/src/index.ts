import { createCoreHealth } from '@flockjs/core';

export interface ReactHealth {
  packageName: '@flockjs/react';
  status: 'ok';
  dependencies: {
    core: ReturnType<typeof createCoreHealth>;
  };
}

export function createReactHealth(): ReactHealth {
  return {
    packageName: '@flockjs/react',
    status: 'ok',
    dependencies: {
      core: createCoreHealth(),
    },
  };
}
