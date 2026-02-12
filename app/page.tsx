'use client';

import { useGame } from '@/hooks/use-game';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Play, Plus, Users, ShieldAlert, Fingerprint, Gamepad2, Spade, Users2, ChevronLeft, RefreshCw } from 'lucide-react';

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState<'hub' | 'imposter'>('hub');
  const router = useRouter();
  const { createParty, partyState, error } = useGame();

  useEffect(() => {
    if (partyState?.code && name) {
      router.push(`/party/${partyState.code}?name=${encodeURIComponent(name)}`);
    }
  }, [partyState?.code, name, router]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      setIsLoading(false);
    }
  }, [error]);

  const handleCreate = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || isLoading) return;
    setIsLoading(true);
    createParty(name);
  };

  const handleJoin = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || !code.trim() || isLoading) return;
    setIsLoading(true);
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
          <div className="flex justify-end">
            <button 
              onClick={handleReset}
              className="text-[10px] font-black text-slate-300 hover:text-rose-500 uppercase tracking-widest transition-colors flex items-center gap-1.5"
            >
              <RefreshCw size={12} /> Clear Testing Session
            </button>
          </div>
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
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-50 font-sans text-gray-900">
      <div className="w-full max-w-sm space-y-10">
        <button 
          onClick={() => setSelectedGame('hub')}
          className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors"
        >
          <ChevronLeft size={16} /> Back to Hub
        </button>
        
        <div className="text-center relative">
          <h1 className="text-6xl font-black italic tracking-tighter text-indigo-600 mb-2 drop-shadow-sm uppercase">
            IMPOSTER <span className="text-slate-900">PARTY</span>
          </h1>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2">
            <Fingerprint className="inline" size={18} />
            Spot the fakes
          </p>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl shadow-indigo-100 border border-slate-100 space-y-6">
          <form onSubmit={handleCreate} className="space-y-6">
            <div className="space-y-3">
              <label htmlFor="name" className="text-xs font-black uppercase tracking-[0.2em] text-indigo-400 ml-1">Agent Handle</label>
              <input
                id="name"
                data-testid="input-name"
                type="text"
                placeholder="YOUR NAME"
                value={name}
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
                className="w-full px-6 py-5 bg-slate-50 border-3 border-transparent focus:border-indigo-500 focus:bg-white rounded-3xl outline-none transition-all text-xl font-bold placeholder:text-slate-300"
              />
            </div>

            <button
              type="submit"
              data-testid="btn-create"
              disabled={!name.trim() || isLoading}
              className="group w-full px-6 py-6 bg-indigo-600 text-white font-black rounded-3xl shadow-xl shadow-indigo-200 active:scale-95 transition-all disabled:opacity-50 text-xl tracking-tighter flex items-center justify-center gap-3"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Plus size={24} strokeWidth={3} />
                  CREATE PARTY
                </>
              )}
            </button>
          </form>
          
          <div className="relative py-2 flex items-center gap-4">
            <div className="flex-grow h-px bg-slate-100" />
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">or</p>
            <div className="flex-grow h-px bg-slate-100" />
          </div>

          <form onSubmit={handleJoin} className="space-y-3">
            <div className="flex gap-3">
              <input
                type="text"
                data-testid="input-code"
                placeholder="CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="w-1/2 px-6 py-5 bg-slate-50 border-3 border-transparent focus:border-rose-500 focus:bg-white rounded-3xl outline-none transition-all text-center uppercase font-black tracking-[0.3em] text-xl placeholder:text-slate-300"
              />
              <button
                type="submit"
                data-testid="btn-join"
                disabled={!name.trim() || code.length < 6 || isLoading}
                className="w-1/2 px-6 py-5 bg-rose-500 text-white font-black rounded-3xl shadow-xl shadow-rose-200 active:scale-95 transition-all disabled:opacity-50 text-xl tracking-tighter flex items-center justify-center gap-3"
              >
                <Users size={24} strokeWidth={3} />
                JOIN
              </button>
            </div>
          </form>
        </div>

        <div className="px-6 space-y-4">
          <div className="flex items-start gap-4 p-5 bg-white rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
              <Play size={20} fill="currentColor" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 mb-1">MISSION PROTOCOL</h3>
              <p className="text-xs text-slate-500 leading-relaxed font-medium">
                Start a party, share the code. Imposters receive a secret hint. Use the next 2 minutes to smoke them out before the vote begins.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
