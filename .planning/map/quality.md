# Quality Analysis

**Analysis Date:** 2026-03-06

---

## Test Frameworks & Configuration

### Unit Tests — Vitest
- **Runner:** Vitest `^4.0.18`
- **Environment:** jsdom (via `vitest.config.ts`)
- **Globals:** enabled (`globals: true`)
- **Setup file:** `vitest.setup.ts` — imports `@testing-library/jest-dom` only
- **Config:** `vitest.config.ts`
- **Include pattern:** `lib/**/*.test.ts`, `hooks/**/*.test.ts`, `context/**/*.test.ts`
- **Assertion extras:** `@testing-library/jest-dom`, `@testing-library/react`, `@testing-library/user-event` installed but not yet used in any test
- **Path alias:** `@/` resolved to project root

```bash
npm run test:unit   # vitest run
npm run test:ui     # vitest --ui
```

### E2E Tests — Playwright
- **Runner:** `@playwright/test ^1.58.2`
- **Config:** `playwright.config.ts`
- **Test directory:** `e2e/`
- **Browser:** Chromium only (`Desktop Chrome`)
- **Parallelism:** disabled (`fullyParallel: false`, `workers: 1`)
- **Retries:** 0 locally, 2 in CI
- **Web server:** auto-starts `npm run dev` at `http://localhost:3000`, reuses if already running
- **Test mode env var:** `TEST_MODE=true` injected for shorter timers

```bash
npm run test:e2e    # playwright test
npm run test        # vitest run && playwright test
```

---

## Test Coverage by Module

### Tested

| Module | Test File(s) | Coverage Areas |
|--------|-------------|----------------|
| `lib/game-engine.ts` | `lib/game-engine.test.ts` | Party creation, joining, role assignment, settings validation, leader transfer |
| `lib/game-engine.ts` | `lib/game-engine.round.test.ts` | Voting flow, phase transitions, dead player handling, crew win condition |
| `lib/game-engine.ts` | `lib/game-engine.consensus.test.ts` | Kick logic, continue/lobby vote consensus |
| App UI (Playwright) | `e2e/party-flow.spec.ts` | Hub navigation, party create/join, settings sync, disband, leave flow |

### Not Tested

| Module | Risk |
|--------|------|
| `context/game-context.tsx` | HIGH — core Socket.io client state machine; all socket events, reconnection, roleInfo, persistence logic untested |
| `hooks/use-game.ts` | LOW — thin wrapper (`useGameStore()`); trivial |
| `lib/game-data.ts` | LOW — static data array; no logic |
| `lib/types.ts` | N/A — types only |
| `server.ts` | HIGH — Socket.io event handlers, `getSafeState`, game loop tick, `start_game` validation, party cleanup all untested |
| `app/page.tsx` | MEDIUM — form logic, double-click protection, `handleCreate`/`handleJoin` untested |
| `app/party/[code]/page.tsx` | MEDIUM — party page render logic, phase-based UI switching untested |

---

## Testing Strategy

### Unit Tests (Vitest)
- **Scope:** Pure logic in `lib/game-engine.ts` — state machine tested directly without any mocking
- **Pattern:** `describe` → `beforeEach` (fresh `GameEngine` instance) → `it` assertions
- **TEST_MODE:** `process.env.TEST_MODE = 'true'` used in setup to shorten timer values (countdown 1s vs 5s, round 10s vs 120s), enabling timer-based phase transitions to be tested synchronously via `engine.tick()`
- **No mocking** of Date, timers, or external modules — tests directly mutate party state then call `engine.tick()`
- No component rendering tests exist despite `@testing-library/react` being installed

### E2E Tests (Playwright)
- **Scope:** Full browser flows — two-page multi-context scenarios (leader + joiner)
- **Pattern:** `test.describe` → sequential `test` blocks; each test boots a fresh context for the joiner
- **Assertions:** DOM visibility, URL patterns, text content, `data-testid` locators
- **Gaps:** No game-loop phases tested (COUNTDOWN → REVEAL → ROUND → VOTE → RESULTS), no reconnection scenario, no mobile viewport tests despite `TESTING.md` calling for them

### Integration Tests
- **None.** No tests exercise the Socket.io server together with the game engine. Server event handlers in `server.ts` are untested.

---

## Code Style Consistency

### Formatting
- **No Prettier config detected** (`.prettierrc`, `.prettierrc.json`, etc. absent)
- Code is consistently formatted but enforcement is manual/editor-dependent

### Linting (ESLint)
- **Config:** `eslint.config.mjs` using ESLint flat config (`defineConfig`)
- **Rule sets:** `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`
- **Ignores:** `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- No additional custom rules or overrides

```bash
npm run lint   # eslint
```

### Import Style
- Path alias `@/` used consistently for cross-module imports
- Imports are ungrouped (no enforced order between external/internal)

### Naming Conventions
- Files: kebab-case (`game-engine.ts`, `game-context.tsx`, `use-game.ts`)
- Types/Interfaces: PascalCase (`GamePhase`, `Player`, `Party`)
- Functions/methods: camelCase (`createParty`, `votePlayer`)
- Constants: UPPER_SNAKE_CASE (`MISSION_DATABASE`, `DISCONNECT_GRACE`)
- React components: PascalCase (`GameProvider`, `Home`)
- `data-testid` attributes: kebab-case (`game-imposter`, `input-name`, `btn-leave`)

---

## TypeScript Strictness

- **`strict: true`** enabled in `tsconfig.json` — covers `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.
- **`skipLibCheck: true`** — type errors in `.d.ts` files ignored
- **`noEmit: true`** — TypeScript is type-check only; transpilation done by Next.js / tsx

### `any` Usage (source files only)

| File | Location | Issue |
|------|----------|-------|
| `server.ts` | `getSafeState(party: any, ...)` and `.map((p: any) => ...)` | Party/Player not typed at server boundary |
| `server.ts` | `io.to(result.party.code).emit('vote:passed' as any)` | Event name cast to bypass Socket.io type check |
| `next.config.ts` | `} as any` | Config object cast |
| `lib/game-engine.ts` | `addMessage()` return type `any`, `addSystemMessage()` return type `any` | Return types not tightened |

These are the only `any` occurrences in source files. No `@ts-ignore` or `eslint-disable` directives exist in source files.

---

## Known Gaps & Recommendations

### Critical Gaps
1. **`server.ts` has zero test coverage** — the Socket.io event handler layer (join, start game, vote, kick, disband, tick loop) is tested only via slow Playwright E2E flows; no unit or integration tests
2. **`context/game-context.tsx` has zero test coverage** — reconnection logic, `roleInfo` assignment, localStorage/sessionStorage persistence, and all 10+ socket event callbacks are untested
3. **No integration test layer** — nothing tests `server.ts` + `GameEngine` together without a real browser

### Test Coverage Gaps (from `TESTING.md` manual checklist)
- Grace period / reconnection behaviour (30s disconnect window) — untested
- Double-click protection — untested
- Timer colour change (red in final 30s) — untested
- Mobile viewport (max 448px) — untested
- Socket.io server cleanup of empty rooms after 1 hour — untested

### Style / Quality Gaps
- No formatter enforced — formatting consistency relies on editor settings
- `any` in `server.ts` bypasses type safety at the Socket.io event layer
- `addMessage` and `addSystemMessage` in `lib/game-engine.ts` have untyped return values
- No coverage thresholds configured in `vitest.config.ts`
- Vitest `include` pattern lists `context/**/*.test.ts` but the context directory has no test file
