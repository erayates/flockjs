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
3. Release PR automation runs on `main` and prepares version/changelog updates:

```bash
pnpm version-packages
```

4. Maintainers merge the release PR and publish with the tag workflow:

```bash
pnpm release
```

## Notes

- Versioning mode is independent per package.
- The base branch for release calculations is `main`.
- Package `CHANGELOG.md` files are generated when `pnpm version-packages` runs.
- Publish is handled by `.github/workflows/release.yml` on `v*` tags.
