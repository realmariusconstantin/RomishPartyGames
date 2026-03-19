import { Party, GamePhase, ChatMessage } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long (ms) a disconnected player's slot is held before cleanup removes them. */
const DISCONNECT_GRACE = 120000; // 2 minutes

/** How long (ms) a fully-empty party is kept alive in memory before deletion. */
const PARTY_EMPTY_GRACE = 120000; // 2 minutes

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Extends the public Party type with server-only tracking fields that are
 * never sent to clients.
 */
type InternalParty = Party & {
  emptyAt: number | null;        // Timestamp when last player disconnected (for grace-period cleanup)
  recentImposters: string[];     // Player IDs who were impostors recently (used to rotate roles fairly)
};

// ---------------------------------------------------------------------------
// GameEngine
// ---------------------------------------------------------------------------

/**
 * Core game logic. All party state lives in three Maps:
 *  - parties:     code → InternalParty
 *  - socketToId:  socketId → playerId
 *  - idToParty:   playerId → partyCode
 *
 * There is one shared singleton exported at the bottom of this file.
 */
export class GameEngine {
  private parties: Map<string, InternalParty> = new Map();
  private socketToId: Map<string, string> = new Map();
  private idToParty: Map<string, string> = new Map();

  /**
   * Phase durations in seconds. In TEST_MODE all timers are much shorter so
   * Vitest unit tests run fast without sleeping.
   */
  private readonly TIMES: {
    PREGAME: number;
    ROUND: number;
    REVEAL: number;
    COUNTDOWN: number;
    RESULTS: number;
    VOTING_GRACE: number;
    VOTE_RESULTS: number;
  };

  /** Counter used to throttle cleanup() to once every 30 ticks (~30 seconds). */
  private cleanupCounter = 0;

  constructor() {
    const isTest = process.env.TEST_MODE === 'true';
    this.TIMES = {
      PREGAME:      isTest ? 5  : 30,
      ROUND:        isTest ? 10 : 0,
      REVEAL:       isTest ? 2  : 5,
      COUNTDOWN:    isTest ? 1  : 5,
      RESULTS:      isTest ? 2  : 10,
      VOTING_GRACE: isTest ? 2  : 120,
      VOTE_RESULTS: isTest ? 2  : 5,
    };
  }

  // -------------------------------------------------------------------------
  // Party lifecycle
  // -------------------------------------------------------------------------

  /**
   * Generates a unique 6-letter party code (A-Z only).
   * Recursively retries on the rare collision.
   */
  private generatePartyCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (this.parties.has(code)) return this.generatePartyCode();
    return code;
  }

  /**
   * Creates a brand-new party with the calling player as leader.
   * Returns the generated party code.
   */
  createParty(playerId: string, socketId: string, playerName: string): string {
    const code = this.generatePartyCode();
    const party: InternalParty = {
      code,
      emptyAt: null,
      recentImposters: [],
      players: [
        {
          id: playerId,
          socketId,
          name: playerName,
          isLeader: true,
          role: null,
          connected: true,
          disconnectedAt: null,
        },
      ],
      game: {
        phase: GamePhase.LOBBY,
        imposterCount: 1,
        remainingTime: 0,
        secretWord: null,
        category: null,
        lastEliminated: null,
        winner: null,
      },
      votes: {
        votedSkip: [],
        votes: {},
        threshold: 0,
      },
      settings: {
        maxPlayers: 10,
        impostersCount: 1,
        language: 'english',
      },
      messages: [],
      continueVotes: [],
      lobbyVotes: [],
      startVotes: [],
      cancelVotes: [],
    };
    this.parties.set(code, party);
    this.socketToId.set(socketId, playerId);
    this.idToParty.set(playerId, code);
    return code;
  }

  /**
   * Joins an existing party by code. Handles two cases:
   *  - Reconnection: player ID already exists → update socket, restore connection
   *  - New join: append player to party (blocked once game is in progress)
   *
   * Returns the party and whether this was a new join (`isNew: true`) or a
   * reconnect (`isNew: false`), or null if the join failed.
   */
  joinParty(
    code: string,
    playerId: string,
    socketId: string,
    playerName: string
  ): { party: Party; isNew: boolean } | null {
    const party = this.parties.get(code);
    if (!party) return null;

    // Reconnection path: player already has a slot — just update the socket binding
    const existingPlayer = party.players.find(p => p.id === playerId);
    if (existingPlayer) {
      existingPlayer.connected = true;
      existingPlayer.socketId = socketId;
      existingPlayer.disconnectedAt = null;
      party.emptyAt = null;
      this.socketToId.set(socketId, playerId);
      this.idToParty.set(playerId, code);
      this.updateVoteThreshold(party);
      return { party, isNew: false };
    }

    // New join is blocked once the countdown has begun
    if (party.game.phase !== GamePhase.LOBBY) return null;
    if (party.players.length >= party.settings.maxPlayers) return null;

    party.players.push({
      id: playerId,
      socketId,
      name: playerName,
      isLeader: false,
      role: null,
      connected: true,
      disconnectedAt: null,
      isDead: false,
    });

    party.emptyAt = null;
    this.socketToId.set(socketId, playerId);
    this.idToParty.set(playerId, code);
    this.updateVoteThreshold(party);
    return { party, isNew: true };
  }

  /** Looks up a party by its 6-letter code. */
  getParty(code: string): Party | undefined {
    return this.parties.get(code);
  }

  /** Looks up the party a given player is currently in. */
  getPartyByPlayerId(playerId: string): Party | undefined {
    const code = this.idToParty.get(playerId);
    return code ? this.parties.get(code) : undefined;
  }

  /** Looks up the party for the player connected on a given socket. */
  getPartyBySocket(socketId: string): Party | undefined {
    const playerId = this.socketToId.get(socketId);
    if (!playerId) return undefined;
    return this.getPartyByPlayerId(playerId);
  }

  /**
   * Updates lobby settings (max players, impostor count, language).
   * Only valid while the party is in the LOBBY phase and within the
   * enforced ratio limits.
   */
  updateSettings(
    code: string,
    settings: { maxPlayers: number; impostersCount: number }
  ): Party | null {
    const party = this.parties.get(code);
    if (!party || party.game.phase !== GamePhase.LOBBY) return null;

    if (settings.maxPlayers < 3 || settings.maxPlayers > 10) return null;
    if (settings.impostersCount < 1) return null;

    // Enforced impostor ratio: 3-6 players → max 1, 7-9 → max 2, 10 → max 3
    const currentCount = party.players.length;
    let maxAllowed = 1;
    if (currentCount >= 10) maxAllowed = 3;
    else if (currentCount >= 7) maxAllowed = 2;

    if (settings.impostersCount > maxAllowed) return null;
    if (settings.maxPlayers < currentCount) return null;

    party.settings = { ...party.settings, ...settings };
    party.game.imposterCount = party.settings.impostersCount; // Keep game state in sync
    return party;
  }

  /**
   * Immediately removes a party and cleans up all associated player maps.
   * Returns the list of player IDs that were in the party (so the caller can
   * notify them).
   */
  disbandParty(code: string): string[] {
    const party = this.parties.get(code);
    if (!party) return [];

    const playerIds = party.players.map(p => p.id);
    this.parties.delete(code);

    // Remove playerId → partyCode mappings
    playerIds.forEach(pid => { this.idToParty.delete(pid); });

    // Remove socketId → playerId mappings by scanning (we don't keep a reverse map)
    for (const [sid, pid] of this.socketToId.entries()) {
      if (playerIds.includes(pid)) {
        this.socketToId.delete(sid);
      }
    }

    return playerIds;
  }

  /**
   * Voluntarily removes a player from their party (they clicked "Leave").
   * Handles leader re-assignment and vote cleanup. Returns the updated party,
   * or undefined if the party no longer exists after they left.
   */
  leaveParty(socketId: string): Party | undefined {
    const playerId = this.socketToId.get(socketId);
    if (!playerId) return;

    const code = this.idToParty.get(playerId);
    if (!code) return;

    const party = this.parties.get(code);
    if (!party) return;

    const playerIndex = party.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      const player = party.players[playerIndex];
      party.players.splice(playerIndex, 1);

      this.socketToId.delete(socketId);
      this.idToParty.delete(playerId);

      // Remove any votes cast by the leaving player
      delete party.votes.votes[playerId];
      party.votes.votedSkip    = party.votes.votedSkip.filter(id => id !== playerId);
      party.continueVotes      = party.continueVotes.filter(id => id !== playerId);
      party.lobbyVotes         = party.lobbyVotes.filter(id => id !== playerId);

      // If the leader left, promote the next player in line
      if (player.isLeader && party.players.length > 0) {
        party.players[0].isLeader = true;
      }
    }

    // Party is empty → remove it entirely
    if (party.players.length === 0) {
      this.parties.delete(code);
      return;
    }

    this.updateVoteThreshold(party);
    return party;
  }

  /**
   * Handles an involuntary socket disconnection (browser close, network drop).
   * Unlike leaveParty, the player's slot is kept for DISCONNECT_GRACE ms to
   * allow reconnection. Their in-round votes are dropped so active players
   * aren't blocked.
   */
  disconnectPlayer(socketId: string): Party | undefined {
    const playerId = this.socketToId.get(socketId);
    if (!playerId) return;

    const code = this.idToParty.get(playerId);
    if (!code) return;

    const party = this.parties.get(code);
    if (!party) return;

    const player = party.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      player.socketId = null;
      player.disconnectedAt = Date.now();

      // Drop in-round votes so active voters can still reach a majority.
      // continueVotes / lobbyVotes are kept — they persist across reconnects.
      delete party.votes.votes[playerId];
      party.votes.votedSkip = party.votes.votedSkip.filter(id => id !== playerId);

      // Hand leader role to the next connected player if the leader disconnected
      if (player.isLeader) {
        const nextLeader = party.players.find(p => p.connected);
        if (nextLeader) {
          player.isLeader = false;
          nextLeader.isLeader = true;
        }
      }
    }

    // If everyone is now offline, start the party-empty grace clock
    if (party.players.every(p => !p.connected)) {
      party.emptyAt = Date.now();
    }

    this.socketToId.delete(socketId);
    this.updateVoteThreshold(party);
    return party;
  }

  /**
   * Leader-only: kick a non-leader player out of the party.
   * Returns the updated party and the kicked player's socketId so the caller
   * can send them a disconnect event; or null if the operation was not allowed.
   */
  kickPlayer(
    socketId: string,
    targetId: string
  ): { party: Party; targetSocketId: string | null } | null {
    const leaderParty = this.getPartyBySocket(socketId);
    if (!leaderParty) return null;

    const me = leaderParty.players.find(p => p.socketId === socketId);
    if (!me?.isLeader) return null;

    const targetIndex = leaderParty.players.findIndex(p => p.id === targetId);
    if (targetIndex === -1) return null;

    const target = leaderParty.players[targetIndex];
    if (target.isLeader) return null; // Cannot kick the leader (themselves)

    const targetSocketId = target.socketId;

    leaderParty.players.splice(targetIndex, 1);

    // Clean up votes for the removed player
    delete leaderParty.votes.votes[targetId];
    leaderParty.continueVotes = leaderParty.continueVotes.filter(id => id !== targetId);
    leaderParty.lobbyVotes    = leaderParty.lobbyVotes.filter(id => id !== targetId);

    this.addSystemMessage(leaderParty.code, `${target.name} has been removed from the network`);
    this.updateVoteThreshold(leaderParty);

    return { party: leaderParty, targetSocketId };
  }

  /**
   * Periodic cleanup called from tick(). Removes players who have been
   * disconnected past the grace period, reassigns leader if needed, and
   * deletes empty or abandoned parties.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [code, party] of this.parties.entries()) {
      const originalCount = party.players.length;
      const removedIds: string[] = [];

      // Remove players whose disconnect grace period has expired
      party.players = party.players.filter(p => {
        if (p.connected) return true;
        if (!p.disconnectedAt || (now - p.disconnectedAt) >= DISCONNECT_GRACE) {
          removedIds.push(p.id);
          return false;
        }
        return true;
      });

      // Clean up all vote arrays for expired players
      if (removedIds.length > 0) {
        removedIds.forEach(pid => { delete party.votes.votes[pid]; });
        party.votes.votedSkip = party.votes.votedSkip.filter(id => !removedIds.includes(id));
        party.continueVotes   = party.continueVotes.filter(id => !removedIds.includes(id));
        party.lobbyVotes      = party.lobbyVotes.filter(id => !removedIds.includes(id));
      }

      // Reassign leader if needed after removals
      if (party.players.length < originalCount) {
        if (party.players.length > 0 && !party.players.some(p => p.isLeader)) {
          party.players[0].isLeader = true;
        }
        this.updateVoteThreshold(party);
      }

      // Delete the party if it's empty or has been empty too long
      if (
        party.players.length === 0 ||
        (party.emptyAt && (now - party.emptyAt) > PARTY_EMPTY_GRACE)
      ) {
        this.parties.delete(code);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Game lifecycle
  // -------------------------------------------------------------------------

  /**
   * Assigns roles, picks the secret word, and kicks off the countdown phase.
   * Uses a "recent impostor avoidance" shuffle to rotate who gets picked, so
   * the same player isn't the impostor every game.
   */
  startGame(
    code: string,
    imposterCount: number,
    secretWord: string,
    category = ''
  ): Party | null {
    const party = this.parties.get(code);
    if (!party || (party.game.phase !== GamePhase.LOBBY && party.game.phase !== GamePhase.PREGAME)) {
      return null;
    }
    if (party.players.length < 3) return null;

    // Clamp impostor count to the allowed ratio (3-6: 1, 7-9: 2, 10: 3)
    const currentCount = party.players.length;
    let maxAllowed = 1;
    if (currentCount >= 10) maxAllowed = 3;
    else if (currentCount >= 7) maxAllowed = 2;
    party.game.imposterCount = Math.max(1, Math.min(imposterCount, maxAllowed));

    party.game.secretWord    = secretWord;
    party.game.category      = category;
    party.game.phase         = GamePhase.COUNTDOWN;
    party.game.remainingTime = this.TIMES.COUNTDOWN;

    // Shuffle players into impostor slots, prioritising those who haven't been
    // the impostor recently. Non-recent candidates are picked first.
    const recentImposters = party.recentImposters;
    const allIndices = Array.from({ length: party.players.length }, (_, i) => i);

    const shuffleArr = (arr: number[]) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    const nonRecentIndices = allIndices.filter(i => !recentImposters.includes(party.players[i].id));
    const recentIndices    = allIndices.filter(i =>  recentImposters.includes(party.players[i].id));
    shuffleArr(nonRecentIndices);
    shuffleArr(recentIndices);

    // Non-recent candidates fill impostor slots first; recent ones only if needed
    const candidateIndices = [...nonRecentIndices, ...recentIndices];
    const imposterIndices  = candidateIndices.slice(0, party.game.imposterCount);

    party.players.forEach((p, i) => {
      p.role   = imposterIndices.includes(i) ? 'imposter' : 'crew';
      p.isDead = false;
    });
    party.recentImposters = imposterIndices.map(i => party.players[i].id);

    // Reset all vote state for the new game
    party.votes.votedSkip    = [];
    party.votes.votes        = {};
    party.continueVotes      = [];
    party.lobbyVotes         = [];
    party.startVotes         = [];
    party.cancelVotes        = [];
    party.game.lastEliminated = null;
    party.game.winner        = null;
    this.updateVoteThreshold(party);

    return party;
  }

  // -------------------------------------------------------------------------
  // Pre-game confirmation vote (LOBBY → PREGAME)
  // -------------------------------------------------------------------------

  /**
   * Leader proposes a game start. Transitions to PREGAME phase where all
   * players must vote to start or cancel. The leader auto-votes yes.
   */
  proposeGame(socketId: string): Party | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.LOBBY) return null;

    const me = party.players.find(p => p.socketId === socketId);
    if (!me?.isLeader) return null;
    if (party.players.length < 3) return null;

    party.game.phase         = GamePhase.PREGAME;
    party.game.remainingTime = this.TIMES.PREGAME;
    party.startVotes         = [me.id]; // Leader counts as a yes vote automatically
    party.cancelVotes        = [];
    return party;
  }

  /**
   * A player votes to start the game. If a majority of connected players
   * have voted yes, returns shouldStart: true so the caller can actually
   * call startGame().
   */
  voteStart(socketId: string): { party: Party; shouldStart: boolean } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.PREGAME) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    // Prevent double-voting
    if (party.startVotes.includes(playerId) || party.cancelVotes.includes(playerId)) {
      return { party, shouldStart: false };
    }

    party.startVotes.push(playerId);
    const connected   = party.players.filter(p => p.connected).length;
    const shouldStart = party.startVotes.length > connected / 2;
    return { party, shouldStart };
  }

  /**
   * A player votes to cancel the pending start. If at least half of connected
   * players vote to cancel (tie = cancel), returns shouldCancel: true.
   */
  cancelStart(socketId: string): { party: Party; shouldCancel: boolean } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.PREGAME) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    if (party.startVotes.includes(playerId) || party.cancelVotes.includes(playerId)) {
      return { party, shouldCancel: false };
    }

    party.cancelVotes.push(playerId);
    const connected    = party.players.filter(p => p.connected).length;
    const shouldCancel = party.cancelVotes.length >= connected / 2; // Tie = cancel
    return { party, shouldCancel };
  }

  /** Resets a party from PREGAME back to LOBBY (used on cancel or timeout). */
  private revertToLobby(party: Party): void {
    party.game.phase         = GamePhase.LOBBY;
    party.game.remainingTime = 0;
    party.startVotes         = [];
    party.cancelVotes        = [];
  }

  // -------------------------------------------------------------------------
  // Post-game consensus vote (RESULTS → LOBBY or new game)
  // -------------------------------------------------------------------------

  /**
   * Player votes to play again. If consensus is reached, the return value's
   * `consensus` field will be `'continue'` and the caller should start a new game.
   */
  voteContinue(
    socketId: string
  ): { party: Party; consensus: 'continue' | 'lobby' | null } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.RESULTS) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId || party.continueVotes.includes(playerId) || party.lobbyVotes.includes(playerId)) {
      return null;
    }

    party.continueVotes.push(playerId);
    return this.checkConsensus(party);
  }

  /**
   * Player votes to return to lobby. If consensus is reached, the return
   * value's `consensus` field will be `'lobby'`.
   */
  voteLobby(
    socketId: string
  ): { party: Party; consensus: 'continue' | 'lobby' | null } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.RESULTS) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId || party.continueVotes.includes(playerId) || party.lobbyVotes.includes(playerId)) {
      return null;
    }

    party.lobbyVotes.push(playerId);
    return this.checkConsensus(party);
  }

  /**
   * Checks whether a majority of connected players have voted (continue or
   * lobby). If so, resets all game state and reports the outcome.
   */
  private checkConsensus(
    party: Party
  ): { party: Party; consensus: 'continue' | 'lobby' | null } {
    const connectedCount = party.players.filter(p => p.connected).length;
    const totalVotes     = party.continueVotes.length + party.lobbyVotes.length;

    // Everyone must vote before consensus is reached
    if (totalVotes < connectedCount) return { party, consensus: null };

    // Whoever has more votes wins; ties go to continue
    const consensus: 'continue' | 'lobby' =
      party.continueVotes.length >= party.lobbyVotes.length ? 'continue' : 'lobby';

    // Always move back to lobby — server auto-starts a new game if consensus === 'continue'
    party.game.phase         = GamePhase.LOBBY;
    party.game.remainingTime = 0;
    party.game.winner        = null;
    party.game.secretWord    = null;
    party.game.category      = null;
    party.players.forEach(p => { p.role = null; p.isDead = false; });
    party.votes.votes        = {};
    party.votes.votedSkip    = [];
    party.continueVotes      = [];
    party.lobbyVotes         = [];
    party.startVotes         = [];
    party.cancelVotes        = [];

    return { party, consensus };
  }

  // -------------------------------------------------------------------------
  // In-round voting
  // -------------------------------------------------------------------------

  /**
   * Records a vote by `socketId` against `targetId`. Immediately resolves
   * if a majority is reached; otherwise transitions ROUND → VOTING_GRACE on
   * the first vote cast (so there's always a countdown to force resolution).
   */
  votePlayer(socketId: string, targetId: string): Party | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || (party.game.phase !== GamePhase.ROUND && party.game.phase !== GamePhase.VOTING_GRACE)) {
      return null;
    }

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    const voter  = party.players.find(p => p.id === playerId);
    const target = party.players.find(p => p.id === targetId);

    // Dead or disconnected players cannot vote
    if (!voter || !target || !voter.connected || voter.isDead) return null;

    party.votes.votes[playerId] = targetId;

    const activeVoters = party.players.filter(p => p.connected && !p.isDead);
    const votesCast    = Object.keys(party.votes.votes).length;

    // Tally current votes to check for an early majority
    const tally: Record<string, number> = {};
    Object.values(party.votes.votes).forEach(tid => { tally[tid] = (tally[tid] || 0) + 1; });
    const majority    = Math.floor(activeVoters.length / 2) + 1;
    const hasMajority = Object.values(tally).some(count => count >= majority);

    if (hasMajority || votesCast >= activeVoters.length) {
      // All results are in — resolve immediately
      this.resolveVotes(party);
    } else if (party.game.phase === GamePhase.ROUND) {
      // First vote cast: start the voting grace-period countdown
      party.game.phase         = GamePhase.VOTING_GRACE;
      party.game.remainingTime = this.TIMES.VOTING_GRACE;
    }

    return party;
  }

  /**
   * Tallies all stored votes and eliminates the player with the most.
   * Ties result in no elimination (TIE sentinel). Transitions to VOTE_RESULTS.
   */
  private resolveVotes(party: Party) {
    const tally: Record<string, number> = {};
    Object.values(party.votes.votes).forEach(targetId => {
      tally[targetId] = (tally[targetId] || 0) + 1;
    });

    let maxVotes  = 0;
    let electedId: string | null = null;
    let tie       = false;

    for (const [id, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes  = count;
        electedId = id;
        tie       = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }

    if (electedId && !tie) {
      const eliminated = party.players.find(p => p.id === electedId);
      if (eliminated) {
        eliminated.isDead          = true;
        party.game.lastEliminated  = eliminated.id;
      }
    } else {
      party.game.lastEliminated = 'TIE';
    }

    party.game.phase         = GamePhase.VOTE_RESULTS;
    party.game.remainingTime = this.TIMES.VOTE_RESULTS;
  }

  /**
   * Records a skip vote. If the threshold is met, immediately begins the
   * voting grace-period countdown so the round ends cleanly.
   */
  voteSkip(socketId: string): { party: Party; thresholdMet: boolean } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.ROUND) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    const voter = party.players.find(p => p.id === playerId);
    if (!voter || !voter.connected || voter.isDead) return null;

    // No-op if already voted to skip
    if (party.votes.votedSkip.includes(playerId)) return { party, thresholdMet: false };

    party.votes.votedSkip.push(playerId);
    const thresholdMet = party.votes.votedSkip.length >= party.votes.threshold;
    if (thresholdMet) {
      party.game.phase         = GamePhase.VOTING_GRACE;
      party.game.remainingTime = this.TIMES.VOTING_GRACE;
    }
    return { party, thresholdMet };
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  /**
   * Adds a player message to the party chat. Keeps the last 50 messages so
   * the array doesn't grow unboundedly.
   */
  addMessage(socketId: string, text: string): { party: Party; message: ChatMessage } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party) return null;

    const playerId = this.socketToId.get(socketId);
    const player   = party.players.find(p => p.id === playerId);
    if (!player) return null;

    const message: ChatMessage = {
      id:         crypto.randomUUID(),
      playerId:   player.id,
      playerName: player.name,
      text,
      timestamp:  Date.now(),
    };

    party.messages.push(message);
    if (party.messages.length > 50) party.messages.shift();

    return { party, message };
  }

  /**
   * Adds a server-generated system message (e.g. "Player X has joined").
   * Uses the same 50-message cap as player messages.
   */
  addSystemMessage(code: string, text: string): ChatMessage | null {
    const party = this.parties.get(code);
    if (!party) return null;

    const message: ChatMessage = {
      id:         crypto.randomUUID(),
      playerId:   'system' as const,
      playerName: 'Network',
      text,
      timestamp:  Date.now(),
    };

    party.messages.push(message);
    if (party.messages.length > 50) party.messages.shift();
    return message;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Recalculates the skip-vote threshold (simple majority of active players).
   * Call this after any change to the player list or connected status.
   */
  private updateVoteThreshold(party: Party) {
    const activePlayers      = party.players.filter(p => p.connected && !p.isDead);
    party.votes.threshold    = activePlayers.length; // Everyone must vote to skip
  }

  /**
   * Checks whether impostor(s) have won or been eliminated, then either
   * transitions to RESULTS or starts a new round.
   */
  private checkWinConditions(party: Party) {
    const alivePlayers  = party.players.filter(p => !p.isDead);
    const crewCount     = alivePlayers.filter(p => p.role === 'crew').length;
    const imposterCount = alivePlayers.filter(p => p.role === 'imposter').length;

    if (imposterCount === 0) {
      // All impostors gone — crew wins
      party.game.winner        = 'crew';
      party.game.phase         = GamePhase.RESULTS;
      party.game.remainingTime = 0; // Stay in results until consensus
    } else if (imposterCount >= crewCount) {
      // Impostors outnumber or match crew — impostors win
      party.game.winner        = 'imposter';
      party.game.phase         = GamePhase.RESULTS;
      party.game.remainingTime = 0;
    } else {
      // Game continues — reset votes and start a new round
      party.votes.votes        = {};
      party.votes.votedSkip    = [];
      party.game.remainingTime = this.TIMES.ROUND;
      party.game.phase         = GamePhase.ROUND;
      this.updateVoteThreshold(party);
    }
  }

  // -------------------------------------------------------------------------
  // Game loop
  // -------------------------------------------------------------------------

  /**
   * Called every second by the server's setInterval. Decrements timers for
   * all active parties and drives the phase state machine when timers expire.
   * Returns the list of parties whose state changed so the server can
   * broadcast updates only to relevant rooms.
   *
   * Cleanup runs every 30 ticks to match the disconnect grace period.
   */
  tick(): Party[] {
    const updatedParties: Party[] = [];

    for (const party of this.parties.values()) {
      if (party.game.remainingTime > 0) {
        party.game.remainingTime--;

        if (party.game.remainingTime === 0) {
          switch (party.game.phase) {
            case GamePhase.PREGAME:
              // Timed out without a majority vote — return everyone to lobby
              this.revertToLobby(party);
              break;
            case GamePhase.COUNTDOWN:
              party.game.phase         = GamePhase.REVEAL;
              party.game.remainingTime = this.TIMES.REVEAL;
              break;
            case GamePhase.REVEAL:
              party.game.phase         = GamePhase.ROUND;
              party.game.remainingTime = this.TIMES.ROUND;
              break;
            case GamePhase.ROUND:
              // Time ran out with no votes — force a voting grace period
              party.game.phase         = GamePhase.VOTING_GRACE;
              party.game.remainingTime = this.TIMES.VOTING_GRACE;
              break;
            case GamePhase.VOTING_GRACE:
              this.resolveVotes(party);
              break;
            case GamePhase.VOTE_RESULTS:
              this.checkWinConditions(party);
              break;
            case GamePhase.RESULTS:
              // No auto-reset; stay until players vote on continue/lobby
              party.game.remainingTime = 0;
              break;
          }
        }

        updatedParties.push(party);
      }
    }

    // Cleanup runs every 30 seconds
    this.cleanupCounter++;
    if (this.cleanupCounter % 30 === 0) {
      this.cleanup();
    }

    return updatedParties;
  }
}

// Shared singleton — imported by server.ts
export const gameEngine = new GameEngine();
