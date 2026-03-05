# Installation

Audience: users.

## Requirements

### Browser runtime

- Chrome/Chromium 80+
- Firefox 75+
- Safari 14+
- Edge 80+

### Tooling

- Node.js 18+
- npm or pnpm

## Packages

Install only what you need.

```bash
# Core SDK (required)
npm install @flockjs/core

# Framework adapters (optional)
npm install @flockjs/react
npm install @flockjs/vue
npm install @flockjs/svelte

# Prebuilt collaboration UI (optional)
npm install @flockjs/cursors

# Self-hosted relay server (optional)
npm install @flockjs/relay
```

## Environment Constraints

- WebRTC-based collaboration depends on browser support and network policy.
- Cross-network sessions need STUN/TURN configuration for production.
- SSR/Node environments can document configuration but cannot run browser WebRTC transport directly.

## Versioning Note

The project is pre-`v1.0`. Verify package versions and release notes before adopting APIs in production.

## Related Docs

- [Quickstart](quickstart.md)
- [Rooms and transports](rooms-and-transports.md)
- [Core API](../reference/core-api.md)
- [Docs index](../README.md)
