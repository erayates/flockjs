# FlockJS

Real-time collaboration primitives for the web.

FlockJS is an open-source, framework-agnostic SDK designed to help frontend teams add multiplayer collaboration features without building custom realtime infrastructure from scratch.

## Project Status

FlockJS is currently in **early development** and this repository is building toward a production-ready `v1.0`.

- API contracts in this repo are the current canonical direction.
- Some packages and features documented here are **planned** and not fully implemented yet.
- Breaking changes are expected before `v1.0`.

## Why FlockJS

Building collaboration features usually requires you to stitch together transport, peer lifecycle, presence state, conflict resolution, and reconnection behavior. FlockJS focuses on delivering these as composable primitives:

- `room` lifecycle and peer registry
- `presence` for who is online and what they are doing
- `cursors` for live pointer positions
- `state` for synchronized shared data
- `awareness` for ephemeral UI context
- `events` for fire-and-forget signals

## Feature Overview

| Area | Description | Status |
|---|---|---|
| Core room lifecycle | `createRoom`, connect/disconnect, peer events | Planned |
| Presence engine | peer metadata, subscriptions, updates | Planned |
| Cursor engine | pointer sync, rendering helpers | Planned |
| Shared state engine | `lww`, `crdt`, `custom` merge strategies | Planned |
| Awareness engine | transient focus/typing/selection state | Planned |
| Event engine | ephemeral room and peer-targeted events | Planned |
| React adapter | provider + hooks API | Planned |
| Vue adapter | plugin + composables | Planned |
| Svelte adapter | stores + actions | Planned |
| Relay server | optional WebSocket relay for scale | Planned |
| Prebuilt UI kit | cursors/presence/typing components | Planned |

## Quick Start (Planned API)

```bash
npm install @flockjs/core
```

```ts
import { createRoom } from '@flockjs/core';

const room = createRoom('my-first-room', {
  transport: 'auto',
  presence: { name: 'Alice', color: '#4F46E5' },
});

await room.connect();

const presence = room.usePresence();
presence.subscribe((peers) => {
  console.log('Peers in room:', peers.length);
});

window.addEventListener('beforeunload', () => {
  void room.disconnect();
});
```

## Package Matrix

| Package | Purpose | Status |
|---|---|---|
| `@flockjs/core` | room, transports, collaboration engines | Planned |
| `@flockjs/react` | React provider/hooks | Planned |
| `@flockjs/vue` | Vue plugin/composables | Planned |
| `@flockjs/svelte` | Svelte store/action integration | Planned |
| `@flockjs/cursors` | prebuilt collaboration UI components | Planned |
| `@flockjs/relay` | self-hosted relay server | Planned |
| `@flockjs/devtools` | debugging and diagnostics tooling | Planned |

## Documentation

- [Documentation index](docs/README.md)
- [Installation](docs/getting-started/installation.md)
- [Quickstart](docs/getting-started/quickstart.md)
- [Core API reference](docs/reference/core-api.md)
- [Contributing guide](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)

## Monorepo Setup

Issue `EP-01 #001` scaffolds this repository as a `pnpm` + `turborepo` monorepo with buildable package stubs.

### Prerequisites

- Node.js `20` (pinned via `.nvmrc` and `.node-version`)
- `pnpm`

### Install and Validate

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

### Workspace Layout

- `packages/*`: core SDK and adapters (`@flockjs/*`)
- `apps/*`: internal applications
- `examples/*`: placeholder examples for future implementation
- `benchmarks/`: placeholder benchmark suite

## Development Direction

Project execution is tracked across 6 sprints and 9 epics:

- Foundation and repository setup
- Core transport and room lifecycle
- Collaboration engines
- Framework adapters and relay
- Advanced capabilities and DX
- Docs, testing, and launch

Details: [Execution plan](docs/project/execution-plan.md)

## Community and Contribution

- File bugs: <https://github.com/erayates/flockjs/issues>
- Start discussions: <https://github.com/erayates/flockjs/discussions>
- Contribute: [CONTRIBUTING.md](CONTRIBUTING.md)
- Community conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Security

Please do not disclose vulnerabilities in public issues. Use the process in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
