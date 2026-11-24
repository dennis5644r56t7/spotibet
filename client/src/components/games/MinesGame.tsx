'use client';

import React, { useEffect, useRef, useState } from 'react';
import { sound } from '../../lib/sound';
import { api } from '../../lib/api';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import confetti from 'canvas-confetti';

interface MinesGameProps {
  user: any;
  balanceType: 'REAL' | 'DEMO';
  onBalanceChange: () => void;
  onOpenFairness?: () => void;
}

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000];

// Mines difficulty is fixed (not player-selectable) so the odds stay fair and
// consistent for every round.
const FIXED_MINE_COUNT = 3;

// Premium gem crystal (SVG)
const GemCrystal: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <defs>
      <linearGradient id="gemBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#d9ffe9" />
        <stop offset="0.4" stopColor="#34d399" />
        <stop offset="1" stopColor="#047857" />
      </linearGradient>
      <linearGradient id="gemFacet" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fffffff0" />
        <stop offset="1" stopColor="#ffffff00" />
      </linearGradient>
    </defs>
    <path d="M24 4 L40 16 L31 42 L17 42 L8 16 Z" fill="url(#gemBody)" stroke="#6ee7b7" strokeWidth="1.5" />
    <path d="M24 4 L32 16 L31 42 L17 42 L16 16 Z" fill="url(#gemFacet)" opacity="0.5" />
    <path d="M8 16 L16 16 L31 42 L17 42 Z" fill="#059669" opacity="0.35" />
    <line x1="24" y1="4" x2="24" y2="42" stroke="#a7f3d0" strokeWidth="0.8" opacity="0.6" />
  </svg>
);

// Premium smoking bomb (SVG)
const BombIcon: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <defs>
      <radialGradient id="bombBody" cx="0.4" cy="0.3" r="0.9">
        <stop offset="0" stopColor="#3a3f4b" />
        <stop offset="1" stopColor="#14161b" />
      </radialGradient>
      <radialGradient id="bombGlow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fca5a5" />
        <stop offset="1" stopColor="#ef444400" />
      </radialGradient>
    </defs>
    <circle cx="28" cy="28" r="18" fill="url(#bombBody)" stroke="#6b7280" strokeWidth="1.5" />
    <circle cx="22" cy="22" r="4" fill="#ffffff20" />
    <rect x="26" y="8" width="5" height="6" rx="1.5" fill="#8b5cf6" />
    <circle cx="28" cy="5" r="4" fill="#f59e0b" stroke="#fbbf24" strokeWidth="1" />
  </svg>
);

// Explosion burst (SVG)
const Explosion: React.FC = () => (
  <svg width="52" height="52" viewBox="0 0 64 64" className="explosion-burst">
    <defs>
      <radialGradient id="burstGrad" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff7ed" />
        <stop offset="0.3" stopColor="#f97316" />
        <stop offset="0.7" stopColor="#ef4444" />
        <stop offset="1" stopColor="#991b1b00" />
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#burstGrad)" />
    <path d="M32 8 l4 10 l8 -4 l-4 10 l12 2 l-10 6 l4 8 l-12 -4 l2 12 l-4 -8 z" fill="#fbbf24" />
    <path d="M32 4 l3 8 l6 -3 l-3 8 l10 1.5 l-8 5 l3 6 l-9 -3 l1.5 9 l-3.5 -6 z" fill="#f59e0b" opacity="0.7" />
  </svg>
);

function TileFace({ isMine, revealed, gameOver, winning }: {
  isMine: boolean;
  revealed: boolean;
  gameOver: boolean;
  winning: boolean;
}) {
  return (
    <div className={`tile-inner ${revealed ? 'flipped' : ''}`}>
      {/* Back (hidden) */}
      <div className="tile-face tile-back">
        <span className="tile-back-mark" />
      </div>
      {/* Front (revealed content) */}
      <div className="tile-face tile-front">
        {isMine ? (
          <div className={`bomb-cell ${winning ? '' : 'bomb-hit'}`}>
            {gameOver && !winning ? <Explosion /> : <BombIcon />}
          </div>
        ) : (
          <div className="gem-cell">
            <GemCrystal />
          </div>
        )}
      </div>
    </div>
  );
}

export const MinesGame: React.FC<MinesGameProps> = ({
  user,
  balanceType,
  onBalanceChange,
}) => {
  const [amount, setAmount] = useState('500');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [revealedTiles, setRevealedTiles] = useState<number[]>([]);
  const [mines, setMines] = useState<number[]>([]);
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
  const [currentPayout, setCurrentPayout] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [boardSize, setBoardSize] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Fit a perfect square board so the whole Mines screen fits without scrolling.
  // The board is sized to the smallest of (panel width, available height). On
  // mobile the height budget accounts for the header, HUD and right-column
  // controls so everything stays on-screen.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      // Never let the board exceed the visible viewport width.
      const maxW = Math.min(w, window.innerWidth - 8);

      let maxH: number;
      if (window.innerWidth < 1024) {
        // Mobile: board must leave room below for the (compressed) controls.
        maxH = window.innerHeight - 56   // navbar
          - 40                           // panel header row
          - 44                           // HUD row
          - 16                           // outer + panel padding/gaps
          - 240;                         // compact right control column + gaps
      } else {
        // Desktop: fill the panel height minus the header, HUD and panel padding
        // so the board + header + HUD all fit inside the panel without scrolling.
        const h = el.clientHeight;
        maxH = h - 150;
      }

      const b = Math.min(maxW, maxH);
      if (b > 0) setBoardSize(Math.floor(b));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  const [lastOutcome, setLastOutcome] = useState<'win' | 'loss' | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ rounds: 0, won: 0, lost: 0, profit: 0 });

  // On mount, abandon any stale server-side Mines session left over from a
  // previous page load / refresh. This clears the "You already have an active
  // Mines game in progress" error and returns any stuck bet to the wallet.
  useEffect(() => {
    let cancelled = false;
    api.abandonMines()
      .then(() => {
        if (!cancelled) onBalanceChange();
      })
      .catch(() => {/* ignore - no active session is fine */});
    return () => { cancelled = true; };
  }, []);

  const balance = balanceType === 'REAL' ? (user?.realBalance ?? 0) : (user?.demoBalance ?? 0);
  const gemsFound = revealedTiles.length;
  const totalTiles = 25;

  // Start animation energy
  const handleStart = async () => {
    sound.minesChip();
    setLoading(true);
    setRevealedTiles([]);
    setMines([]);
    setIsGameOver(false);
    setLastOutcome(null);

    try {
      const res = await api.startMines({
        amount: parseFloat(amount),
        mineCount: FIXED_MINE_COUNT,
        balanceType,
      });

      setSessionId(res.sessionId);
      setCurrentMultiplier(1.0);
      setCurrentPayout(parseFloat(amount));
      setStats((s) => ({ ...s, rounds: s.rounds + 1 }));
      onBalanceChange();
    } catch (err: any) {
      alert(err.message || 'Failed to start Mines game');
    } finally {
      setLoading(false);
    }
  };

  const handleTileClick = async (tileIndex: number) => {
    if (!sessionId || isGameOver || revealedTiles.includes(tileIndex) || loading) return;
    sound.minesChip();

    try {
      const res = await api.revealMines({ sessionId, tileIndex });

      if (res.isMine) {
        sound.minesLoss();
        setIsGameOver(true);
        setMines(res.mines || [tileIndex]);
        setRevealedTiles(res.revealedTiles);
        setLastOutcome('loss');
        setSessionId(null);
        setStats((s) => ({ ...s, lost: s.lost + 1, profit: s.profit - parseFloat(amount) }));
        onBalanceChange();
      } else {
        sound.minesCashout();
        setRevealedTiles(res.revealedTiles);
        setCurrentMultiplier(res.currentMultiplier);
        setCurrentPayout(res.currentPayout);

        if (res.isAllGemsRevealed) {
          sound.minesWin();
          setIsGameOver(true);
          setLastOutcome('win');
          setSessionId(null);
          setStats((s) => ({ ...s, won: s.won + 1, profit: s.profit + res.currentPayout - parseFloat(amount) }));
          confetti({ particleCount: 100, spread: 75, origin: { y: 0.4 }, colors: ['#34d399', '#fbbf24', '#ffffff'] });
          onBalanceChange();
        }
      }
    } catch (err: any) {
      alert(err.message || 'Error revealing tile');
    }
  };

  const handleCashout = async () => {
    if (!sessionId || revealedTiles.length === 0 || isGameOver) return;
    sound.minesWin();
    setLoading(true);

    try {
      const res = await api.cashoutMines({ sessionId });
      setMines(res.mines || []);
      setIsGameOver(true);
      setLastOutcome('win');
      setSessionId(null);
      setStats((s) => ({ ...s, won: s.won + 1, profit: s.profit + res.payout - parseFloat(amount) }));
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.4 }, colors: ['#34d399', '#fbbf24', '#f87171'] });
      onBalanceChange();
    } catch (err: any) {
      alert(err.message || 'Cashout failed');
    } finally {
      setLoading(false);
    }
  };

  const adjustAmount = (delta: number) => {
    sound.minesChip();
    setAmount((p) => String(Math.max(50, Math.min(50000, (Number(p) || 0) + delta))));
  };

  return (
    <div className="w-full max-w-full mx-auto p-1 sm:p-4 flex flex-col lg:flex-row items-stretch gap-2.5 sm:gap-5 h-full min-h-0 overflow-y-auto lg:overflow-hidden">
      {/* ===== LEFT: MINES GRID ===== */}
      <div ref={panelRef} className="mines-panel w-full max-w-full lg:flex-1 min-h-0 min-w-0 flex flex-col items-center p-3 sm:p-5 rounded-2xl sm:rounded-3xl">
        {/* Header row */}
        <div className="w-full flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className="mines-logo">💎</span>
            <div>
              <h3 className="mines-title">MINES</h3>
              <p className="text-[10px] text-[#6f7b90] font-mono -mt-0.5">Reveal gems & cash out</p>
            </div>
          </div>
        </div>

        {/* 5x5 Grid (square, fits panel without stretching) */}
        <div
          className="mines-grid"
          style={boardSize ? { width: boardSize, height: boardSize } : { width: '100%', aspectRatio: '1/1' }}
        >
          {Array.from({ length: 25 }).map((_, idx) => {
            const isRevealed = revealedTiles.includes(idx);
            const isMine = mines.includes(idx);
            const winning = lastOutcome === 'win' && !isMine;
            const isFresh = revealedTiles[revealedTiles.length - 1] === idx;

            return (
              <button
                key={idx}
                disabled={!sessionId || isGameOver || isRevealed}
                onClick={() => handleTileClick(idx)}
                className="mine-cell"
                style={{ ['--reveal-order' as any]: revealedTiles.indexOf(idx) }}
              >
                <div className="tile3d">
                  <TileFace isMine={isMine} revealed={isRevealed} gameOver={isGameOver} winning={winning} />
                </div>
                {/* Freshly revealed glow */}
                {isRevealed && isFresh && !isMine && <div className="fresh-ping" />}
              </button>
            );
          })}
        </div>

        {/* HUD */}
        <div className="mines-hud mt-3 w-full flex-shrink-0">
          <div className="hud-stat">
            <span className="hud-label">Gems Found</span>
            <span className="hud-value text-[#2fd08a]">{gemsFound}</span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">Multiplier</span>
            <span className="hud-value text-[#f0b45c]">{currentMultiplier.toFixed(2)}x</span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">Payout</span>
            <span className="hud-value text-[#eef2f8]">KSh {currentPayout.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* ===== RIGHT: CONTROLS ===== */}
      <div className="w-full max-w-full lg:w-[330px] min-w-0 flex flex-col gap-2.5 min-h-0">
        {/* Stats strip */}
        <div className="stats-strip">
          <div className="stat-box"><span className="stat-num text-[#eef2f8]">{stats.rounds}</span><span className="stat-lbl">Rounds</span></div>
          <div className="stat-box"><span className="stat-num text-[#2fd08a]">{stats.won}</span><span className="stat-lbl">Won</span></div>
          <div className="stat-box"><span className="stat-num text-[#f4587a]">{stats.lost}</span><span className="stat-lbl">Lost</span></div>
          <div className={`stat-box ${stats.profit >= 0 ? 'text-[#2fd08a]' : 'text-[#f4587a]'}`}>
            <span className="stat-num">{stats.profit >= 0 ? '+' : ''}{stats.profit.toLocaleString()}</span>
            <span className="stat-lbl">Profit</span>
          </div>
        </div>

        {/* Bet amount */}
        <div className="control-card p-3 sm:p-4">
          <div className="control-label-row">
            <span className="control-label">BET AMOUNT</span>
            <span className="control-sub">KSh {balance.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => adjustAmount(-100)} disabled={!!sessionId} className="adjust-btn"><Minus className="w-4 h-4" /></button>
            <div className="bet-input-wrap">
              <span className="currency-sym">KSh</span>
              <input
                type="number" disabled={sessionId !== null} value={amount}
                onChange={(e) => setAmount(e.target.value)} className="bet-input"
              />
            </div>
            <button onClick={() => adjustAmount(100)} disabled={!!sessionId} className="adjust-btn"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="quick-chips">
            {QUICK_AMOUNTS.map((val) => (
              <button key={val} disabled={sessionId !== null} onClick={() => setAmount(String(val))}
                className={`quick-chip ${amount === String(val) ? 'active' : ''}`}>
                {val >= 1000 ? `${val / 1000}K` : val}
              </button>
            ))}
          </div>
        </div>

        {/* Action button */}
        <div className="pt-1">
          {sessionId ? (
            <button onClick={handleCashout} disabled={revealedTiles.length === 0}
              className={`action-btn cashout ${revealedTiles.length > 0 ? 'enabled' : 'disabled'}`}>
              {revealedTiles.length > 0 ? (
                <span className="flex flex-col items-center leading-tight">
                  <span>CASHOUT KSh {currentPayout.toLocaleString()}</span>
                  <span className="text-[11px] font-mono opacity-80">{currentMultiplier.toFixed(2)}x</span>
                </span>
              ) : (
                <span>REVEAL A TILE TO CASH OUT</span>
              )}
            </button>
          ) : (
            <button onClick={handleStart} disabled={loading}
              className={`action-btn bet ${loading ? 'disabled' : 'enabled'}`}>
              {loading ? 'Starting...' : `BET KSh ${Number(amount || 0).toLocaleString()}`}
            </button>
          )}
        </div>

        {/* Outcome message */}
        {lastOutcome && (
          <div className={`outcome-msg ${lastOutcome}`}>
            {lastOutcome === 'win' ? (
              <span className="flex items-center gap-1.5 font-bold text-[#4ade80]">
                <RotateCcw className="w-3.5 h-3.5" /> Nice! You cashed out
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-bold text-[#ff7a90]">💥 Boom! Hit a mine</span>
            )}
          </div>
        )}
      </div>

      <style>{`
        /* === Panels === */
        .mines-panel {
          background: #0e1015;
          border: 1px solid #232733;
          box-shadow: 0 1px 2px rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.85);
          min-width: 0;
          overflow-x: hidden;
        }
        .mines-logo { font-size: 20px; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6)); }
        .mines-title {
          font-family: 'JetBrains Mono', monospace; font-weight: 900; letter-spacing: 0.12em;
          color: #eef2f8; font-size: 16px;
        }
        .panel-badge { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700; color: #4ade80; background: #0e2a1e; padding: 3px 8px; border-radius: 20px; border: 1px solid #1f5c41; }

        /* Grid */
        .mines-grid {
          display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, minmax(0, 1fr));
          gap: 6px; width: 100%; max-width: 100%; height: 100%; min-height: 0; min-width: 0;
          perspective: 800px; margin: 0 auto;
        }
        .mine-cell { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; perspective: 600px; background: transparent; border: none; padding: 1px; cursor: pointer; }
        .mine-cell:disabled { cursor: default; }
        .mine-cell:not(:disabled):hover { transform: translateY(-2px) scale(1.04); }

        /* 3D flip */
        .tile3d {
          position: absolute; inset: 0; width: 100%; height: 100%;
          transition: transform 0.45s cubic-bezier(0.2,0.85,0.35,1.1);
          transform-style: preserve-3d;
        }
        .mine-cell:not(:disabled):hover .tile3d { transform: rotateY(0deg) translateZ(7px); }
        .tile-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform 0.5s; }
        .mine-cell:not(.reveal-anim) .tile-inner { }
        .tile-back, .tile-front {
          position: absolute; inset: 0; width: 100%; height: 100%;
          backface-visibility: hidden; display: flex; align-items: center; justify-content: center;
          border-radius: 50%;
        }
        .tile-back {
          background: linear-gradient(145deg, #0e1015 0%, #171b24 55%, #12151d 100%);
          border: 1px solid #2c313d;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.5);
        }
        .tile-back-mark { width: 38%; height: 38%; border-radius: 50%; background: radial-gradient(circle at 30% 30%, #2b3140, #1a1e27); box-shadow: inset 0 2px 5px rgba(0,0,0,0.5); }
        .tile-front { transform: rotateY(180deg); background: #0e1015; border: 1px solid #232733; box-shadow: 0 2px 8px rgba(0,0,0,0.55); }
        .tile-inner.flipped { transform: rotateY(180deg); }

        /* gem / bomb cells */
        .gem-cell { display: flex; align-items: center; justify-content: center; animation: gem-shine 2s ease-in-out infinite; }
        .bomb-cell { display: flex; align-items: center; justify-content: center; }
        .bomb-hit { animation: bomb-shake 0.5s ease-in-out; }

        @keyframes gem-shine { 0%,100%{filter:brightness(1);} 50%{filter:brightness(1.12) drop-shadow(0 1px 4px rgba(0,0,0,0.55));} }
        @keyframes bomb-shake { 0%,100%{transform:translate(0,0);}25%{transform:translate(-2px,1px);}50%{transform:translate(2px,-1px);}75%{transform:translate(-1px,-2px);} }
        .explosion-burst { animation: explode 0.7s ease-out forwards; }
        @keyframes explode { 0%{transform:scale(0.2);opacity:0;}30%{transform:scale(1.3);opacity:1;}100%{transform:scale(1);opacity:1;} }

        .fresh-ping { position: absolute; inset: -6px; border-radius: 16px; border: 2px solid rgba(15,157,88,0.6); animation: ping 0.8s ease-out forwards; pointer-events: none; }
        @keyframes ping { 0%{transform:scale(0.7);opacity:1;}100%{transform:scale(1.3);opacity:0;} }

        /* HUD */
        .mines-hud { display: flex; gap: 8px; }
        .hud-stat { flex: 1; background: #12151d; border: 1px solid #232733; border-radius: 10px; padding: 6px 8px; text-align: center; }
        .hud-label { display:block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #6f7b90; font-weight: 700; }
        .hud-value { display:block; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:13px; }

        /* Right column */
        .stats-strip { display:grid; grid-template-columns: repeat(4,1fr); gap:8px; }
        .stat-box { background:#0e1015; border:1px solid #232733; border-radius:12px; padding:5px; text-align:center; }
        .stat-num { display:block; font-family:'JetBrains Mono',monospace; font-weight:900; font-size:13px; }
        .stat-lbl { font-size:8px; text-transform:uppercase; letter-spacing:0.1em; color:#6f7b90; font-weight:700; }

        .control-card { background:#0e1015; border:1px solid #232733; border-radius:14px; box-shadow:0 1px 2px rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.85); }
        .control-label-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .control-label { font-size:10px; font-weight:800; letter-spacing:0.14em; color:#98a3b8; }
        .control-sub { font-size:10px; font-family:'JetBrains Mono',monospace; color:#2fd08a; font-weight:700; }
        .adjust-btn { width:46px; height:46px; border-radius:50%; background:#12151d; color:#c2cbda; display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid #232733; transition:all 0.12s; flex-shrink:0; }
        .adjust-btn:hover:not(:disabled){background:#1f232d; color:#eef2f8; transform:translateY(-1px);}
        .adjust-btn:disabled{opacity:0.4;cursor:default;}
        .adjust-btn svg { width:20px; height:20px; }
        .bet-input-wrap { flex:1; min-width:0; display:flex; align-items:center; gap:6px; background:#12151d; border:1px solid #232733; padding:0 12px; border-radius:50px; height:46px; }
        .currency-sym { font-size:12px; font-weight:800; color:#f0b45c; }
        .bet-input { flex:1; min-width:0; background:transparent; color:#eef2f8; font-family:'JetBrains Mono',monospace; font-weight:700; font-size:15px; outline:none; }

        .quick-chips { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; margin-top:10px; }
        .quick-chip { padding:9px 0; border-radius:50px; background:#12151d; color:#98a3b8; font-family:'JetBrains Mono',monospace; font-weight:700; font-size:11px; cursor:pointer; transition:all 0.12s; }
        .quick-chip:hover:not(:disabled){background:#1f232d;color:#eef2f8; transform:translateY(-1px);}
        .quick-chip.active { background:#fbbf24; color:#3a2500; box-shadow:0 3px 10px rgba(217,119,6,0.25); }
        .quick-chip:disabled{opacity:0.4;cursor:default;}

        .action-btn { width:100%; height:64px; border-radius:18px; font-family:inherit; font-weight:900; font-size:15px; text-transform:uppercase; letter-spacing:0.08em; cursor:pointer; transition:all 0.12s; border:none; }
        .action-btn.bet.enabled { background:linear-gradient(180deg,#34d399,#10b981 60%,#059669); color:#fff; box-shadow:0 5px 18px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.3); border:1px solid #6ee7b7; }
        .action-btn.bet.enabled:hover{transform:translateY(-2px);filter:brightness(1.05);}
        .action-btn.bet.enabled:active{transform:translateY(1px);}
        .action-btn.cashout.enabled { background:linear-gradient(180deg,#fbbf24,#d97706 60%,#b45309); color:#fff; box-shadow:0 5px 18px rgba(251,191,36,0.4), inset 0 1px 0 rgba(255,255,255,0.3); border:1px solid #fde68a; animation:cashout-pulse 1.4s ease-in-out infinite; }
        .action-btn.cashout.enabled:hover{transform:translateY(-2px);}
        @keyframes cashout-pulse { 0%,100%{filter:brightness(1);}50%{filter:brightness(1.12);} }
        .action-btn.disabled { background:#1f232d; color:#6f7b90; cursor:not-allowed; }

        .outcome-msg { text-align:center; padding:8px; border-radius:10px; font-size:12px; }
        .outcome-msg.win { background:#0e2a1e; border:1px solid #1f5c41; animation:pop 0.3s ease-out; }
        .outcome-msg.loss { background:#2b1218; border:1px solid #6b2536; animation:pop 0.3s ease-out; }
        @keyframes pop { 0%{transform:scale(0.9);opacity:0;}100%{transform:scale(1);opacity:1;} }

        @media (max-width:1023px){ .mines-grid{ gap:5px; } .stats-strip{gap:6px;} }

        /* ---- Mobile-first fit (compressed to avoid scrolling) ---- */
        @media (max-width:640px){
          .mines-grid{ width:100%; gap:4px; margin:0 auto; }
          .mines-panel{ padding:10px 10px 12px; }
          .mines-panel .mb-3{ margin-bottom:10px; }
          .mines-title{ font-size:14px; }
          .mines-hud{ gap:5px; margin-top:8px; }
          .hud-stat{ padding:4px; }
          .hud-value{ font-size:11px; }
          .hud-label{ font-size:7px; }

          /* Compact round buttons */
          .adjust-btn{ width:40px; height:40px; }
          .adjust-btn svg{ width:16px; height:16px; }
          .bet-input-wrap{ height:40px; border-radius:50px; }

          /* Compact action button */
          .action-btn{ height:48px; border-radius:14px; font-size:13px; }

          /* Tighter stats (2x2) */
          .stats-strip{ grid-template-columns:repeat(4,1fr); gap:4px; }
          .stat-box{ padding:4px 3px; }
          .stat-num{ font-size:12px; }
          .stat-lbl{ font-size:7px; }

          /* Tight cards */
          .control-card{ padding:10px; }
          .control-label{ font-size:9px; }
          .quick-chips{ gap:4px; margin-top:7px; }
          .quick-chip{ padding:7px 0; font-size:10px; }
        }

        /* Very small phones */
        @media (max-width:380px){
          .adjust-btn{ width:44px; height:44px; }
          .bet-input-wrap{ height:44px; }
          .quick-chips{ gap:6px; }
          .quick-chip{ padding:9px 0; font-size:10px; }
          .action-btn{ height:56px; }
        }
      `}</style>
    </div>
  );
};
