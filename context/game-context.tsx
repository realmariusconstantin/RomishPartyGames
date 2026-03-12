'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';
import { 
  Party, 
  ClientToServerEvents, 
  ServerToClientEvents,
  PartySettings 
} from '@/lib/types';

interface GameContextType {
  partyState: Party | null;
  roleInfo: { role: 'imposter' | 'crew' } | null;
  error: string | null;
  socketId: string | null;
  playerId: string | null;
  isConnected: boolean;
  
  createParty: (name: string) => void;
  joinParty: (code: string, name: string) => void;
  proposeGame: () => void;
  voteStart: () => void;
  cancelStart: () => void;
  voteSkip: () => void;
  votePlayer: (targetId: string) => void;
  syncState: () => void;
  updateSettings: (settings: PartySettings) => void;
  disbandParty: () => void;
  leaveParty: () => void;
  sendMessage: (text: string) => void;
  voteContinue: () => void;
  voteLobby: () => void;
  kickPlayer: (targetId: string) => void;
  clearError: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [partyState, setPartyState] = useState<Party | null>(null);
  const [roleInfo, setRoleInfo] = useState<{ role: 'imposter' | 'crew' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [playerId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      let id = sessionStorage.getItem('imposter_player_id');
      if (!id) {
        id = (crypto.randomUUID ?? (() => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); })))();
        sessionStorage.setItem('imposter_player_id', id);
        console.log(`%c[Identity] GENERATED NEW PLAYER ID: ${id}`, "color: #6366f1; font-weight: bold; background: #eef2ff; padding: 2px 6px; border-radius: 4px;");
      } else {
        console.log(`%c[Identity] LOADED PLAYER ID: ${id}`, "color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 6px; border-radius: 4px;");
      }
      return id;
    }
    return null;
  });

  // Persistence logic for playerName, partyCode, and playerId
  useEffect(() => {
    if (!playerId) return;
    
    // Ensure fresh connection for each tab
    const newSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      transports: ['websocket', 'polling'],
      forceNew: true,
      auth: { playerId }
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id, 'as Player:', playerId);
      setIsConnected(true);
      setSocketId(newSocket.id || null);
      setError(null);
      
      // Auto-rejoin if we have saved info
      const currentName = sessionStorage.getItem('imposter_player_name');
      const currentCode = sessionStorage.getItem('imposter_party_code');
      
      if (currentName && currentCode) {
        console.log('[Socket] Attempting auto-rejoin for:', currentCode);
        newSocket.emit('join_party', currentCode, currentName);
      }
      
      // Always sync on reconnect to handle state misses
      newSocket.emit('state:sync');
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setIsConnected(false);
      setSocketId(null);
    });

    // Re-sync state whenever the tab/app becomes visible again (covers phone app-switching)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && newSocket.connected) {
        newSocket.emit('state:sync');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic heartbeat so missed broadcasts self-heal within 8 seconds
    const syncInterval = setInterval(() => {
      if (newSocket.connected && sessionStorage.getItem('imposter_party_code')) {
        newSocket.emit('state:sync');
      }
    }, 8000);

    newSocket.on('state_update', (state) => {
      setPartyState(state);
      // Persist party code when we successfully get a state
      sessionStorage.setItem('imposter_party_code', state.code);
    });

    newSocket.on('role_reveal', (data) => {
      setRoleInfo(data);
    });

    newSocket.on('error', (msg) => {
      setError(msg);
    });

    newSocket.on('party_created', (code) => {
      sessionStorage.setItem('imposter_party_code', code);
    });

    // Remove settings toast, handled silently

    newSocket.on('party:disbanded', () => {
      setPartyState(null);
      setRoleInfo(null);
      sessionStorage.removeItem('imposter_party_code');
      // If we are currently in a lobby, the redirect tells us why
      router.push('/');
    });

    socketRef.current = newSocket;

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(syncInterval);
      newSocket.close();
    };
  }, [playerId, router]);

  const createParty = useCallback((name: string) => {
    sessionStorage.setItem('imposter_player_name', name);
    socketRef.current?.emit('create_party', name);
  }, []);

  const joinParty = useCallback((code: string, name: string) => {
    sessionStorage.setItem('imposter_player_name', name);
    sessionStorage.setItem('imposter_party_code', code);
    socketRef.current?.emit('join_party', code, name);
  }, []);

  const proposeGame = useCallback(() => {
    socketRef.current?.emit('propose_game');
  }, []);

  const voteStart = useCallback(() => {
    socketRef.current?.emit('vote_start');
  }, []);

  const cancelStart = useCallback(() => {
    socketRef.current?.emit('cancel_start');
  }, []);

  const voteSkip = useCallback(() => {
    socketRef.current?.emit('vote_skip');
  }, []);

  const votePlayer = useCallback((targetId: string) => {
    socketRef.current?.emit('vote_player', targetId);
  }, []);

  const syncState = useCallback(() => {
    socketRef.current?.emit('state:sync');
  }, []);

  const updateSettings = useCallback((settings: PartySettings) => {
    socketRef.current?.emit('party:updateSettings', settings);
  }, []);

  const disbandParty = useCallback(() => {
    socketRef.current?.emit('party:disband');
  }, []);

  const leaveParty = useCallback(() => {
    socketRef.current?.emit('party:leave');
    setPartyState(null);
    setRoleInfo(null);
    sessionStorage.removeItem('imposter_party_code');
    router.push('/');
  }, [router]);

  const sendMessage = useCallback((text: string) => {
    socketRef.current?.emit('send_message', text);
  }, []);

  const voteContinue = useCallback(() => {
    socketRef.current?.emit('vote_continue');
  }, []);

  const voteLobby = useCallback(() => {
    socketRef.current?.emit('vote_lobby');
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <GameContext.Provider value={{
      partyState,
      roleInfo,
      error,
      socketId,
      playerId,
      isConnected,
      createParty,
      joinParty,
      proposeGame,
      voteStart,
      cancelStart,
      voteSkip,
      votePlayer,
      syncState,
      updateSettings,
      disbandParty,
      leaveParty,
      sendMessage,
      voteContinue,
      voteLobby,
      kickPlayer: (targetId: string) => {
        socketRef.current?.emit('kick_player', targetId);
      },
      clearError,
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGameStore() {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGameStore must be used within a GameProvider');
  }
  return context;
}
