import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import express from 'express';
import { gameEngine } from './lib/game-engine';
import { ClientToServerEvents, ServerToClientEvents, GamePhase } from './lib/types';
import { MISSION_DATABASE } from './lib/game-data';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function getSafeState(party: any, playerId: string) {
  const me = party.players.find((p: any) => p.id === playerId);
  const isImposter = me?.role === 'imposter';
  const isGameOver = party.game.phase === GamePhase.RESULTS;

  return {
    ...party,
    players: party.players.map((p: any) => ({
      ...p,
      role: (isGameOver || p.id === playerId || (isImposter && p.role === 'imposter')) ? p.role : null,
      socketId: undefined, // Hide internal socket IDs
    })),
    game: {
      ...party.game,
      secretWord: (me?.role === 'crew' || isGameOver) ? party.game.secretWord : null,
      hint: (isImposter || isGameOver) ? party.game.hint : null,
    }
  };
}

app.prepare().then(() => {
  const server = express();
  const httpServer = createServer(server);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

  const broadcastState = (code: string) => {
    const party = gameEngine.getParty(code);
    if (!party) return;
    
    // Send personalized state to each player in the room
    party.players.forEach(p => {
      if (p.socketId) {
        io.to(p.socketId).emit('state_update', getSafeState(party, p.id));
      }
    });
  };

  // Global game loop for ticking
  setInterval(() => {
    const updatedParties = gameEngine.tick();
    updatedParties.forEach(party => broadcastState(party.code));
  }, 1000);

  io.on('connection', (socket) => {
    const playerId = socket.handshake.auth.playerId as string;
    console.log(`[Socket] OPEN: ${socket.id} | PlayerID: ${playerId}`);

    socket.on('create_party', (name) => {
      console.log(`[Party] Create: ${name} (ID: ${playerId})`);
      const code = gameEngine.createParty(playerId, socket.id, name);
      socket.join(code);
      socket.emit('party_created', code);
      broadcastState(code);
    });

    socket.on('join_party', (code, name) => {
      const party = gameEngine.joinParty(code.toUpperCase(), playerId, socket.id, name);
      if (party) {
        console.log(`[Party] Join: ${name} to ${party.code} (ID: ${playerId})`);
        socket.join(party.code);
        broadcastState(party.code);
      } else {
        console.log(`[Party] Join Failed: ${name} to ${code} (ID: ${playerId})`);
        socket.emit('error', 'Party not found, full, or already started');
      }
    });

    // Handle state:sync
    socket.on('state:sync', () => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      if (party) {
        socket.emit('state_update', getSafeState(party, playerId));
      }
    });

    socket.on('start_game', (imposterCount) => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me = party?.players.find(p => p.id === playerId);
      
      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can start the game');
      if (party.game.phase !== GamePhase.LOBBY) return socket.emit('error', 'Game already started');
      
      // Use provided imposterCount or fall back to settings
      const count = imposterCount || party.settings.impostersCount;
      if (party.players.length < 3) return socket.emit('error', 'Minimum 3 agents required');
      if (count >= party.players.length) return socket.emit('error', 'Too many imposters');

      console.log(`[Game] Starting party ${party.code} with ${count} imposters`);
      const mission = MISSION_DATABASE[Math.floor(Math.random() * MISSION_DATABASE.length)];
      const updatedParty = gameEngine.startGame(party.code, count, mission.word, mission.hint);
      
      if (updatedParty) {
        broadcastState(party.code);
      }
    });

    socket.on('party:updateSettings', (settings) => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me = party?.players.find(p => p.id === playerId);
      
      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can update settings');
      if (party.game.phase !== GamePhase.LOBBY) return socket.emit('error', 'Settings can only be changed in lobby');

      const updated = gameEngine.updateSettings(party.code, settings);
      if (updated) {
        broadcastState(party.code);
        io.to(party.code).emit('party:settingsUpdated', settings);
      } else {
        socket.emit('error', 'Invalid settings: Check player count and limits (3-10 players)');
      }
    });

    socket.on('party:disband', () => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me = party?.players.find(p => p.id === playerId);
      
      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can disband the party');

      io.to(party.code).emit('party:disbanded');
      gameEngine.disbandParty(party.code);
    });

    socket.on('party:leave', () => {
      const party = gameEngine.leaveParty(socket.id);
      if (party) {
        broadcastState(party.code);
      }
      socket.emit('party:disbanded'); // Also clear state for the leaver
      socket.leave(party ? party.code : ''); 
    });

    socket.on('vote_skip', () => {
      const result = gameEngine.voteSkip(socket.id);
      if (result) {
        broadcastState(result.party.code);
        if (result.thresholdMet) {
          console.log(`[Game] Party ${result.party.code} skip vote passed`);
          io.to(result.party.code).emit('vote:passed' as any);
        }
      }
    });

    socket.on('vote_player', (targetId) => {
      const updatedParty = gameEngine.votePlayer(socket.id, targetId);
      if (updatedParty) {
        broadcastState(updatedParty.code);
      }
    });

    socket.on('disconnect', () => {
      const party = gameEngine.disconnectPlayer(socket.id);
      if (party) {
        console.log(`[Socket] Disconnected: ${socket.id} (Player: ${playerId})`);
        broadcastState(party.code);
      }
    });
  });

  server.all('*path', (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
