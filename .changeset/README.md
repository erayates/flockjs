# Changesets

FlockJS uses [Changesets](https://github.com/changesets/changesets) for package versioning and release publishing.

## Scope

- Publishable: `packages/*` (`@flockjs/*`)
- Internal only: `apps/*` (`@flockjs/app-*`)

## Contributor Workflow

1. Create a changeset for release-relevant changes:

```bash
pnpm changeset
```

2. Include the generated file under `.changeset/` in your PR.
3. Maintainers run versioning and publish during release:

```bash
pnpm version-packages
pnpm release
```

## Notes

- Versioning mode is independent per package.
- The base branch for release calculations is `main`.
