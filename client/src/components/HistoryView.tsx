'use client';

import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ArrowDownRight, ArrowUpRight, History, Gamepad2 } from 'lucide-react';

export const HistoryView: React.FC = () => {
  const [tab, setTab] = useState<'TRANSACTIONS' | 'BETS'>('TRANSACTIONS');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === 'TRANSACTIONS') {
        const res = await api.getTransactions();
        setTransactions(res.transactions || []);
      } else {
        const res = await api.getBets();
        setBets(res.bets || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      {/* Tab toggle */}
      <div className="segmented w-full sm:w-fit">
        <button
          onClick={() => setTab('TRANSACTIONS')}
          aria-selected={tab === 'TRANSACTIONS'}
          className={`flex items-center gap-2 ${tab === 'TRANSACTIONS' ? 'is-brand' : ''}`}
        >
          <History className="w-4 h-4" />
          <span>Wallet Transactions</span>
        </button>
        <button
          onClick={() => setTab('BETS')}
          aria-selected={tab === 'BETS'}
          className={`flex items-center gap-2 ${tab === 'BETS' ? 'is-brand' : ''}`}
        >
          <Gamepad2 className="w-4 h-4" />
          <span>Game Bet History</span>
        </button>
      </div>

      {/* List Container */}
      <div className="bg-[#0e1015] border border-[#232733] rounded-3xl p-6 shadow-card overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-[#6f7b90] text-sm">Loading ledger history...</div>
        ) : tab === 'TRANSACTIONS' ? (
          <div className="divide-y divide-[#1f232d]">
            {transactions.map((tx) => {
              const creditTypes = [
                'DEPOSIT',
                'BET_WON',
                'BONUS',
                'BET_REFUND',
                'BET_REFUNDED',
                'WITHDRAWAL_REVERSED',
                'REFUND',
              ];
              const isCredit = creditTypes.includes(tx.type);
              const isPending = tx.status === 'PENDING';
              const isFailed = tx.status === 'FAILED';

              return (
                <div key={tx.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-xl border flex-shrink-0 ${
                        isFailed
                          ? 'bg-[#1a1e27] text-[#6f7b90] border-[#232733]'
                          : isCredit
                            ? 'bg-[#0e2a1e] text-[#2fd08a] border-[#1f5c41]'
                            : isPending
                              ? 'bg-[#2a2113] text-[#f0b45c] border-[#5c4620]'
                              : 'bg-[#2b1218] text-[#f4587a] border-[#6b2536]'
                      }`}
                    >
                      {isCredit ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#eef2f8] font-mono">
                          {String(tx.type || '').replace(/_/g, ' ')}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-[#232733] bg-[#12151d] text-[#98a3b8] font-mono">
                          {tx.balanceType || 'REAL'}
                        </span>
                        {isPending && (
                          <span className="status-pill is-warning">
                            Pending
                          </span>
                        )}
                        {isFailed && (
                          <span className="status-pill is-neutral">
                            Failed
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#98a3b8] truncate">
                        {tx.description || 'System transaction'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div
                      className={`text-sm font-mono font-bold ${
                        isFailed
                          ? 'text-[#6f7b90] line-through'
                          : isCredit
                            ? 'text-[#2fd08a]'
                            : isPending
                              ? 'text-[#f0b45c]'
                              : 'text-[#f4587a]'
                      }`}
                    >
                      {isCredit ? '+' : '-'}KSh {Number(tx.amount || 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-[#6f7b90] font-mono">
                      {new Date(tx.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
            {transactions.length === 0 && (
              <div className="text-center py-12 text-[#6f7b90] text-sm">No transactions found</div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#1f232d]">
            {bets.map((bet) => {
              const isWin = bet.status === 'WON' || (bet.payout && bet.payout > 0);

              return (
                <div key={bet.id} className="py-3.5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-[#eef2f8] font-mono">{bet.gameType}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                          isWin
                            ? 'bg-[#0e2a1e] text-[#2fd08a] border border-[#1f5c41]'
                            : 'bg-[#2b1218] text-[#f4587a] border border-[#6b2536]'
                        }`}
                      >
                        {bet.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#98a3b8] font-mono mt-0.5">
                      Bet: KSh {Number(bet.amount).toLocaleString()} {bet.multiplier ? `• ${bet.multiplier}x` : ''}
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className={`text-sm font-mono font-bold ${
                        isWin ? 'text-[#2fd08a]' : 'text-[#6f7b90]'
                      }`}
                    >
                      {isWin ? `+KSh ${Number(bet.payout).toLocaleString()}` : 'KSh 0'}
                    </div>
                    <div className="text-[10px] text-[#6f7b90] font-mono">
                      {new Date(bet.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
            {bets.length === 0 && (
              <div className="text-center py-12 text-[#6f7b90] text-sm">No bets placed yet</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
