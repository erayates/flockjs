---
'@flockjs/core': major
'@flockjs/relay': minor
'@flockjs/react': minor
'@flockjs/svelte': minor
'@flockjs/vue': minor
---

Adopt the FlockJS code quality guideline baseline across packages.

## Core (breaking)

- Export `FlockError` as a runtime class and standardize thrown error instances.
- Centralize runtime capability detection in `src/internal/env.ts`.
- Remove assertion-based narrowing in non-test source and migrate to guard utilities.
- Harden event emission by isolating user callback errors.
- Update event engine payload typing to boundary-safe `unknown` for transport-delivered events.

## Relay

- Switch inbound relay protocol parsing to Zod schema validation with `safeParse`.
- Preserve wire format while improving malformed payload rejection consistency.

## Adapters

- Add explicit framework peer dependency contracts:
  - `@flockjs/react`: `react`, `react-dom`
  - `@flockjs/vue`: `vue`
  - `@flockjs/svelte`: `svelte`
- Keep `@flockjs/core` as a workspace dependency for framework adapters.
