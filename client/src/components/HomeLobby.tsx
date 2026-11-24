'use client';

import React from 'react';
import { ShieldCheck, Plane } from 'lucide-react';
import { sound } from '../lib/sound';

interface HomeLobbyProps {
  onSelectGame: (game: 'AVIATOR' | 'ROULETTE' | 'BLACKJACK' | 'SLOTS' | 'DICE' | 'MINES') => void;
  user: any;
  onOpenDeposit: () => void;
}

export const HomeLobby: React.FC<HomeLobbyProps> = ({
  onSelectGame,
}) => {
  const games = [
    { id: 'AVIATOR' as const, title: 'Aviator', artwork: '/games/aviator-3d.webp' },
    { id: 'MINES' as const, title: 'Mines', artwork: '/games/mines-3d.webp' },
    { id: 'ROULETTE' as const, title: 'Roulette', artwork: '/games/roulette-3d.webp' },
    { id: 'BLACKJACK' as const, title: 'Blackjack', artwork: '/games/blackjack-3d.webp' },
    { id: 'SLOTS' as const, title: 'Slots', artwork: '/games/slots-3d.webp' },
    { id: 'DICE' as const, title: 'Dice', artwork: '/games/dice-3d.webp' },
  ];

  return (
    <div className="sportibet-home-page flex min-h-full w-full flex-shrink-0 flex-col">
      <div className="sportibet-lobby flex-1 w-full max-w-[1560px] mx-auto px-3 sm:px-7 py-3 sm:py-6 space-y-3 sm:space-y-6 animate-in fade-in">
        {/* VIP Lounge Hero Panel */}
        <section
          className="sportibet-welcome-panel relative w-full overflow-hidden rounded-2xl sm:rounded-3xl px-5 py-8 sm:px-10 sm:py-14"
          aria-label="Spotibet welcome"
        >
          {/* Decorative concentric rings */}
          <div className="sportibet-hero-art" aria-hidden="true">
            <span className="sportibet-hero-orbit sportibet-hero-orbit-one" />
            <span className="sportibet-hero-orbit sportibet-hero-orbit-two" />
            <span className="sportibet-hero-orbit sportibet-hero-orbit-three" />
          </div>

          <div className="relative z-10 max-w-2xl">
            <h1 className="mt-2 sm:mt-3 text-[28px] leading-[1.08] sm:text-4xl lg:text-5xl font-black tracking-tight text-[#eef2f8] font-display">
              Welcome to<br className="sm:hidden" /> Mega Casino
            </h1>
            <p className="mt-3 sm:mt-4 max-w-md text-sm sm:text-base leading-relaxed text-[#98a3b8]">
              Aviator, roulette, blackjack, slots and mines — all provably fair, all in one place.
            </p>

            <div className="mt-5 sm:mt-7 flex flex-wrap items-center gap-2.5 sm:gap-3">
              <button
                onClick={() => {
                  sound.playChip();
                  onSelectGame('AVIATOR');
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#dc1c34] px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-bold uppercase tracking-wide text-white border border-[#c0152b] hover:bg-[#f02840] active:scale-[0.98] transition"
              >
                <Plane className="h-4 w-4 -rotate-12" />
                <span>Play Aviator</span>
              </button>
              <button
                onClick={() => {
                  sound.playChip();
                  onSelectGame('ROULETTE');
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0e1015] px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-bold uppercase tracking-wide text-[#eef2f8] border border-[#232733] hover:bg-[#12151d] active:scale-[0.98] transition"
              >
                <span>Browse all games</span>
              </button>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between border-b border-[#232733] pb-2.5">
          <h2 className="sportibet-games text-base sm:text-2xl font-bold tracking-tight text-[#eef2f8] font-display">Our Games</h2>
          <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-[#2e1218] text-[#dc1c34] border border-[#5c2430]">{games.length} games</span>
        </div>

        {/* Grid of Clean High-Impact 3D Game Cards - Zero Clutter */}
        <div className="sportibet-game-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-4 lg:gap-5">
          {games.map((game) => (
            <button
              key={game.id}
              type="button"
              onClick={() => {
                sound.playChip();
                onSelectGame(game.id);
              }}
              className="group cursor-pointer flex flex-col items-center w-full bg-transparent border-0 p-0 transition transform hover:-translate-y-1 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dc1c34] rounded-2xl"
            >
              {/* 3D Game Cover - Pure Artwork */}
              <div className="sportibet-game-cover w-full aspect-[4/3] rounded-xl sm:rounded-2xl relative overflow-hidden border border-[#232733] transition-all duration-300 bg-[#0e1015]">
                <img
                  src={game.artwork}
                  alt={game.title}
                  className="w-full h-full object-cover select-none transition-transform duration-500 ease-out group-hover:scale-105"
                  draggable={false}
                />
              </div>

              {/* Clean Game Title Below */}
              <span className="mt-1.5 text-xs sm:text-sm font-bold text-[#eef2f8] group-hover:text-[#dc1c34] transition text-center tracking-wide font-display">
                {game.title}
              </span>
            </button>
          ))}
        </div>
      </div>
      <footer className="sportibet-footer mt-6 border-t border-[#232733] bg-[#161a22] text-slate-300" aria-label="Spotibet responsible play">
        <div className="sportibet-footer-grid mx-auto grid w-full max-w-[1560px] gap-7 px-5 py-7 sm:px-7 lg:grid-cols-2 lg:gap-12 lg:py-8">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[5px] border-[#dc1c34] bg-white text-sm font-black tracking-tighter text-slate-900" aria-label="Adults aged 18 and above">18+</span>
            <div className="max-w-xl">
              <p className="mb-1 text-sm font-bold text-white">Adults only. Play responsibly.</p>
              <p className="text-xs leading-relaxed text-slate-400">Spotibet is for adults aged 18+. Betting can be addictive and cause financial and psychological harm. Only play with money you can afford to lose.</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-[#0e1015]/5 text-slate-300" aria-hidden="true"><ShieldCheck className="h-6 w-6" strokeWidth={1.5} /></span>
            <div className="max-w-xl">
              <p className="mb-1 text-sm font-bold text-white">Spotibet · Licensing</p>
              <p className="text-xs leading-relaxed text-slate-400">Spotibet is licensed and regulated by the Betting Control and Licensing Board of Kenya (BCLB) under the Betting, Lotteries and Gaming Act, Cap 131, Laws of Kenya, with licence numbers <span className="whitespace-nowrap text-slate-300 font-semibold">BK-0001203</span> and <span className="whitespace-nowrap text-slate-300 font-semibold">PG-0001202</span>.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
