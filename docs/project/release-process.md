# Release Process

Audience: contributors and maintainers.

## Goals

- Predictable versioning across packages
- Clear changelog communication
- Safe promotion from pre-release to stable

## Versioning Model

- Semantic Versioning intent (`major.minor.patch`)
- Independent versions per publishable package (`@flockjs/*`)
- Pre-`v1.0` may ship frequent minor-level API adjustments
- Breaking changes must be explicitly called out in PRs and changelog

Changesets is the canonical versioning tool:

- `pnpm changeset`
- `pnpm version-packages`
- `pnpm release`

## Publish Scope

- Published: `packages/*`
- Internal only: `apps/*`, `examples/*`, `benchmarks/*`

## Workflow Overview

1. Contributor adds a changeset file in PR (`pnpm changeset`).
2. PR CI (`.github/workflows/ci.yml`) validates on Node `18` and `20`.
3. Maintainers merge release-ready changes into `main`.
4. Maintainers run `pnpm version-packages` and commit version bumps.
5. Maintainers push tag matching `v*`.
6. Tag triggers `.github/workflows/release.yml`.
7. Release workflow validates and publishes to npm via Changesets.

## Pre-Release and Stable Strategy

- Use pre-release tags to validate significant API changes.
- Promote to stable after testing and compatibility checks.

## CI/CD Contracts

PR validation pipeline order:

1. install
2. lint
3. typecheck
4. test
5. build

Release trigger:

- Git tag push matching `v*`

Release secrets:

- `NPM_TOKEN` (required)
- `TURBO_TEAM` (optional)
- `TURBO_TOKEN` (optional)

## Release Checklist

- [ ] CI green
- [ ] Changesets included for release-relevant package changes
- [ ] Changelog updated
- [ ] Docs updated for API changes
- [ ] Breaking changes explicitly documented
- [ ] Security notes included where relevant
- [ ] `NPM_TOKEN` configured
- [ ] Release tag (`v*`) pushed from intended commit

## Related Docs

- [Changelog](../../CHANGELOG.md)
- [Execution plan](execution-plan.md)
- [Development setup](development-setup.md)
- [Docs index](../README.md)
