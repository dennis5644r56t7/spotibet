'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  ArrowUpRight,
  Smartphone,
  Building2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { api, Bank, WalletConfig } from '../lib/api';
import { sound } from '../lib/sound';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onBalanceUpdated: () => void;
}

const FALLBACK_BANKS: Bank[] = [
  { name: 'Equity Bank', code: '068' },
  { name: 'Kenya Commercial Bank (KCB)', code: '001' },
  { name: 'Co-operative Bank of Kenya', code: '011' },
  { name: 'NCBA Bank', code: '007' },
  { name: 'Absa Bank Kenya', code: '003' },
  { name: 'Standard Chartered Bank', code: '002' },
  { name: 'Diamond Trust Bank (DTB)', code: '063' },
  { name: 'Stanbic Bank', code: '031' },
  { name: 'I&M Bank', code: '067' },
];

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

interface WithdrawalRow {
  reference: string;
  amount: number;
  netAmount: number;
  channel: string;
  status: string;
  createdAt: string;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  user,
  onBalanceUpdated,
}) => {
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<'MOBILE_MONEY' | 'BANK'>('MOBILE_MONEY');
  const [phone, setPhone] = useState('');
  const [banks, setBanks] = useState<Bank[]>(FALLBACK_BANKS);
  const [bankCode, setBankCode] = useState(FALLBACK_BANKS[0].code);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    setError('');
    setSuccess('');
    setLoading(false);

    Promise.allSettled([
      api.getWalletConfig(),
      api.getBanks(),
      api.getWithdrawals(),
    ]).then(([configResult, banksResult, withdrawalsResult]) => {
      if (cancelled) return;

      if (configResult.status === 'fulfilled') {
        setConfig(configResult.value as WalletConfig);
      }

      if (banksResult.status === 'fulfilled') {
        const list = (banksResult.value as { banks: Bank[] }).banks;
        if (Array.isArray(list) && list.length > 0) {
          setBanks(list);
          setBankCode((current) =>
            list.some((bank) => bank.code === current) ? current : list[0].code
          );
        }
      }

      if (withdrawalsResult.status === 'fulfilled') {
        const list = (withdrawalsResult.value as { withdrawals?: WithdrawalRow[] }).withdrawals;
        if (Array.isArray(list)) setWithdrawals(list.slice(0, 5));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.id]);

  const currency = config?.currency || 'KES';
  const minWithdrawal = config?.minWithdrawal ?? 100;
  const maxWithdrawal = config?.maxWithdrawal ?? 500000;
  const paystackReady = config?.paystackConfigured === true;
  const realBalance = Number(user?.realBalance || 0);

  if (!isOpen) return null;

  const handleWithdraw = async () => {
    setError('');
    setSuccess('');

    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric < minWithdrawal || numeric > maxWithdrawal) {
      setError(
        `Enter an amount between ${currency} ${minWithdrawal.toLocaleString()} and ${currency} ${maxWithdrawal.toLocaleString()}.`
      );
      return;
    }
    if (realBalance < numeric) {
      setError('Insufficient real money balance for this withdrawal.');
      return;
    }
    if (channel === 'MOBILE_MONEY' && !phone.trim()) {
      setError('Enter the M-Pesa phone number that should receive the payout.');
      return;
    }
    if (channel === 'BANK' && (!accountNumber.trim() || !accountName.trim())) {
      setError('Enter the bank account number and account holder name.');
      return;
    }
    if (!paystackReady) {
      setError('Payouts are not configured. Add a valid Paystack secret key on the server.');
      return;
    }

    setLoading(true);
    sound.playChip();

    try {
      const res = await api.withdraw({
        amount: Math.round(numeric * 100) / 100,
        channel,
        phone: channel === 'MOBILE_MONEY' ? phone.trim() : undefined,
        bankCode: channel === 'BANK' ? bankCode : undefined,
        accountNumber: channel === 'BANK' ? accountNumber.trim() : phone.trim(),
        accountName: accountName.trim() || user?.username || 'Spotibet Player',
      });

      sound.playWin();
      setSuccess(
        `${res.message || 'Withdrawal submitted'} Reference: ${res.reference}. Your balance has been updated.`
      );
      setAmount('');
      setPhone('');
      setAccountNumber('');
      onBalanceUpdated();
      // Refresh the recent list without closing the dedicated cashier.
      const list = await api.getWithdrawals().catch(() => null);
      if (list?.withdrawals) setWithdrawals(list.withdrawals.slice(0, 5));
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed');
      onBalanceUpdated();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-[#0e1015] border border-[#232733] rounded-3xl w-full max-w-lg p-6 sm:p-7 shadow-pop relative text-[#c2cbda] max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#98a3b8] hover:text-[#eef2f8] p-1.5 rounded-full bg-[#07080c] hover:bg-[#242935] transition border border-[#232733]"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full overflow-hidden border border-[#232733] bg-[#0e1015] shrink-0">
            <img src="/spotibet-logo.png" alt="Spotibet" className="w-full h-full object-cover" />
          </div>
          <div>
            <h2 className="text-lg font-black font-display tracking-tight text-[#eef2f8] flex items-center gap-2">
              <span>Withdraw Funds</span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#1a1e27] text-[#98a3b8] border border-[#232733]">
                {currency}
              </span>
            </h2>
            <p className="text-[11px] text-[#6f7b90]">M-Pesa & bank payouts via Paystack</p>
          </div>
        </div>

        {/* Available balance */}
        <div className="mb-5 p-3 rounded-xl bg-[#12151d] border border-[#232733] flex items-center justify-between">
          <span className="text-[11px] text-[#98a3b8]">Available real balance</span>
          <span className="font-mono text-sm font-black text-[#2fd08a]">
            {currency} {formatMoney(realBalance)}
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
        {config && !paystackReady && (
          <div className="mb-4 p-3 rounded-xl bg-[#2a2113] border border-[#5c4620] text-[#e0a95c] text-[11px] leading-relaxed">
            Payouts are disabled until a valid <code className="font-mono">PAYSTACK_SECRET_KEY</code> is configured on the server.
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="field-label">Withdrawal Amount ({currency})</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-[#6f7b90] text-sm">KSh</span>
              <input
                type="number"
                min={minWithdrawal}
                max={maxWithdrawal}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="field-input pl-14 font-mono font-bold text-[#eef2f8]"
              />
            </div>
            <div className="flex justify-between items-center mt-1.5">
              <span className="text-[10px] text-[#6f7b90] font-mono">
                Min {currency} {minWithdrawal.toLocaleString()} • Max {currency} {maxWithdrawal.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setAmount(String(Math.floor(realBalance * 100) / 100))}
                className="text-[10px] font-bold text-[#dc1c34] hover:text-[#f02840] uppercase tracking-wide"
              >
                Use max
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">Payout Destination</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannel('MOBILE_MONEY')}
                className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                  channel === 'MOBILE_MONEY'
                    ? 'bg-[#0e2a1e] border-[#2fd08a] text-[#4ade80] font-bold'
                    : 'bg-[#0e1015] border-[#232733] text-[#98a3b8] hover:border-[#3a4150] hover:text-[#eef2f8]'
                }`}
              >
                <Smartphone className="w-5 h-5" />
                <span className="text-xs font-bold">M-Pesa</span>
                <span className="text-[9px] text-[#6f7b90]">Instant mobile payout</span>
              </button>
              <button
                type="button"
                onClick={() => setChannel('BANK')}
                className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                  channel === 'BANK'
                    ? 'bg-[#0e2a1e] border-[#2fd08a] text-[#4ade80] font-bold'
                    : 'bg-[#0e1015] border-[#232733] text-[#98a3b8] hover:border-[#3a4150] hover:text-[#eef2f8]'
                }`}
              >
                <Building2 className="w-5 h-5" />
                <span className="text-xs font-bold">Bank</span>
                <span className="text-[9px] text-[#6f7b90]">KES bank transfer</span>
              </button>
            </div>
          </div>

          {channel === 'MOBILE_MONEY' ? (
            <div>
              <label className="field-label">M-Pesa Phone Number</label>
              <input
                type="tel"
                placeholder="e.g. 0712345678 or 254712345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="field-input font-mono font-bold"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="field-label">Bank</label>
                <select
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className="field-input font-semibold"
                >
                  {banks.map((bank) => (
                    <option key={`${bank.code}-${bank.name}`} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Account Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 0123456789"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="field-input font-mono font-bold"
                />
              </div>
            </>
          )}

          <div>
            <label className="field-label">
              Account Holder Full Name{' '}
              {channel === 'MOBILE_MONEY' && (
                <span className="text-[#6f7b90] font-normal normal-case tracking-normal">(optional)</span>
              )}
            </label>
            <input
              type="text"
              placeholder="e.g. John Kamau"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="field-input font-semibold"
            />
          </div>

          <button
            onClick={handleWithdraw}
            disabled={loading || !paystackReady}
            className="w-full py-3 rounded-2xl btn-spribe-red font-black text-sm uppercase tracking-wider transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            {loading
              ? 'Submitting payout...'
              : `Withdraw ${currency} ${Number(amount || 0).toLocaleString()}`}
          </button>

          <p className="text-[10px] text-[#6f7b90] text-center leading-relaxed">
            Funds are debited immediately and refunded automatically if the payout fails. Double-check
            the phone or bank details before submitting.
          </p>
        </div>

        {/* Recent withdrawals — a dedicated cashier should show payout status. */}
        {withdrawals.length > 0 && (
          <div className="mt-6 pt-4 border-t border-[#232733]">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#98a3b8] mb-2">
              Recent withdrawals
            </h3>
            <div className="space-y-1.5">
              {withdrawals.map((w) => (
                <div
                  key={w.reference}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#12151d] text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[#eef2f8]">
                      {currency} {formatMoney(w.netAmount ?? w.amount)}
                    </div>
                    <div className="text-[9px] text-[#6f7b90] truncate">
                      {w.reference} • {w.channel === 'BANK' ? 'Bank' : 'M-Pesa'}
                    </div>
                  </div>
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                      w.status === 'PAID'
                        ? 'bg-[#0e2a1e] text-[#2fd08a]'
                        : w.status === 'FAILED' || w.status === 'REVERSED'
                        ? 'bg-[#2b1218] text-[#f4587a]'
                        : 'bg-[#2a2113] text-[#f0b45c]'
                    }`}
                  >
                    {w.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
