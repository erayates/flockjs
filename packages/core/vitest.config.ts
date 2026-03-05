import { mergeConfig } from 'vitest/config';

import baseConfig from '../../vitest.config';

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
