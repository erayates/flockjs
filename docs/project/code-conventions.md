# Code Conventions

Audience: contributors.

This document defines FlockJS coding conventions and distinguishes automated enforcement from review-time expectations.

## Enforced Automatically

1. TypeScript compiler strictness (workspace baseline):
   - `strict`
   - `forceConsistentCasingInFileNames`
   - `noImplicitReturns`
   - `noUnusedLocals`
   - `noUncheckedIndexedAccess`
   - `exactOptionalPropertyTypes`
2. ESLint checks for TypeScript sources:
   - Sorted imports/exports (`simple-import-sort`)
   - No explicit `any`
   - Strict equality (`eqeqeq`)
   - Curly braces required (`curly`)
   - `no-var`, `prefer-const`
   - `no-eval`, `no-implied-eval`, `no-new-func`
3. Prettier formatting and `.editorconfig` defaults.
4. CI and local hooks quality gates:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build`
5. Package test conventions:
   - Unit tests in `src/**/*.test.ts`
   - Core coverage threshold at or above 80%

## Review-Enforced Guidelines

1. Prefer explicit domain types and unions over broad string/unknown shapes when feasible.
2. Model finite string values with literal unions rather than unconstrained `string`.
3. Keep functions focused and avoid boolean flag parameters for multi-path behavior.
4. Limit side effects and mutable shared state; isolate effectful boundaries.
5. Validate all untrusted data at boundaries (transport payloads, sockets, input-driven state).
6. Use clear, intention-revealing names (especially booleans using `is`/`has` where appropriate).
7. Avoid hidden coupling, magic numbers, and deeply nested control flow when a clearer design is available.

## Related Docs

- [Contributing](../../CONTRIBUTING.md)
- [Development setup](development-setup.md)
- [Documentation style guide](../STYLE_GUIDE.md)
- [Docs index](../README.md)
