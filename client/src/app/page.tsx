'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, X } from 'lucide-react';
import { Navbar } from '../components/Navbar';
import { HomeLobby } from '../components/HomeLobby';
import { AuthModal } from '../components/AuthModal';
import { DepositPage } from '../components/DepositPage';
import { WithdrawModal } from '../components/WithdrawModal';
import { FairnessModal } from '../components/FairnessModal';
import { AviatorGame } from '../components/games/AviatorGame';
import { RouletteGame } from '../components/games/RouletteGame';
import { MinesGame } from '../components/games/MinesGame';
import { BlackjackGame } from '../components/games/BlackjackGame';
import { DiceGame } from '../components/games/DiceGame';
import { SlotsGame } from '../components/games/SlotsGame';
import { HistoryView } from '../components/HistoryView';
import { getSocket } from '../lib/socket';
import { api, getAuthToken, removeAuthToken } from '../lib/api';
import { sound } from '../lib/sound';

export default function App() {
  const [activeTab, setActiveTab] = useState<'HOME' | 'DEPOSIT' | 'AVIATOR' | 'ROULETTE' | 'BLACKJACK' | 'SLOTS' | 'DICE' | 'MINES' | 'HISTORY'>('HOME');
  const [user, setUser] = useState<any>(null);
  const [balanceType, setBalanceType] = useState<'REAL' | 'DEMO'>('DEMO');
  const [socket, setSocket] = useState<any>(null);

  // Modals
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const paymentHandled = useRef(false);

  // Load User Profile & Socket, and verify a Paystack redirect if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref') || params.get('ref');
    const hadPaymentParams = Boolean(reference || params.get('payment'));

    const clearPaymentParams = () => {
      if (hadPaymentParams) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    };

    const verifyPaystackReturn = async () => {
      if (!reference || paymentHandled.current) return;
      paymentHandled.current = true;

      try {
        const res = await api.verifyDeposit(reference);
        setPaymentNotice({
          type: 'success',
          message: `Payment confirmed. KSh ${Number(res.amount || 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} was added to your real balance.`,
        });
        await loadUserProfile();
      } catch (err: any) {
        setPaymentNotice({
          type: 'error',
          message:
            err?.message ||
            `We could not verify payment ${reference}. If you were charged, contact support with this reference.`,
        });
      } finally {
        clearPaymentParams();
      }
    };

    const token = getAuthToken();

    if (token) {
      const sock = getSocket(token);
      setSocket(sock);
      loadUserProfile();
      verifyPaystackReturn();
    } else {
      // Auto-create guest session so user can immediately play without friction!
      api.guest()
        .then((res) => {
          localStorage.setItem('casino_token', res.token);
          setUser(res.user);
          // Reconnect socket with the new guest token so Aviator bets authenticate
          const updatedSock = getSocket(res.token);
          setSocket(updatedSock);
          verifyPaystackReturn();
        })
        .catch((err) => {
          console.log('Guest initialization notice:', err);
          clearPaymentParams();
        });
    }
  }, []);

  useEffect(() => {
    if (!paymentNotice) return;
    const timer = setTimeout(() => setPaymentNotice(null), 10000);
    return () => clearTimeout(timer);
  }, [paymentNotice]);

  const loadUserProfile = async () => {
    try {
      const res = await api.me();
      setUser(res.user);
    } catch (err) {
      removeAuthToken();
      setUser(null);
    }
  };

  const handleRefillDemo = async () => {
    try {
      const res = await api.refillDemo();
      sound.playCashout();
      setUser((prev: any) => ({ ...prev, demoBalance: res.demoBalance }));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleLogout = () => {
    removeAuthToken();
    setUser(null);
    window.location.reload();
  };

  return (
    <div className="h-[100dvh] max-h-[100dvh] w-full flex flex-col bg-[#07080c] text-[#c2cbda] overflow-hidden select-none">
      {paymentNotice && (
        <div
          className={`fixed top-3 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-2rem)] max-w-lg rounded-2xl border px-4 py-3 text-xs font-semibold shadow-pop flex items-start gap-3 ${
            paymentNotice.type === 'success'
              ? 'bg-[#0e2a1e] border-[#1f5c41] text-[#4ade80]'
              : 'bg-[#2b1218] border-[#6b2536] text-[#ff7a90]'
          }`}
        >
          {paymentNotice.type === 'success' ? (
            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          )}
          <span className="flex-1 leading-relaxed">{paymentNotice.message}</span>
          <button
            onClick={() => setPaymentNotice(null)}
            className="text-current/60 hover:text-current p-0.5 rounded transition"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Navbar
        user={user}
        balanceType={balanceType}
        setBalanceType={setBalanceType}
        onOpenDeposit={() => setActiveTab('DEPOSIT')}
        onOpenWithdraw={() => setIsWithdrawOpen(true)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onOpenFairness={() => setIsFairnessOpen(true)}
        onRefillDemo={handleRefillDemo}
        onLogout={handleLogout}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
      />

      {/* Main Content Area: Flexes to exact remaining viewport height */}
      <main className={`flex-1 flex flex-col overflow-y-auto min-h-0 w-full ${activeTab === 'HOME' ? 'sportibet-lobby-background' : 'lg:overflow-hidden'}`}>
        {activeTab === 'HOME' && (
          <HomeLobby
            onSelectGame={(g) => setActiveTab(g)}
            user={user}
            onOpenDeposit={() => setActiveTab('DEPOSIT')}
          />
        )}

        {activeTab === 'DEPOSIT' && (
          <DepositPage
            user={user}
            onNavigateHome={() => setActiveTab('HOME')}
            onBalanceUpdated={loadUserProfile}
          />
        )}

        {activeTab === 'AVIATOR' && (
          <AviatorGame
            socket={socket}
            user={user}
            balanceType={balanceType}
            setBalanceType={setBalanceType}
            onBalanceChange={loadUserProfile}
            onOpenFairness={() => setIsFairnessOpen(true)}
            onNavigateHome={() => setActiveTab('HOME')}
            onOpenDeposit={() => setActiveTab('DEPOSIT')}
            onOpenWithdraw={() => setIsWithdrawOpen(true)}
            onRefillDemo={handleRefillDemo}
          />
        )}

        {activeTab === 'ROULETTE' && (
          <RouletteGame
            user={user}
            balanceType={balanceType}
            onBalanceChange={loadUserProfile}
            onOpenFairness={() => setIsFairnessOpen(true)}
          />
        )}

        {activeTab === 'MINES' && (
          <MinesGame
            user={user}
            balanceType={balanceType}
            onBalanceChange={loadUserProfile}
            onOpenFairness={() => setIsFairnessOpen(true)}
          />
        )}

        {activeTab === 'BLACKJACK' && (
          <BlackjackGame
            user={user}
            balanceType={balanceType}
            onBalanceChange={loadUserProfile}
            onOpenFairness={() => setIsFairnessOpen(true)}
          />
        )}

        {activeTab === 'SLOTS' && (
          <SlotsGame
            user={user}
            balanceType={balanceType}
            onBalanceChange={loadUserProfile}
            onOpenFairness={() => setIsFairnessOpen(true)}
          />
        )}

        {activeTab === 'DICE' && <DiceGame user={user} balanceType={balanceType} onBalanceChange={loadUserProfile} />}

        {activeTab === 'HISTORY' && <HistoryView />}
      </main>

      {/* Global Modals */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={(authUser) => {
          setUser(authUser);
          // Reconnect socket with the newly-authenticated token
          const updatedSock = getSocket(getAuthToken() || undefined);
          setSocket(updatedSock);
        }}
      />

      <WithdrawModal
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        user={user}
        onBalanceUpdated={loadUserProfile}
      />

      <FairnessModal
        isOpen={isFairnessOpen}
        onClose={() => setIsFairnessOpen(false)}
        gameType={
          activeTab === 'ROULETTE' ? 'ROULETTE'
          : activeTab === 'MINES' ? 'MINES'
          : activeTab === 'BLACKJACK' ? 'BLACKJACK'
          : activeTab === 'SLOTS' ? 'SLOTS'
          : activeTab === 'DICE' ? 'DICE'
          : 'AVIATOR'
        }
      />
    </div>
  );
}
