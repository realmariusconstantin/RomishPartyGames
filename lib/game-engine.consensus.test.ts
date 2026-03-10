import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './game-engine';
import { GamePhase } from './types';

describe('GameEngine - Kick and Consensus Logic', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
  });

  describe('Kick Logic', () => {
    it('should allow leader to kick a player', () => {
      const code = engine.createParty('p1', 's1', 'Leader');
      engine.joinParty(code, 'p2', 's2', 'P2');
      
      const result = engine.kickPlayer('s1', 'p2');
      expect(result).not.toBeNull();
      expect(result?.party.players.length).toBe(1);
      expect(result?.targetSocketId).toBe('s2');
      
      const party = engine.getParty(code);
      expect(party?.players.length).toBe(1);
    });

    it('should not allow non-leader to kick a player', () => {
      const code = engine.createParty('p1', 's1', 'Leader');
      engine.joinParty(code, 'p2', 's2', 'P2');
      engine.joinParty(code, 'p3', 's3', 'P3');
      
      const result = engine.kickPlayer('s2', 'p3');
      expect(result).toBeNull();
      
      const party = engine.getParty(code);
      expect(party?.players.length).toBe(3);
    });

    it('should not allow kicking the leader', () => {
      engine.createParty('p1', 's1', 'Leader');
      const result = engine.kickPlayer('s1', 'p1');
      expect(result).toBeNull();
    });
  });

  describe('Consensus Logic', () => {
    it('should transition to lobby if majority votes for lobby', () => {
      const code = engine.createParty('p1', 's1', 'P1');
      engine.joinParty(code, 'p2', 's2', 'P2');
      engine.joinParty(code, 'p3', 's3', 'P3');
      
      // Manually set to Results phase
      const party = engine.getParty(code)!;
      party.game.phase = GamePhase.RESULTS;
      
      engine.voteLobby('s1');
      engine.voteLobby('s2');
      engine.voteContinue('s3');
      
      expect(party.game.phase).toBe(GamePhase.LOBBY);
      expect(party.continueVotes.length).toBe(0);
      expect(party.lobbyVotes.length).toBe(0);
    });

    it('should restart game settings if majority votes to continue', () => {
      const code = engine.createParty('p1', 's1', 'P1');
      engine.joinParty(code, 'p2', 's2', 'P2');
      engine.joinParty(code, 'p3', 's3', 'P3');
      
      const party = engine.getParty(code)!;
      party.game.phase = GamePhase.RESULTS;
      party.game.winner = 'crew';
      
      engine.voteContinue('s1');
      engine.voteContinue('s2');
      engine.voteLobby('s3');
      
      expect(party.game.phase).toBe(GamePhase.LOBBY);
      expect(party.game.winner).toBeNull();
    });

    it('should NOT transition until all connected players vote', () => {
      const code = engine.createParty('p1', 's1', 'P1');
      engine.joinParty(code, 'p2', 's2', 'P2');
      
      const party = engine.getParty(code)!;
      party.game.phase = GamePhase.RESULTS;
      
      engine.voteContinue('s1');
      expect(party.game.phase).toBe(GamePhase.RESULTS);
      
      engine.voteContinue('s2');
      expect(party.game.phase).toBe(GamePhase.LOBBY);
    });
  });
});

describe('GameEngine - Double-vote prevention', () => {
  let engine: GameEngine;
  let code: string;

  beforeEach(() => {
    engine = new GameEngine();
    code = engine.createParty('p1', 's1', 'P1');
    engine.joinParty(code, 'p2', 's2', 'P2');

    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.RESULTS;
    party.game.winner = 'crew';
  });

  it('should reject a second voteContinue from the same player', () => {
    engine.voteContinue('s1');
    const second = engine.voteContinue('s1');
    expect(second).toBeNull();

    const party = engine.getParty(code)!;
    expect(party.continueVotes.filter(id => id === 'p1').length).toBe(1);
  });

  it('should reject voteLobby from a player who already voted continue', () => {
    engine.voteContinue('s1');
    const crossVote = engine.voteLobby('s1');
    expect(crossVote).toBeNull();

    const party = engine.getParty(code)!;
    expect(party.lobbyVotes).not.toContain('p1');
  });

  it('should reject voteContinue from a player who already voted lobby', () => {
    engine.voteLobby('s1');
    const crossVote = engine.voteContinue('s1');
    expect(crossVote).toBeNull();

    const party = engine.getParty(code)!;
    expect(party.continueVotes).not.toContain('p1');
  });
});

describe('GameEngine - disbandParty and vote cleanup on leave', () => {
  let engine: GameEngine;
  let code: string;

  beforeEach(() => {
    engine = new GameEngine();
    code = engine.createParty('p1', 's1', 'Leader');
    engine.joinParty(code, 'p2', 's2', 'P2');
    engine.joinParty(code, 'p3', 's3', 'P3');
  });

  it('disbandParty removes the party and returns all player IDs', () => {
    const ids = engine.disbandParty(code);
    expect(ids).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']));
    expect(engine.getParty(code)).toBeUndefined();
  });

  it('disbandParty cleans up identity maps so players cannot look up the old party', () => {
    engine.disbandParty(code);
    expect(engine.getPartyByPlayerId('p1')).toBeUndefined();
    expect(engine.getPartyBySocket('s1')).toBeUndefined();
  });

  it('leaveParty cleans up the leaving player skip vote', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.ROUND;
    party.game.remainingTime = 10;
    engine.voteSkip('s2'); // p2 votes to skip
    expect(party.votes.votedSkip).toContain('p2');

    engine.leaveParty('s2'); // p2 leaves
    expect(party.votes.votedSkip).not.toContain('p2');
  });

  it('leaveParty cleans up the leaving player cast vote', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.VOTING_GRACE;
    engine.votePlayer('s2', 'p3'); // p2 votes for p3
    expect(party.votes.votes['p2']).toBe('p3');

    engine.leaveParty('s2');
    expect(party.votes.votes['p2']).toBeUndefined();
  });

  it('leaveParty cleans up continue/lobby votes', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.RESULTS;
    engine.voteContinue('s2');
    engine.voteLobby('s3');
    expect(party.continueVotes).toContain('p2');
    expect(party.lobbyVotes).toContain('p3');

    engine.leaveParty('s2');
    engine.leaveParty('s3');
    expect(party.continueVotes).not.toContain('p2');
    expect(party.lobbyVotes).not.toContain('p3');
  });

  it('disconnectPlayer removes in-round skip vote to avoid stale tally', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.ROUND;
    party.game.remainingTime = 10;
    engine.voteSkip('s2'); // p2 votes to skip
    expect(party.votes.votedSkip).toContain('p2');

    engine.disconnectPlayer('s2');
    expect(party.votes.votedSkip).not.toContain('p2');
  });

  it('disconnectPlayer removes cast vote to avoid inflating tally', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.VOTING_GRACE;
    engine.votePlayer('s2', 'p3');
    expect(party.votes.votes['p2']).toBe('p3');

    engine.disconnectPlayer('s2');
    expect(party.votes.votes['p2']).toBeUndefined();
  });
});
