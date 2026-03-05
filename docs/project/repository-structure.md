# Repository Structure

Audience: contributors.

This is the planned monorepo structure for FlockJS.

```text
flockjs/
├── packages/
│   ├── core/         # Transport, room lifecycle, engines
│   ├── react/        # React provider and hooks
│   ├── vue/          # Vue plugin and composables
│   ├── svelte/       # Svelte stores/actions
│   ├── cursors/      # Prebuilt collaboration UI components
│   ├── relay/        # Self-hosted relay server
│   └── devtools/     # Developer diagnostics tooling
├── apps/
│   ├── docs/         # Documentation application (future phase)
│   ├── demo/         # Interactive showcase app
│   └── playground/   # API exploration environment
├── examples/
│   ├── collaborative-editor/
│   ├── shared-canvas/
│   ├── live-dashboard/
│   └── multiplayer-game/
└── benchmarks/       # Latency, memory, and scaling benchmarks
```

## Responsibilities by Area

- `packages/core`: source of truth for shared protocol and engine contracts
- `packages/* adapters`: framework-specific integration boundaries
- `packages/relay`: scaling path for larger rooms
- `examples/`: runnable reference integrations
- `benchmarks/`: performance regression visibility

## Related Docs

- [Development setup](development-setup.md)
- [Execution plan](execution-plan.md)
- [Release process](release-process.md)
- [Docs index](../README.md)
