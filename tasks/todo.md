# Tasks

## Session: Tidy, Comment, Optimise (2026-03-13)

### Plan
- [x] Explore codebase and identify issues
- [x] Delete dead code: `lib/game-data.ts` (never imported)
- [x] Fix variable shadowing in `disconnectPlayer` — inner `const playerId` duplicated outer
- [x] Fix weak message IDs: `Math.random().toString(36)` → `crypto.randomUUID()` in `addMessage` / `addSystemMessage`
- [x] Add `maxLength={20}` to name input in `app/page.tsx`
- [x] Guard "Clear Testing Session" button behind `process.env.NODE_ENV !== 'production'`
- [x] Wrap `kickPlayer` in `useCallback` in `game-context.tsx` (was the only action not using it)
- [x] Add inline comments and JSDoc to `lib/game-engine.ts`, `server.ts`, `context/game-context.tsx`
- [x] Fix pre-existing test failure in `game-engine.consensus.test.ts` — majority mismatch with 3-player party
- [x] Run TypeScript check — no new errors (only pre-existing `qrcode.react` types issue)
- [x] Run all unit tests — 38/38 pass

### Review
All changes verified via `tsc --noEmit` and `vitest run`.
No regressions introduced.
