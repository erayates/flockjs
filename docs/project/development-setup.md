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

## Troubleshooting

- If workspace linking fails, reinstall dependencies from repository root.
- If type errors look stale, clear local build artifacts and rerun typecheck.
- If `pnpm typecheck` passes but `pnpm typecheck:root` fails, verify root `tsconfig.json` includes only intended sources and excludes tests/build output.

## Related Docs

- [Contributing](../../CONTRIBUTING.md)
- [Repository structure](repository-structure.md)
- [Labeling and triage](labeling-and-triage.md)
- [Docs index](../README.md)
