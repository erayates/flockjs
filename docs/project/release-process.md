# Release Process

Audience: contributors and maintainers.

## Goals

- Predictable versioning across packages
- Clear changelog communication
- Safe promotion from pre-release to stable

## Versioning Model

- Semantic Versioning intent (`major.minor.patch`)
- Pre-`v1.0` may ship frequent minor-level API adjustments
- Breaking changes must be explicitly called out in PRs and changelog

## Planned Release Workflow

1. Contributors include changeset metadata with release-relevant PRs.
2. CI validates lint, typecheck, tests, and build.
3. Maintainers review and merge release-ready changes.
4. Release PR is generated and reviewed.
5. Maintainers publish and tag release.
6. Changelog entries are finalized.

## Pre-Release and Stable Strategy

- Use pre-release tags to validate significant API changes.
- Promote to stable after testing and compatibility checks.

## Release Checklist

- [ ] CI green
- [ ] Changelog updated
- [ ] Docs updated for API changes
- [ ] Breaking changes explicitly documented
- [ ] Security notes included where relevant

## Related Docs

- [Changelog](../../CHANGELOG.md)
- [Execution plan](execution-plan.md)
- [Development setup](development-setup.md)
- [Docs index](../README.md)
