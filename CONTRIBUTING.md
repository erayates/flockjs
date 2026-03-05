# Contributing to FlockJS

Thanks for contributing to FlockJS.

This guide defines the expected workflow for code, docs, and community contributions.

## Audience

- New contributors
- Returning contributors
- Maintainers reviewing pull requests

## Repository

- Canonical repo: <https://github.com/erayates/flockjs>
- Default branch: `main`

## Contribution Types

All contribution types are welcome:

- Bug fixes
- New features
- Documentation improvements
- Tests and test infrastructure
- Tooling and CI improvements
- Performance investigations

## Before You Start

1. Search existing issues and discussions to avoid duplicates.
2. For larger changes, open or comment on an issue first.
3. Confirm scope and acceptance criteria before implementation.

## Local Setup

### Prerequisites

- Node.js `18+` (Node `20` also supported in CI)
- `pnpm`
- `git`

### Setup Steps

```bash
git clone https://github.com/erayates/flockjs.git
cd flockjs
pnpm install
```

When workspace scaffolding is fully in place, the expected root commands are:

```bash
pnpm build
pnpm test
pnpm test:watch
pnpm lint
pnpm typecheck
pnpm typecheck:root
pnpm format:check
pnpm format:write
pnpm changeset
pnpm release:status
```

## Branching Strategy

- Branch from `main`.
- Use descriptive branch names:
  - `feat/<area>-<short-description>`
  - `fix/<area>-<short-description>`
  - `docs/<area>-<short-description>`

Examples:

- `feat/core-room-events`
- `fix/relay-auth-timeout`
- `docs/getting-started-quickstart`

## Commit Convention

Use Conventional Commits:

- `feat: add room reconnection backoff options`
- `fix: prevent duplicate peer leave events`
- `docs: improve transport selection guide`
- `test: add integration test for presence updates`

Recommended types:

- `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

Commit messages are validated by commitlint (`@commitlint/config-conventional`) through a Husky `commit-msg` hook.

## Pull Request Requirements

Every PR should:

1. Link to an issue or explain why no issue exists.
2. Describe what changed and why.
3. Include tests for behavior changes.
4. Update docs when API/behavior changes.
5. Pass CI checks.

CI validates each PR to `main` on Node `18` and `20` with this stage order:

1. install
2. lint
3. typecheck
4. test
5. build

### PR Checklist

- [ ] Scope is focused and minimal.
- [ ] Tests added or updated.
- [ ] Existing tests pass.
- [ ] Docs updated (if relevant).
- [ ] No unrelated changes bundled.

## Code Quality Standards

- Keep changes small and reviewable.
- Prefer explicit types over `any`.
- Maintain strict TypeScript compatibility.
- Preserve backward compatibility where possible; call out breaking changes clearly.
- Add comments only where logic is non-obvious.
- Keep import statements sorted (enforced by ESLint).
- Keep formatting consistent (enforced by Prettier).

## Local Git Hooks

Husky hooks are enabled via the `prepare` script.

- `pre-commit`: runs `pnpm lint` and `pnpm typecheck`
- `commit-msg`: runs commitlint on the commit message

If a hook fails, fix the underlying issue and retry the commit. Bypassing hooks (`--no-verify`) should be reserved for emergency cases only.

## Testing Expectations

Expected quality bar for merged changes:

- Unit tests for deterministic logic
- Integration tests for multi-peer behavior where applicable
- Reproduction test for bug fixes

Core package target:

- Coverage goal: `>= 80%` before `v1.0`

## Versioning and Releases

FlockJS uses Changesets with independent package versioning.

Contributor expectations:

1. Add a changeset (`pnpm changeset`) for any user-visible package change.
2. Include the generated `.changeset/*.md` file in your PR.

Maintainer release flow:

1. Ensure CI is green on `main`.
2. Run `pnpm version-packages` to apply version bumps and changelog updates.
3. Push a release tag (`v*`) to trigger `.github/workflows/release.yml`.
4. Release workflow validates and publishes `packages/*` to npm.

Required repository secrets for release and cache:

- `NPM_TOKEN` (required for npm publish)
- `TURBO_TEAM` (optional)
- `TURBO_TOKEN` (optional)

## Documentation Contributions

When updating docs:

- Follow `docs/STYLE_GUIDE.md`
- Prefer concise, example-first explanations
- Mark unsupported features as **Planned**
- Keep terminology consistent (`room`, `peer`, `presence`, `awareness`, `state`, `events`)

## Review and Merge Process

1. Maintainer reviews PR for correctness, scope, and clarity.
2. Feedback is addressed in follow-up commits.
3. At least one maintainer approval is required.
4. PR is merged when CI is green.

## Reporting Bugs

Use the bug report template:

- <https://github.com/erayates/flockjs/issues/new/choose>

Include:

- Environment and versions
- Reproduction steps
- Expected behavior
- Actual behavior
- Logs/errors

## Security Reports

Do not file security issues publicly. Use the workflow in [SECURITY.md](SECURITY.md).

## Related Docs

- [Support](SUPPORT.md)
- [Governance](GOVERNANCE.md)
- [Documentation style guide](docs/STYLE_GUIDE.md)
- [Project development setup](docs/project/development-setup.md)
