# Architecture Analysis

**Analysis Date:** 2026-03-06

---

## High-Level Architecture Style

**Monolith with real-time event layer.**

A single Node.js process hosts both the Next.js frontend (via `next` adapter) and the Socket.IO server. There is no microservices split, no REST API — the only server↔client protocol is Socket.IO events. Express is used only as an HTTP adapter to bridge Next.js page routing with the Socket.IO server.

```
[ Browser (React) ]
       ↕ Socket.IO (ws)
[ server.ts – Express + Socket.IO + Next.js handler ]
       ↕ in-process call
[ GameEngine (in-memory state) ]
```

---

## Module / Folder Structure

```
RomishPartyGames/
├── server.ts              # Entry point: HTTP server, Socket.IO event handlers, game loop
├── next.config.ts         # Next.js config (custom server, not built-in dev server)
├── app/
│   ├── layout.tsx         # Root layout – mounts GameProvider and Toaster globally
│   ├── page.tsx           # Home/hub page (create or join party)
│   └── party/[code]/
│       └── page.tsx       # In-party page (lobby, round, voting, results – all in one)
├── context/
│   └── game-context.tsx   # React Context + Socket.IO client lifecycle, all actions
├── hooks/
│   └── use-game.ts        # Thin re-export of useGameStore() from context
├── lib/
│   ├── types.ts           # All shared types: Party, Player, GameState, event contracts
│   ├── game-engine.ts     # Core game logic class (GameEngine) – pure in-memory
│   ├── game-data.ts       # Static data: MISSION_DATABASE (word/hint pairs)
│   ├── game-engine.test.ts
│   ├── game-engine.round.test.ts
│   └── game-engine.consensus.test.ts
└── e2e/
    └── party-flow.spec.ts # Playwright end-to-end tests
```

### Directory Responsibilities

| Directory | Responsibility |
|-----------|---------------|
| `server.ts` | Socket.IO event routing, auth handshake, game tick loop, personalized state broadcast |
| `app/` | Next.js App Router pages (client components only – no server actions or RSC data fetching) |
| `context/` | Socket.IO client connection, auth token, auto-rejoin, React state derived from server events |
| `hooks/` | Ergonomic consumer API (thin wrapper) |
| `lib/` | All domain logic, types, and static data – framework-agnostic |

---

## Data Flow

### Action Flow (Client → Server → Broadcast)

```
User Action (e.g., vote_player)
  → useGame() action (context/game-context.tsx)
    → socket.emit('vote_player', targetId)
      → server.ts socket handler
        → gameEngine.votePlayer(socket.id, targetId)
          → mutates Party in-memory
        → broadcastState(party.code)
          → getSafeState(party, playerId)  [per-player role masking]
          → io.to(socketId).emit('state_update', safeState)
            → context: setPartyState(state)
              → UI re-renders
```

### Game Tick Flow (Server-initiated)

```
setInterval(1000ms) in server.ts
  → gameEngine.tick()
    → decrements remainingTime for each party
    → advances GamePhase when time expires
    → returns list of mutated parties
  → broadcastState(party.code) for each updated party
```

### Reconnection Flow

```
Socket reconnects with auth.playerId (from sessionStorage)
  → server identifies existing player by ID
  → gameEngine.joinParty() detects existing player → reconnect path
  → broadcastState() sends current state to reconnected socket
  → client also emits 'state:sync' on connect for safety net
```

---

## State Management Approach

**Server is the single source of truth. Client holds a mirror.**

- All `Party` state lives in `GameEngine.parties: Map<string, Party>` (in-process, in-memory).
- The client's `partyState: Party | null` in `GameContext` is a read-only snapshot received via `state_update` events.
- Client actions never optimistically update local state — they emit a socket event and wait for the server's `state_update` broadcast.
- `roleInfo` (role + hint) is a separate client-side state derived from the `role_reveal` private event — it is NOT in `partyState` to prevent leaking role to observers.
- `playerId` is persisted in `sessionStorage` (not `localStorage`) to give each browser tab its own identity.
- `partyCode` and `playerName` are also persisted in `sessionStorage` to enable auto-rejoin after refresh or reconnect.

---

## Server-Side vs Client-Side Boundary

| Concern | Where |
|---------|-------|
| Game state | Server-only (`GameEngine`) |
| Phase transitions & timing | Server-only (`tick()` loop) |
| Role assignment | Server-only (`startGame()`) |
| Role/word visibility enforcement | Server (`getSafeState()` masks per player) |
| Imposter count validation | Server (`startGame()`, `updateSettings()`) |
| Vote resolution | Server (`resolveVotes()`, `checkConsensus()`) |
| Disconnect / grace period | Server (`disconnectPlayer()`, `cleanup()`) |
| UI rendering | Client-only (Next.js App Router, all `'use client'`) |
| Input / action dispatch | Client → Socket event |
| Player identity | Client (`sessionStorage` UUID, sent via socket `auth`) |
| Toast notifications | Client (`sonner`) |

There are **no Next.js Server Components doing data fetching**, no API routes, and no server actions. The App Router is used purely for routing; all data comes through Socket.IO.

---

## Key Abstractions and Relationships

### `Party` (lib/types.ts)
The central domain object. Contains everything about a session:
- `players: Player[]` — connected/disconnected participants
- `game: GameState` — phase, timer, word, hint, winner
- `votes: VoteState` — skip votes, player votes, threshold
- `messages: ChatMessage[]` — in-game chat log
- `settings: PartySettings` — max players, imposter count
- `continueVotes / lobbyVotes` — post-game consensus arrays

### `GameEngine` (lib/game-engine.ts)
Singleton instance (`export const gameEngine = new GameEngine()`). Owns:
- `parties: Map<code, Party>` — all live game rooms
- `socketToId: Map<socketId, playerId>` — socket ↔ persistent player ID
- `idToParty: Map<playerId, code>` — player ↔ party lookup
- All mutation methods: `createParty`, `joinParty`, `startGame`, `votePlayer`, `tick`, `cleanup`, etc.
- `tick()` — called every 1 second by server's `setInterval`; returns parties whose `remainingTime` changed or whose phase advanced

### `GamePhase` enum (lib/types.ts)
State machine values: `LOBBY → COUNTDOWN → REVEAL → ROUND → VOTING_GRACE → VOTE_RESULTS → RESULTS → LOBBY`
- Phase transitions are driven exclusively by `tick()` timer expiry or game events (all votes cast).

### `ClientToServerEvents` / `ServerToClientEvents` (lib/types.ts)
Typed Socket.IO event contracts shared between server and client. Enforced via generic parameters on `io` and `socket` instances.

### `GameContext` / `GameProvider` (context/game-context.tsx)
- Creates and manages the Socket.IO client instance (once, on mount)
- Stores `partyState`, `roleInfo`, `error`, `isConnected`, `playerId`
- Exposes action callbacks (`createParty`, `joinParty`, `votePlayer`, etc.) that wrap `socket.emit`
- Handles socket lifecycle events: `connect`, `disconnect`, `state_update`, `role_reveal`, `party:disbanded`
- Exported as `useGameStore()` hook, re-exported via `hooks/use-game.ts` as `useGame()`

### `useGame()` (hooks/use-game.ts)
Trivial re-export: `return useGameStore()`. Provides a stable import path for page components.

### `getSafeState()` (server.ts)
Per-player state sanitizer. Strips:
- Other players' roles (unless game over or both are imposters)
- `secretWord` from imposters
- `hint` from crew
- `socketId` from all player objects

---

## Phase State Machine

```
LOBBY
  └─(start_game)─→ COUNTDOWN (5s)
                      └─(tick)─→ REVEAL (5s)  [role_reveal emitted here]
                                   └─(tick)─→ ROUND (120s)
                                                ├─(all vote / skip threshold)─→ VOTING_GRACE (10s)
                                                └─(timer end)─────────────────→ VOTING_GRACE (10s)
                                                                                  └─(tick)─→ VOTE_RESULTS (5s)
                                                                                               └─(tick)─→ RESULTS (10s)
                                                                                                           └─(continueVotes/lobbyVotes consensus)─→ LOBBY
```

---

## Security Notes

- `getSafeState()` enforces information hiding server-side — the client never receives role data it shouldn't see.
- `auth.playerId` from `socket.handshake.auth` is trusted as the persistent player identity; no authentication beyond session-scoped UUID.
- Leader-only actions (`start_game`, `party:disband`, `kick_player`, `party:updateSettings`) are validated server-side by checking `player.isLeader`.
