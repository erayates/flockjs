export interface CoreHealth {
  packageName: '@flockjs/core';
  status: 'ok';
}

export function createCoreHealth(): CoreHealth {
  return {
    packageName: '@flockjs/core',
    status: 'ok',
  };
}
