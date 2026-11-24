'use client';

import React, { useEffect, useState } from 'react';
import { sound } from '../../lib/sound';
import { api } from '../../lib/api';
import { Plus, Hand, ArrowUpCircle } from 'lucide-react';

interface BlackjackGameProps {
  user: any;
  balanceType: 'REAL' | 'DEMO';
  onBalanceChange: () => void;
  onOpenFairness?: () => void;
}

export const BlackjackGame: React.FC<BlackjackGameProps> = ({
  user,
  balanceType,
  onBalanceChange,
}) => {
  const [amount, setAmount] = useState('500');
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // On mount, abandon any stale server-side Blackjack hand left from a previous
  // page load/refresh so the next deal works cleanly and any stuck bet is refunded.
  useEffect(() => {
    let cancelled = false;
    api.abandonBlackjack()
      .then(() => {
        if (!cancelled) onBalanceChange();
      })
      .catch(() => {/* ignore - no active hand is fine */});
    return () => { cancelled = true; };
  }, []);

  const handleDeal = async () => {
    sound.blackjackChip();
    setLoading(true);

    try {
      const res = await api.dealBlackjack({
        amount: parseFloat(amount),
        balanceType,
      });

      setSession(res.session);
      if (res.session.result === 'BLACKJACK') {
        sound.blackjackWin();
      }
      onBalanceChange();
    } catch (err: any) {
      alert(err.message || 'Deal failed');
    } finally {
      setLoading(false);
    }
  };

  const handleHit = async () => {
    if (!session || loading) return;
    sound.blackjackChip();
    setLoading(true);

    try {
      const res = await api.hitBlackjack(session.sessionId);
      setSession(res.session);
      if (res.session.result === 'DEALER_WIN') {
        sound.blackjackLoss(); // bust
      }
      onBalanceChange();
    } catch (err: any) {
      alert(err.message || 'Hit failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStand = async () => {
    if (!session || loading) return;
    sound.blackjackChip();
    setLoading(true);

    try {
      const res = await api.standBlackjack(session.sessionId);
      setSession(res.session);
      if (res.session.result === 'PLAYER_WIN') {
        sound.blackjackWin();
      } else if (res.session.result === 'DEALER_WIN') {
        sound.blackjackLoss();
      }
      onBalanceChange();
    } catch (err: any) {
      alert(err.message || 'Stand failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDouble = async () => {
    if (!session || loading) return;
    sound.blackjackChip();
    setLoading(true);

    try {
      const res = await api.doubleBlackjack(session.sessionId);
      setSession(res.session);
      if (res.session.result === 'PLAYER_WIN') {
        sound.blackjackWin();
      } else if (res.session.result === 'DEALER_WIN') {
        sound.blackjackLoss();
      }
      onBalanceChange();
    } catch (err: any) {
      alert(err.message || 'Double down failed');
    } finally {
      setLoading(false);
    }
  };

  const renderCard = (cardStr: string, idx: number) => {
    if (cardStr === 'HIDDEN') {
      return (
        <div
          key={idx}
          className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-gradient-to-tr from-rose-950 to-rose-700 border-2 border-rose-500 shadow-xl flex items-center justify-center text-rose-300 font-bold select-none"
        >
          🂠
        </div>
      );
    }

    const rank = cardStr.slice(0, -1);
    const suit = cardStr.slice(-1);
    const isRed = suit === '♥' || suit === '♦';

    return (
      <div
        key={idx}
        className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white border border-gray-300 shadow-2xl p-2 flex flex-col justify-between font-mono select-none animate-in fade-in duration-200"
      >
        <div className={`text-xs font-black leading-none ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
          {rank}
          <div className="text-[10px]">{suit}</div>
        </div>
        <div className={`text-center text-xl sm:text-2xl ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
          {suit}
        </div>
        <div className={`text-xs font-black leading-none text-right ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
          {rank}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-1.5 sm:p-4 flex flex-col items-center justify-center gap-2.5 sm:gap-4 h-full min-h-0">
      {/* Felt Blackjack Table */}
      <div className="w-full bg-[#0f1a16] border border-[#1d3a2e] rounded-2xl sm:rounded-3xl p-3 sm:p-10 shadow-card flex flex-col items-center justify-between min-h-[320px] sm:min-h-[420px] relative">
        {/* Dealer Area */}
        <div className="flex flex-col items-center">
          <span className="text-xs uppercase tracking-widest text-[#5fd39c] font-mono mb-2">
            DEALER {session ? `(${session.dealerScore})` : ''}
          </span>
          <div className="flex items-center gap-2">
            {session ? (
              session.dealerHand.map((c: string, i: number) => renderCard(c, i))
            ) : (
              <div className="w-16 h-24 rounded-xl border-2 border-dashed border-[#2a4a3c] flex items-center justify-center text-[#7ea393] text-xs">
                Dealer
              </div>
            )}
          </div>
        </div>

        {/* Center Table Banner / Outcome */}
        <div className="text-center my-4">
          {session?.result && (
            <div className="animate-in zoom-in-95 duration-150">
              <span
                className={`inline-block px-6 py-2 rounded-2xl text-lg font-black font-mono shadow-card border ${
                  session.result === 'PLAYER_WIN' || session.result === 'BLACKJACK'
                    ? 'bg-[#0e2a1e] text-[#4ade80] border-[#1f5c41]'
                    : session.result === 'PUSH'
                    ? 'bg-[#2a2113] text-[#f0b45c] border-[#5c4620]'
                    : 'bg-[#2b1218] text-[#ff7a90] border-[#6b2536]'
                }`}
              >
                {session.result === 'BLACKJACK' && `NATURAL BLACKJACK! +KSh ${session.payout.toLocaleString()}`}
                {session.result === 'PLAYER_WIN' && `YOU WIN! +KSh ${session.payout.toLocaleString()}`}
                {session.result === 'PUSH' && 'PUSH (TIE)'}
                {session.result === 'DEALER_WIN' && 'DEALER WINS'}
              </span>
            </div>
          )}
          {!session && (
            <span className="text-[#7ea393] text-xs tracking-widest font-mono uppercase">
              BLACKJACK PAYS 3:2 • DEALER MUST STAND ON 17
            </span>
          )}
        </div>

        {/* Player Area */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 mb-2">
            {session ? (
              session.playerHand.map((c: string, i: number) => renderCard(c, i))
            ) : (
              <div className="w-16 h-24 rounded-xl border-2 border-dashed border-[#2a4a3c] flex items-center justify-center text-[#7ea393] text-xs">
                Player
              </div>
            )}
          </div>
          <span className="text-xs uppercase tracking-widest text-[#5fd39c] font-mono">
            YOUR HAND {session ? `(${session.playerScore})` : ''}
          </span>
        </div>
      </div>

      {/* Action Controls */}
      <div className="w-full bg-[#0e1015] border border-[#232733] rounded-2xl sm:rounded-3xl p-2.5 sm:p-4 shadow-card flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4">
        {/* Bet Amount */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          <span className="text-[11px] sm:text-xs text-[#98a3b8] font-mono font-bold">BET:</span>
          <div className="flex items-center bg-[#12151d] border border-[#232733] rounded-xl px-2.5 py-1 sm:px-3 sm:py-1.5">
            <span className="text-[#6f7b90] font-bold text-xs mr-1.5">KSh</span>
            <input
              type="number"
              disabled={session && session.status === 'PLAYER_TURN'}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-16 sm:w-24 bg-transparent text-xs sm:text-sm font-mono font-bold text-[#eef2f8] focus:outline-none"
            />
          </div>
          {[100, 200, 500, 1000].map((val) => (
            <button
              key={val}
              disabled={session && session.status === 'PLAYER_TURN'}
              onClick={() => setAmount(String(val))}
              className="px-2 sm:px-2.5 py-1 rounded-lg bg-[#12151d] border border-[#232733] text-[#98a3b8] hover:bg-[#1f232d] hover:text-[#eef2f8] text-[11px] sm:text-xs font-mono font-bold transition"
            >
              +{val}
            </button>
          ))}
        </div>

        {/* Game Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {session && session.status === 'PLAYER_TURN' ? (
            <>
              <button
                onClick={handleHit}
                disabled={loading}
                className="flex-1 sm:flex-initial px-6 py-3 rounded-2xl btn-spribe-green text-white font-extrabold text-xs uppercase tracking-wider shadow-lg transition flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                HIT
              </button>
              <button
                onClick={handleStand}
                disabled={loading}
                className="flex-1 sm:flex-initial px-6 py-3 rounded-2xl btn-spribe-orange text-white font-extrabold text-xs uppercase tracking-wider shadow-lg transition flex items-center justify-center gap-1.5"
              >
                <Hand className="w-4 h-4" />
                STAND
              </button>
              {session.playerHand.length === 2 && (
                <button
                  onClick={handleDouble}
                  disabled={loading}
                  className="flex-1 sm:flex-initial px-5 py-3 rounded-2xl bg-gradient-to-b from-[#8b5cf6] to-[#a78bfa] hover:from-[#a78bfa] hover:to-[#7c3aed] text-white font-extrabold text-xs uppercase tracking-wider shadow-[0_3px_0_#4c1d95,0_8px_16px_rgba(139,92,246,0.3)] transition flex items-center justify-center gap-1.5"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  DOUBLE
                </button>
              )}
            </>
          ) : (
            <button
              onClick={handleDeal}
              disabled={loading}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl btn-spribe-green text-white font-extrabold text-sm uppercase tracking-wider shadow-lg transition"
            >
              {loading ? 'Dealing...' : `DEAL (KSh ${Number(amount || 0).toLocaleString()})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
