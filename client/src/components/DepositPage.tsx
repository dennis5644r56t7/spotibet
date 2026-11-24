'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Smartphone, CreditCard, Building2, AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { api, WalletConfig } from '../lib/api';
import { sound } from '../lib/sound';

interface DepositPageProps {
  user: any;
  onNavigateHome: () => void;
  onBalanceUpdated: () => void;
}

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];
const FALLBACK_MIN = 50;

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const DepositPage: React.FC<DepositPageProps> = ({
  user,
  onNavigateHome,
  onBalanceUpdated,
}) => {
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState<'MPESA' | 'CARD' | 'BANK'>('MPESA');
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getWalletConfig().then((cfg) => {
      if (cancelled) return;
      setConfig(cfg);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const currency = config?.currency || 'KES';
  const minDeposit = config?.minDeposit ?? FALLBACK_MIN;
  const maxDeposit = config?.maxDeposit ?? 500000;
  const paystackReady = config?.paystackConfigured === true;

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric < minDeposit || numeric > maxDeposit) {
      setError(`Enter an amount between ${currency} ${minDeposit} and ${currency} ${maxDeposit.toLocaleString()}.`);
      return;
    }
    if (!paystackReady) {
      setError('Paystack is not configured on the server yet.');
      return;
    }

    setLoading(true);
    sound.playChip();

    try {
      const res = await api.deposit(numeric, currency, method);
      const PaystackPop = (window as any).PaystackPop;

      if (res?.accessCode && typeof PaystackPop === 'function') {
        setLoading(false);
        const popup = new PaystackPop();
        popup.resumeTransaction(res.accessCode, {
          onSuccess: async (transaction: any) => {
            try {
              await api.verifyDeposit(String(transaction?.reference || res.reference));
              onBalanceUpdated();
              setSuccess('Payment received. Your wallet has been credited.');
              setTimeout(onNavigateHome, 2500);
            } catch (err: any) {
              setError(err.message || 'Could not verify the payment');
            }
          },
          onCancel: () => setError('Payment was cancelled.'),
          onError: (err: any) => setError(err?.message || 'Paystack checkout could not be loaded.'),
        });
        return;
      }

      if (!res?.authorizationUrl) throw new Error('Paystack did not return a checkout URL');
      window.location.assign(res.authorizationUrl);
    } catch (err: any) {
      setError(err.message || 'Could not start the deposit');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      <button
        onClick={() => { sound.playChip(); onNavigateHome(); }}
        className="mb-5 flex items-center gap-1.5 text-xs font-bold text-[#98a3b8] hover:text-[#eef2f8] transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Home
      </button>

      <div className="bg-[#0e1015] border border-[#232733] rounded-2xl p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full overflow-hidden border border-[#232733] shrink-0">
            <img src="/spotibet-logo.png" alt="Spotibet" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#eef2f8]">Deposit funds</h1>
            <p className="text-[11px] text-[#6f7b90]">Secure checkout powered by Paystack</p>
          </div>
        </div>

        <div className="mb-6 p-3 rounded-xl bg-[#12151d] border border-[#232733] flex items-center justify-between">
          <span className="text-[11px] text-[#98a3b8]">Real money balance</span>
          <span className="font-mono text-sm font-black text-[#2fd08a]">
            {currency} {formatMoney(user?.realBalance || 0)}
          </span>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-[#2b1218] border border-[#6b2536] flex items-center gap-2 text-[#ff7a90] text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 rounded-xl bg-[#0e2a1e] border border-[#1f5c41] flex items-center gap-2 text-[#4ade80] text-xs font-bold">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <label className="field-label">Deposit amount ({currency})</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-[#6f7b90] text-sm">KSh</span>
          <input
            type="number"
            min={minDeposit}
            max={maxDeposit}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field-input pl-14 font-mono font-bold text-lg text-[#eef2f8]"
          />
        </div>
        <div className="flex justify-between items-center mt-1.5">
          <span className="text-[10px] text-[#6f7b90] font-mono">
            Min {currency} {minDeposit.toLocaleString()} • Max {currency} {maxDeposit.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setAmount(String(minDeposit))}
            className="text-[10px] font-bold text-[#dc1c34] uppercase tracking-wide hover:text-[#f02840]"
          >
            Use minimum
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          {QUICK_AMOUNTS.filter((v) => v >= minDeposit).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(String(value))}
              className={`py-2 rounded-lg border text-xs font-mono font-bold transition ${
                Number(amount) === value
                  ? 'bg-[#0e2a1e] border-[#2fd08a] text-[#4ade80]'
                  : 'bg-[#12151d] border-[#232733] text-[#98a3b8] hover:text-[#eef2f8]'
              }`}
            >
              {value >= 1000 ? `${value / 1000}k` : value}
            </button>
          ))}
        </div>

        <label className="field-label mt-6">Payment method</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: 'MPESA' as const, label: 'M-Pesa', Icon: Smartphone },
            { id: 'CARD' as const, label: 'Card', Icon: CreditCard },
            { id: 'BANK' as const, label: 'Bank', Icon: Building2 },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              className={`p-3 rounded-xl border transition flex flex-col items-center gap-1.5 ${
                method === id
                  ? 'bg-[#0e2a1e] border-[#2fd08a] text-[#4ade80] font-bold'
                  : 'bg-[#0e1015] border-[#232733] text-[#98a3b8] hover:border-[#3a4150] hover:text-[#eef2f8]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs">{label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !paystackReady}
          className="w-full py-3 mt-6 rounded-2xl btn-spribe-green font-black text-sm uppercase tracking-wider transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Lock className="w-4 h-4" />
          {loading ? 'Opening Paystack…' : `Continue to Paystack · ${currency} ${Number(amount || 0).toLocaleString()}`}
        </button>

        {!paystackReady && config && (
          <p className="mt-3 text-[11px] text-[#f0b45c] text-center">
            Paystack must be configured on the server before deposits can be made.
          </p>
        )}
        <p className="mt-3 text-[10px] text-[#6f7b90] text-center leading-relaxed">
          You'll be taken to Paystack's secure checkout. Your balance is credited only after the
          payment is verified by our server.
        </p>
      </div>
    </div>
  );
};
