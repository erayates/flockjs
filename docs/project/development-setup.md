# Development Setup

Audience: contributors.

## Prerequisites

- Node.js `20` locally (`18` and `20` are validated in CI)
- `pnpm`
- `git`

## Clone and Install

```bash
git clone https://github.com/erayates/flockjs.git
cd flockjs
pnpm install
```

## Expected Workspace Commands

```bash
pnpm build
pnpm test
pnpm test:watch
pnpm lint
pnpm format:check
pnpm format:write
pnpm typecheck
pnpm typecheck:root
pnpm typecheck:all
pnpm changeset
pnpm version-packages
pnpm release:status
```

Additional integration workflow (planned):

```bash
pnpm test:integration
```

## Working Norms

- Prefer small, focused PRs.
- Keep docs and tests in the same PR as behavior changes.
- Preserve strict TypeScript compatibility.
- Keep imports sorted and lint-clean before commit.
- Run Prettier checks before opening a PR.
- Keep package unit tests in `src/**/*.test.ts` for Vitest convention consistency.
- Core package coverage threshold must stay at or above 80%.
- Add a changeset file for release-relevant changes in `packages/*`.

## CI and Release

- PR workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`
- PR validation matrix: Node `18`, `20`
- Validation order: install -> lint -> typecheck -> test -> build
- Release trigger: push tag matching `v*`

Required GitHub secrets for release:

- `NPM_TOKEN` (required)
- `TURBO_TEAM` (optional, for remote cache)
- `TURBO_TOKEN` (optional, for remote cache)

## Local Hooks

Husky is configured to enforce quality checks during commits:

- `pre-commit`: `pnpm lint` + `pnpm typecheck`
- `commit-msg`: commitlint conventional-commit validation

Use `--no-verify` only for emergency situations.

## Troubleshooting

- If workspace linking fails, reinstall dependencies from repository root.
- If type errors look stale, clear local build artifacts and rerun typecheck.
- If `pnpm typecheck` passes but `pnpm typecheck:root` fails, verify root `tsconfig.json` includes only intended sources and excludes tests/build output.
- If coverage output is missing, confirm tests are under `packages/*/src/**/*.test.ts` and rerun `pnpm test`.
- If releases fail before publish, confirm `NPM_TOKEN` is configured in repository secrets.

## Related Docs

- [Contributing](../../CONTRIBUTING.md)
- [Repository structure](repository-structure.md)
- [Labeling and triage](labeling-and-triage.md)
- [Release process](release-process.md)
- [Docs index](../README.md)
