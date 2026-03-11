import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './game-engine';

describe('GameEngine', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
  });

  it('should create a party with a leader', () => {
    const code = engine.createParty('p1', 's1', 'Player 1');
    const party = engine.getParty(code);
    expect(party).toBeDefined();
    expect(party?.players[0].id).toBe('p1');
    expect(party?.players[0].isLeader).toBe(true);
  });

  it('should allow players to join until maxPlayers is reached', () => {
    const code = engine.createParty('p1', 's1', 'Leader');
    // Join more so we can have 1 imposter (requires >1 player)
    engine.joinParty(code, 'p2', 's2', 'P2');
    engine.joinParty(code, 'p3', 's3', 'P3');
    engine.updateSettings(code, { maxPlayers: 3, impostersCount: 1 });
    
    expect(engine.joinParty(code, 'p4', 's4', 'P4')).toBeNull(); // Limit reached
  });

  it('should assign roles correctly on start', () => {
    const code = engine.createParty('p1', 's1', 'L');
    engine.joinParty(code, 'p2', 's2', 'P2');
    engine.joinParty(code, 'p3', 's3', 'P3');
    
    engine.startGame(code, 1, 'ASTRONAUT', 'Space');
    const party = engine.getParty(code);
    
    const imposters = party?.players.filter(p => p.role === 'imposter');
    const crew = party?.players.filter(p => p.role === 'crew');
    
    expect(imposters?.length).toBe(1);
    expect(crew?.length).toBe(2);
    expect(party?.game.secretWord).toBe('ASTRONAUT');
    expect(party?.game.category).toBe('Space');
  });

  it('should use short timers in TEST_MODE', () => {
    process.env.TEST_MODE = 'true';
    const engineWithTestMode = new GameEngine();
    const code = engineWithTestMode.createParty('p1', 's1', 'L');
    engineWithTestMode.joinParty(code, 'p2', 's2', 'P2');
    engineWithTestMode.joinParty(code, 'p3', 's3', 'P3');
    
    engineWithTestMode.startGame(code, 1, 'Word', 'TestCategory');
    const party = engineWithTestMode.getParty(code);
    
    // In start_game, it transitions to COUNTDOWN with 5s
    expect(party?.game.remainingTime).toBe(1); // COUNTDOWN_TIME is 1 in TEST_MODE
  });

  describe('Settings Validation', () => {
    it('should validate maxPlayers range (3-10)', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      expect(engine.updateSettings(code, { maxPlayers: 2, impostersCount: 1 })).toBeNull();
      expect(engine.updateSettings(code, { maxPlayers: 11, impostersCount: 1 })).toBeNull();
      expect(engine.updateSettings(code, { maxPlayers: 5, impostersCount: 1 })).not.toBeNull();
    });

    it('should validate impostersCount limits', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      engine.joinParty(code, 'p3', 's3', 'P3');
      
      // 3 players: max 1 imposter according to (3-6:1, 7-9:2, 10:3)
      expect(engine.updateSettings(code, { maxPlayers: 10, impostersCount: 2 })).toBeNull();
      expect(engine.updateSettings(code, { maxPlayers: 10, impostersCount: 1 })).not.toBeNull();

      // 7 players: max 2 imposters
      engine.joinParty(code, 'p4', 's4', 'P4');
      engine.joinParty(code, 'p5', 's5', 'P5');
      engine.joinParty(code, 'p6', 's6', 'P6');
      engine.joinParty(code, 'p7', 's7', 'P7');
      expect(engine.updateSettings(code, { maxPlayers: 10, impostersCount: 2 })).not.toBeNull();
      expect(engine.updateSettings(code, { maxPlayers: 10, impostersCount: 3 })).toBeNull();
    });

    it('should not allow maxPlayers below current player count', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      engine.joinParty(code, 'p3', 's3', 'P3');
      expect(engine.updateSettings(code, { maxPlayers: 2, impostersCount: 1 })).toBeNull();
    });
  });

  describe('Leader Transfer', () => {
    it('should transfer leader when current leader leaves', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      
      engine.leaveParty('s1');
      const party = engine.getParty(code);
      expect(party?.players.length).toBe(1);
      expect(party?.players[0].id).toBe('p2');
      expect(party?.players[0].isLeader).toBe(true);
    });

    it('should transfer leader when current leader disconnects', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      
      engine.disconnectPlayer('s1');
      const party = engine.getParty(code);
      const player1 = party?.players.find(p => p.id === 'p1');
      const player2 = party?.players.find(p => p.id === 'p2');
      expect(player1?.isLeader).toBe(false);
      expect(player2?.isLeader).toBe(true);
    });
  });

  describe('Disband and Leave', () => {
    it('should delete party and return player IDs on disband', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      const ids = engine.disbandParty(code);
      expect(ids).toContain('p1');
      expect(ids).toContain('p2');
      expect(engine.getParty(code)).toBeUndefined();
    });

    it('should delete party if last player leaves', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.leaveParty('s1');
      expect(engine.getParty(code)).toBeUndefined();
    });
  });

  describe('Vote Majority', () => {
    it('should calculate correct threshold (floor(n/2)+1)', () => {
      const code = engine.createParty('p1', 's1', 'L');
      engine.joinParty(code, 'p2', 's2', 'P2');
      engine.joinParty(code, 'p3', 's3', 'P3'); // 3 players
      
      const party = engine.getParty(code);
      expect(party?.votes.threshold).toBe(2); // 3/2 = 1.5 -> 1 + 1 = 2

      engine.joinParty(code, 'p4', 's4', 'P4'); // 4 players
      expect(party?.votes.threshold).toBe(3); // 4/2 = 2 -> 2 + 1 = 3
    });
  });
});
