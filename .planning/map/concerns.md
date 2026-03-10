# Codebase Concerns

**Analysis Date:** 2026-03-06

---

## Bugs / Risky Logic

**`voteSkip` is a non-functional stub:**
- `lib/game-engine.ts` — `voteSkip()` always returns `null` with no implementation body.
- The server handler in `server.ts` calls it and emits `vote:passed` on threshold, but the engine never signals a threshold was met.
- FEATURES.md lists "Vote to skip round" as a core feature. It is silently broken.

**`voteContinue` allows double-voting:**
- `lib/game-engine.ts` — `voteContinue` checks only `party.continueVotes.includes(playerId)`, but not `party.lobbyVotes`.
- A player who already called `voteLobby` can also call `voteContinue`, inflating both vote arrays and corrupting consensus math.
- `voteLobby` correctly checks both arrays; `voteContinue` does not.

**`checkConsensus` "continue" and "lobby" branches are identical:**
- `lib/game-engine.ts` — Both branches perform the same operations: reset the party to `GamePhase.LOBBY`, clear roles, clear votes.
- Playing again and returning to lobby produce the same outcome. There is no mechanism to automatically restart with a new word when "continue" wins.

**`secretWord` missing from initial party creation:**
- `lib/game-engine.ts` — `createParty` creates `party.game` without initializing `secretWord`, while the `GameState` interface requires `secretWord: string | null`.
- At runtime this field is `undefined` until `startGame` is called. `getSafeState` in `server.ts` accesses `party.game.secretWord` for every state broadcast during the lobby phase, returning `undefined` instead of `null`.

**Stale votes after player disconnects/leaves:**
- `lib/game-engine.ts` — `leaveParty` and `disconnectPlayer` do not remove the leaving player's entry from `votes.votes` or `votes.votedSkip`.
- If a player cast a vote, then left, their vote persists. During `resolveVotes`, the tally still counts them.
- `kickPlayer` does clean up votes — the leave/disconnect paths do not.

**Disconnected players remain in `voteThreshold` window:**
- `updateVoteThreshold` counts only `connected && !isDead` players, but the `cleanup()` grace period is 30 seconds.
- A party where most players disconnect will have threshold collapse to 1 or 2 while cleanup hasn't run yet, meaning a single remaining player can immediately resolve votes.

---

## Security Concerns

**Client-controlled `playerId` with trivially short entropy:**
- `context/game-context.tsx` — Player ID is generated client-side: `` `p-${Math.random().toString(36).substring(2, 6)}` ``.
- This is a 4-character base-36 string (~1.68 million combinations). Collision by chance is plausible in a busy session, and deliberate spoofing is easy.
- The ID is passed as `socket.handshake.auth.playerId` and trusted by the server for all identity lookups. A client can impersonate any known player ID if they know it.
- Fix approach: generate the ID server-side on first connection and return it to the client, or use a cryptographically random UUID.

**No input length or content validation for player names or chat messages:**
- `lib/game-engine.ts` `addMessage` and `createParty`/`joinParty` — no server-side cap on string length.
- A malicious client can submit a 1 MB player name or chat message, which is stored in-memory and broadcast to all party members on every tick.

**No rate limiting on socket events:**
- `server.ts` — Every socket event (including `send_message`, `vote_player`, `join_party`) accepts unlimited calls per connection.
- A client can flood `send_message` to fill the 50-message buffer instantly and force constant state broadcasts at maximum bandwidth.

**Non-cryptographic party code generation:**
- `lib/game-engine.ts` `generatePartyCode()` — Uses `Math.random()`, which is not cryptographically random.
- Party codes are 6 uppercase letters (~308 million space). Brute-force guessing is feasible but not trivial. For a party game this is an acceptable risk, but worth noting.

**`kick_player` and `vote_lobby` use `as any` casts:**
- `context/game-context.tsx` — `socket?.emit('kick_player' as any, targetId)` and `socket?.emit('vote_lobby' as any)`.
- These events are not in the `ClientToServerEvents` type. TypeScript type safety is bypassed, hiding potential mismatches in event names and argument types.

**Settings tab client-side guard only redirects after render:**
- `app/party/[code]/page.tsx` — A non-leader can momentarily access the settings tab in a React state window before the `useEffect` guard fires. Server validates all actions, so this is cosmetic, but it reveals settings UI briefly.

---

## Technical Debt

**`party & { emptyAt: number | null }` is an undocumented type extension:**
- `lib/game-engine.ts` — The engine stores `Party & { emptyAt: number | null }` in its internal map. This field is not in the shared `Party` type in `lib/types.ts`.
- External callers receive a `Party` with an undeclared runtime property, creating friction for any future code that reads `parties` through the public API.

**`TIMES` getter reads `process.env` on every access:**
- `lib/game-engine.ts` — `private get TIMES()` is evaluated every time a phase transition or game start is triggered. Minor overhead, but in high-frequency `tick()` calls ths is inefficient. Should be computed once on construction or cached.

**Duplicated leader-reassignment logic:**
- Leader reassignment on disconnect appears in both `disconnectPlayer` and `cleanup`. If `cleanup` removes a player who has already had leader transferred by `disconnectPlayer`, the logic can run again on a party with no previous leader flag set.

**`disbandParty` `reason` parameter is unused:**
- `context/game-context.tsx` — `disbandParty` useCallback accepts `reason?: string` which is never forwarded to the socket event.

**`useGameStore` naming mismatch:**
- `hooks/use-game.ts` imports `useGameStore` from `context/game-context.tsx`, which is a custom hook name associated with Zustand. The actual implementation uses React Context. This naming is misleading and raises false expectations about the state management approach.

**Comment residue in `server.ts`:**
- `server.ts` lines ~155–158 — Multi-line inline comment about chat broadcasting decisions left in production code (`// We could also emit to the room but since we're broadcasting the full state... // ...actually just broadcasting state is enough for now`). Decision should be documented or removed.

---

## Performance Considerations

**Full party state broadcast every second for every active party:**
- `server.ts` — The 1-second `setInterval` broadcasts personalized state to every player in every party that had any timer change. This includes all 50 messages, all player data, and full game state.
- For 10 parties of 10 players each, this is 100 individual socket emissions per second regardless of activity level.
- Consider delta-state updates or separate slower message sync channel.

**`cleanup()` runs inside every `tick()` call:**
- `lib/game-engine.ts` — `cleanup()` is invoked once per second and contains a nested loop: for each party, it iterates `socketToId` (all sockets globally) to find and remove entries. This is O(parties × total_sockets).
- Should run on a slower interval (e.g., every 30 seconds) since the grace window is 30 seconds anyway.

**`disbandParty` iterates all socket mappings:**
- `lib/game-engine.ts` — Cleanup of `socketToId` iterates the entire map to find matching player IDs. Use a reverse lookup (socketId → playerId already exists; maintain playerId → [socketId] as well) or clean up socket mappings at disconnect time.

**Messages stored with `Array.shift()`:**
- `lib/game-engine.ts` — Trimming to 50 messages uses `shift()`, which is O(n) for arrays. A bounded circular buffer or deque would be O(1).

---

## Scalability Limitations

**In-memory singleton — no horizontal scaling:**
- `lib/game-engine.ts` — All state lives in a single `GameEngine` instance exported as `gameEngine`. Deploying more than one process immediately breaks party state consistency.
- No database persistence: server restart wipes all active parties.

**No Socket.IO adapter:**
- `server.ts` — Socket.IO is initialized without a Redis (or other) adapter. Room-based broadcasts (`io.to(code).emit(...)`) only work within a single process. Multi-server deployments would silently fail to deliver events cross-process.

**Only 15 words in `MISSION_DATABASE`:**
- `lib/game-data.ts` — With 15 missions selected by `Math.random()`, repetition within the same group session is very likely after 5–6 games. No deduplication or shuffle-tracking is implemented.

**No dead-player isolation:**
- Dead players (`isDead: true`) remain in the chat and receive full state updates, including the ongoing vote tally. There is no separate dead-player channel.

---

## Missing Features (Documented or Implied)

**Vote-to-skip is broken:**
- Described in FEATURES.md under "Voting System — Skip Round mechanism." Server emits `vote:passed` event but `voteSkip()` always returns `null`. The skip flow never executes.

**REMI and POKER are placeholder stubs:**
- `app/page.tsx` — Both game cards are rendered as `cursor-not-allowed` divs with "COMING SOON." No routing, engine, or feature scaffolding exists for either game.

**No persistence across server restarts:**
- FEATURES.md notes "Temporary in-memory server storage (resets on server restart)" but presents it neutrally. For a real deployment this is a hard limitation: any crash or deploy drops all live parties mid-game.

**No spectator mode:**
- Players who are `isDead` cannot rejoin as players but also have no distinct UI mode. They see the same interface as alive players minus voting controls.

**`secretWord` never cleared after game ends in the lobby reset:**
- After `checkConsensus` resets the party to `LOBBY`, `party.game.secretWord` and `party.game.hint` are not nulled out. Until the next `startGame`, these fields retain the previous game's values.

---

## Test Coverage Gaps

**`voteSkip` has no test:**
- `lib/game-engine.test.ts`, `lib/game-engine.round.test.ts` — The skip-vote path is untested. Given the function is stubbed, tests would immediately reveal the gap.

**`addMessage` / chat has no unit test:**
- No tests cover message trimming, system message injection, or `addSystemMessage`. Chat is a core feature with no engine-level coverage.

**`cleanup()` has no test:**
- The disconnect grace period expiry and party deletion logic in `cleanup()` are not tested. This is some of the most timing-sensitive code in the engine.

**`disconnectPlayer` + reconnect flow has no test:**
- The reconnection path in `joinParty` (when `existingPlayer` is found) and the corresponding `disconnectPlayer` setup are exercised only implicitly via E2E tests.

**`disbandParty` has no unit test:**
- Socket map cleanup in `disbandParty` is not verified in isolation.

**E2E tests don't cover the game flow:**
- `e2e/party-flow.spec.ts` covers only lobby creation, settings, and disband. There are no E2E tests for starting a game, voting, role reveal, win conditions, or the continue/lobby consensus.

**Tests directly mutate internal party state:**
- `lib/game-engine.round.test.ts` and `lib/game-engine.consensus.test.ts` manipulate `party.game.phase` and `party.game.remainingTime` directly by accessing the returned reference. This is brittle: any internal encapsulation change (e.g., returning a copy) would silently break tests.

---

*Concerns audit: 2026-03-06*
