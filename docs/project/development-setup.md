# Development Setup

Audience: contributors.

## Prerequisites

- Node.js `18+`
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
pnpm lint
pnpm format:check
pnpm format:write
pnpm typecheck
pnpm typecheck:root
pnpm typecheck:all
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

## Local Hooks

Husky is configured to enforce quality checks during commits:

- `pre-commit`: `pnpm lint` + `pnpm typecheck`
- `commit-msg`: commitlint conventional-commit validation

Use `--no-verify` only for emergency situations.

## Troubleshooting

- If workspace linking fails, reinstall dependencies from repository root.
- If type errors look stale, clear local build artifacts and rerun typecheck.
- If `pnpm typecheck` passes but `pnpm typecheck:root` fails, verify root `tsconfig.json` includes only intended sources and excludes tests/build output.

## Related Docs

- [Contributing](../../CONTRIBUTING.md)
- [Repository structure](repository-structure.md)
- [Labeling and triage](labeling-and-triage.md)
- [Docs index](../README.md)
