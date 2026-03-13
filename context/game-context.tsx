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

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface GameContextType {
  partyState:    Party | null;
  roleInfo:      { role: 'imposter' | 'crew' } | null;
  error:         string | null;
  socketId:      string | null;
  playerId:      string | null;
  isConnected:   boolean;

  // Actions (all emit events to the server)
  createParty:   (name: string) => void;
  joinParty:     (code: string, name: string) => void;
  proposeGame:   () => void;
  voteStart:     () => void;
  cancelStart:   () => void;
  voteSkip:      () => void;
  votePlayer:    (targetId: string) => void;
  syncState:     () => void;
  updateSettings:(settings: PartySettings) => void;
  disbandParty:  () => void;
  leaveParty:    () => void;
  sendMessage:   (text: string) => void;
  voteContinue:  () => void;
  voteLobby:     () => void;
  kickPlayer:    (targetId: string) => void;
  clearError:    () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function GameProvider({ children }: { children: React.ReactNode }) {
  const router    = useRouter();
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  const [partyState,  setPartyState ] = useState<Party | null>(null);
  const [roleInfo,    setRoleInfo   ] = useState<{ role: 'imposter' | 'crew' } | null>(null);
  const [error,       setError      ] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [socketId,    setSocketId   ] = useState<string | null>(null);

  /**
   * Stable player identity for the session. Generated once on first visit and
   * stored in sessionStorage so reconnects after a dropped connection are
   * handled transparently by the server.
   */
  const [playerId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;

    let id = sessionStorage.getItem('imposter_player_id');
    if (!id) {
      // Call randomUUID via the crypto object so `this` stays bound correctly.
      // Pulling it out as a bare reference (crypto.randomUUID ?? fallback)()
      // detaches it from its context and causes "Illegal invocation".
      id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      sessionStorage.setItem('imposter_player_id', id);
      console.log(`%c[Identity] GENERATED NEW PLAYER ID: ${id}`, 'color: #6366f1; font-weight: bold; background: #eef2ff; padding: 2px 6px; border-radius: 4px;');
    } else {
      console.log(`%c[Identity] LOADED PLAYER ID: ${id}`, 'color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 6px; border-radius: 4px;');
    }
    return id;
  });

  // -------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!playerId) return;

    /**
     * One socket per tab (forceNew: true). The playerId is sent in the auth
     * handshake so the server can identify reconnecting players.
     */
    const newSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      reconnection:        true,
      reconnectionAttempts: Infinity,
      reconnectionDelay:   500,
      reconnectionDelayMax: 4000,
      transports:          ['websocket', 'polling'],
      forceNew:            true,
      auth:                { playerId },
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id, 'as Player:', playerId);
      setIsConnected(true);
      setSocketId(newSocket.id || null);
      setError(null);

      // Auto-rejoin if we have a saved party code (handles page refresh / reconnect)
      const currentName = sessionStorage.getItem('imposter_player_name');
      const currentCode = sessionStorage.getItem('imposter_party_code');
      if (currentName && currentCode) {
        console.log('[Socket] Attempting auto-rejoin for:', currentCode);
        newSocket.emit('join_party', currentCode, currentName);
      }

      // Always request latest state on reconnect to cover any missed broadcasts
      newSocket.emit('state:sync');
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setIsConnected(false);
      setSocketId(null);
    });

    // Re-sync whenever the tab becomes visible again (handles phone app-switching)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && newSocket.connected) {
        newSocket.emit('state:sync');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Heartbeat: self-heals missed broadcasts within 8 seconds
    const syncInterval = setInterval(() => {
      if (newSocket.connected && sessionStorage.getItem('imposter_party_code')) {
        newSocket.emit('state:sync');
      }
    }, 8000);

    // -----------------------------------------------------------------------
    // Inbound event handlers
    // -----------------------------------------------------------------------

    newSocket.on('state_update', (state) => {
      setPartyState(state);
      // Persist party code so auto-rejoin works after a page reload
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

    newSocket.on('party:disbanded', () => {
      // Reset all local state and send the player back to the home page
      setPartyState(null);
      setRoleInfo(null);
      sessionStorage.removeItem('imposter_party_code');
      router.push('/');
    });

    socketRef.current = newSocket;

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(syncInterval);
      newSocket.close();
    };
  }, [playerId, router]);

  // -------------------------------------------------------------------------
  // Action callbacks
  // All are stable references (useCallback with empty/minimal deps) so
  // consumers don't re-render unnecessarily.
  // -------------------------------------------------------------------------

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

  /** Leader-only: ejects another player from the party. */
  const kickPlayer = useCallback((targetId: string) => {
    socketRef.current?.emit('kick_player', targetId);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // -------------------------------------------------------------------------

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
      kickPlayer,
      clearError,
    }}>
      {children}
    </GameContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the game context. Must be used inside a <GameProvider>.
 *
 * Named useGameStore for historical reasons; it is a plain React Context hook,
 * not a Zustand/Redux store. Consumers can use the re-exported `useGame` alias
 * from hooks/use-game.ts for a shorter import path.
 */
export function useGameStore() {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGameStore must be used within a GameProvider');
  }
  return context;
}
