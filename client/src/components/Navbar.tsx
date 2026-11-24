'use client';

import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Volume2,
  LogIn,
  Plus,
  Menu,
  X,
  Home,
  LogOut,
  ShieldCheck,
  History,
  ArrowUpRight,
} from 'lucide-react';
import { sound } from '../lib/sound';

interface NavbarProps {
  user: any;
  balanceType: 'REAL' | 'DEMO';
  setBalanceType: (type: 'REAL' | 'DEMO') => void;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onOpenAuth: () => void;
  onOpenFairness: () => void;
  onRefillDemo: () => void;
  onLogout: () => void;
  activeTab: 'HOME' | 'DEPOSIT' | 'AVIATOR' | 'ROULETTE' | 'BLACKJACK' | 'SLOTS' | 'DICE' | 'MINES' | 'HISTORY';
  onSelectTab: (tab: 'HOME' | 'DEPOSIT' | 'AVIATOR' | 'ROULETTE' | 'BLACKJACK' | 'SLOTS' | 'DICE' | 'MINES' | 'HISTORY') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  balanceType,
  setBalanceType,
  onOpenDeposit,
  onOpenWithdraw,
  onOpenAuth,
  onOpenFairness,
  onRefillDemo,
  onLogout,
  activeTab,
  onSelectTab,
}) => {
  const [mounted, setMounted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsMuted(sound.getMuted());
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  const handleToggleSound = () => {
    const muted = sound.toggleMute();
    setIsMuted(muted);
  };

  const currentBalance = user
    ? balanceType === 'REAL'
      ? user.realBalance
      : user.demoBalance
    : 0;

  return (
    <header
            className={`${activeTab === 'HOME' ? 'sportibet-home-header' : ''} sticky top-0 z-50 bg-[#0b0d12]/95 backdrop-blur-md border-b border-[#232733] px-2 sm:px-4 py-1.5 sm:py-2 flex-shrink-0 ${
        activeTab === 'AVIATOR' ? 'hidden' : ''
      }`}
    >
      <div className="w-full max-w-[1680px] mx-auto flex items-center justify-between gap-1.5 sm:gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              sound.playChip();
              onSelectTab('HOME');
            }}
            className="flex items-center gap-2 group transition"
            aria-label="Spotibet home"
          >
            <div className="relative flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-full overflow-hidden ring-1 ring-[#232733] group-hover:scale-105 transition-all bg-[#0e1015]">
              <img
                src="/spotibet-logo.png"
                alt="Spotibet"
                className="h-full w-full object-cover"
              />
            </div>
            <span className="text-lg sm:text-xl font-black tracking-tight text-[#eef2f8] flex items-center font-display">
              Spoti<span className="text-[#dc1c34]">bet</span>
            </span>
          </button>
        </div>

        {/* Right Tools: Demo/Real (Only inside game!), Balance, Deposit, Sound, Menu */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
          {/* Demo / Real toggle: ONLY rendered when inside a game, NOT on Home! */}
          {activeTab !== 'HOME' && (
            <div className="segmented p-0.5 rounded-lg sm:rounded-xl animate-in fade-in">
              <button
                onClick={() => {
                  sound.playChip();
                  setBalanceType('DEMO');
                }}
                aria-selected={balanceType === 'DEMO'}
                className={balanceType === 'DEMO' ? 'is-brand' : ''}
              >
                Demo
              </button>
              <button
                onClick={() => {
                  sound.playChip();
                  setBalanceType('REAL');
                }}
                aria-selected={balanceType === 'REAL'}
                className={balanceType === 'REAL' ? 'is-brand' : ''}
              >
                Real
              </button>
            </div>
          )}

          {/* Balance — tap to open the account menu (Deposit, Sound, settings). */}
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="sportibet-balance flex h-8 items-center gap-1.5 px-1.5 sm:px-3 text-[#c2cbda] rounded-lg hover:bg-[#12151d] transition"
            aria-label="Open account menu"
            aria-expanded={isMenuOpen}
            aria-controls="account-menu"
          >
            <div className="flex items-baseline gap-1 text-xs sm:text-sm font-semibold tabular-nums tracking-normal">
              <span className="text-[#6f7b90] text-[10px] sm:text-xs font-medium">KSh</span>
              {(currentBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </div>
          </button>

          {/* Hamburger Menu Toggle */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-[#0e1015] hover:bg-[#07080c] border border-[#232733] text-[#c2cbda] hover:text-[#eef2f8] transition"
            title="Menu"
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            aria-controls="account-menu"
          >
            {isMenuOpen ? <X className="w-4 h-4 text-[#eef2f8]" /> : <Menu className="w-4 h-4 text-[#c2cbda]" />}
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:bg-transparent lg:backdrop-blur-none" onClick={() => setIsMenuOpen(false)} aria-hidden="true" />
          <div
            id="account-menu"
            aria-label="Account menu"
            className="absolute right-2 sm:right-4 top-full mt-2 z-50 w-64 max-w-[calc(100vw-16px)] rounded-2xl border border-[#232733] bg-[#0e1015] p-2 text-[#c2cbda] shadow-pop"
          >
            <div className="flex items-center gap-2.5 border-b border-[#1f232d] px-2 py-3 mb-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1a1e27] text-xs font-bold text-[#98a3b8]" aria-hidden="true">
                {user?.username?.slice(0, 2).toUpperCase() || 'PL'}
              </div>
              <span className="truncate text-sm font-bold text-[#eef2f8]">{user?.username || 'Guest Player'}</span>
            </div>

            <div className="border-b border-[#1f232d] py-1 mb-1">
              {[
                { label: 'Sound', icon: Volume2, enabled: mounted && !isMuted, toggle: handleToggleSound },
              ].map(({ label, icon: Icon, enabled, toggle }) => (
                <div key={label} className="flex h-10 items-center justify-between px-2">
                  <span className="flex items-center gap-2.5 text-xs font-medium text-[#c2cbda]"><Icon className="h-4 w-4 text-[#6f7b90]" />{label}</span>
                  <button type="button" role="switch" aria-label={label} aria-checked={enabled} onClick={toggle} className="switch-track focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dc1c34]" data-on={enabled}>
                    <span className="switch-thumb" />
                  </button>
                </div>
              ))}
            </div>

            {[
              { label: 'Deposit', icon: Plus, action: onOpenDeposit },
              { label: 'Withdraw', icon: ArrowUpRight, action: onOpenWithdraw },
              { label: 'Home', icon: Home, action: () => onSelectTab('HOME') },
              { label: 'Bet history', icon: History, action: () => onSelectTab('HISTORY') },
              { label: 'Fairness', icon: ShieldCheck, action: onOpenFairness },
              ...(balanceType === 'DEMO' ? [{ label: 'Refill demo', icon: RefreshCw, action: onRefillDemo }] : []),
            ].map(({ label, icon: Icon, action }) => (
              <button key={label} type="button" onClick={() => { sound.playChip(); action(); setIsMenuOpen(false); }} className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8] focus-visible:bg-[#07080c]">
                <Icon className="h-4 w-4 text-[#6f7b90]" />{label}
              </button>
            ))}
            <div className="mt-1 border-t border-[#1f232d] pt-1">
              <button type="button" onClick={() => { setIsMenuOpen(false); user ? onLogout() : onOpenAuth(); }} className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium transition-colors ${user ? 'text-[#dc1c34] hover:bg-[#2e1218]' : 'text-[#c2cbda] hover:bg-[#07080c] hover:text-[#eef2f8]'}`}>
                {user ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4 text-[#6f7b90]" />}
                {user ? 'Sign out' : 'Sign in'}
              </button>
            </div>
          </div>
        </>
      )}
    </header>
  );
};
