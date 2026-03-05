# Code Quality Guidelines

> **Context:** FlockJS is a framework-agnostic, zero-backend, open-source TypeScript library.  
> It runs in Chrome 80+, Firefox 75+, Safari 14+, and Node.js 18+ (limited).  
> These rules are different from application-level guidelines — library code has stricter constraints.

**Last updated:** 2026  
**Stack:** Pure TypeScript · WebRTC · BroadcastChannel · WebSocket · MIT License

---

## Table of Contents

1. [Library vs Application — The Key Difference](#1-library-vs-application--the-key-difference)
2. [TypeScript Configuration](#2-typescript-configuration)
3. [Dependency Rules](#3-dependency-rules)
4. [Type System Rules](#4-type-system-rules)
5. [Trust Boundaries & Validation](#5-trust-boundaries--validation)
6. [Environment & API Availability](#6-environment--api-availability)
7. [Bundle & Performance Rules](#7-bundle--performance-rules)
8. [Public API Design Rules](#8-public-api-design-rules)
9. [Error Handling Rules](#9-error-handling-rules)
10. [Async Rules](#10-async-rules)
11. [ESLint Configuration](#11-eslint-configuration)
12. [AI Code Agent Rules](#12-ai-code-agent-rules)
13. [Code Review Checklist](#13-code-review-checklist)

---

## 1. Library vs Application — The Key Difference

Most TypeScript guidelines are written for applications. FlockJS is a library. The constraints are fundamentally different.

| Concern | Application (e.g. Zyora) | Library (FlockJS core) |
|---|---|---|
| Hard dependencies | Fine — you control the stack | Forbidden — you ship into unknown stacks |
| Bundle size | Managed at app level | Every byte is your user's problem |
| Target environment | Known — Next.js 14+ / Node 20+ | Unknown — Safari 14, Node 18, Chrome 80 |
| Zod | Use it | Do not add as dependency to core |
| `typeof window` guards | Forbidden — environment is known | Sometimes required — environment is unknown |
| Error messages | Internal, terse | Public API — must be developer-friendly |
| Breaking changes | Team decides | Semantic versioning contract with the world |

**The core rule for a library:** Never make your users pay for decisions they didn't make. No surprise bundle weight. No forced dependency upgrades. No runtime assumptions about the environment.

---

## 2. TypeScript Configuration

### `tsconfig.json` — Core Package

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2019",
    "lib": ["ES2019", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true
  }
}
```

### Why `ES2019` target?

Safari 14 is in the support matrix. ES2019 is the highest common denominator that does not require polyfills for the features FlockJS uses. Do not raise this target without checking the browser support table first.

### Why `declaration: true`?

FlockJS ships types alongside the compiled output. Users get full autocomplete and type checking without any extra setup. This is non-negotiable for a TypeScript-first library.

---

## 3. Dependency Rules

### Core Package (`@flockjs/core`) — Zero Runtime Dependencies

The core package must have **zero `dependencies`** in `package.json`. Every external package you add becomes mandatory weight in every user's bundle.

```json
// package.json — @flockjs/core
{
  "dependencies": {},       // ← must stay empty
  "peerDependencies": {},   // ← optional, for framework adapters only
  "devDependencies": {
    "typescript": "...",
    "vitest": "...",
    "tsup": "..."
    // dev tooling only — never reaches users
  }
}
```

**No Zod in core.** Validate with manual type guards (see Section 5). The relay server (`@flockjs/relay`) runs on Node.js where bundle size is irrelevant — Zod is fine there.

### Framework Adapters (`@flockjs/react`, `@flockjs/vue`, `@flockjs/svelte`)

Framework packages declare the framework as a `peerDependency`, not a `dependency`. Users already have React/Vue/Svelte installed — don't ship a second copy.

```json
// package.json — @flockjs/react
{
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  },
  "dependencies": {
    "@flockjs/core": "workspace:*"
  }
}
```

### Relay Server (`@flockjs/relay`) — Node.js Only

The relay server is a standalone Node.js process. Bundle size is irrelevant. Zod, structured logging, and other server utilities are welcome here.

```json
// package.json — @flockjs/relay
{
  "dependencies": {
    "zod": "^3.0.0",
    "ws": "^8.0.0"
  }
}
```

---

## 4. Type System Rules

### 4.1 Never Use `any`

`any` in a library is worse than in an application — it leaks into every user's codebase through the type definitions you ship.

```typescript
// ❌ FORBIDDEN
function emit(event: string, data: any): void { ... }
const peers: any[] = [];

// ✅ CORRECT — generic or unknown
function emit<T = unknown>(event: string, data: T): void { ... }
const peers: Peer[] = [];
```

### 4.2 Never Use `as` Type Assertions to Silence Errors

Type assertions bypass the compiler. In library code they introduce silent runtime bugs that are very hard for users to debug.

```typescript
// ❌ FORBIDDEN — casting unknown without validating
const presence = data as PresenceData;

// ❌ FORBIDDEN — as inside type guard before narrowing
function isPresenceData(data: unknown): data is PresenceData {
  return typeof (data as Record<string, unknown>).id === 'string'; // as on unknown
}

// ✅ CORRECT — narrow step by step, no as needed
function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

function isPresenceData(data: unknown): data is PresenceData {
  if (!isObject(data)) return false;
  return (
    typeof data['id'] === 'string' &&
    typeof data['joinedAt'] === 'number' &&
    typeof data['lastSeen'] === 'number'
  );
}
```

### 4.3 Non-null Assertion `!` — Forbidden Outside Tests

```typescript
// ❌ FORBIDDEN
const peer = this.peers.get(peerId)!;

// ✅ CORRECT — handle the nullable case explicitly
const peer = this.peers.get(peerId);
if (!peer) {
  this.emit('error', new FlockError('PEER_NOT_FOUND', `No peer with id: ${peerId}`));
  return;
}
```

### 4.4 Redundant Type Annotations

Let inference work for local values. Annotate public API return types explicitly — they are the published contract.

```typescript
// ❌ UNNECESSARY — inference handles these
const count: number = 0;
const connected: boolean = false;

// ✅ CORRECT — annotate public API surface
export function createRoom(roomId: string, options?: RoomOptions): Room { ... }
export class Room {
  connect(): Promise<void> { ... }
  disconnect(): Promise<void> { ... }
  on(event: string, handler: EventHandler): Unsubscribe { ... }
}
```

---

## 5. Trust Boundaries & Validation

FlockJS has two real trust boundaries. Everything that crosses them is `unknown` and must be validated before use. Everything inside the library, typed by TypeScript, must never be defensively re-checked.

```
┌─────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 1 — WebRTC DataChannel              │
│  peer.on('message', (raw) => ...)  ← unknown        │
│  → Validate here with type guard                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 2 — WebSocket Relay                 │
│  ws.on('message', (raw) => ...)  ← unknown          │
│  → Validate here. Relay server can use Zod.         │
└─────────────────────────────────────────────────────┘

         ↓ typed, validated
┌─────────────────────────────────────────────────────┐
│  FLOCKJS INTERNALS — fully typed                    │
│  Do NOT re-check types here.                        │
│  TypeScript guarantees them.                        │
└─────────────────────────────────────────────────────┘
```

### 5.1 Validation Pattern for Core (No Zod)

Build a shared `isObject` primitive and compose all type guards from it. No `as` assertions.

```typescript
// src/internal/guards.ts

// Foundation — reuse everywhere
export function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

// Compose specific guards on top
export function isPresenceData(data: unknown): data is PresenceData {
  if (!isObject(data)) return false;
  return (
    typeof data['id'] === 'string' &&
    typeof data['joinedAt'] === 'number' &&
    typeof data['lastSeen'] === 'number'
  );
}

export function isCursorPosition(data: unknown): data is CursorPosition {
  if (!isObject(data)) return false;
  return (
    typeof data['x'] === 'number' &&
    typeof data['y'] === 'number' &&
    typeof data['userId'] === 'string'
  );
}

export function isFlockMessage(data: unknown): data is FlockMessage {
  if (!isObject(data)) return false;
  return (
    typeof data['type'] === 'string' &&
    typeof data['peerId'] === 'string'
  );
}
```

```typescript
// Usage — validate at the DataChannel boundary, trust downstream
channel.onmessage = (event: MessageEvent) => {
  let raw: unknown;
  try {
    raw = JSON.parse(event.data as string);
  } catch {
    this.log('warn', 'Received non-JSON message from peer, ignoring.');
    return;
  }

  if (!isFlockMessage(raw)) {
    this.log('warn', 'Received malformed FlockMessage, ignoring.', raw);
    return;
  }

  // raw is FlockMessage from here on — no more checks needed downstream
  this.handleMessage(raw);
};
```

### 5.2 Validation Pattern for Relay Server (Zod OK)

```typescript
// @flockjs/relay — Node.js, Zod is fine
import { z } from 'zod';

const JoinMessageSchema = z.object({
  type:     z.literal('join'),
  roomId:   z.string().min(1).max(200),
  peerId:   z.string().uuid(),
  presence: z.record(z.unknown()).optional(),
});

const RelayMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  LeaveMessageSchema,
  BroadcastMessageSchema,
]);

ws.on('message', (raw: Buffer) => {
  const result = RelayMessageSchema.safeParse(JSON.parse(raw.toString()));
  if (!result.success) {
    ws.send(JSON.stringify({ error: 'Invalid message format' }));
    return;
  }
  handleMessage(result.data); // fully typed from here
});
```

### 5.3 Never Validate Typed Internal Values

Inside the library, once data has been validated at the boundary, do not re-check it.

```typescript
// ❌ FORBIDDEN — presence is typed as PresenceData, TS guarantees it
function broadcastPresence(presence: PresenceData): void {
  if (typeof presence.id === 'string') { ... }  // redundant
  if (presence !== null && presence !== undefined) { ... }  // redundant
}

// ✅ CORRECT — trust the type
function broadcastPresence(presence: PresenceData): void {
  this.broadcast({ type: 'presence', payload: presence });
}
```

---

## 6. Environment & API Availability

Unlike Zyora (known Next.js + Node 20+ stack), FlockJS runs in genuinely unknown environments. Browser guards are sometimes required — but must be precise and documented.

### APIs That Are Guaranteed Across the Full Support Matrix

```typescript
// ✅ Safe to use without guards in all supported environments
JSON.parse() / JSON.stringify()
Promise
Array.from()
Object.entries() / Object.keys() / Object.values()
Map / Set
Symbol
typeof / instanceof
addEventListener / removeEventListener  // browser only, guard before use
```

### APIs That Require Environment Checks

```typescript
// ✅ CORRECT — guard with a comment explaining why
const isSSR = typeof window === 'undefined';
// Node.js 18 (SSR) supports BroadcastChannel but not WebRTC.
// Guard is required because the support matrix includes both environments.
if (!isSSR) {
  this.transport = new WebRTCTransport(options);
} else {
  this.transport = new BroadcastChannelTransport(options);
}
```

```typescript
// src/internal/env.ts — centralize all environment detection
export const env = {
  isBrowser:          typeof window !== 'undefined',
  hasWebRTC:          typeof RTCPeerConnection !== 'undefined',
  hasBroadcastChannel: typeof BroadcastChannel !== 'undefined',
  hasWebCrypto:       typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
} as const;
```

Then use `env.*` everywhere. This is the single source of truth — not scattered inline `typeof` checks.

### `crypto.randomUUID()` — Requires a Guard in FlockJS

Unlike in Zyora (Node 20+ guaranteed), FlockJS targets Node 18 and Safari 14 where `crypto.randomUUID()` may not exist.

```typescript
// ❌ WRONG for FlockJS — randomUUID is not available everywhere in the support matrix
const id = crypto.randomUUID();

// ✅ CORRECT for FlockJS — polyfill inline or detect
function generatePeerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID (Node 18, older Safari)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
```

This is one of the few legitimate uses of an environment guard in FlockJS — and it is centralized in one place, not scattered across the codebase.

---

## 7. Bundle & Performance Rules

### 7.1 No Side Effects at Import Time

Library code must not execute anything when imported. All work happens inside function calls, not at the module's top level.

```typescript
// ❌ FORBIDDEN — executes on import
const defaultRoom = createRoom('default');  // side effect at module level
console.log('FlockJS loaded');             // side effect at module level

// ✅ CORRECT — export functions/classes, nothing executes until called
export { createRoom } from './room';
export type { Room, RoomOptions } from './types';
```

Also add `"sideEffects": false` to `package.json` so bundlers can tree-shake aggressively.

```json
{
  "sideEffects": false
}
```

### 7.2 Named Exports Only — No Default Exports

Default exports break tree-shaking in some bundlers and make refactoring harder.

```typescript
// ❌ FORBIDDEN
export default class Room { ... }
export default function createRoom() { ... }

// ✅ CORRECT
export class Room { ... }
export function createRoom() { ... }
```

### 7.3 Avoid Large Internal Dependencies

Before pulling in any utility (lodash, ramda, etc.), write the function. For a zero-dependency library, one `clamp(n, min, max)` function is better than shipping an entire utility library.

```typescript
// ❌ FORBIDDEN
import clamp from 'lodash/clamp';

// ✅ CORRECT — 1 line, zero cost
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
```

---

## 8. Public API Design Rules

### 8.1 Never Break the Public API Without a Major Version

Every exported type, function signature, and class method is a contract with every FlockJS user. Changing a parameter type, removing an option, or renaming an event is a **breaking change**.

| Change | Version bump required |
|---|---|
| Add optional parameter | Minor |
| Add new export | Minor |
| Change parameter type | **Major** |
| Remove export or option | **Major** |
| Rename event string | **Major** |
| Change return type | **Major** |

### 8.2 Options Objects Over Positional Parameters

Positional parameters beyond two are hard to use and impossible to extend without breaking changes.

```typescript
// ❌ FRAGILE — adding a third param is a breaking change
function createRoom(roomId: string, transport: Transport, maxPeers: number): Room

// ✅ EXTENSIBLE — options object, new fields are non-breaking
function createRoom(roomId: string, options?: RoomOptions): Room
```

### 8.3 Return Unsubscribe Functions, Not Void

Every `on()` / `subscribe()` method must return a cleanup function. Users of the library are responsible for their own cleanup — make it easy.

```typescript
// ❌ — user has no way to clean up
room.on('peer:join', handler): void

// ✅ — unsubscribe is returned directly
const unsubscribe = room.on('peer:join', handler);
// ...
unsubscribe(); // clean up
```

### 8.4 Generic State Engine — Users Bring Their Types

The `useState()` and `useEvents()` APIs accept user-defined types. Design them to be generic so users get full type inference without casting.

```typescript
// ✅ CORRECT — user's type flows through without any assertion
const state = room.useState<{ count: number; selectedId: string | null }>({
  initialValue: { count: 0, selectedId: null },
  strategy: 'last-write-wins',
});

const value = state.get(); // inferred as { count: number; selectedId: string | null }
```

---

## 9. Error Handling Rules

### 9.1 Typed Error Class

All errors thrown by FlockJS must be instances of `FlockError` with a typed code. This allows users to handle specific error cases programmatically.

```typescript
// src/errors.ts
export type FlockErrorCode =
  | 'ROOM_FULL'
  | 'CONNECTION_FAILED'
  | 'PEER_NOT_FOUND'
  | 'INVALID_STATE'
  | 'ENCRYPTION_FAILED'
  | 'RELAY_UNAVAILABLE';

export class FlockError extends Error {
  readonly code: FlockErrorCode;

  constructor(code: FlockErrorCode, message: string) {
    super(message);
    this.name = 'FlockError';
    this.code = code;
  }
}

// Usage — users can handle specific codes
room.on('error', (err) => {
  if (err instanceof FlockError && err.code === 'ROOM_FULL') {
    showRoomFullDialog();
  }
});
```

### 9.2 Never Throw in Event Callbacks

Library event callbacks run in user code. An uncaught throw crashes the user's application silently. Wrap callback invocations.

```typescript
// ❌ DANGEROUS — user callback crash propagates
this.handlers.get('peer:join')?.forEach(handler => handler(peer));

// ✅ CORRECT — isolate user callback errors
this.handlers.get('peer:join')?.forEach(handler => {
  try {
    handler(peer);
  } catch (err) {
    this.log('error', 'Uncaught error in peer:join handler', err);
  }
});
```

### 9.3 Developer-Friendly Error Messages

Errors in a library are read by other developers. Include context.

```typescript
// ❌ UNHELPFUL
throw new FlockError('INVALID_STATE', 'Invalid state');

// ✅ HELPFUL
throw new FlockError(
  'INVALID_STATE',
  `Cannot call room.connect() when status is '${this.status}'. ` +
  `Call room.disconnect() first, then reconnect.`
);
```

---

## 10. Async Rules

### 10.1 `forEach` with `async` — Forbidden

```typescript
// ❌ FORBIDDEN — promises discarded, errors silently lost
peers.forEach(async (peer) => {
  await peer.sendMessage(payload);
});

// ✅ CORRECT — sequential
for (const peer of peers) {
  await peer.sendMessage(payload);
}

// ✅ CORRECT — parallel
await Promise.all(peers.map(peer => peer.sendMessage(payload)));
```

### 10.2 Unhandled Promise Rejections

```typescript
// ❌ FORBIDDEN
peer.channel.send(data); // send() may return a Promise in some environments

// ✅ CORRECT
void peer.channel.send(data); // explicit fire-and-forget
// or
await peer.channel.send(data);
```

### 10.3 AbortController for Cancellable Operations

Internal async flows that can be interrupted (reconnect loops, peer discovery) must support cancellation.

```typescript
class ReconnectManager {
  private abortController: AbortController | null = null;

  async start(signal: AbortSignal): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal.aborted) return;
      await this.tryConnect();
      if (signal.aborted) return;
      await delay(this.backoffMs * attempt, signal);
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
```

### 10.4 Never Mix `async/await` and `.then()`

```typescript
// ❌ FORBIDDEN
async function connect() {
  return await this.transport.open()
    .then(() => this.startHeartbeat())
    .then(() => this.emit('connected'));
}

// ✅ CORRECT
async function connect(): Promise<void> {
  await this.transport.open();
  this.startHeartbeat();
  this.emit('connected');
}
```

---

## 11. ESLint Configuration

```javascript
// eslint.config.js
import tseslint from '@typescript-eslint/eslint-plugin';

export default [
  {
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // Type system
      '@typescript-eslint/no-explicit-any':              'error',
      '@typescript-eslint/no-unsafe-assignment':         'error',
      '@typescript-eslint/no-unsafe-member-access':      'error',
      '@typescript-eslint/no-unsafe-call':               'error',
      '@typescript-eslint/no-unsafe-return':             'error',
      '@typescript-eslint/no-non-null-assertion':        'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition':     'error',

      // Public API discipline
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],

      // Async correctness
      '@typescript-eslint/no-floating-promises':  'error',
      '@typescript-eslint/await-thenable':        'error',
      '@typescript-eslint/no-misused-promises':   'error',

      // Dead code
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'error', // use internal logger, not console
    }
  }
];
```

---

## 12. AI Code Agent Rules

> Paste this block into `.claude/CLAUDE.md` for FlockJS development.

```
FLOCKJS LIBRARY CODE RULES
============================

CONTEXT
────────
FlockJS is a zero-dependency, framework-agnostic TypeScript library.
It is NOT an application. Application-level rules (Next.js, NestJS, Zod in core)
do NOT apply here.

Support matrix: Chrome 80+, Firefox 75+, Safari 14+, Node.js 18+ (limited).

DEPENDENCIES — ABSOLUTE RULES
───────────────────────────────
- @flockjs/core → zero runtime dependencies. Period.
- @flockjs/react/vue/svelte → framework as peerDependency only.
- @flockjs/relay → Node.js only, Zod and ws are fine here.
- Never add a dependency to core without explicit team discussion.

TYPE SYSTEM
────────────
- Never use `any`. Use generics or `unknown`.
- Never use `!` non-null assertion outside test files.
- Never use `as` to silence errors — fix the type.
- Never use `as` inside type guards on `unknown` values.
  Correct pattern: narrow with isObject() first, then access fields without assertion.

TRUST BOUNDARIES
─────────────────
There are exactly two trust boundaries in FlockJS core:
  1. WebRTC DataChannel onmessage → unknown → validate with isObject() guards
  2. WebSocket relay message     → unknown → validate with isObject() guards
     (relay server can use Zod instead)

Inside the library, TypeScript types are trusted. Never re-check them.

ENVIRONMENT GUARDS
──────────────────
FlockJS targets Safari 14 and Node 18 — environment guards ARE sometimes required.
Rules:
  - All environment detection lives in src/internal/env.ts
  - Use env.hasWebRTC, env.isBrowser, etc. — never inline typeof checks
  - crypto.randomUUID() needs a fallback — Safari 14 and Node 18 don't have it
  - Document every guard with a comment explaining which environment requires it

DO NOT write environment guards for APIs that are universally available:
  JSON, Promise, Array.from, Map, Set, Object.entries

BUNDLE DISCIPLINE
──────────────────
- No side effects at module level — nothing executes on import
- Named exports only — no default exports
- sideEffects: false in package.json
- Never import from lodash or any utility library — write the 1-line function

PUBLIC API
───────────
- Options objects over positional parameters (beyond 2)
- Every on()/subscribe() must return an unsubscribe function
- State/event APIs must be generic — user types flow through without casting
- Adding a required parameter or changing a type = breaking change = major version bump

ERROR HANDLING
───────────────
- All thrown errors must be instances of FlockError with a typed code
- Wrap user callback invocations in try/catch — never let user errors propagate
- Error messages must include context (current state, what to do instead)

ASYNC
──────
- Never use forEach with async callbacks
- Run independent operations in parallel with Promise.all
- Use AbortController for cancellable loops (reconnect, discovery)
- Never mix async/await and .then() in the same function

WHEN IN DOUBT
─────────────
- Is this data from a DataChannel or WebSocket? → validate with isObject() guards
- Is this TypeScript-typed internal data? → trust it, don't check it
- Does this environment check belong in env.ts? → yes, always centralize
- Would this add bytes to the user's bundle? → question whether it's necessary
```

---

## 13. Code Review Checklist

### Automated (CI)
- [ ] `tsc --noEmit` — zero errors
- [ ] `eslint --max-warnings 0` — clean
- [ ] `no-explicit-any` — no violations
- [ ] `no-non-null-assertion` — no violations
- [ ] `no-floating-promises` — no violations

### Manual Review — Dependencies
- [ ] Any new entry in `dependencies` in `@flockjs/core`? → Reject unless explicitly approved
- [ ] Framework package using `dependencies` instead of `peerDependencies`? → Fix

### Manual Review — Type System
- [ ] `as` assertion anywhere? → Is it inside a type guard on `unknown` without narrowing first?
- [ ] `any` anywhere? → Replace with `unknown` + guard or generic
- [ ] `!` non-null assertion? → Handle explicitly
- [ ] Redundant type check on an already-typed value? → Remove
- [ ] Type guard using `as` instead of `isObject()` pattern? → Rewrite

### Manual Review — Environment
- [ ] Inline `typeof window/crypto/navigator`? → Move to `env.ts`
- [ ] `crypto.randomUUID()` used without fallback? → Add fallback (Node 18, Safari 14)
- [ ] New environment assumption not in the support matrix? → Document or add a guard

### Manual Review — Public API
- [ ] New required parameter on an exported function? → Breaking change → major version
- [ ] Changed return type on a public method? → Breaking change → major version
- [ ] `on()` / `subscribe()` returning void instead of unsubscribe? → Fix
- [ ] Side effect at module top level? → Remove

### Manual Review — Errors & Async
- [ ] Error thrown with a raw `new Error()` instead of `FlockError`? → Fix
- [ ] User callback invoked without try/catch? → Wrap it
- [ ] `forEach` with `async` callback? → Replace with `for...of` or `Promise.all`
- [ ] `async/await` mixed with `.then()` in same function? → Pick one

---

## Summary Reference Card

| Situation | Action |
|---|---|
| `unknown` from DataChannel / WebSocket | `isObject()` guard → typed |
| Relay server incoming message | Zod `safeParse()` |
| TypeScript-typed internal value | Trust it — no checks |
| `crypto.randomUUID()` | Fallback required — Node 18, Safari 14 |
| `typeof window/navigator/RTCPeerConnection` | Centralize in `env.ts`, add a comment |
| JSON.parse, Promise, Array.from | No guard needed — universally available |
| Adding a runtime dependency to core | Don't. Write the function inline. |
| Changing a public API parameter type | Major version bump |
| `on()` / `subscribe()` return value | Always return unsubscribe function |
| Error to throw | `new FlockError(code, descriptive message)` |

---

*This document governs FlockJS library development. Application-level guidelines (Zyora) apply separately to apps that consume FlockJS — not to the library itself.*
