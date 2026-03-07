import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

import noInlineEnvTypeofChecks from './eslint-rules/no-inline-env-typeof-checks.js';
import noTypeAssertionInTypeGuard from './eslint-rules/no-type-assertion-in-type-guard.js';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

const localRules = {
  'no-inline-env-typeof-checks': noInlineEnvTypeofChecks,
  'no-type-assertion-in-type-guard': noTypeAssertionInTypeGuard,
};

export default [
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'packages/*/src/*.test.ts',
            'packages/*/src/*/*.test.ts',
            'packages/*/src/*/*/*.test.ts',
            'packages/*/integration/*.test.ts',
            'packages/*/integration/*/*.test.ts',
            'packages/*/integration/*/*/*.test.ts',
            'apps/*/src/*.test.ts',
            'apps/*/src/*/*.test.ts',
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 50,
        },
        tsconfigRootDir,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      local: {
        rules: localRules,
      },
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'never',
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-var': 'error',
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            'Use a typed error helper or an explicit CLI failure path instead of throw new Error().',
        },
      ],
      'prefer-const': [
        'error',
        {
          destructuring: 'all',
          ignoreReadBeforeAssign: true,
        },
      ],
      'local/no-inline-env-typeof-checks': 'error',
      'local/no-type-assertion-in-type-guard': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      'local/no-inline-env-typeof-checks': 'off',
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['packages/core/src/internal/env.ts'],
    rules: {
      'local/no-inline-env-typeof-checks': 'off',
    },
  },
  {
    files: ['packages/core/src/internal/typed-peer.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },
  eslintConfigPrettier,
];
