'use client';

import React, { useState } from 'react';
import { X, ShieldCheck, Check, Copy, RefreshCw } from 'lucide-react';
import { sound } from '../lib/sound';
import { api } from '../lib/api';

interface FairnessModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientSeed?: string;
  onUpdateClientSeed?: (seed: string) => void;
  gameType?: string; // AVIATOR | ROULETTE | MINES | BLACKJACK | SLOTS | DICE
  mineCount?: number; // required for MINES verification
}

export const FairnessModal: React.FC<FairnessModalProps> = ({
  isOpen,
  onClose,
  clientSeed = 'lucky_pilot_seed_' + Math.floor(Math.random() * 10000),
  onUpdateClientSeed,
  gameType = 'AVIATOR',
  mineCount,
}) => {
  const [currentSeed, setCurrentSeed] = useState(clientSeed);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'SETTINGS' | 'VERIFY'>('SETTINGS');
  const [verifyServerSeed, setVerifyServerSeed] = useState('');
  const [verifyNonce, setVerifyNonce] = useState('1');
  const [verifyClientSeed, setVerifyClientSeed] = useState('');
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    sound.playChip();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRandomize = () => {
    const newSeed = 'seed_' + Math.random().toString(36).substring(2, 10);
    setCurrentSeed(newSeed);
    if (onUpdateClientSeed) onUpdateClientSeed(newSeed);
    sound.playChip();
  };

  const handleManualVerify = async () => {
    if (!verifyServerSeed) return;
    sound.playChip();
    setVerifyLoading(true);
    setVerifyResult(null);
    setVerifyError(null);

    try {
      const res = await api.verifyFairness({
        gameType,
        serverSeed: verifyServerSeed,
        clientSeed: verifyClientSeed || currentSeed,
        nonce: Number(verifyNonce) || 1,
        mineCount: gameType === 'MINES' ? mineCount : undefined,
      });

      sound.playWin();
      let outcomeText: string;
      if (res.outcome?.crashPoint) {
        outcomeText = `Crash point ${res.outcome.crashPoint}x`;
      } else if (res.outcome?.winningNumber !== undefined) {
        outcomeText = `Winning number ${res.outcome.winningNumber} (${res.outcome.color})`;
      } else if (res.outcome?.mines) {
        outcomeText = `Mines at tiles ${res.outcome.mines.join(', ')}`;
      } else {
        outcomeText = 'Verified by HMAC-SHA256';
      }
      setVerifyResult(`Verified Authentic Round • ${outcomeText}`);
    } catch (err: any) {
      setVerifyError(err.message || 'Verification failed');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#0e1015] border border-[#232733] rounded-3xl w-full max-w-md p-6 shadow-pop relative text-[#c2cbda]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#98a3b8] hover:text-[#eef2f8] p-1.5 rounded-full bg-[#07080c] hover:bg-[#242935] transition border border-[#232733]"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.7)] border border-[#232733] bg-[#0e1015] shrink-0">
            <img src="/spotibet-logo.png" alt="Spotibet Fair" className="w-full h-full object-cover" />
          </div>
          <div>
            <h3 className="font-black text-base text-[#eef2f8] tracking-tight font-display">
              Spotibet Provably Fair
            </h3>
            <p className="text-[11px] text-[#6f7b90]">HMAC-SHA256 Cryptographic Verification</p>
          </div>
        </div>

        {/* Tab switch */}
        <div className="segmented mb-4">
          <button
            onClick={() => setActiveTab('SETTINGS')}
            aria-selected={activeTab === 'SETTINGS'}
            className={activeTab === 'SETTINGS' ? 'is-brand' : ''}
          >
            Client Seed
          </button>
          <button
            onClick={() => setActiveTab('VERIFY')}
            aria-selected={activeTab === 'VERIFY'}
            className={activeTab === 'VERIFY' ? 'is-brand' : ''}
          >
            Verify Round
          </button>
        </div>

        {activeTab === 'SETTINGS' ? (
          <div className="space-y-4 text-xs">
            <p className="text-[#98a3b8] text-xs leading-relaxed">
              Every round outcome is generated from the combined seed of the server and your client seed before flight begins. The result cannot be altered.
            </p>

            <div>
              <label className="field-label">
                Your Client Seed
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={currentSeed}
                  onChange={(e) => setCurrentSeed(e.target.value)}
                  className="field-input flex-1 font-mono font-bold"
                />
                <button
                  type="button"
                  onClick={handleRandomize}
                  title="Randomize Client Seed"
                  className="p-2 rounded-xl bg-[#07080c] hover:bg-[#242935] text-[#98a3b8] hover:text-[#eef2f8] border border-[#232733] transition"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(currentSeed)}
                  title="Copy Seed"
                  className="p-2 rounded-xl bg-[#07080c] hover:bg-[#242935] text-[#98a3b8] hover:text-[#eef2f8] border border-[#232733] transition"
                >
                  {copied ? <Check className="w-4 h-4 text-[#2fd08a]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="p-3 bg-[#12151d] rounded-xl border border-[#232733] space-y-1">
              <span className="text-[10px] uppercase font-bold text-[#98a3b8] block tracking-wider">
                Active SHA-256 Algorithm
              </span>
              <p className="font-mono text-[11px] text-[#f0b45c] truncate">
                HMAC-SHA256(ServerSeed, ClientSeed, Nonce)
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl btn-spribe-green font-bold text-xs uppercase tracking-wider mt-2"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <p className="text-[#98a3b8] text-xs leading-relaxed">
              Enter the revealed server seed from your round history to independently verify that the round outcome was authentic.
            </p>

            <div>
              <label className="field-label">
                Server Seed
              </label>
              <input
                type="text"
                placeholder="Paste server seed from completed round..."
                value={verifyServerSeed}
                onChange={(e) => setVerifyServerSeed(e.target.value)}
                className="field-input font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="field-label">
                  Client Seed
                </label>
                <input
                  type="text"
                  placeholder="client seed"
                  value={verifyClientSeed}
                  onChange={(e) => setVerifyClientSeed(e.target.value)}
                  className="field-input font-mono"
                />
              </div>
              <div>
                <label className="field-label">
                  Nonce
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={verifyNonce}
                  onChange={(e) => setVerifyNonce(e.target.value)}
                  className="field-input font-mono"
                />
              </div>
            </div>

            {gameType === 'MINES' && (
              <div className="p-2.5 rounded-xl bg-[#2a2113] border border-[#5c4620] text-[#f0b45c] text-[11px]">
                Using <b>{mineCount ?? 3}</b>-mine board layout for verification.
              </div>
            )}

            {verifyError && (
              <div className="p-2.5 rounded-xl bg-[#2b1218] border border-[#6b2536] text-[#ff7a90] font-bold text-xs">
                ✗ {verifyError}
              </div>
            )}

            {verifyResult && (
              <div className="p-2.5 rounded-xl bg-[#0e2a1e] border border-[#1f5c41] text-[#4ade80] font-bold text-xs">
                ✓ {verifyResult}
              </div>
            )}

            <button
              onClick={handleManualVerify}
              disabled={!verifyServerSeed || verifyLoading}
              className="w-full py-2.5 rounded-xl btn-spribe-green font-bold text-xs uppercase tracking-wider disabled:opacity-40"
            >
              {verifyLoading ? 'Verifying...' : 'Verify Seed'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
