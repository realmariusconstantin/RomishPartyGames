import { Party, GamePhase } from './types';

const DISCONNECT_GRACE = 30000; // 30 seconds
const PARTY_EMPTY_GRACE = 120000; // 2 minutes

export class GameEngine {
  private parties: Map<string, Party & { emptyAt: number | null }> = new Map();
  private socketToId: Map<string, string> = new Map();
  private idToParty: Map<string, string> = new Map();

  private get TIMES() {
    const isTest = process.env.TEST_MODE === 'true';
    return {
      ROUND: isTest ? 10 : 120,
      REVEAL: isTest ? 2 : 5,
      COUNTDOWN: isTest ? 1 : 5,
      RESULTS: isTest ? 2 : 10
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
        hint: null,
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
      }
    };
    this.parties.set(code, party);
    this.socketToId.set(socketId, playerId);
    this.idToParty.set(playerId, code);
    return code;
  }

  joinParty(code: string, playerId: string, socketId: string, playerName: string): Party | null {
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
      return party;
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
    });
    
    party.emptyAt = null;
    this.socketToId.set(socketId, playerId);
    this.idToParty.set(playerId, code);
    this.updateVoteThreshold(party);
    return party;
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

    party.settings = settings;
    party.game.imposterCount = settings.impostersCount; // Sync game state
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

  // General cleanup of stale players and empty parties
  cleanup(): void {
    const now = Date.now();
    for (const [code, party] of this.parties.entries()) {
      // 1. Remove players who have been disconnected for too long
      const originalCount = party.players.length;
      party.players = party.players.filter(p => {
        if (p.connected) return true;
        if (!p.disconnectedAt) return false;
        return (now - p.disconnectedAt) < DISCONNECT_GRACE;
      });

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

  startGame(code: string, imposterCount: number, secretWord: string, hint: string): Party | null {
    const party = this.parties.get(code);
    if (!party || party.game.phase !== GamePhase.LOBBY) return null;
    
    // Minimum 3 players for Imposter game
    if (party.players.length < 3) return null;
    
    // Clamp imposter count based on party size: 3-6: 1, 7-9: 2, 10: 3
    const currentCount = party.players.length;
    let maxAllowed = 1;
    if (currentCount >= 10) maxAllowed = 3;
    else if (currentCount >= 7) maxAllowed = 2;
    party.game.imposterCount = Math.max(1, Math.min(imposterCount, maxAllowed));

    party.game.secretWord = secretWord;
    party.game.hint = hint;
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
    });

    party.votes.votedSkip = [];
    party.votes.votes = {};
    party.game.lastEliminated = null;
    party.game.winner = null;
    this.updateVoteThreshold(party);

    return party;
  }

  votePlayer(socketId: string, targetId: string): Party | null {
    const party = this.getPartyBySocket(socketId);
    if (!party || party.game.phase !== GamePhase.ROUND) return null;

    const playerId = this.socketToId.get(socketId);
    if (!playerId) return null;

    // Check if voter and target are still in game and connected
    const voter = party.players.find(p => p.id === playerId);
    const target = party.players.find(p => p.id === targetId);

    if (!voter || !target || !voter.connected) return null;

    party.votes.votes[playerId] = targetId;

    // Check if everyone voted
    const activeVoters = party.players.filter(p => p.connected);
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
      const index = party.players.findIndex(p => p.id === electedId);
      if (index !== -1) {
        const eliminated = party.players[index];
        party.game.lastEliminated = eliminated.id;
        // Mark as role-revealed but don't delete from array if we want 
        // to keep their socket connection for the Results screen.
        // Actually, we use party.players.filter(p => p.role === 'imposter') in results.
        // If we remove them from party.players, their server-side state is gone.
        // Let's set a flag instead or just handle the count.
        
        // Fix: Leave the player in the array but remove their role/mark as spectator
        // so they can see the results phase with the rest of the players.
        eliminated.connected = false; // "Soft" remove to stop them from voting
        party.game.lastEliminated = eliminated.id;
      }
    } else {
      party.game.lastEliminated = 'TIE';
    }

    // Check Win Conditions
    const alivePlayers = party.players.filter(p => !party.game.lastEliminated || p.id !== party.game.lastEliminated);
    const crewCount = party.players.filter(p => p.role === 'crew' && p.id !== party.game.lastEliminated).length;
    const imposterCount = party.players.filter(p => p.role === 'imposter' && p.id !== party.game.lastEliminated).length;

    if (imposterCount === 0) {
      party.game.winner = 'crew';
      party.game.phase = GamePhase.RESULTS;
      party.game.remainingTime = this.TIMES.RESULTS;
    } else if (imposterCount >= crewCount) {
      party.game.winner = 'imposter';
      party.game.phase = GamePhase.RESULTS;
      party.game.remainingTime = this.TIMES.RESULTS;
    } else {
      // Continue to next round if not ended
      // Actually remove the eliminated player from the main roster now so they don't count for next round
      if (party.game.lastEliminated && party.game.lastEliminated !== 'TIE') {
        const idx = party.players.findIndex(p => p.id === party.game.lastEliminated);
        if (idx !== -1) {
          const eliminated = party.players.splice(idx, 1)[0];
          this.idToParty.delete(eliminated.id);
        }
      }
      
      party.votes.votes = {};
      party.votes.votedSkip = [];
      party.game.remainingTime = this.TIMES.ROUND;
      this.updateVoteThreshold(party);
    }
  }

  voteSkip(socketId: string): { party: Party; thresholdMet: boolean } | null {
    return null;
  }

  private updateVoteThreshold(party: Party) {
    const activePlayers = party.players.filter((p) => p.connected);
    party.votes.threshold = Math.floor(activePlayers.length / 2) + 1;
  }

  tick(): Party[] {
    const updatedParties: Party[] = [];
    const now = Date.now();

    for (const [code, party] of this.parties.entries()) {
      let changed = false;

      if (party.game.remainingTime > 0) {
        party.game.remainingTime--;
        changed = true;

        if (party.game.remainingTime === 0) {
          if (party.game.phase === GamePhase.COUNTDOWN) {
            party.game.phase = GamePhase.REVEAL;
            party.game.remainingTime = this.TIMES.REVEAL;
          } else if (party.game.phase === GamePhase.REVEAL) {
            party.game.phase = GamePhase.ROUND;
            party.game.remainingTime = this.TIMES.ROUND;
          } else if (party.game.phase === GamePhase.ROUND) {
            this.resolveVotes(party);
          } else if (party.game.phase === GamePhase.RESULTS) {
            party.game.phase = GamePhase.LOBBY;
            party.game.remainingTime = 0;
            party.game.winner = null;
            // Clean up roles and votes for next game
            party.players.forEach(p => p.role = null);
            party.votes.votes = {};
            party.votes.votedSkip = [];
          }
        }
      }

      if (changed) {
        updatedParties.push(party);
      }
    }
    
    // Periodically cleanup
    this.cleanup();

    return updatedParties;
  }
}

export const gameEngine = new GameEngine();
