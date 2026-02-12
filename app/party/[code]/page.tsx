'use client';

import { useGame } from '@/hooks/use-game';
import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { GamePhase } from '@/lib/types';
import { toast } from 'sonner';
import { 
  Users, 
  Copy, 
  ChevronRight, 
  ShieldAlert, 
  Timer, 
  CheckCircle2, 
  Crown, 
  Radio, 
  AlertCircle,
  Play,
  Home as HomeIcon,
  RefreshCw,
  Settings2,
  LogOut,
  RotateCcw
} from 'lucide-react';

export default function PartyPage() {
  const { code } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const userName = searchParams.get('name');
  
  const { 
    partyState, 
    roleInfo, 
    error, 
    joinParty, 
    startGame, 
    voteSkip,
    votePlayer,
    updateSettings,
    disbandParty,
    leaveParty,
    socketId,
    playerId,
    isConnected
  } = useGame();

  const [activeTab, setActiveTab] = useState<'lobby' | 'manage'>('lobby');
  const [isStarting, setIsStarting] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Local settings state
  const [localSettings, setLocalSettings] = useState({ maxPlayers: 10, impostersCount: 1 });
  
  const currentPlayers = partyState?.players.length || 0;
  const maxAllowedImposters = currentPlayers >= 10 ? 3 : (currentPlayers >= 7 ? 2 : 1);

  useEffect(() => {
    if (code && userName && isConnected) {
      joinParty(code as string, userName);
    }
  }, [code, userName, joinParty, isConnected]);

  useEffect(() => {
    if (partyState?.settings) {
      // Clamp imposters count based on current players if needed
      setLocalSettings(prev => ({
        ...partyState.settings,
        impostersCount: Math.min(partyState.settings.impostersCount, maxAllowedImposters)
      }));
    }
  }, [partyState?.settings, maxAllowedImposters]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      setIsStarting(false);
      setIsVoting(false);
      setIsSaving(false);
    }
  }, [error]);

  const me = partyState?.players.find(p => p.id === playerId);
  const isLeader = me?.isLeader;

  // Security: Redirect non-leaders from manage tab
  useEffect(() => {
    if (activeTab === 'manage' && !isLeader) {
      setActiveTab('lobby');
      toast.error('Not authorized');
    }
  }, [activeTab, isLeader]);

  const copyCode = () => {
    navigator.clipboard.writeText(code as string);
    toast.success('Party Code Copied!');
  };

  const handleStart = async () => {
    if (isStarting) return;
    if (currentPlayers < 3) {
      toast.error('Minimum 3 agents required for this mission');
      return;
    }
    setIsStarting(true);
    startGame(localSettings.impostersCount);
  };

  const handleUpdateSettings = () => {
    setIsSaving(true);
    updateSettings({
      ...localSettings,
      impostersCount: Math.min(localSettings.impostersCount, maxAllowedImposters)
    });
    setTimeout(() => setIsSaving(false), 500);
  };

  const handleLeaveAndEnd = () => {
    disbandParty();
  };

  const handleVote = async () => {
    if (isVoting) return;
    setIsVoting(true);
    voteSkip();
    setTimeout(() => setIsVoting(false), 500);
  };

  const handleLeave = () => {
    leaveParty();
  };

  const onVotePlayer = (targetId: string) => {
    if (partyState?.votes.votes[playerId || '']) return;
    votePlayer(targetId);
  };

  if (!partyState || !isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white">
        <div className="relative">
          <div className="animate-spin rounded-full h-20 w-20 border-8 border-slate-50 border-t-indigo-600"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Radio className="text-indigo-600 animate-pulse" size={24} />
          </div>
        </div>
        <p className="mt-8 text-slate-400 font-black uppercase tracking-[0.3em] text-xs">Establishing Link...</p>
      </div>
    );
  }

  return (
    <main className="max-w-6xl mx-auto min-h-screen p-4 md:p-8 flex flex-col font-sans bg-slate-50 selection:bg-indigo-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6 md:mb-10 bg-white p-5 md:px-8 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div className="flex items-center gap-6 w-full md:w-auto">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-slate-900">PARTY <span data-testid="display-code" className="text-indigo-600 font-mono tracking-normal">{partyState.code}</span></h1>
              <button 
                onClick={copyCode}
                title="Copy Code"
                className="p-2 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-xl transition-all active:scale-90"
              >
                <Copy size={16} />
              </button>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Users size={12} strokeWidth={3} />
              {partyState.players.length} / {partyState.settings.maxPlayers} Agents
            </p>
          </div>
          
          <div className="h-10 w-px bg-slate-100 hidden md:block" />
          
          <div className="md:block">
            <p className="text-sm font-black text-slate-900 leading-none mb-1.5">{me?.name || 'Joining...'}</p>
            <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] flex items-center gap-1.5 ${isLeader ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
              {isLeader ? <Crown size={10} strokeWidth={3} /> : <Radio size={10} strokeWidth={3} />}
              {isLeader ? 'Leader' : 'Agent'}
            </span>
          </div>
        </div>

        <button 
          onClick={handleLeave}
          data-testid="btn-leave"
          className="w-full md:w-auto px-6 py-3 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 font-black rounded-2xl text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2"
        >
          <LogOut size={14} />
          Leave Party
        </button>
      </div>

      {/* Tabs (Lobby Phase Only) */}
      {partyState.game.phase === GamePhase.LOBBY && isLeader && (
        <div data-testid="leader-controls" className="flex gap-2 mb-8 bg-slate-200/50 p-1.5 rounded-[2rem] w-fit mx-auto md:mx-0">
          <button 
            onClick={() => setActiveTab('lobby')}
            data-testid="tab-lobby"
            className={`px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'lobby' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Mission Lobby
          </button>
          <button 
            onClick={() => setActiveTab('manage')}
            data-testid="tab-manage"
            className={`px-8 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'manage' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Settings2 size={12} />
            Manage
          </button>
        </div>
      )}

      <div className="flex-grow flex flex-col items-center">
        {partyState.game.phase === GamePhase.LOBBY && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
            {activeTab === 'lobby' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
                <div className="bg-white p-6 md:p-10 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col h-full">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 mb-8 px-1 flex items-center gap-2">
                    <Radio size={16} className="text-indigo-500 animate-pulse" />
                    Agent Network ({partyState.players.length})
                  </h2>
                  <div className="flex-grow">
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="player-list">
                      {partyState.players.map(p => (
                        <li key={p.id} className="group flex items-center justify-between p-4 bg-slate-50 rounded-2xl border-2 border-transparent hover:border-indigo-100 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className={`w-2.5 h-2.5 rounded-full ${p.connected ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                              {p.connected && <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-20"></div>}
                            </div>
                            <span className="font-bold text-slate-700 text-base tracking-tight truncate max-w-[120px]" data-testid={`player-${p.id}`}>
                              {p.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {p.id === socketId && <span className="bg-indigo-100 text-indigo-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase">YOU</span>}
                            {p.isLeader ? (
                              <div className="p-1.5 bg-amber-50 text-amber-500 rounded-lg shadow-sm border border-amber-100">
                                <Crown size={12} strokeWidth={3} />
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-200" />
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  {isLeader ? (
                    <div className="bg-indigo-900 p-8 md:p-10 rounded-[2.5rem] text-white shadow-2xl shadow-indigo-200 flex flex-col justify-center items-center text-center space-y-8 min-h-[320px]">
                      <div className="p-5 bg-white/10 rounded-[2rem] backdrop-blur-md">
                        <Play size={48} fill="currentColor" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black italic tracking-tighter">MISSION READY</h3>
                        <p className="text-indigo-200 text-xs font-bold leading-relaxed max-w-xs mx-auto">
                          {partyState.players.length < 3 
                            ? "Awaiting more agents. Minimum 3 required for deployment." 
                            : "Launch the operation. Roles will be assigned instantly to all connected agents."}
                        </p>
                      </div>
                      <button 
                        onClick={handleStart}
                        data-testid="btn-start"
                        disabled={partyState.players.length < 3 || isStarting}
                        className="group w-full py-6 bg-white text-indigo-900 font-black rounded-[2rem] text-xl shadow-xl active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-3 tracking-tighter"
                      >
                        {isStarting ? (
                          <div className="w-6 h-6 border-4 border-indigo-900/30 border-t-indigo-900 rounded-full animate-spin" />
                        ) : (
                          <>
                            START MISSION
                            <ChevronRight size={24} strokeWidth={3} />
                          </>
                        )}
                      </button>
                      {partyState.players.length < 2 && (
                        <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest italic flex items-center gap-2">
                          <AlertCircle size={14} />
                          Need 2+ Agents
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white p-12 md:p-16 rounded-[2.5rem] border-4 border-dashed border-slate-100 flex flex-col items-center justify-center text-center space-y-8 flex-grow">
                      <div className="flex justify-center gap-3">
                        <div className="w-4 h-4 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-4 h-4 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-4 h-4 bg-indigo-600 rounded-full animate-bounce"></div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-slate-800 font-black text-xl italic tracking-tight uppercase">AWAITING LEADER</p>
                        <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">Transmission standby</p>
                      </div>
                    </div>
                  )}

                  <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-start gap-4">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Radio size={20} />
                    </div>
                    <div>
                      <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-widest mb-1">Briefing</h4>
                      <p className="text-[10px] text-slate-500 font-medium leading-relaxed uppercase tracking-tight">
                        Share the code <span className="text-indigo-600 font-black font-mono">{partyState.code}</span> with your team. Only the leader can initiate the mission.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Manage Tab (Leader Only) */
              <div className="w-full max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-sm border border-slate-100 space-y-12">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[12px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-3">
                      <Settings2 size={18} className="text-indigo-500" />
                      Protocol Settings
                    </h2>
                  </div>
                  
                  {/* Max Players */}
                  <div className="space-y-6">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1">Max Capacity</label>
                        <p className="text-[10px] text-slate-300 font-bold px-1 uppercase italic tracking-tighter">Total slot availability</p>
                      </div>
                      <span className="text-4xl font-black text-indigo-600 italic px-2 tracking-tighter">{localSettings.maxPlayers}</span>
                    </div>
                    <div className="relative pt-2">
                      <input 
                        type="range" min="3" max="10" step="1"
                        data-testid="slider-max-players"
                        title="Max Players"
                        value={localSettings.maxPlayers}
                        onChange={(e) => setLocalSettings(prev => ({ ...prev, maxPlayers: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-600 custom-slider"
                      />
                      <div className="flex justify-between mt-3 text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">
                        <span>3 MIN</span>
                        <span>10 MAX</span>
                      </div>
                    </div>
                  </div>

                  {/* Imposter Count */}
                  <div className="space-y-6">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-1">Imposter Quota</label>
                        <p className="text-[10px] text-slate-300 font-bold px-1 uppercase italic tracking-tighter">Active hostiles in field</p>
                      </div>
                      <span className="text-4xl font-black text-rose-600 italic px-2 tracking-tighter">{localSettings.impostersCount}</span>
                    </div>
                    <div className="relative pt-2">
                      <input 
                        type="range" min="1" max={maxAllowedImposters} step="1"
                        data-testid="slider-imposter-count"
                        title="Imposter Count"
                        value={localSettings.impostersCount}
                        onChange={(e) => setLocalSettings(prev => ({ ...prev, impostersCount: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-rose-600 custom-slider"
                      />
                      <div className="flex justify-between mt-3 text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">
                        <span>1 MIN</span>
                        <span>{maxAllowedImposters} MAX</span>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={handleUpdateSettings}
                    data-testid="btn-save-settings"
                    disabled={isSaving}
                    className="w-full py-5 bg-slate-900 text-white font-black rounded-2xl text-sm uppercase tracking-[0.3em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 overflow-hidden group"
                  >
                    {isSaving ? <RefreshCw size={18} className="animate-spin" /> : (
                      <>
                        <ShieldAlert size={18} className="group-hover:rotate-12 transition-transform" />
                        Save Protocols
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-rose-50/50 p-8 md:p-10 rounded-[3rem] border border-rose-100 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="space-y-2 text-center md:text-left">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-rose-500">Operation Termination</h3>
                    <p className="text-[10px] font-bold text-rose-400 uppercase tracking-tight leading-relaxed max-w-xs">
                      End the party session for all agents. This action is irreversible.
                    </p>
                  </div>
                  <button 
                    onClick={handleLeaveAndEnd}
                    data-testid="btn-disband"
                    className="w-full md:w-auto px-10 py-5 bg-rose-600 text-white font-black rounded-2xl text-xs uppercase tracking-[0.2em] shadow-xl shadow-rose-200 active:scale-95 transition-all flex items-center justify-center gap-2 group"
                  >
                    <LogOut size={18} />
                    LEAVE & END PARTY
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Existing Phases (Countdown, Reveal, Round, Results) */}
        {partyState.game.phase === GamePhase.COUNTDOWN && (
          <div className="text-center animate-in zoom-in duration-300">
            <h2 className="text-xs font-black uppercase tracking-[0.4em] text-slate-400 mb-10 animate-pulse">Establishing Identity...</h2>
            <div className="text-[14rem] font-black leading-none text-indigo-600 italic tracking-tighter drop-shadow-2xl" data-testid="timer-display">
              {partyState.game.remainingTime}
            </div>
          </div>
        )}

        {partyState.game.phase === GamePhase.REVEAL && (
          <div className="w-full space-y-8 animate-in fade-in zoom-in duration-500">
            <h2 className="text-center text-xs font-black uppercase tracking-[0.4em] text-slate-400">Classified Dossier</h2>
            <div className={`p-10 rounded-[3rem] shadow-2xl ${me?.role === 'imposter' ? 'bg-rose-600 text-white shadow-rose-200' : 'bg-slate-900 text-white shadow-slate-300'}`}>
              <div className="flex justify-center mb-8">
                <div className={`w-20 h-20 rounded-[2rem] border-4 flex items-center justify-center rotate-3 shadow-lg ${me?.role === 'imposter' ? 'border-rose-400/50 bg-rose-500' : 'border-slate-700 bg-slate-800'}`}>
                  {me?.role === 'imposter' ? <ShieldAlert size={40} /> : <Users size={40} />}
                </div>
              </div>
              <div className="text-center italic font-black text-7xl tracking-tighter mb-6 leading-none" data-testid="role-reveal">
                {me?.role === 'imposter' ? 'IMPOSTER' : 'CREW'}
              </div>
              <div className="h-px bg-white/10 my-10"></div>
              {me?.role === 'imposter' ? (
                <div className="space-y-6">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-200 text-center opacity-70">CONFIDENTIAL INTEL:</p>
                  <div className="bg-rose-500/50 p-6 rounded-3xl border-2 border-white/10 backdrop-blur-sm">
                    <p className="text-4xl font-black italic text-center break-words leading-tight" data-testid="reveal-hint">&quot;{partyState.game.hint}&quot;</p>
                  </div>
                  <p className="text-xs text-rose-100 font-bold leading-relaxed text-center opacity-80 px-4">
                    Infiltrate the conversation. Do not reveal your source material.
                  </p>
                </div>
              ) : (
                <div className="text-center space-y-6">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 text-center opacity-70">CONFIDENTIAL WORD:</p>
                  <div className="bg-slate-800 p-6 rounded-3xl border-2 border-white/5">
                    <p className="text-4xl font-black italic text-center break-words leading-tight text-white" data-testid="reveal-word">&quot;{partyState.game.secretWord}&quot;</p>
                  </div>
                  <p className="text-xs text-slate-400 font-bold leading-relaxed px-4">
                    The imposter has a hint but doesn't know the word. Expose the fraud.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {partyState.game.phase === GamePhase.ROUND && (
          <div className="w-full space-y-10 animate-in fade-in duration-500">
            <div className="text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-6 py-2 bg-indigo-50 text-indigo-600 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-sm">
                <Radio size={14} className="animate-pulse" />
                Open Frequency
              </div>
              <div className={`text-9xl font-black italic leading-none transition-all duration-500 tracking-tighter flex items-center justify-center gap-2 ${partyState.game.remainingTime < 30 ? 'text-rose-500 scale-105' : 'text-slate-900'}`}>
                <Timer size={48} strokeWidth={3} className="opacity-10" />
                <span data-testid="timer-display">
                  {Math.floor(partyState.game.remainingTime / 60)}:{(partyState.game.remainingTime % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Voting Section */}
            <div className="flex flex-col items-center">
              {/* Player Voting Section */}
              <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl shadow-slate-300 w-full max-w-2xl flex flex-col">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Expose Hostile</h3>
                  <div className="bg-rose-600 text-white text-[10px] font-black px-4 py-2 rounded-xl italic shadow-md shadow-rose-900/50">
                    {Object.keys(partyState.votes.votes).length} / {partyState.players.length} SUBMITTED
                  </div>
                </div>
                
                <div className="space-y-3 mb-8">
                  {partyState.players.map(p => {
                    const isSelf = p.id === playerId;
                    const hasVotedThisPerson = partyState.votes.votes[playerId || ''] === p.id;
                    const alreadyVoted = !!partyState.votes.votes[playerId || ''];

                    return (
                      <button
                        key={p.id}
                        disabled={isSelf || alreadyVoted}
                        onClick={() => onVotePlayer(p.id)}
                        className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all group ${
                          isSelf ? 'bg-white/5 opacity-50 cursor-not-allowed' : 
                          hasVotedThisPerson ? 'bg-rose-600 shadow-lg shadow-rose-900/50 border-2 border-rose-400' :
                          alreadyVoted ? 'bg-white/5 opacity-40 cursor-not-allowed' :
                          'bg-white/10 hover:bg-white/15 border-2 border-transparent hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${hasVotedThisPerson ? 'bg-rose-400 text-rose-950' : 'bg-white/10 text-white'}`}>
                            {p.name[0].toUpperCase()}
                          </div>
                          <span className={`font-bold tracking-tight ${hasVotedThisPerson ? 'text-white' : 'text-slate-300'}`}>
                            {p.name}
                          </span>
                        </div>
                        {hasVotedThisPerson && <CheckCircle2 size={20} className="text-white" />}
                        {!alreadyVoted && !isSelf && <ShieldAlert size={18} className="text-white/20 group-hover:text-rose-400 transition-colors" />}
                      </button>
                    );
                  })}
                </div>
                
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight text-center italic">
                  Majority rules. Ties result in no elimination.
                </p>
              </div>
            </div>
          </div>
        )}

        {partyState.game.phase === GamePhase.RESULTS && (
          <div className="w-full text-center space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="space-y-4">
              <div className={`inline-block px-10 py-4 rounded-[2rem] font-black italic text-4xl tracking-tighter shadow-xl ${partyState.game.winner === 'imposter' ? 'bg-rose-600 text-white shadow-rose-200' : 'bg-emerald-600 text-white shadow-emerald-200'}`}>
                {partyState.game.winner === 'imposter' ? 'IMPOSTERS DOMINATED' : 'NETWORK SECURED'}
              </div>
              <h2 className="text-8xl font-black italic tracking-tighter text-slate-900 leading-none" data-testid="results-title">MISSION<br/>COMPLETE</h2>
              <p className="text-slate-400 font-bold uppercase tracking-[0.4em] text-[10px]">Debriefing Report</p>
            </div>
            
            {partyState.game.lastEliminated && (
              <div className="bg-white p-6 rounded-[2rem] border-2 border-slate-100 italic font-bold text-slate-500 uppercase tracking-widest text-sm">
                Last person to leave: <span className="text-indigo-600">{partyState.game.lastEliminated === 'TIE' ? 'NO ONE (TIE)' : partyState.players.find(p => p.id === partyState.game.lastEliminated)?.name || 'UNKNOWN'}</span>
              </div>
            )}

            <div className="bg-slate-900 p-10 rounded-[4rem] text-white shadow-2xl shadow-slate-400 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 opacity-10">
                <ShieldAlert size={120} />
              </div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 mb-8 italic">Compromised Agents</h3>
              <div className="flex flex-wrap justify-center gap-4 mb-14 relative z-10">
                {partyState.players.filter(p => p.role === 'imposter').map(p => (
                  <div key={p.id} className="bg-rose-600 px-8 py-4 rounded-[2rem] shadow-xl shadow-rose-900/50 rotate-2" data-testid="result-imposter-row">
                    <span className="text-2xl font-black italic tracking-tighter uppercase">{p.name}</span>
                  </div>
                ))}
              </div>
              <div className="pt-10 border-t border-white/5 relative z-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">The Secret Word:</p>
                  <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                    <p className="text-4xl font-black italic text-indigo-400 tracking-tight leading-tight" data-testid="result-word">&quot;{partyState.game.secretWord}&quot;</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-4">The Imposter's Hint:</p>
                  <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                    <p className="text-2xl font-black italic text-rose-400 tracking-tight leading-tight" data-testid="result-hint">&quot;{partyState.game.hint}&quot;</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-6 pt-6">
              <div className="flex flex-col items-center gap-2 mb-4">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Returning to Lobby in</span>
                <span className="text-3xl font-black text-indigo-600 italic tracking-tighter" data-testid="results-countdown">{partyState.game.remainingTime}s</span>
              </div>
              {isLeader ? (
                <button 
                  onClick={handleStart}
                  disabled={isStarting}
                  data-testid="btn-play-again"
                  className="group w-full py-7 bg-indigo-600 text-white font-black rounded-[2.5rem] text-2xl shadow-2xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-3 tracking-tighter"
                >
                  {isStarting ? (
                    <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <RotateCcw size={24} />
                      IMMEDIATE RESTART
                    </>
                  )}
                </button>
              ) : (
                <div className="p-8 bg-white rounded-[3rem] border border-slate-100 flex items-center justify-center gap-4">
                  <div className="w-2 h-2 bg-indigo-600 rounded-full animate-ping"></div>
                  <p className="text-slate-400 font-black italic animate-pulse tracking-wide">Stand by for Redirection...</p>
                </div>
              )}
              <button 
                onClick={() => router.push('/')}
                className="group inline-flex items-center gap-2 text-xs font-black text-slate-400 hover:text-indigo-600 transition-colors uppercase tracking-[0.3em] py-2"
              >
                <HomeIcon size={14} />
                Return to HQ
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-14 text-center">
        {partyState.game.phase === GamePhase.ROUND && (
          <div className="p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm flex gap-4 items-start text-left">
            <div className="p-2 bg-amber-50 text-amber-500 rounded-xl">
              <AlertCircle size={20} />
            </div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-relaxed">
              Maintain operational security. Ask indirect questions to confirm fellow agents' knowledge without exposing the intel to hostiles.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
