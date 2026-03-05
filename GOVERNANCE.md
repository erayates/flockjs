# Governance

## Purpose

This document defines how technical and project decisions are made in FlockJS.

## Governance Model

FlockJS currently follows a **maintainer-led** model.

- Maintainers curate roadmap priorities.
- Contributors propose changes through issues and pull requests.
- Decisions are documented in issues, PRs, and project docs.

## Roles

### Maintainers

Maintainers are responsible for:

- Reviewing and merging pull requests
- Maintaining quality and release standards
- Managing issue triage and roadmap alignment
- Enforcing the Code of Conduct
- Handling security triage and disclosure coordination

### Contributors

Contributors are responsible for:

- Following contribution and style guidelines
- Submitting scoped, testable changes
- Participating respectfully in review and discussion

## Decision Process

1. Proposal is raised via issue/discussion/PR.
2. Maintainers review technical fit, scope, and tradeoffs.
3. Feedback is discussed publicly.
4. A maintainer records the final decision in-thread.

For high-impact changes (API shape, architecture, security model), maintainers may require an explicit design note in `docs/project/`.

## Release Stewardship

Maintainers control versioning and release cadence.

Release expectations:

- Breaking changes are clearly documented.
- Changelog entries are maintained.
- Pre-`v1.0` iterations may ship frequent API refinements.

## Conflict Resolution

If contributors disagree on technical direction:

1. Document the alternatives and tradeoffs.
2. Seek maintainer decision based on project goals.
3. If needed, split work behind feature flags or staged rollout plans.

## Inactivity and Role Changes

Maintainer access may be adjusted due to inactivity, security risk, or repeated policy violations.

## Related Docs

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Execution plan](docs/project/execution-plan.md)
