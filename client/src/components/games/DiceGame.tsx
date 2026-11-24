'use client';

import React, { useRef, useState } from 'react';
import { Dices } from 'lucide-react';
import { api } from '../../lib/api';
import { sound } from '../../lib/sound';

interface DiceGameProps {
  user: any;
  balanceType: 'REAL' | 'DEMO';
  onBalanceChange: () => void;
}

export function DiceGame({ user, balanceType, onBalanceChange }: DiceGameProps) {
  const [amount, setAmount] = useState('1000');
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<{ roll: number; won: boolean; payout: number } | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const roll = async () => {
    if (busy.current) return;
    const stake = Number(amount);
    if (!Number.isFinite(stake) || stake < 1000 || stake > 500000) {
      setError('Enter a bet between KSh 1,000 and KSh 500,000.');
      return;
    }
    busy.current = true;
    setRolling(true);
    setError('');
    setResult(null);
    sound.diceChip();
    try {
      const next = await api.rollDice({ amount: stake, balanceType });
      setResult(next);
      next.won ? sound.diceWin() : sound.diceLoss();
      onBalanceChange();
    } catch (err: any) {
      setError(err.message || 'Unable to roll. Please try again.');
    } finally {
      busy.current = false;
      setRolling(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 sm:p-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#dc1c34] font-bold">Spotibet</p>
        <h1 className="mt-2 text-3xl font-bold text-[#eef2f8]">Dice</h1>
        <p className="mt-2 text-sm text-[#98a3b8]">Roll a number from 1 to 50 to win. Results range from 1 to 100.</p>
      </div>
      <div className="relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-[#232733] bg-[#0e1015] p-6 shadow-card">
        <Dices aria-hidden="true" className={`h-14 w-14 text-[#dc1c34] ${rolling ? 'animate-bounce motion-reduce:animate-none' : ''}`} strokeWidth={1.5} />
        <div className="mt-4 text-center" aria-live="polite" aria-atomic="true">
          <p className="text-5xl font-bold tabular-nums text-[#eef2f8]">{rolling ? '…' : result?.roll ?? '—'}</p>
          <p className={`mt-3 text-sm ${result?.won ? 'text-[#2fd08a]' : 'text-[#98a3b8]'}`}>
            {rolling ? 'Rolling…' : result ? result.won ? `Won KSh ${result.payout.toLocaleString()}` : 'No win this roll' : 'Ready to roll'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center text-sm">
        <div className="rounded-xl border border-[#232733] bg-[#0e1015] p-3 shadow-card"><p className="text-xs text-[#98a3b8]">Win chance</p><p className="mt-1 font-semibold text-[#eef2f8]">50%</p></div>
        <div className="rounded-xl border border-[#232733] bg-[#0e1015] p-3 shadow-card"><p className="text-xs text-[#98a3b8]">Total payout</p><p className="mt-1 font-semibold text-[#eef2f8]">1.96x stake</p></div>
      </div>
      <label className="text-sm font-medium text-[#c2cbda]">Bet amount (KSh)
        <input type="number" min="1000" max="500000" step="1000" value={amount} disabled={rolling} onChange={e => setAmount(e.target.value)} className="field-input mt-2 font-mono font-bold text-[#eef2f8]" />
      </label>
      <div className="grid grid-cols-4 gap-2">{[1000, 2000, 5000, 10000].map(value => <button key={value} disabled={rolling} onClick={() => setAmount(String(value))} className="rounded-lg bg-[#0e1015] border border-[#232733] py-2 text-xs font-medium text-[#98a3b8] hover:bg-[#07080c] hover:text-[#eef2f8] transition">{value.toLocaleString()}</button>)}</div>
      {error && <p role="alert" className="text-sm text-[#f4587a]">{error}</p>}
      <button onClick={roll} disabled={rolling || !user} className="rounded-xl bg-[#dc1c34] px-5 py-3 text-sm font-bold text-white shadow-[0_6px_18px_rgba(220,28,52,0.28)] border border-[#c0152b] hover:bg-[#f02840] active:scale-[0.99] transition disabled:cursor-not-allowed disabled:opacity-50">{rolling ? 'Rolling…' : !user ? 'Connecting account…' : 'Roll dice'}</button>
    </div>
  );
}
