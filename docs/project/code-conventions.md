# Code Conventions

Audience: contributors.

FlockJS engineering conventions are defined in:

- [FlockJS Code Quality Guidelines](flockjs-code-quality-guidelines.md)

This guideline is the canonical source for:

- TypeScript and runtime boundary rules
- Environment guard policy for cross-runtime library code
- Dependency and bundle-discipline constraints
- Public API stability and semver expectations
- Error handling and async correctness
- ESLint and CI quality gates
- AI code agent operating rules

## Enforcement Model

1. **Automated gates** in CI and local checks enforce lint, typecheck, tests, and build.
2. **Manual review** follows the checklist in the canonical guideline.
3. If this file and the canonical guideline conflict, the guideline takes precedence.

## Related Docs

- [Contributing](../../CONTRIBUTING.md)
- [Development setup](development-setup.md)
- [Release process](release-process.md)
- [Docs index](../README.md)
