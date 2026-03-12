'use client';

import { useGame } from '@/hooks/use-game';
import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { GamePhase, Party, ChatMessage } from '@/lib/types';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import {
  Users, Copy, ChevronRight, ShieldAlert, CheckCircle2, Crown,
  Radio, Home as HomeIcon, Settings2, LogOut, RotateCcw, Zap,
  MessageSquare, X, Globe, QrCode,
} from 'lucide-react';

// ─── Chat Panel ──────────────────────────────────────────────────────────────
const ChatPanel = ({
  partyState, playerId, chatInput, setChatInput, handleSendMessage, messagesEndRef, onClose,
}: {
  partyState: Party; playerId: string | null; chatInput: string;
  setChatInput: (v: string) => void; handleSendMessage: (e: React.FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>; onClose?: () => void;
}) => (
  <div className="flex flex-col h-full bg-slate-900 border-t border-slate-800">
    {onClose && (
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800 shrink-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
          <Radio size={12} /> Comms
        </p>
        <button onClick={onClose} className="p-2 text-slate-500 hover:text-white rounded-lg transition-colors">
          <X size={16} />
        </button>
      </div>
    )}
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {partyState.messages.length === 0 && (
        <div className="text-center text-slate-700 py-20 italic text-sm">No transmissions yet…</div>
      )}
      {partyState.messages.map((m: ChatMessage) => (
        <div key={m.id} className={`flex flex-col ${m.playerId === playerId ? 'items-end' : 'items-start'}`}>
          {m.playerId === 'system' ? (
            <div className="w-full flex justify-center py-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-800/50 px-3 py-1 rounded-full">{m.text}</span>
            </div>
          ) : (
            <div className={`max-w-[80%] p-3 shadow-sm border border-white/5 ${m.playerId === playerId ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-2xl rounded-tl-none'}`}>
              <p className="text-[9px] font-black uppercase tracking-tighter opacity-50 mb-1">{m.playerName}</p>
              <p className="text-sm font-bold leading-snug">{m.text}</p>
            </div>
          )}
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
    <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 flex gap-2 shrink-0">
      <input
        type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
        placeholder="Type a message…" autoComplete="off"
        className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
      />
      <button type="submit" className="p-3 bg-indigo-600 text-white rounded-xl active:bg-indigo-700 transition-colors min-w-[48px] flex items-center justify-center">
        <ChevronRight size={20} />
      </button>
    </form>
  </div>
);

export default function PartyPage() {
  const { code } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const userName = searchParams.get('name');

  const {
    partyState, error, joinParty, proposeGame, voteStart, cancelStart,
    voteSkip, votePlayer, voteContinue, voteLobby, kickPlayer,
    updateSettings, leaveParty, sendMessage, playerId, isConnected, clearError,
  } = useGame();

  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showLeaveWarning, setShowLeaveWarning] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [enteredName, setEnteredName] = useState('');
  const [joinedName, setJoinedName] = useState(userName);

  const currentPlayers = partyState?.players.length ?? 0;
  const maxAllowedImposters = currentPlayers >= 10 ? 3 : currentPlayers >= 7 ? 2 : 1;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  useEffect(() => {
    if (partyState?.messages && partyState.messages.length > prevMsgCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      prevMsgCount.current = partyState.messages.length;
    }
  }, [partyState?.messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage(chatInput.trim());
    setChatInput('');
  };

  useEffect(() => {
    if (code && joinedName && isConnected) joinParty(code as string, joinedName);
  }, [code, joinedName, joinParty, isConnected]);

  useEffect(() => {
    const isHost = partyState?.players.find(p => p.id === playerId)?.isLeader ?? false;
    if (partyState?.game.phase === GamePhase.LOBBY && isHost && partyState?.settings && partyState.settings.impostersCount > maxAllowedImposters) {
      updateSettings({ ...partyState.settings, impostersCount: maxAllowedImposters });
    }
  }, [partyState?.game.phase, partyState?.players, partyState?.settings, playerId, maxAllowedImposters, updateSettings]);

  useEffect(() => {
    if (error) { toast.error(error); clearError(); }
  }, [error, clearError]);

  useEffect(() => {
    if (isConnected && !partyState) {
      const t = setTimeout(() => { if (!partyState) router.push('/'); }, 10000);
      return () => clearTimeout(t);
    }
  }, [isConnected, partyState, router]);

  // ── Back button / close-tab interception ───────────────────────────────────
  useEffect(() => {
    // Push a sentinel entry so the first back-press is absorbed
    window.history.pushState({ party: true }, '');

    const handlePopState = () => {
      // Re-push to keep the user on this page, then show the warning
      window.history.pushState({ party: true }, '');
      setShowLeaveWarning(true);
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const me = partyState?.players.find(p => p.id === playerId);
  const isLeader = me?.isLeader ?? false;

  const copyCode = () => {
    navigator.clipboard.writeText(code as string);
    toast.success('Code copied!');
  };

  const handleStart = () => {
    if (currentPlayers < 3) { toast.error('Need at least 3 players to start'); return; }
    proposeGame();
  };

  const onVotePlayer = (targetId: string) => {
    if (me?.isDead || partyState?.votes.votes[playerId ?? '']) return;
    votePlayer(targetId);
  };

  // ── Name entry (QR scan arrivals) ─────────────────────────────────────────
  if (!joinedName) {
    const handleNameSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = enteredName.trim();
      if (!trimmed || trimmed.length > 20) return;
      setJoinedName(trimmed);
    };
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-slate-950 p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center mx-auto mb-4 shadow-xl shadow-indigo-900/40">
              <Radio size={32} className="text-white animate-pulse" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500">Joining party</p>
            <p className="text-3xl font-black text-white tracking-tight">{code}</p>
          </div>
          <form onSubmit={handleNameSubmit} className="space-y-3">
            <input
              autoFocus
              type="text"
              value={enteredName}
              onChange={(e) => setEnteredName(e.target.value)}
              placeholder="Your agent name…"
              maxLength={20}
              className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder:text-slate-600"
            />
            <button
              type="submit"
              disabled={!enteredName.trim()}
              className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl text-lg uppercase tracking-wide active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/40 flex items-center justify-center gap-3"
            >
              <ChevronRight size={22} /> Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (!partyState || !isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-slate-950">
        <div className="relative">
          <div className="animate-spin rounded-full h-20 w-20 border-b-2 border-indigo-500" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Radio className="text-indigo-500 animate-pulse" size={28} />
          </div>
        </div>
        <p className="mt-6 text-indigo-500/50 font-black uppercase tracking-[0.4em] text-[10px] animate-pulse">Connecting…</p>
      </div>
    );
  }

  const phase = partyState.game.phase;
  const hasVotedStart = partyState.startVotes.includes(playerId ?? '');
  const hasVotedCancel = partyState.cancelVotes.includes(playerId ?? '');
  const hasPregameVoted = hasVotedStart || hasVotedCancel;
  const msgCount = partyState.messages.length;

  return (
    <main className="min-h-dvh flex flex-col bg-slate-950 text-slate-200">

      {/* ── Persistent Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <button onClick={copyCode} className="flex items-center gap-2 group active:scale-95 transition-transform">
          <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">CODE</span>
          <span data-testid="display-code" className="text-xl font-black text-indigo-400 font-mono tracking-widest">{partyState.code}</span>
          <Copy size={14} className="text-slate-600 group-hover:text-indigo-400 transition-colors" />
        </button>
        <div className="flex items-center gap-2">
          <span className={`hidden sm:block text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-widest ${isLeader ? 'bg-amber-900/30 text-amber-400' : 'bg-slate-800 text-slate-500'}`}>
            {isLeader ? '★ Host' : me?.name ?? '…'}
          </span>
          {phase === GamePhase.LOBBY && (
            <button
              onClick={() => setShowQR(true)}
              className="p-2 bg-slate-800 text-slate-500 rounded-xl active:bg-indigo-900/40 active:text-indigo-400 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
              title="Show QR code"
            >
              <QrCode size={16} />
            </button>
          )}
          <button
            onClick={() => setShowLeaveWarning(true)}
            data-testid="btn-leave"
            className="p-2 bg-slate-800 text-slate-500 rounded-xl active:bg-rose-900/40 active:text-rose-400 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ── Phase Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* LOBBY ─────────────────────────────────────────────────────────── */}
        {phase === GamePhase.LOBBY && (
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Player count */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 flex items-center gap-1.5">
                <Users size={12} strokeWidth={3} />
                {currentPlayers} / {partyState.settings.maxPlayers} agents
              </p>
              {currentPlayers < 3 && (
                <p className="text-[10px] text-amber-500/70 font-black uppercase tracking-widest">Need {3 - currentPlayers} more</p>
              )}
            </div>

            {/* Player grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {partyState.players.map((p) => (
                <div key={p.id} className="relative flex items-center gap-3 p-3 bg-slate-900 rounded-2xl border border-slate-800">
                  <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-black text-base ${p.id === playerId ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {p.name[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate">{p.name}</p>
                    {p.isLeader && <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest">Host</p>}
                  </div>
                  {isLeader && !p.isLeader && (
                    <button onClick={() => kickPlayer(p.id)} className="absolute top-1 right-1 p-1 text-slate-700 hover:text-rose-400 transition-colors rounded-lg" title="Kick">
                      <X size={12} />
                    </button>
                  )}
                  {!p.connected && <div className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full" title="Disconnected" />}
                </div>
              ))}
              {[...Array(Math.max(0, 3 - currentPlayers))].map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
                  <div className="w-10 h-10 rounded-xl border border-dashed border-slate-800 flex items-center justify-center">
                    <Users size={16} className="text-slate-800" />
                  </div>
                  <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Waiting…</p>
                </div>
              ))}
            </div>

            {/* Settings – leader only, lobby only */}
            {isLeader && (
              <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="w-full flex items-center justify-between p-4 text-left active:bg-slate-800/70 transition-colors"
                >
                  <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <Settings2 size={14} /> Settings
                  </span>
                  <ChevronRight size={16} className={`text-slate-600 transition-transform duration-200 ${showSettings ? 'rotate-90' : ''}`} />
                </button>
                {showSettings && (
                  <div className="px-4 pb-5 space-y-5 border-t border-slate-800">
                    {/* Max players */}
                    <div className="pt-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Max Players</label>
                        <span className="text-sm font-black text-indigo-400">{partyState.settings.maxPlayers}</span>
                      </div>
                      <input
                        type="range" min="3" max="10" value={partyState.settings.maxPlayers}
                        onChange={(e) => updateSettings({ ...partyState.settings, maxPlayers: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>
                    {/* Imposters */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Imposters</label>
                      <div className="flex gap-2">
                        {[1, 2, 3].map(n => (
                          <button
                            key={n} disabled={n > maxAllowedImposters}
                            onClick={() => updateSettings({ ...partyState.settings, impostersCount: n })}
                            className={`flex-1 py-3 rounded-xl font-black text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${partyState.settings.impostersCount === n ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 active:bg-slate-700'}`}
                          >{n}</button>
                        ))}
                      </div>
                      {maxAllowedImposters < 3 && (
                        <p className="text-[9px] text-slate-600 italic">Need {maxAllowedImposters === 1 ? '7' : '10'}+ players for more imposters</p>
                      )}
                    </div>
                    {/* Language */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                        <Globe size={12} /> Language
                      </label>
                      <select
                        value={partyState.settings.language}
                        onChange={(e) => updateSettings({ ...partyState.settings, language: e.target.value })}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 cursor-pointer"
                      >
                        <option value="english">🇬🇧 English</option>
                        <option value="spanish">🇪🇸 Spanish</option>
                        <option value="french">🇫🇷 French</option>
                        <option value="german">🇩🇪 German</option>
                        <option value="romanian">🇷🇴 Romanian</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1 min-h-4" />

            {/* Start / waiting */}
            {isLeader ? (
              <button
                onClick={handleStart}
                disabled={currentPlayers < 3}
                data-testid="btn-start-game"
                className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl text-lg uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg shadow-indigo-900/40"
              >
                <Zap size={20} /> Start Game
              </button>
            ) : (
              <div className="w-full py-4 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center gap-3">
                <div className="w-2 h-2 bg-slate-700 rounded-full animate-pulse" />
                <p className="text-xs font-black text-slate-600 uppercase tracking-widest">Waiting for host…</p>
              </div>
            )}
          </div>
        )}

        {/* PREGAME – Ready Check ──────────────────────────────────────────── */}
        {phase === GamePhase.PREGAME && (
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            <div className="text-center pt-6 pb-2">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500 mb-3">Ready Check</p>
              <div className="text-8xl font-black text-white tabular-nums" data-testid="timer-display">
                {partyState.game.remainingTime}s
              </div>
              <p className="text-slate-500 text-sm font-bold mt-2">
                {partyState.startVotes.length} / {partyState.players.filter(p => p.connected).length} ready
              </p>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto">
              {partyState.players.filter(p => p.connected).map(p => {
                const votedStart = partyState.startVotes.includes(p.id);
                const votedCancel = partyState.cancelVotes.includes(p.id);
                return (
                  <div key={p.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${votedStart ? 'bg-emerald-900/20 border-emerald-800/50' : votedCancel ? 'bg-rose-900/20 border-rose-800/50' : 'bg-slate-900 border-slate-800'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-base shrink-0 ${votedStart ? 'bg-emerald-600 text-white' : votedCancel ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                      {votedStart ? '✓' : votedCancel ? '✗' : p.name[0].toUpperCase()}
                    </div>
                    <span className="font-black text-white">{p.name}</span>
                    {p.isLeader && <Crown size={12} className="text-amber-500 ml-auto shrink-0" />}
                    {!votedStart && !votedCancel && !p.isLeader && (
                      <span className="ml-auto text-[9px] text-slate-600 font-black uppercase tracking-widest">Deciding…</span>
                    )}
                  </div>
                );
              })}
            </div>

            {!hasPregameVoted && !isLeader ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => cancelStart()}
                  className="py-4 bg-slate-800 text-slate-300 font-black rounded-2xl text-base uppercase tracking-wide active:scale-95 transition-transform border border-slate-700 active:bg-rose-900/30 active:text-rose-400"
                >
                  ✗ Not Yet
                </button>
                <button
                  onClick={() => voteStart()}
                  className="py-4 bg-emerald-600 text-white font-black rounded-2xl text-base uppercase tracking-wide active:scale-95 transition-transform shadow-lg shadow-emerald-900/40"
                >
                  ✓ Ready!
                </button>
              </div>
            ) : (
              <div className="py-4 bg-slate-900 rounded-2xl border border-slate-800 text-center">
                <p className="text-sm font-black text-slate-500 uppercase tracking-widest">
                  {hasVotedStart ? '✓ You are ready' : hasVotedCancel ? '✗ You voted not yet' : '★ You started the vote'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* COUNTDOWN ─────────────────────────────────────────────────────── */}
        {phase === GamePhase.COUNTDOWN && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-600 animate-pulse">Game starts in</p>
            <div className="text-[12rem] font-black leading-none text-indigo-500 italic tracking-tighter drop-shadow-2xl" data-testid="timer-display">
              {partyState.game.remainingTime}
            </div>
          </div>
        )}

        {/* REVEAL ─────────────────────────────────────────────────────────── */}
        {phase === GamePhase.REVEAL && (
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <div className={`w-full max-w-sm p-8 rounded-[3rem] shadow-2xl border-2 flex flex-col items-center gap-6 ${me?.role === 'imposter' ? 'bg-rose-950/20 border-rose-900/50' : 'bg-slate-900 border-slate-800'}`}>
              <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center shadow-2xl ${me?.role === 'imposter' ? 'bg-rose-600' : 'bg-indigo-600'}`}>
                {me?.role === 'imposter'
                  ? <ShieldAlert size={40} className="animate-pulse text-white" />
                  : <Users size={40} className="text-white" />}
              </div>
              <div className="text-center space-y-1">
                <p className={`text-[10px] font-black uppercase tracking-[0.4em] ${me?.role === 'imposter' ? 'text-rose-500' : 'text-indigo-400'}`}>You are the</p>
                <p className="text-5xl font-black italic text-white tracking-tighter" data-testid="role-reveal">
                  {me?.role === 'imposter' ? 'INFILTRATOR' : 'FIELD AGENT'}
                </p>
              </div>
              {partyState.game.category && (
                <div className="w-full bg-slate-800/50 rounded-2xl p-4 text-center border border-slate-700/50">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Category</p>
                  <p className="text-xl font-black text-white">{partyState.game.category}</p>
                </div>
              )}
              {me?.role !== 'imposter' && (
                <div className="w-full rounded-2xl p-5 text-center border bg-indigo-950/30 border-indigo-900/30">
                  <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-indigo-400">
                    Your Word
                  </p>
                  <p className="text-4xl font-black italic text-white tracking-tight break-words leading-tight" data-testid="reveal-word">
                    &quot;{partyState.game.secretWord}&quot;
                  </p>
                </div>
              )}
              <p className={`text-xs text-center leading-relaxed px-2 ${me?.role === 'imposter' ? 'text-rose-300/50' : 'text-slate-500'}`}>
                {me?.role === 'imposter'
                  ? 'Blend in. Give vague clues. Do not reveal you are an infiltrator.'
                  : 'Give hints about your word without saying it. Spot the odd one out.'}
              </p>
            </div>
          </div>
        )}

        {/* ROUND + VOTING_GRACE ───────────────────────────────────────────── */}
        {(phase === GamePhase.ROUND || phase === GamePhase.VOTING_GRACE) && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {showChat ? (
              <ChatPanel
                partyState={partyState} playerId={playerId} chatInput={chatInput}
                setChatInput={setChatInput} handleSendMessage={handleSendMessage}
                messagesEndRef={messagesEndRef} onClose={() => setShowChat(false)}
              />
            ) : (
              <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
                {/* Timer */}
                <div className="text-center space-y-2">
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${phase === GamePhase.VOTING_GRACE ? 'bg-rose-950/50 border-rose-700 text-rose-400 animate-pulse' : 'bg-indigo-950/50 border-indigo-900 text-indigo-400'}`}>
                    <Radio size={10} className="animate-pulse" />
                    {phase === GamePhase.VOTING_GRACE ? 'Vote now!' : 'Discussion'}
                  </div>
                  {(phase !== GamePhase.ROUND || partyState.game.remainingTime > 0) && (
                    <div className={`text-7xl font-black italic leading-none tracking-tighter tabular-nums ${partyState.game.remainingTime < 30 ? 'text-rose-500' : 'text-white'}`} data-testid="timer-display">
                      {Math.floor(partyState.game.remainingTime / 60)}:{(partyState.game.remainingTime % 60).toString().padStart(2, '0')}
                    </div>
                  )}
                </div>

                {/* Vote header */}
                <div className="flex justify-between items-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {me?.isDead ? 'Spectating' : 'Vote out the imposter'}
                  </p>
                  <span className="text-[10px] font-black text-rose-500">
                    {Object.keys(partyState.votes.votes).length}/{partyState.players.filter(p => !p.isDead).length} voted
                  </span>
                </div>

                {/* Vote grid */}
                <div className={`grid grid-cols-2 gap-2 ${me?.isDead ? 'opacity-50 pointer-events-none' : ''}`}>
                  {partyState.players.map(p => {
                    const isSelf = p.id === playerId;
                    const hasVotedThis = partyState.votes.votes[playerId ?? ''] === p.id;
                    const alreadyVoted = !!partyState.votes.votes[playerId ?? ''];
                    return (
                      <button
                        key={p.id}
                        disabled={isSelf || alreadyVoted || me?.isDead || p.isDead}
                        onClick={() => onVotePlayer(p.id)}
                        className={`p-3 rounded-2xl flex items-center gap-2 transition-all active:scale-95 ${
                          isSelf ? 'bg-slate-800/30 opacity-40 cursor-not-allowed' :
                          p.isDead ? 'bg-rose-950/10 opacity-30 cursor-not-allowed' :
                          hasVotedThis ? 'bg-rose-900/50 border-2 border-rose-500 text-white shadow-lg' :
                          alreadyVoted || me?.isDead ? 'bg-slate-800/20 opacity-40 cursor-not-allowed' :
                          'bg-slate-800 border border-slate-700 active:bg-slate-700'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center font-black text-sm ${hasVotedThis ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                          {p.name[0].toUpperCase()}
                        </div>
                        <span className={`font-black text-sm truncate ${hasVotedThis ? 'text-white' : 'text-slate-300'} ${p.isDead ? 'line-through' : ''}`}>{p.name}</span>
                        {hasVotedThis && <CheckCircle2 size={14} className="text-rose-400 ml-auto shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 min-h-2" />

                {/* Skip vote + chat toggle */}
                <div className="flex gap-2">
                  {phase === GamePhase.ROUND && !me?.isDead && (
                    <button
                      onClick={() => voteSkip()}
                      disabled={partyState.votes.votedSkip.includes(playerId ?? '')}
                      className="flex-1 py-3 bg-slate-800 text-slate-400 font-black rounded-xl text-xs uppercase tracking-widest border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed active:bg-amber-900/20 active:text-amber-400 transition-colors"
                    >
                      {partyState.votes.votedSkip.includes(playerId ?? '')
                        ? '✓ Skip voted'
                        : `Skip ${partyState.votes.votedSkip.length}/${partyState.votes.threshold}`}
                    </button>
                  )}
                  <button
                    onClick={() => setShowChat(true)}
                    className="py-3 px-4 bg-slate-800 text-slate-400 font-black rounded-xl text-xs uppercase tracking-widest border border-slate-700 active:bg-indigo-900/30 active:text-indigo-400 transition-colors flex items-center gap-2 relative"
                  >
                    <MessageSquare size={16} />
                    {msgCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full text-[9px] text-white flex items-center justify-center font-black">
                        {msgCount > 9 ? '9+' : msgCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VOTE RESULTS ───────────────────────────────────────────────────── */}
        {phase === GamePhase.VOTE_RESULTS && (
          <div className="flex-1 flex flex-col items-center justify-center p-4 gap-8">
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-600 animate-pulse">Voting result</p>
            <div className={`px-10 py-10 rounded-[3rem] shadow-2xl border-2 font-black italic text-6xl tracking-tighter text-white text-center max-w-xs w-full ${partyState.game.lastEliminated === 'TIE' ? 'bg-slate-800 border-slate-700' : 'bg-rose-600/20 border-rose-500'}`}>
              {partyState.game.lastEliminated === 'TIE'
                ? 'TIE!'
                : partyState.players.find(p => p.id === partyState.game.lastEliminated)?.name ?? '?'}
            </div>
            <p className="text-2xl font-black italic text-white uppercase tracking-tight text-center">
              {partyState.game.lastEliminated === 'TIE' ? 'No one was eliminated' : 'Has been eliminated'}
            </p>
            <p className="text-sm text-slate-600 font-black uppercase tracking-widest">{partyState.game.remainingTime}s</p>
          </div>
        )}

        {/* RESULTS ────────────────────────────────────────────────────────── */}
        {phase === GamePhase.RESULTS && (
          <div className="flex-1 flex flex-col p-4 gap-5 overflow-y-auto">
            {/* Winner banner */}
            <div className={`py-5 px-6 rounded-3xl font-black text-3xl italic text-center tracking-tighter border ${partyState.game.winner === 'imposter' ? 'bg-rose-900/30 border-rose-500 text-rose-400' : 'bg-emerald-900/30 border-emerald-500 text-emerald-400'}`}>
              {partyState.game.winner === 'imposter' ? '⚡ Infiltrators Win!' : '✓ Crew Wins!'}
            </div>

            {/* Word reveal card */}
            <div className="bg-slate-900 rounded-3xl border border-slate-800 p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">The Word</p>
                <p className="text-2xl font-black italic text-white break-words">&quot;{partyState.game.secretWord}&quot;</p>
              </div>
              <div className="border-t border-slate-800 pt-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">The Infiltrators</p>
                <div className="flex flex-wrap gap-2">
                  {partyState.players.filter(p => p.role === 'imposter').map(p => (
                    <span key={p.id} className="px-3 py-1 bg-rose-900/40 border border-rose-800 rounded-xl font-black text-rose-300 text-sm">{p.name}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Play again / lobby vote */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center">
                {partyState.continueVotes.length + partyState.lobbyVotes.length} / {partyState.players.filter(p => p.connected).length} voted
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => voteContinue()}
                  disabled={partyState.continueVotes.includes(playerId ?? '') || partyState.lobbyVotes.includes(playerId ?? '')}
                  className={`py-4 rounded-2xl font-black text-lg uppercase tracking-wide transition-all active:scale-95 flex items-center justify-center gap-2 ${
                    partyState.continueVotes.includes(playerId ?? '') ? 'bg-slate-900 border-2 border-indigo-500 text-indigo-400' :
                    partyState.lobbyVotes.includes(playerId ?? '') ? 'bg-slate-900 text-slate-700 cursor-not-allowed opacity-50' :
                    'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                  }`}
                >
                  <RotateCcw size={18} /> Play Again
                </button>
                <button
                  onClick={() => voteLobby()}
                  disabled={partyState.continueVotes.includes(playerId ?? '') || partyState.lobbyVotes.includes(playerId ?? '')}
                  className={`py-4 rounded-2xl font-black text-lg uppercase tracking-wide transition-all active:scale-95 flex items-center justify-center gap-2 ${
                    partyState.lobbyVotes.includes(playerId ?? '') ? 'bg-slate-900 border-2 border-rose-500 text-rose-400' :
                    partyState.continueVotes.includes(playerId ?? '') ? 'bg-slate-900 text-slate-700 cursor-not-allowed opacity-50' :
                    'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  <HomeIcon size={18} /> Lobby
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Leave Warning Modal ── */}
      {showLeaveWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="bg-slate-900 rounded-[2rem] border border-slate-700 p-8 flex flex-col items-center gap-6 max-w-xs w-full shadow-2xl">
            <div className="w-14 h-14 bg-rose-900/30 rounded-[1.5rem] flex items-center justify-center border border-rose-800/50">
              <LogOut size={26} className="text-rose-400" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-black text-white">Leave the Party?</p>
              <p className="text-sm text-slate-400 font-bold leading-snug">You'll lose your spot. Reconnecting mid-game may not be possible.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              <button
                onClick={() => setShowLeaveWarning(false)}
                className="py-4 bg-slate-800 text-white font-black rounded-2xl text-base uppercase tracking-wide border border-slate-700 active:bg-slate-700 transition-colors"
              >
                Stay
              </button>
              <button
                onClick={() => { setShowLeaveWarning(false); leaveParty(); }}
                className="py-4 bg-rose-600 text-white font-black rounded-2xl text-base uppercase tracking-wide active:bg-rose-700 transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Modal ── */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={() => setShowQR(false)}>
          <div className="bg-slate-900 rounded-[2rem] border border-slate-700 p-8 flex flex-col items-center gap-6 max-w-xs w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between w-full">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500 flex items-center gap-2">
                <QrCode size={12} /> Scan to Join
              </p>
              <button onClick={() => setShowQR(false)} className="p-1.5 text-slate-500 hover:text-white rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="bg-white p-4 rounded-2xl">
              <QRCodeSVG
                value={typeof window !== 'undefined' ? `${window.location.origin}/party/${partyState.code}` : ''}
                size={200}
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
            <div className="text-center space-y-1">
              <p className="text-3xl font-black text-white font-mono tracking-widest">{partyState.code}</p>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Scan or share the code</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
