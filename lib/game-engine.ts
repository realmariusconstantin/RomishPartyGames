import { Party, GamePhase, ChatMessage } from './types';

const DISCONNECT_GRACE = 30000; // 30 seconds
const PARTY_EMPTY_GRACE = 120000; // 2 minutes

type InternalParty = Party & { emptyAt: number | null };

export class GameEngine {
  private parties: Map<string, InternalParty> = new Map();
  private socketToId: Map<string, string> = new Map();
  private idToParty: Map<string, string> = new Map();
  private readonly TIMES: { PREGAME: number; ROUND: number; REVEAL: number; COUNTDOWN: number; RESULTS: number; VOTING_GRACE: number; VOTE_RESULTS: number };
  private cleanupCounter = 0;

  constructor() {
    const isTest = process.env.TEST_MODE === 'true';
    this.TIMES = {
      PREGAME: isTest ? 5 : 30,
      ROUND: isTest ? 10 : 120,
      REVEAL: isTest ? 2 : 5,
      COUNTDOWN: isTest ? 1 : 5,
      RESULTS: isTest ? 2 : 10,
      VOTING_GRACE: isTest ? 2 : 10,
      VOTE_RESULTS: isTest ? 2 : 5
    };
  }

  private generatePartyCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (this.parties.has(code)) return this.generatePartyCode();
    return code;
  }

  createParty(playerId: string, socketId: string, playerName: string): string {
    const code = this.generatePartyCode();
    const party: Party & { emptyAt: number | null } = {
      code,
      emptyAt: null,
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

  joinParty(code: string, playerId: string, socketId: string, playerName: string): { party: Party, isNew: boolean } | null {
    const party = this.parties.get(code);
    if (!party) return null;

    // Check for reconnection
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

    // Joining blocked once countdown starts
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
      isDead: false, // Ensure initialized
    });
    
    party.emptyAt = null;
    this.socketToId.set(socketId, playerId);
    this.idToParty.set(playerId, code);
    this.updateVoteThreshold(party);
    return { party, isNew: true };
  }

  getParty(code: string): Party | undefined {
    return this.parties.get(code);
  }

  getPartyByPlayerId(playerId: string): Party | undefined {
    const code = this.idToParty.get(playerId);
    return code ? this.parties.get(code) : undefined;
  }

  getPartyBySocket(socketId: string): Party | undefined {
    const playerId = this.socketToId.get(socketId);
    if (!playerId) return undefined;
    return this.getPartyByPlayerId(playerId);
  }

  updateSettings(code: string, settings: { maxPlayers: number; impostersCount: number }): Party | null {
    const party = this.parties.get(code);
    if (!party || party.game.phase !== GamePhase.LOBBY) return null;

    // Validation
    if (settings.maxPlayers < 3 || settings.maxPlayers > 10) return null;
    if (settings.impostersCount < 1) return null;
    
    // Enforce limits: 3-6: 1, 7-9: 2, 10: 3
    const currentCount = party.players.length;
    let maxAllowed = 1;
    if (currentCount >= 10) maxAllowed = 3;
    else if (currentCount >= 7) maxAllowed = 2;
    
    if (settings.impostersCount > maxAllowed) return null;
    
    if (settings.maxPlayers < currentCount) return null;

    party.settings = { ...party.settings, ...settings };
    party.game.imposterCount = party.settings.impostersCount; // Sync game state
    return party;
  }

  disbandParty(code: string): string[] {
    const party = this.parties.get(code);
    if (!party) return [];

    const playerIds = party.players.map(p => p.id);
    this.parties.delete(code);
    
    // Cleanup maps
    playerIds.forEach(pid => {
      this.idToParty.delete(pid);
      // We don't have socket IDs here easily without iterating socketToId
    });
    
    // Better to iterate socketToId to cleanup
    for (const [sid, pid] of this.socketToId.entries()) {
      if (playerIds.includes(pid)) {
        this.socketToId.delete(sid);
      }
    }

    return playerIds;
  }

  leaveParty(socketId: string): Party | undefined {
    const playerId = this.socketToId.get(socketId);
    if (!playerId) return;

    const code = this.idToParty.get(playerId);
    if (!code) return;

    const party = this.parties.get(code);
    if (!party) return;

    const playerIndex = party.players.findIndex((p) => p.id === playerId);
    if (playerIndex !== -1) {
      const player = party.players[playerIndex];
      party.players.splice(playerIndex, 1);
      
      this.socketToId.delete(socketId);
      this.idToParty.delete(playerId);

      // Clean up the leaving player's votes
      delete party.votes.votes[playerId];
      party.votes.votedSkip = party.votes.votedSkip.filter(id => id !== playerId);
      party.continueVotes = party.continueVotes.filter(id => id !== playerId);
      party.lobbyVotes = party.lobbyVotes.filter(id => id !== playerId);

      // If leader leaves, reassign leader
      if (player.isLeader && party.players.length > 0) {
        // Assign to oldest remaining player (first in list)
        party.players[0].isLeader = true;
      }
    }

    if (party.players.length === 0) {
      this.parties.delete(code);
      return;
    }

    this.updateVoteThreshold(party);
    return party;
  }

  disconnectPlayer(socketId: string): Party | undefined {
    const playerId = this.socketToId.get(socketId);
    if (!playerId) return;

    const code = this.idToParty.get(playerId);
    if (!code) return;

    const party = this.parties.get(code);
    if (!party) return;

    const player = party.players.find((p) => p.id === playerId);
    if (player) {
      player.connected = false;
      player.socketId = null;
      player.disconnectedAt = Date.now();
      
      // Remove in-round votes so remaining active players aren't blocked
      // waiting for a disconnected player, or having their vote count inflated.
      // continueVotes/lobbyVotes are intentionally kept — those persist across reconnects.
      const playerId = this.socketToId.get(socketId);
      if (playerId) {
        delete party.votes.votes[playerId];
        party.votes.votedSkip = party.votes.votedSkip.filter(id => id !== playerId);
      }

      // If leader leaves, reassign if any connected players left
      if (player.isLeader) {
        const nextLeader = party.players.find((p) => p.connected);
        if (nextLeader) {
          player.isLeader = false;
          nextLeader.isLeader = true;
        }
      }
    }

    if (party.players.every(p => !p.connected)) {
      party.emptyAt = Date.now();
    }

    this.socketToId.delete(socketId);
    this.updateVoteThreshold(party);
    return party;
  }

  kickPlayer(socketId: string, targetId: string): { party: Party, targetSocketId: string | null } | null {
    const leaderParty = this.getPartyBySocket(socketId);
    if (!leaderParty) return null;
    
    const me = leaderParty.players.find(p => p.socketId === socketId);
    if (!me?.isLeader) return null;

    const targetIndex = leaderParty.players.findIndex(p => p.id === targetId);
    if (targetIndex === -1) return null;

    const target = leaderParty.players[targetIndex];
    if (target.isLeader) return null; // Cannot kick leader

    const targetSocketId = target.socketId;

    // Remove the player
    leaderParty.players.splice(targetIndex, 1);
    
    // Clean up if they had votes
    delete leaderParty.votes.votes[targetId];
    leaderParty.continueVotes = leaderParty.continueVotes.filter(id => id !== targetId);
    leaderParty.lobbyVotes = leaderParty.lobbyVotes.filter(id => id !== targetId);

    this.addSystemMessage(leaderParty.code, `${target.name} has been removed from the network`);
    this.updateVoteThreshold(leaderParty);

    return { party: leaderParty, targetSocketId };
  }

  // General cleanup of stale players and empty parties
  cleanup(): void {
    const now = Date.now();
    for (const [code, party] of this.parties.entries()) {
      // 1. Remove players who have been disconnected for too long
      const originalCount = party.players.length;

      const removedIds: string[] = [];
      party.players = party.players.filter(p => {
        if (p.connected) return true;
        if (!p.disconnectedAt) { removedIds.push(p.id); return false; }
        if ((now - p.disconnectedAt) >= DISCONNECT_GRACE) { removedIds.push(p.id); return false; }
        return true;
      });

      // Clean up votes for removed players
      if (removedIds.length > 0) {
        removedIds.forEach(pid => { delete party.votes.votes[pid]; });
        party.votes.votedSkip = party.votes.votedSkip.filter(id => !removedIds.includes(id));
        party.continueVotes = party.continueVotes.filter(id => !removedIds.includes(id));
        party.lobbyVotes = party.lobbyVotes.filter(id => !removedIds.includes(id));
      }

      // If we removed a player, we might need a new leader
      if (party.players.length < originalCount) {
        if (party.players.length > 0 && !party.players.some(p => p.isLeader)) {
          party.players[0].isLeader = true;
        }
        this.updateVoteThreshold(party);
      }

      // 2. Delete party if empty for too long
      if (party.players.length === 0 || (party.emptyAt && (now - party.emptyAt) > PARTY_EMPTY_GRACE)) {
        this.parties.delete(code);
      }
    }
  }

  startGame(code: string, imposterCount: number, secretWord: string, category = ''): Party | null {
    const party = this.parties.get(code);
    if (!party || (party.game.phase !== GamePhase.LOBBY && party.game.phase !== GamePhase.PREGAME)) return null;
    
    // Minimum 3 players for Imposter game
    if (party.players.length < 3) return null;
    
    // Clamp imposter count based on party size: 3-6: 1, 7-9: 2, 10: 3
    const currentCount = party.players.length;
    let maxAllowed = 1;
    if (currentCount >= 10) maxAllowed = 3;
    else if (currentCount >= 7) maxAllowed = 2;
    party.game.imposterCount = Math.max(1, Math.min(imposterCount, maxAllowed));

    party.game.secretWord = secretWord;
    party.game.category = category;
    party.game.phase = GamePhase.COUNTDOWN;
    party.game.remainingTime = this.TIMES.COUNTDOWN;

    // Assign roles randomly
    const indices = Array.from({ length: party.players.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const imposterIndices = indices.slice(0, party.game.imposterCount);
    party.players.forEach((p, i) => {
      p.role = imposterIndices.includes(i) ? 'imposter' : 'crew';
      p.isDead = false;
    });

    party.votes.votedSkip = [];
    party.votes.votes = {};
    party.continueVotes = [];
    party.lobbyVotes = [];
    party.startVotes = [];
    party.cancelVotes = [];
    party.game.lastEliminated = null;
    party.game.winner = null;
    this.updateVoteThreshold(party);

    return party;
  }

  // --- Pre-game confirmation vote ---

  proposeGame(socketId: string): Party | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.LOBBY) return null;

    const me = party.players.find(p => p.socketId === socketId);
    if (!me?.isLeader) return null;
    if (party.players.length < 3) return null;

    party.game.phase = GamePhase.PREGAME;
    party.game.remainingTime = this.TIMES.PREGAME;
    party.startVotes = [me.id]; // Leader auto-votes yes
    party.cancelVotes = [];
    return party;
  }

  voteStart(socketId: string): { party: Party; shouldStart: boolean } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.PREGAME) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;
    if (party.startVotes.includes(playerId) || party.cancelVotes.includes(playerId)) {
      return { party, shouldStart: false };
    }

    party.startVotes.push(playerId);
    const connected = party.players.filter(p => p.connected).length;
    const shouldStart = party.startVotes.length > connected / 2;
    return { party, shouldStart };
  }

  cancelStart(socketId: string): { party: Party; shouldCancel: boolean } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.PREGAME) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;
    if (party.startVotes.includes(playerId) || party.cancelVotes.includes(playerId)) {
      return { party, shouldCancel: false };
    }

    party.cancelVotes.push(playerId);
    const connected = party.players.filter(p => p.connected).length;
    const shouldCancel = party.cancelVotes.length >= connected / 2; // majority cancel or tie = cancel
    return { party, shouldCancel };
  }

  private revertToLobby(party: Party): void {
    party.game.phase = GamePhase.LOBBY;
    party.game.remainingTime = 0;
    party.startVotes = [];
    party.cancelVotes = [];
  }

  // --- End pre-game ---

  voteContinue(socketId: string): { party: Party; consensus: 'continue' | 'lobby' | null } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.RESULTS) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId || party.continueVotes.includes(playerId) || party.lobbyVotes.includes(playerId)) return null;

    party.continueVotes.push(playerId);
    return this.checkConsensus(party);
  }

  voteLobby(socketId: string): { party: Party; consensus: 'continue' | 'lobby' | null } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.RESULTS) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId || party.continueVotes.includes(playerId) || party.lobbyVotes.includes(playerId)) return null;

    party.lobbyVotes.push(playerId);
    return this.checkConsensus(party);
  }

  private checkConsensus(party: Party): { party: Party; consensus: 'continue' | 'lobby' | null } {
    const connectedCount = party.players.filter(p => p.connected).length;
    const totalVotes = party.continueVotes.length + party.lobbyVotes.length;

    if (totalVotes < connectedCount) {
      return { party, consensus: null };
    }

    const consensus: 'continue' | 'lobby' = party.continueVotes.length >= party.lobbyVotes.length
      ? 'continue'
      : 'lobby';

    // Reset to lobby in both cases; server auto-starts a new game when consensus === 'continue'
    party.game.phase = GamePhase.LOBBY;
    party.game.remainingTime = 0;
    party.game.winner = null;
    party.game.secretWord = null;
    party.game.category = null;
    party.players.forEach(p => {
      p.role = null;
      p.isDead = false;
    });
    party.votes.votes = {};
    party.votes.votedSkip = [];
    party.continueVotes = [];
    party.lobbyVotes = [];
    party.startVotes = [];
    party.cancelVotes = [];

    return { party, consensus };
  }

  votePlayer(socketId: string, targetId: string): Party | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || (party.game.phase !== GamePhase.ROUND && party.game.phase !== GamePhase.VOTING_GRACE)) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    // Check if voter and target are still in game and connected
    const voter = party.players.find(p => p.id === playerId);
    const target = party.players.find(p => p.id === targetId);

    if (!voter || !target || !voter.connected || voter.isDead) return null;

    party.votes.votes[playerId] = targetId;

    // Check if everyone voted
    const activeVoters = party.players.filter(p => p.connected && !p.isDead);
    const votesCast = Object.keys(party.votes.votes).length;

    if (votesCast >= activeVoters.length) {
      this.resolveVotes(party);
    }

    return party;
  }

  private resolveVotes(party: Party) {
    const tally: Record<string, number> = {};
    Object.values(party.votes.votes).forEach(targetId => {
      tally[targetId] = (tally[targetId] || 0) + 1;
    });

    let maxVotes = 0;
    let electedId: string | null = null;
    let tie = false;

    for (const [id, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        electedId = id;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }

    if (electedId && !tie) {
      const eliminated = party.players.find(p => p.id === electedId);
      if (eliminated) {
        eliminated.isDead = true;
        party.game.lastEliminated = eliminated.id;
      }
    } else {
      party.game.lastEliminated = 'TIE';
    }

    party.game.phase = GamePhase.VOTE_RESULTS;
    party.game.remainingTime = this.TIMES.VOTE_RESULTS;
  }

  voteSkip(socketId: string): { party: Party; thresholdMet: boolean } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.ROUND) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    const voter = party.players.find(p => p.id === playerId);
    if (!voter || !voter.connected || voter.isDead) return null;

    if (party.votes.votedSkip.includes(playerId)) return { party, thresholdMet: false };

    party.votes.votedSkip.push(playerId);
    const thresholdMet = party.votes.votedSkip.length >= party.votes.threshold;
    if (thresholdMet) {
      party.game.phase = GamePhase.VOTING_GRACE;
      party.game.remainingTime = this.TIMES.VOTING_GRACE;
    }
    return { party, thresholdMet };
  }

  addMessage(socketId: string, text: string): { party: Party, message: ChatMessage } | null {
    const party = this.getPartyBySocket(socketId);
    if (!party) return null;

    const playerId = this.socketToId.get(socketId);
    const player = party.players.find(p => p.id === playerId);
    if (!player) return null;

    const message = {
      id: Math.random().toString(36).substring(2, 9),
      playerId: player.id,
      playerName: player.name,
      text,
      timestamp: Date.now()
    };

    party.messages.push(message);
    // Keep last 50 messages
    if (party.messages.length > 50) party.messages.shift();

    return { party, message };
  }

  addSystemMessage(code: string, text: string): ChatMessage | null {
    const party = this.parties.get(code);
    if (!party) return null;

    const message = {
      id: Math.random().toString(36).substring(2, 9),
      playerId: 'system' as const,
      playerName: 'Network',
      text,
      timestamp: Date.now()
    };

    party.messages.push(message);
    if (party.messages.length > 50) party.messages.shift();
    return message;
  }

  private updateVoteThreshold(party: Party) {
    const activePlayers = party.players.filter((p) => p.connected && !p.isDead);
    party.votes.threshold = Math.floor(activePlayers.length / 2) + 1;
  }

  private checkWinConditions(party: Party) {
    const alivePlayers = party.players.filter(p => !p.isDead);
    const crewCount = alivePlayers.filter(p => p.role === 'crew').length;
    const imposterCount = alivePlayers.filter(p => p.role === 'imposter').length;

    if (imposterCount === 0) {
      party.game.winner = 'crew';
      party.game.phase = GamePhase.RESULTS;
      party.game.remainingTime = 0; // Infinite time for results
    } else if (imposterCount >= crewCount) {
      party.game.winner = 'imposter';
      party.game.phase = GamePhase.RESULTS;
      party.game.remainingTime = 0; // Infinite time for results
    } else {
      // Continue next round
      party.votes.votes = {};
      party.votes.votedSkip = [];
      party.game.remainingTime = this.TIMES.ROUND;
      party.game.phase = GamePhase.ROUND;
      this.updateVoteThreshold(party);
    }
  }

  tick(): Party[] {
    const updatedParties: Party[] = [];

    for (const party of this.parties.values()) {
      let changed = false;

      if (party.game.remainingTime > 0) {
        party.game.remainingTime--;
        changed = true;

        if (party.game.remainingTime === 0) {
          if (party.game.phase === GamePhase.PREGAME) {
            // Timeout without majority — revert to lobby
            this.revertToLobby(party);
          } else if (party.game.phase === GamePhase.COUNTDOWN) {
            party.game.phase = GamePhase.REVEAL;
            party.game.remainingTime = this.TIMES.REVEAL;
          } else if (party.game.phase === GamePhase.REVEAL) {
            party.game.phase = GamePhase.ROUND;
            party.game.remainingTime = this.TIMES.ROUND;
          } else if (party.game.phase === GamePhase.ROUND) {
            party.game.phase = GamePhase.VOTING_GRACE;
            party.game.remainingTime = this.TIMES.VOTING_GRACE;
          } else if (party.game.phase === GamePhase.VOTING_GRACE) {
            this.resolveVotes(party);
          } else if (party.game.phase === GamePhase.VOTE_RESULTS) {
            this.checkWinConditions(party);
          } else if (party.game.phase === GamePhase.RESULTS) {
            // No auto-reset. Stay in results until consensus.
            party.game.remainingTime = 0;
          }
        }
      }

      if (changed) {
        updatedParties.push(party);
      }
    }
    
    // Run cleanup every 30 seconds (matches disconnect grace period)
    this.cleanupCounter++;
    if (this.cleanupCounter % 30 === 0) {
      this.cleanup();
    }

    return updatedParties;
  }
}

export const gameEngine = new GameEngine();
