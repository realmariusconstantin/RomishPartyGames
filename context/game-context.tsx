'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { 
  Party, 
  ClientToServerEvents, 
  ServerToClientEvents,
  PartySettings 
} from '@/lib/types';

interface GameContextType {
  partyState: Party | null;
  roleInfo: { role: 'imposter' | 'crew'; hint: string | null } | null;
  error: string | null;
  socketId: string | null;
  playerId: string | null;
  isConnected: boolean;
  
  createParty: (name: string) => void;
  joinParty: (code: string, name: string) => void;
  startGame: (imposterCount: number) => void;
  voteSkip: () => void;
  votePlayer: (targetId: string) => void;
  syncState: () => void;
  updateSettings: (settings: PartySettings) => void;
  disbandParty: () => void;
  leaveParty: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [partyState, setPartyState] = useState<Party | null>(null);
  const [roleInfo, setRoleInfo] = useState<{ role: 'imposter' | 'crew'; hint: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      let id = sessionStorage.getItem('imposter_player_id');
      if (!id) {
        id = `p-${Math.random().toString(36).substring(2, 6)}`; // Shorter for easy logging
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
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
      forceNew: true, // Crucial for multi-tab testing on some browsers
      auth: { playerId } 
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id, 'as Player:', playerId);
      setIsConnected(true);
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
    });

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

    newSocket.on('party:settingsUpdated', (settings) => {
      setPartyState(prev => prev ? { ...prev, settings } : null);
      toast.info('Party settings updated');
    });

    newSocket.on('party:disbanded', () => {
      setPartyState(null);
      setRoleInfo(null);
      sessionStorage.removeItem('imposter_party_code');
      toast.info('Party session ended');
      router.push('/');
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const createParty = useCallback((name: string) => {
    sessionStorage.setItem('imposter_player_name', name);
    socket?.emit('create_party', name);
  }, [socket]);

  const joinParty = useCallback((code: string, name: string) => {
    sessionStorage.setItem('imposter_player_name', name);
    sessionStorage.setItem('imposter_party_code', code);
    socket?.emit('join_party', code, name);
  }, [socket]);

  const startGame = useCallback((imposterCount: number) => {
    socket?.emit('start_game', imposterCount);
  }, [socket]);

  const voteSkip = useCallback(() => {
    socket?.emit('vote_skip');
  }, [socket]);

  const votePlayer = useCallback((targetId: string) => {
    socket?.emit('vote_player', targetId);
  }, [socket]);

  const syncState = useCallback(() => {
    socket?.emit('state:sync');
  }, [socket]);

  const updateSettings = useCallback((settings: PartySettings) => {
    socket?.emit('party:updateSettings', settings);
  }, [socket]);

  const disbandParty = useCallback((reason?: string) => {
    socket?.emit('party:disband');
  }, [socket]);

  const leaveParty = useCallback(() => {
    socket?.emit('party:leave');
    setPartyState(null);
    setRoleInfo(null);
    sessionStorage.removeItem('imposter_party_code');
    router.push('/');
  }, [socket, router]);

  return (
    <GameContext.Provider value={{
      partyState,
      roleInfo,
      error,
      socketId: socket?.id || null,      playerId,      isConnected,
      createParty,
      joinParty,
      startGame,
      voteSkip,
      votePlayer,
      syncState,
      updateSettings,
      disbandParty,
      leaveParty
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
