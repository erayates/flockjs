# Documentation Style Guide

Audience: contributors.

## Purpose

Ensure FlockJS docs are consistent, accurate, and easy to maintain.

## Core Rules

1. Use precise, technical language.
2. Prefer short sections and concrete examples.
3. Mark non-implemented behavior as **Planned**.
4. Keep terminology consistent:
   - `room`
   - `peer`
   - `presence`
   - `cursors`
   - `state`
   - `awareness`
   - `events`
5. Avoid speculative claims or unverified external channels.
6. End each doc with a `Related docs` section and include `docs/README.md`.

## Audience Tag

Every page must include an explicit `Audience:` line near the top.

## Code Snippet Standards

- Prefer TypeScript snippets.
- Keep examples minimal but runnable in concept.
- Include import lines for non-trivial snippets.
- Avoid pseudocode when concrete code is feasible.

## API Documentation Standards

- Define function signatures first.
- Document option types and defaults.
- Include at least one usage example.
- Add failure-mode or constraint notes for sensitive behavior.

## Contributor Documentation Standards

- Use numbered lists for workflows.
- Separate policy from implementation details.
- Keep repository links canonical to `erayates/flockjs`.

## Related Docs

- [Docs index](README.md)
- [Contributing](../CONTRIBUTING.md)
- [Execution plan](project/execution-plan.md)
