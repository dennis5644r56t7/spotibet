'use client';

import React, { useState } from 'react';
import { X, Lock, Mail, User, Sparkles, AlertCircle } from 'lucide-react';
import { api, setAuthToken } from '../lib/api';
import { sound } from '../lib/sound';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: any) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    sound.playChip();

    try {
      let res;
      if (tab === 'REGISTER') {
        res = await api.register({ email, username, password });
      } else {
        res = await api.login({ login: email, password });
      }

      setAuthToken(res.token);
      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestPlay = async () => {
    setError('');
    setLoading(true);
    sound.playChip();

    try {
      const res = await api.guest();
      setAuthToken(res.token);
      onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Guest session creation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0e1015] border border-[#232733] rounded-3xl w-full max-w-md p-6 sm:p-7 shadow-pop relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full bg-[#07080c] hover:bg-[#242935] text-[#98a3b8] hover:text-[#eef2f8] transition border border-[#232733]"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Spotibet Brand Header */}
        <div className="flex flex-col items-center justify-center mb-5 text-center">
          <div className="w-14 h-14 rounded-full overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.85)] border border-[#232733] mb-2 bg-[#0e1015]">
            <img src="/spotibet-logo.png" alt="Spotibet" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-black text-[#eef2f8] font-display tracking-tight">
            Spoti<span className="text-[#dc1c34]">bet</span> Casino
          </h2>
          <p className="text-xs text-[#98a3b8] mt-0.5">Kenya's premier high-roller platform</p>
        </div>

        {/* 1-Click Guest Play Banner */}
        <div className="mb-5 p-4 rounded-2xl bg-[#221c12] border border-[#5c4620] text-center">
          <div className="flex items-center justify-center gap-2 text-[#f0b45c] font-bold text-xs uppercase tracking-wider mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Instant Demo Play</span>
          </div>
          <p className="text-xs text-[#98a3b8] mb-2.5">
            Start flying immediately with <strong className="text-[#eef2f8]">KSh 10,000</strong> demo credits!
          </p>
          <button
            onClick={handleGuestPlay}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#fbbf24] to-[#f59e0b] hover:from-[#fcd34d] hover:to-[#fbbf24] text-[#3a2500] font-black text-xs shadow-[0_4px_14px_rgba(245,158,11,0.28)] transition uppercase tracking-wider"
          >
            {loading ? 'Starting...' : '⚡ Play Instantly as Guest'}
          </button>
        </div>

        <div className="relative flex items-center justify-center my-4">
          <div className="border-t border-[#232733] w-full"></div>
          <span className="bg-[#0e1015] px-3 text-[10px] text-[#6f7b90] uppercase tracking-widest font-mono whitespace-nowrap shrink-0">
            Or Account Sign In
          </span>
          <div className="border-t border-[#232733] w-full"></div>
        </div>

        {/* Tab Selector */}
        <div className="segmented mb-5">
          <button
            onClick={() => {
              setTab('LOGIN');
              setError('');
            }}
            aria-selected={tab === 'LOGIN'}
            className={tab === 'LOGIN' ? 'is-brand' : ''}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              setTab('REGISTER');
              setError('');
            }}
            aria-selected={tab === 'REGISTER'}
            className={tab === 'REGISTER' ? 'is-brand' : ''}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-[#2b1218] border border-[#6b2536] flex items-center gap-2 text-[#ff7a90] text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {tab === 'REGISTER' && (
            <div>
              <label className="field-label">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-[#6f7b90] absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="PilotAce99"
                  className="field-input pl-9"
                />
              </div>
            </div>
          )}

          <div>
            <label className="field-label">
              {tab === 'REGISTER' ? 'Email Address' : 'Email or Username'}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6f7b90] absolute left-3 top-3" />
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tab === 'REGISTER' ? 'player@spotibet.ke' : 'player@spotibet.ke or PilotAce99'}
                className="field-input pl-9"
              />
            </div>
          </div>

          <div>
            <label className="field-label">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6f7b90] absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="field-input pl-9"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-[#dc1c34] via-[#f02840] to-[#b3142a] hover:brightness-105 text-white font-black text-sm shadow-[0_6px_20px_rgba(220,28,52,0.32)] border border-[#c0152b] transition uppercase tracking-wider active:scale-[0.99]"
          >
            {loading ? 'Please wait...' : tab === 'LOGIN' ? 'Sign In to Spotibet' : 'Complete Registration'}
          </button>
        </form>
      </div>
    </div>
  );
};
