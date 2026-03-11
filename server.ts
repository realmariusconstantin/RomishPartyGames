import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import express from 'express';
import { gameEngine } from './lib/game-engine';
import { ClientToServerEvents, ServerToClientEvents, GamePhase, Party } from './lib/types';
import { getRandomWord } from './lib/wordpacks';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function getSafeState(party: Party, playerId: string): Party {
  const me = party.players.find(p => p.id === playerId);
  const isImposter = me?.role === 'imposter';
  const isGameOver = party.game.phase === GamePhase.RESULTS;

  return {
    ...party,
    players: party.players.map(p => ({
      ...p,
      role: (isGameOver || p.id === playerId || (isImposter && p.role === 'imposter')) ? p.role : null,
      socketId: null, // Hide internal socket IDs from clients
    })),
    game: {
      ...party.game,
      secretWord: (me?.role === 'crew' || isGameOver) ? party.game.secretWord : null,
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
        if (isNew) {
           gameEngine.addSystemMessage(party.code, `${name} has joined the network`);
        }
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

    socket.on('propose_game', () => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me = party?.players.find(p => p.id === playerId);

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
        const { party } = result;
        const mission = getRandomWord(party.settings.language || 'english');
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


    socket.on('party:updateSettings', (settings) => {
      const party = gameEngine.getPartyByPlayerId(playerId);
      const me = party?.players.find(p => p.id === playerId);
      
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
      const me = party?.players.find(p => p.id === playerId);
      
      if (!party) return socket.emit('error', 'Party not found');
      if (!me?.isLeader) return socket.emit('error', 'Only the leader can disband the party');

      io.to(party.code).emit('party:disbanded');
      gameEngine.disbandParty(party.code);
    });

    socket.on('party:leave', () => {
      const party = gameEngine.getPartyBySocket(socket.id);
      const name = party?.players.find(p => p.socketId === socket.id)?.name;
      const code = party?.code;
      
      const updatedParty = gameEngine.leaveParty(socket.id);
      if (updatedParty) {
        if (name) gameEngine.addSystemMessage(updatedParty.code, `${name} has left the network`);
        broadcastState(updatedParty.code);
      }
      socket.emit('party:disbanded'); // Also clear state for the leaver
      socket.leave(code || ''); 
    });

    socket.on('send_message', (text) => {
      if (typeof text !== 'string' || text.trim().length === 0 || text.length > 500) return;
      const result = gameEngine.addMessage(socket.id, text);
      if (result) {
        broadcastState(result.party.code);
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

    socket.on('vote_player', (targetId) => {
      const updatedParty = gameEngine.votePlayer(socket.id, targetId);
      if (updatedParty) {
        broadcastState(updatedParty.code);
      }
    });

    socket.on('vote_continue', () => {
      const result = gameEngine.voteContinue(socket.id);
      if (result) {
        if (result.consensus === 'continue') {
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

    socket.on('kick_player', (targetId) => {
      const result = gameEngine.kickPlayer(socket.id, targetId);
      if (result) {
        const { party, targetSocketId } = result;
        broadcastState(party.code);
        if (targetSocketId) {
          io.to(targetSocketId).emit('party:disbanded'); // Force redirect for kicked player
        }
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
