/**
 * server.ts — Entry point for the Node.js process.
 *
 * Wires together three things:
 *  1. Express — used only as an adapter to hand HTTP requests to Next.js
 *  2. Socket.IO — all real-time game communication
 *  3. Next.js — serves the React frontend
 *
 * All game state lives in the in-memory `gameEngine` singleton (lib/game-engine.ts).
 * There is no database; if the process restarts, all parties are lost.
 */

import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import express from 'express';
import { gameEngine } from './lib/game-engine';
import { ClientToServerEvents, ServerToClientEvents, GamePhase, Party } from './lib/types';
import { getRandomWord } from './lib/wordpacks';

const dev      = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port     = 3000;

const app    = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ---------------------------------------------------------------------------
// getSafeState
// ---------------------------------------------------------------------------

/**
 * Strips server-only fields before sending party state to a specific player:
 *  - Other players' roles are hidden (except when the viewer is an impostor,
 *    who can see fellow impostors, or when the game is over and all are revealed)
 *  - The secret word is hidden from impostors (they don't know the word)
 *  - Internal socketIds are never sent to clients
 */
function getSafeState(party: Party, playerId: string): Party {
  const me         = party.players.find(p => p.id === playerId);
  const isImposter = me?.role === 'imposter';
  const isGameOver = party.game.phase === GamePhase.RESULTS;

  return {
    ...party,
    players: party.players.map(p => ({
      ...p,
      // Reveal role only to the player themselves, to fellow impostors, or after game over
      role:     (isGameOver || p.id === playerId || (isImposter && p.role === 'imposter'))
        ? p.role
        : null,
      socketId: null, // Never expose internal socket IDs
    })),
    game: {
      ...party.game,
      // Crew sees the word; impostors must not (they're posing as if they know)
      secretWord: (me?.role === 'crew' || isGameOver) ? party.game.secretWord : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

app.prepare().then(() => {
  const server     = express();
  const httpServer = createServer(server);

  /**
   * Typed Socket.IO server — ClientToServerEvents describes what the browser
   * emits, ServerToClientEvents what the server emits.
   */
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

  // -------------------------------------------------------------------------
  // broadcastState
  // -------------------------------------------------------------------------

  /**
   * Sends a personalised state snapshot to every connected player in a party.
   * Each player receives a version with sensitive information stripped for their
   * specific perspective (see getSafeState).
   */
  const broadcastState = (code: string) => {
    const party = gameEngine.getParty(code);
    if (!party) return;

    party.players.forEach(p => {
      if (p.socketId) {
        io.to(p.socketId).emit('state_update', getSafeState(party, p.id));
      }
    });
  };

  // -------------------------------------------------------------------------
  // Game loop — 1-second tick
  // -------------------------------------------------------------------------

  /**
   * Drives the phase state machine for all active parties. GameEngine.tick()
   * returns only the parties that changed this tick, so we only broadcast to
   * rooms that actually need an update.
   */
  setInterval(() => {
    const updatedParties = gameEngine.tick();
    updatedParties.forEach(party => broadcastState(party.code));
  }, 1000);

  // -------------------------------------------------------------------------
  // Socket event handlers
  // -------------------------------------------------------------------------

  io.on('connection', (socket) => {
    const playerId = socket.handshake.auth.playerId as string;
    console.log(`[Socket] OPEN: ${socket.id} | PlayerID: ${playerId}`);

    // --- Party management ---------------------------------------------------

    socket.on('create_party', (name) => {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 20) {
        return socket.emit('error', 'Invalid name (1–20 characters)');
      }
      console.log(`[Party] Create: ${name} (ID: ${playerId})`);
      const code = gameEngine.createParty(playerId, socket.id, name);
      socket.join(code);
      socket.emit('party_created', code);
      broadcastState(code);
    });

    socket.on('join_party', (code, name) => {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 20) {
        return socket.emit('error', 'Invalid name (1–20 characters)');
      }
      const result = gameEngine.joinParty(code.toUpperCase(), playerId, socket.id, name);
      if (result) {
        const { party, isNew } = result;
        console.log(`[Party] Join: ${name} to ${party.code} (ID: ${playerId})`);
        socket.join(party.code);
        // Only emit the join system message for genuinely new players, not reconnects
        if (isNew) {
          gameEngine.addSystemMessage(party.code, `${name} has joined the network`);
        }
        broadcastState(party.code);
      } else {
        console.log(`[Party] Join Failed: ${name} to ${code} (ID: ${playerId})`);
        socket.emit('error', 'Party not found, full, or already started');
      }
    });

    /** Client requests a full state push — used on reconnect and tab-visibility change. */
    socket.on('state:sync', () => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      if (party) {
        socket.emit('state_update', getSafeState(party, playerId));
      }
    });

    socket.on('party:updateSettings', (settings) => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me    = party?.players.find(p => p.id === playerId);

      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can update settings');
      if (party.game.phase !== GamePhase.LOBBY) return socket.emit('error', 'Settings can only be changed in lobby');

      const updated = gameEngine.updateSettings(party.code, settings);
      if (updated) {
        broadcastState(party.code);
      } else {
        socket.emit('error', 'Invalid settings: Check player count and limits (3-10 players, valid language)');
      }
    });

    socket.on('party:disband', () => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me    = party?.players.find(p => p.id === playerId);

      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can disband the party');

      // Notify all members before removing the party from memory
      io.to(party.code).emit('party:disbanded');
      gameEngine.disbandParty(party.code);
    });

    socket.on('party:leave', () => {
      const party = gameEngine.getPartyBySocket(socket.id);
      const name  = party?.players.find(p => p.socketId === socket.id)?.name;
      const code  = party?.code;

      const updatedParty = gameEngine.leaveParty(socket.id);
      if (updatedParty) {
        if (name) gameEngine.addSystemMessage(updatedParty.code, `${name} has left the network`);
        broadcastState(updatedParty.code);
      }
      // Tell the leaver's socket to reset as well (same event the server sends for disband)
      socket.emit('party:disbanded');
      socket.leave(code || '');
    });

    socket.on('kick_player', (targetId) => {
      const result = gameEngine.kickPlayer(socket.id, targetId);
      if (result) {
        const { party, targetSocketId } = result;
        broadcastState(party.code);
        // Force the kicked player's browser to redirect to home
        if (targetSocketId) {
          io.to(targetSocketId).emit('party:disbanded');
        }
      }
    });

    // --- Pre-game vote ------------------------------------------------------

    socket.on('propose_game', () => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me    = party?.players.find(p => p.id === playerId);

      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can start the game');
      if (party.game.phase !== GamePhase.LOBBY) return socket.emit('error', 'Game is not in lobby');
      if (party.players.length < 3) return socket.emit('error', 'Minimum 3 agents required');

      const proposed = gameEngine.proposeGame(socket.id);
      if (proposed) {
        console.log(`[Game] Pre-game vote started for party ${proposed.code}`);
        broadcastState(proposed.code);
      }
    });

    socket.on('vote_start', () => {
      const result = gameEngine.voteStart(socket.id);
      if (!result) return;
      if (result.shouldStart) {
        // Majority voted yes — pick a random word and kick off the game
        const { party }  = result;
        const mission    = getRandomWord(party.settings.language || 'english');
        gameEngine.startGame(party.code, party.settings.impostersCount, mission.word, mission.category);
        console.log(`[Game] Starting party ${party.code} | word: ${mission.word} | lang: ${party.settings.language}`);
      }
      broadcastState(result.party.code);
    });

    socket.on('cancel_start', () => {
      const result = gameEngine.cancelStart(socket.id);
      if (!result) return;
      if (result.shouldCancel) {
        console.log(`[Game] Pre-game cancelled for party ${result.party.code}`);
      }
      broadcastState(result.party.code);
    });

    // --- In-round voting ----------------------------------------------------

    socket.on('vote_player', (targetId) => {
      const updatedParty = gameEngine.votePlayer(socket.id, targetId);
      if (updatedParty) {
        broadcastState(updatedParty.code);
      }
    });

    socket.on('vote_skip', () => {
      const result = gameEngine.voteSkip(socket.id);
      if (result) {
        broadcastState(result.party.code);
        if (result.thresholdMet) {
          console.log(`[Game] Party ${result.party.code} skip vote passed`);
          io.to(result.party.code).emit('vote:passed');
        }
      }
    });

    // --- Chat ---------------------------------------------------------------

    socket.on('send_message', (text) => {
      if (typeof text !== 'string' || text.trim().length === 0 || text.length > 500) return;
      const result = gameEngine.addMessage(socket.id, text);
      if (result) {
        broadcastState(result.party.code);
      }
    });

    // --- Post-game vote -----------------------------------------------------

    socket.on('vote_continue', () => {
      const result = gameEngine.voteContinue(socket.id);
      if (result) {
        if (result.consensus === 'continue') {
          // Majority wants to play again — start a new game immediately
          const mission = getRandomWord(result.party.settings.language || 'english');
          gameEngine.startGame(result.party.code, result.party.settings.impostersCount, mission.word, mission.category);
        }
        broadcastState(result.party.code);
      }
    });

    socket.on('vote_lobby', () => {
      const result = gameEngine.voteLobby(socket.id);
      if (result) {
        broadcastState(result.party.code);
      }
    });

    // --- Connection lifecycle ------------------------------------------------

    socket.on('disconnect', () => {
      const party = gameEngine.disconnectPlayer(socket.id);
      if (party) {
        console.log(`[Socket] Disconnected: ${socket.id} (Player: ${playerId})`);
        broadcastState(party.code);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Next.js catch-all — must come after Socket.IO setup
  // -------------------------------------------------------------------------

  server.all('*path', (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
