'use client';

import { useGame } from '@/hooks/use-game';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Play, Plus, Users, ShieldAlert, Fingerprint, Gamepad2, Spade, Users2, ChevronLeft, RefreshCw } from 'lucide-react';

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedGame, setSelectedGame] = useState<'hub' | 'imposter'>('hub');
  const router = useRouter();
  const { createParty, partyState, error, clearError } = useGame();

  // isLoading is true only when we've submitted AND no error has come back yet
  const isLoading = isSubmitting && !error;

  useEffect(() => {
    if (partyState?.code && name) {
      router.push(`/party/${partyState.code}?name=${encodeURIComponent(name)}`);
    }
  }, [partyState?.code, name, router]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleCreate = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || isLoading) return;
    clearError();
    setIsSubmitting(true);
    createParty(name);
  };

  const handleJoin = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || !code.trim() || isLoading) return;
    setIsSubmitting(true);
    router.push(`/party/${code.toUpperCase()}?name=${encodeURIComponent(name)}`);
  };

  const handleReset = () => {
    sessionStorage.clear();
    window.location.reload();
  };

  if (selectedGame === 'hub') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-50 font-sans text-gray-900">
        <div className="w-full max-w-4xl space-y-12">
          {/* Only visible during local development — hidden in production builds */}
          {process.env.NODE_ENV !== 'production' && (
            <div className="flex justify-end">
              <button
                onClick={handleReset}
                className="text-[10px] font-black text-slate-300 hover:text-rose-500 uppercase tracking-widest transition-colors flex items-center gap-1.5"
              >
                <RefreshCw size={12} /> Clear Testing Session
              </button>
            </div>
          )}
          <div className="text-center space-y-4">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight text-slate-900 drop-shadow-sm">
              Romish <span className="text-indigo-600">Party Games</span>
            </h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2">
              <Gamepad2 className="text-indigo-500" size={20} />
              Choose your adventure
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Imposter Card */}
            <button 
              onClick={() => setSelectedGame('imposter')}
              data-testid="game-imposter"
              className="group relative flex flex-col items-center p-8 bg-white rounded-[3rem] shadow-xl shadow-indigo-100 border-2 border-transparent hover:border-indigo-600 transition-all text-center space-y-6"
            >
              <div className="p-6 bg-indigo-50 rounded-[2rem] text-indigo-600 group-hover:scale-110 transition-transform">
                <ShieldAlert size={48} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-900">IMPOSTER</h2>
                <p className="text-sm text-slate-500 font-medium">Find the fakes among your crew. Pure social deduction.</p>
              </div>
              <div className="px-6 py-3 bg-indigo-600 text-white font-black rounded-2xl text-xs uppercase tracking-widest shadow-lg shadow-indigo-200">
                PLAY NOW
              </div>
            </button>

            {/* Remi Card */}
            <div className="group relative flex flex-col items-center p-8 bg-slate-100 rounded-[3rem] border-2 border-dashed border-slate-200 text-center space-y-6 opacity-60 grayscale cursor-not-allowed">
              <div className="p-6 bg-slate-200 rounded-[2rem] text-slate-400">
                <Spade size={48} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-400 uppercase">REMI</h2>
                <p className="text-sm text-slate-400 font-medium italic">Traditional card classic.</p>
              </div>
              <div className="px-6 py-3 bg-slate-300 text-slate-500 font-black rounded-2xl text-xs uppercase tracking-widest">
                COMING SOON
              </div>
            </div>

            {/* Poker Card */}
            <div className="group relative flex flex-col items-center p-8 bg-slate-100 rounded-[3rem] border-2 border-dashed border-slate-200 text-center space-y-6 opacity-60 grayscale cursor-not-allowed">
              <div className="p-6 bg-slate-200 rounded-[2rem] text-slate-400">
                <Users2 size={48} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-400 uppercase">POKER</h2>
                <p className="text-sm text-slate-400 font-medium italic">High stakes, high rewards.</p>
              </div>
              <div className="px-6 py-3 bg-slate-300 text-slate-500 font-black rounded-2xl text-xs uppercase tracking-widest">
                COMING SOON
              </div>
            </div>
          </div>
          
          <p className="text-center text-slate-400 text-xs font-bold uppercase tracking-[0.2em]">More games being added monthly</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-950 font-sans text-white selection:bg-indigo-500/20">
      <div className="w-full max-w-lg space-y-12 animate-in fade-in zoom-in duration-500">
        <button 
          onClick={() => setSelectedGame('hub')}
          className="text-[10px] font-black text-slate-500 hover:text-white uppercase tracking-widest transition-all flex items-center gap-1.5"
        >
          <ChevronLeft size={14} strokeWidth={3} /> Back to Hub
        </button>
        
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-32 h-32 bg-indigo-600 rounded-[3rem] shadow-2xl flex items-center justify-center rotate-6 scale-110 mb-8 border-4 border-indigo-400/20">
              <ShieldAlert size={64} className="text-white drop-shadow-lg" />
            </div>
          </div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tight italic text-white leading-none uppercase drop-shadow-2xl">
            INFILTRATOR
          </h1>
          <p className="text-slate-500 font-bold uppercase tracking-[0.4em] text-[10px] flex items-center justify-center gap-3">
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
            Secure Channel Open
          </p>
        </div>

        <div className="bg-slate-900/50 p-10 rounded-[3.5rem] border border-slate-800 shadow-3xl backdrop-blur-xl">
          <form onSubmit={handleCreate} className="space-y-10">
            <div className="space-y-4">
              <label htmlFor="name" className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 flex items-center gap-2">
                <Fingerprint size={14} strokeWidth={3} /> Agent Codename
              </label>
              <input
                id="name"
                data-testid="input-name"
                type="text"
                placeholder="ENTER HANDLE"
                value={name}
                autoComplete="off"
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-700/50 p-6 rounded-3xl text-2xl font-black italic tracking-tighter placeholder:text-slate-800 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/30 transition-all text-white shadow-inner"
              />
            </div>

            <button
              type="submit"
              data-testid="btn-create"
              disabled={!name.trim() || isLoading}
              className="group w-full px-6 py-8 bg-indigo-600 text-white font-black rounded-3xl shadow-3xl shadow-indigo-900/40 hover:shadow-indigo-500/50 hover:-translate-y-1 active:scale-95 transition-all flex items-center justify-center gap-4 disabled:opacity-30 disabled:hover:translate-y-0 disabled:shadow-none text-2xl italic tracking-tighter"
            >
              {isLoading ? (
                <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Plus size={28} strokeWidth={4} />
                  INITIATE MISSION
                </>
              )}
            </button>
          </form>
          
          <div className="relative py-6 flex items-center gap-4">
            <div className="flex-grow h-px bg-slate-800/50" />
            <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest italic">or enter link</p>
            <div className="flex-grow h-px bg-slate-800/50" />
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div className="flex gap-4">
              <input
                type="text"
                data-testid="input-code"
                placeholder="CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="w-1/2 bg-slate-900 text-center border-2 border-slate-800 p-6 rounded-[2.5rem] font-mono tracking-[0.5em] placeholder:text-slate-800 focus:outline-none focus:border-indigo-500/30 transition-all text-indigo-400 text-3xl"
              />
              <button
                type="submit"
                data-testid="btn-join"
                disabled={!name.trim() || code.length < 6 || isLoading}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-[2.5rem] shadow-xl active:scale-95 transition-all disabled:opacity-30 text-xl tracking-tighter flex items-center justify-center gap-3 border border-slate-700/50 italic"
              >
                <Users size={24} strokeWidth={3} />
                JOIN
              </button>
            </div>
          </form>
        </div>

        <div className="px-6 space-y-4">
          <div className="flex items-start gap-4 p-6 bg-slate-900/30 rounded-[2.5rem] border border-slate-800/50 backdrop-blur-sm">
            <div className="p-3 bg-indigo-950/50 rounded-2xl text-indigo-400 border border-indigo-900/30">
              <Play size={20} fill="currentColor" strokeWidth={3} />
            </div>
            <div>
              <h3 className="text-xs font-black text-white mb-1 uppercase tracking-widest">Operator Briefing</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed font-bold italic">
                Infiltrate the network. Use indirect questioning to identify the rogue agent. Secure the intel before extraction.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
