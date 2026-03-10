import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './game-engine';
import { GamePhase } from './types';

describe('GameEngine - Voting Flow', () => {
  let engine: GameEngine;
  let code: string;

  beforeEach(() => {
    process.env.TEST_MODE = 'true';
    engine = new GameEngine();
    code = engine.createParty('p1', 's1', 'Leader');
    engine.joinParty(code, 'p2', 's2', 'P2');
    engine.joinParty(code, 'p3', 's3', 'P3');
    engine.startGame(code, 1, 'ASTRONAUT', 'Space');
    
    // Skip Reveal and Countdown to get to ROUND
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.ROUND;
    party.game.remainingTime = 10;
  });

  it('should transition to VOTING_GRACE when ROUND timer ends', () => {
    const party = engine.getParty(code)!;
    party.game.remainingTime = 1;
    engine.tick();
    
    expect(party.game.phase).toBe(GamePhase.VOTING_GRACE);
    expect(party.game.remainingTime).toBeGreaterThan(0);
  });

  it('should transition to VOTE_RESULTS after VOTING_GRACE ends', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.VOTING_GRACE;
    party.game.remainingTime = 1;
    engine.tick();
    
    expect(party.game.phase).toBe(GamePhase.VOTE_RESULTS);
  });

  it('should mark a player as isDead and not remove them on majority vote', () => {
    const party = engine.getParty(code)!;
    engine.votePlayer('s1', 'p2');
    engine.votePlayer('s2', 'p2');
    engine.votePlayer('s3', 'p2'); // Majority for p2
    
    expect(party.game.phase).toBe(GamePhase.VOTE_RESULTS);
    expect(party.game.lastEliminated).toBe('p2');
    
    const p2 = party.players.find(p => p.id === 'p2')!;
    expect(p2.isDead).toBe(true);
    expect(party.players.length).toBe(3); // p2 still in party
  });

  it('should prevent isDead players from voting', () => {
    const party = engine.getParty(code)!;
    const p1 = party.players.find(p => p.id === 'p1')!;
    p1.isDead = true;
    
    engine.votePlayer('s1', 'p2');
    expect(party.votes.votes['p1']).toBeUndefined();
  });

  it('should transition to RESULTS if all imposters are dead', () => {
    const party = engine.getParty(code)!;
    // Force one player as imposter
    party.players.forEach(p => p.role = 'crew');
    party.players[1].role = 'imposter'; // p2 is imposter
    
    // Vote p2 out
    engine.votePlayer('s1', 'p2');
    engine.votePlayer('s2', 'p2');
    engine.votePlayer('s3', 'p2'); // p2 voted out
    
    expect(party.game.phase).toBe(GamePhase.VOTE_RESULTS);
    
    // End VOTE_RESULTS phase
    party.game.remainingTime = 1;
    engine.tick();
    
    expect(party.game.phase).toBe(GamePhase.RESULTS);
    expect(party.game.winner).toBe('crew');
  });
});

describe('GameEngine - voteSkip', () => {
  let engine: GameEngine;
  let code: string;

  beforeEach(() => {
    process.env.TEST_MODE = 'true';
    engine = new GameEngine();
    code = engine.createParty('p1', 's1', 'Leader');
    engine.joinParty(code, 'p2', 's2', 'P2');
    engine.joinParty(code, 'p3', 's3', 'P3');
    engine.startGame(code, 1, 'ASTRONAUT', 'Space');

    // Fast-forward to ROUND phase
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.ROUND;
    party.game.remainingTime = 10;
  });

  it('should record a skip vote and not trigger threshold with 1/3 votes', () => {
    const party = engine.getParty(code)!;
    const result = engine.voteSkip('s1');

    expect(result).not.toBeNull();
    expect(result!.thresholdMet).toBe(false);
    expect(party.votes.votedSkip).toContain('p1');
    expect(party.game.phase).toBe(GamePhase.ROUND);
  });

  it('should transition to VOTING_GRACE when threshold is met', () => {
    const party = engine.getParty(code)!;
    // threshold for 3 players = floor(3/2)+1 = 2
    engine.voteSkip('s1');
    const result = engine.voteSkip('s2');

    expect(result!.thresholdMet).toBe(true);
    expect(party.game.phase).toBe(GamePhase.VOTING_GRACE);
    expect(party.game.remainingTime).toBeGreaterThan(0);
  });

  it('should prevent a player from voting to skip twice', () => {
    engine.voteSkip('s1');
    const secondVote = engine.voteSkip('s1');

    expect(secondVote).not.toBeNull();
    expect(secondVote!.thresholdMet).toBe(false);

    const party = engine.getParty(code)!;
    const skips = party.votes.votedSkip.filter(id => id === 'p1');
    expect(skips.length).toBe(1); // only counted once
  });

  it('should reject voteSkip outside of ROUND phase', () => {
    const party = engine.getParty(code)!;
    party.game.phase = GamePhase.LOBBY;

    const result = engine.voteSkip('s1');
    expect(result).toBeNull();
  });

  it('should reject voteSkip from a dead player', () => {
    const party = engine.getParty(code)!;
    const p1 = party.players.find(p => p.id === 'p1')!;
    p1.isDead = true;

    const result = engine.voteSkip('s1');
    expect(result).toBeNull();
  });
});
