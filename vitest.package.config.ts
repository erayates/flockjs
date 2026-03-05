import { mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, {
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
