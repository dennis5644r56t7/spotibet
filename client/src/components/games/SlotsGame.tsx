'use client';

import React, { useEffect, useRef, useState } from 'react';
import { sound } from '../../lib/sound';
import { api } from '../../lib/api';
import { Sparkles, Coins, Info, Minus, Plus, RefreshCcw } from 'lucide-react';
import confetti from 'canvas-confetti';

interface SlotsGameProps {
  user: any;
  balanceType: 'REAL' | 'DEMO';
  onBalanceChange: () => void;
  onOpenFairness?: () => void;
}

const makeReel = (seed: string[]): string[] => {
  // Build a 9-tall virtual reel (5 symbols + 2 lead + 2 fill) so it can scroll
  const base = seed.length >= 3 ? seed : [...seed, ...seed, ...seed];
  return [...base.slice(-2), ...base.slice(0, 2), ...base]; // leads on top
};

const SymbolTile: React.FC<{ sym: string; size?: 'sm' | 'md' | 'lg'; dimmed?: boolean; win?: boolean }> = ({
  sym,
  size = 'md',
  dimmed,
  win,
}) => {
  const tileScale = size === 'lg' ? 'scale-110' : size === 'sm' ? 'scale-75' : 'scale-100';

  return (
    <div
      className={`symbol-tile ${size === 'lg' ? 'tile-lg' : ''} ${dimmed ? 'tile-dimmed' : ''} ${win ? 'tile-win' : ''} ${tileScale}`}
      data-sym={sym}
    >
      <svg viewBox="0 0 100 100" className="symbol-svg" width="100%" height="100%">
        {renderSymbol(sym)}
      </svg>
    </div>
  );
};

// ---- Premium symbol artwork (inline SVG) ----
function renderSymbol(sym: string) {
  switch (sym) {
    case 'SEVEN':
      return (
        <g>
          <defs>
            <linearGradient id="svRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ff5a6e" /><stop offset="1" stopColor="#b01230" />
            </linearGradient>
          </defs>
          <text x="50" y="72" textAnchor="middle" fontSize="70" fontWeight="900" fill="url(#svRed)" stroke="#fff" strokeWidth="3" fontFamily="'Arial Black',Arial">7</text>
          <text x="50" y="72" textAnchor="middle" fontSize="70" fontWeight="900" fill="none" stroke="#7a0d20" strokeWidth="1" opacity="0.5" fontFamily="'Arial Black',Arial">7</text>
        </g>
      );
    case 'DIAMOND':
      return (
        <g>
          <defs>
            <linearGradient id="dm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#aee3ff" /><stop offset="0.5" stopColor="#38bdf8" /><stop offset="1" stopColor="#5cc0f2" />
            </linearGradient>
          </defs>
          <path d="M50 12 L84 50 L50 88 L16 50 Z" fill="url(#dm)" stroke="#e0f2fe" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M50 20 L74 50 L50 80 L26 50 Z" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
          <circle cx="42" cy="35" r="3" fill="rgba(255,255,255,0.9)" />
        </g>
      );
    case 'BELL':
      return (
        <g>
          <defs>
            <linearGradient id="bl" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#d97706" />
            </linearGradient>
          </defs>
          <ellipse cx="50" cy="78" rx="26" ry="12" fill="url(#bl)" stroke="#78350f" strokeWidth="2" />
          <path d="M50 20 a18 18 0 0 0 -18 18 c0 10 -4 16 -8 24 a18 18 0 0 0 52 0 c-4 -8 -8 -14 -8 -24 a18 18 0 0 0 -18 -18 Z" fill="url(#bl)" stroke="#78350f" strokeWidth="2" />
          <path d="M32 62 c4 6 8 8 18 8 s14 -2 18 -8" fill="none" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="50" cy="24" r="3.5" fill="#f0b45c" />
        </g>
      );
    case 'BAR':
      return (
        <g>
          <rect x="22" y="36" width="56" height="30" rx="5" fill="#fde68a" stroke="#f0b45c" strokeWidth="2.5" />
          <text x="50" y="58" textAnchor="middle" fontSize="18" fontWeight="900" fill="#f0b45c" fontFamily="'Arial Black',Arial" letterSpacing="1">BAR</text>
        </g>
      );
    case 'CHERRY':
      return (
        <g>
          <circle cx="36" cy="62" r="18" fill="#ef4444" stroke="#9f1239" strokeWidth="2" />
          <circle cx="64" cy="62" r="18" fill="#ef4444" stroke="#9f1239" strokeWidth="2" />
          <circle cx="30" cy="55" r="5" fill="rgba(255,255,255,0.5)" />
          <circle cx="58" cy="55" r="5" fill="rgba(255,255,255,0.5)" />
          <path d="M50 44 c-8 -12 0 -20 0 -20 s8 8 0 20 Z" fill="#16a34a" stroke="#14532d" strokeWidth="1.5" />
          <path d="M36 50 c-4 -6 0 -14 4 -12 c2 2 -2 10 -4 12 Z" fill="#16a34a" />
          <path d="M64 50 c4 -6 0 -14 -4 -12 c-2 2 2 10 4 12 Z" fill="#16a34a" />
        </g>
      );
    case 'WILD':
      return (
        <g>
          <polygon points="50,10 61,34 87,36 67,53 73,79 50,64 27,79 33,53 13,36 39,34" fill="#fbbf24" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />
          <polygon points="50,18 58,36 78,37 62,50 67,71 50,60 33,71 38,50 22,37 42,36" fill="#fde68a" />
          <text x="50" y="78" textAnchor="middle" fontSize="15" fontWeight="900" fill="#f0b45c" fontFamily="'Arial Black',Arial">WILD</text>
        </g>
      );
    case 'SCATTER':
      return (
        <g>
          <defs>
            <linearGradient id="sc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fecdd3" /><stop offset="0.5" stopColor="#f4587a" /><stop offset="1" stopColor="#881337" />
            </linearGradient>
          </defs>
          <path d="M50 10 L60 40 L90 40 L66 60 L74 90 L50 72 L26 90 L34 60 L10 40 L40 40 Z" fill="url(#sc)" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="50" cy="50" r="13" fill="#fff" />
          <text x="50" y="55" textAnchor="middle" fontSize="17" fontWeight="900" fill="#f4587a" fontFamily="'Arial Black',Arial">S</text>
        </g>
      );
    case 'A':
      return (
        <g>
          <text x="50" y="72" textAnchor="middle" fontSize="58" fontWeight="900" fill="#c084fc" stroke="#fff" strokeWidth="2" fontFamily="'Arial Black',Arial">A</text>
        </g>
      );
    case 'K':
      return (
        <g>
          <text x="50" y="72" textAnchor="middle" fontSize="58" fontWeight="900" fill="#f59e0b" stroke="#fff" strokeWidth="2" fontFamily="'Arial Black',Arial">K</text>
        </g>
      );
    case 'Q':
      return (
        <g>
          <text x="50" y="72" textAnchor="middle" fontSize="58" fontWeight="900" fill="#34d399" stroke="#fff" strokeWidth="2" fontFamily="'Arial Black',Arial">Q</text>
        </g>
      );
    default:
      return (
        <text x="50" y="72" textAnchor="middle" fontSize="58" fontWeight="900" fill="#fff" stroke="#000" strokeWidth="2" fontFamily="'Arial Black',Arial">{sym}</text>
      );
  }
}

export const SlotsGame: React.FC<SlotsGameProps> = ({
  user,
  balanceType,
  onBalanceChange,
}) => {
  const [amount, setAmount] = useState('500');
  const [grid, setGrid] = useState<string[][]>([
    ['SEVEN', 'DIAMOND', 'BELL', 'BAR', 'CHERRY'],
    ['A', 'K', 'Q', 'WILD', 'SEVEN'],
    ['CHERRY', 'BELL', 'DIAMOND', 'A', 'K'],
  ]);
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState<any>(null);
  const [winningSyms, setWinningSyms] = useState<Set<string>>(new Set());
  const [showPaytable, setShowPaytable] = useState(false);
  const [rollingRows, setRollingRows] = useState<number[]>([0, 0, 0, 0, 0]); // each reel's progress
  const [balanceShown, setBalanceShown] = useState(0);
  const timersRef = useRef<number[]>([]);

  const balance = balanceType === 'REAL' ? (user?.realBalance ?? 0) : (user?.demoBalance ?? 0);

  useEffect(() => {
    setBalanceShown(balance);
  }, [balance]);

  useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), []);

  const adjustAmount = (delta: number) => {
    sound.slotsChip();
    setAmount((prev) => {
      const next = Math.max(50, Math.min(50000, (Number(prev) || 0) + delta));
      return String(next);
    });
  };

  const setQuick = (val: number) => {
    sound.slotsChip();
    setAmount(String(val));
  };

  const celebrate = (res: any) => {
    const colors = ['#fbbf24', '#e94560', '#60a5fa', '#34d399'];
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.3 },
      colors,
      disableForReducedMotion: true,
    });
    if (res.isBonus) {
      setTimeout(() =>
        confetti({ particleCount: 70, origin: { x: 0.2, y: 0.4 }, angle: 60, spread: 55, colors }),
      400);
      setTimeout(() =>
        confetti({ particleCount: 70, origin: { x: 0.8, y: 0.4 }, angle: 120, spread: 55, colors }),
      650);
    }
  };

  const handleSpin = async () => {
    if (spinning) return;
    sound.slotsChip();
    setSpinning(true);
    setLastWin(null);
    setWinningSyms(new Set());

    // Start rolling animation for all reels
    setRollingRows([0, 0, 0, 0, 0]);

    try {
      const res = await api.spinSlots({ amount: parseFloat(amount), balanceType });

      // Staggered reel stops (left to right). Backend grid = grid[row][col]
      for (let colIdx = 0; colIdx < 5; colIdx++) {
        const delay = colIdx * 250 + 900;
        timersRef.current.push(
          window.setTimeout(() => {
            setGrid((prev) =>
              prev.map((row, r) => {
                const newRow = [...row];
                newRow[colIdx] = res.grid[r][colIdx];
                return newRow;
              })
            );
            setRollingRows((prev) => prev.map((v, i) => (i === colIdx ? 1 : v)));
          }, delay)
        );
      }

      // Final reveal
      timersRef.current.push(
        window.setTimeout(() => {
          setGrid(res.grid);
          setRollingRows([0, 0, 0, 0, 0]);
          setLastWin(res);
          setSpinning(false);

          // Collect winning symbols for highlight
          const winSyms = new Set<string>();
          if (res.winningLines && res.winningLines.length) {
            res.winningLines.forEach((line: any) => {
              if (line.lineSymbols) line.lineSymbols.forEach((sym: string) => winSyms.add(sym));
            });
          }
          if (res.scatterCount >= 3) winSyms.add('SCATTER');
          setWinningSyms(winSyms);

          if (res.totalWin > 0) {
            sound.slotsWin();
            celebrate(res);
          } else {
            sound.slotsLoss();
          }
          onBalanceChange();
        }, 900 + 250 * 5)
      );
    } catch (err: any) {
      alert(err.message || 'Spin failed');
      setSpinning(false);
      setRollingRows([0, 0, 0, 0, 0]);
    }
  };

  // Build a tall virtual reel for each column (to make the strip scrollable)
  const virtualReels = grid[0].map((_, colIdx) =>
    makeReel([grid[0][colIdx], grid[1][colIdx], grid[2][colIdx]])
  );

  return (
    <div className="w-full max-w-[1400px] mx-auto p-1 sm:p-4 flex flex-col lg:flex-row items-stretch gap-3 h-full min-h-0 overflow-y-auto lg:overflow-hidden">
      {/* ===== LEFT: SLOT MACHINE ===== */}
      <div className="w-full lg:flex-1 flex flex-col min-h-0">
        {/* Marquee header */}
        <div className="slot-cabinet-title mb-1.5 sm:mb-2">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="slot-led-dot" />
              <h3 className="slot-marquee">NEON VEGAS 777</h3>
            </div>
            <div className="slot-balance-chip">
              <Coins className="w-3.5 h-3.5" />
              <span>KSh {balanceShown.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Cabinet */}
        <div className="slot-cabinet flex-1 min-h-0 flex flex-col rounded-2xl sm:rounded-3xl border p-2 sm:p-5">
          {/* Light strip */}
          <div className="slot-lights mb-1 sm:mb-2">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} className={`slot-light ${i % 2 ? 'alt' : ''}`} />
            ))}
          </div>

          {/* Reels window */}
          <div className="reels-window flex-1 min-h-0 rounded-xl sm:rounded-2xl p-1.5 sm:p-3 grid grid-cols-5 gap-1 sm:gap-2 overflow-hidden">
            {Array.from({ length: 5 }).map((_, colIdx) => (
              <div key={colIdx} className="reel relative">
                {/* Payline center glow */}
                <div className="reel-line-mid" />
                {colIdx === 0 && <div className="reel-center-badge">WIN</div>}

                {/* Reel strip */}
                {spinning ? (
                  <div className="reel-strip spinning" style={{ animationDelay: `${colIdx * 0.15}s` }}>
                    {Array.from({ length: 18 }).map((_, i) => {
                      const sym = virtualReels[colIdx][i % virtualReels[colIdx].length];
                      return (
                        <div key={i} className="reel-slot-content">
                          <SymbolTile sym={sym} size="md" />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="reel-strip stopped">
                    {grid.map((row, rIdx) => {
                      const sym = row[colIdx];
                      const isWin = winningSyms.has(sym);
                      return (
                        <div key={rIdx} className="reel-slot-content">
                          <SymbolTile sym={sym} size="md" win={isWin} dimmed={winningSyms.size > 0 && !isWin} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Payline indicator */}
          <div className="payline-bar mt-1.5 sm:mt-2">
            <span className="payline-label">PAYLINES</span>
            <div className="payline-pips">
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className={`payline-pip ${lastWin?.winningLines?.some((l: any) => l.lineIndex === i) ? 'lit' : ''}`} />
              ))}
            </div>
            <span className="payline-count">×10</span>
          </div>

          {/* Win banner */}
          <div className="mt-1.5 sm:mt-2 min-h-[26px]">
            {lastWin && (
              <div className={`win-banner ${lastWin.totalWin > 0 ? 'win' : 'lose'} ${lastWin.isBonus ? 'bonus' : ''}`}>
                {lastWin.totalWin > 0 ? (
                  <div className="flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span className="win-amount">
                      {lastWin.isBonus ? 'BONUS + ' : 'WIN '}KSh {lastWin.totalWin.toLocaleString()}
                    </span>
                    {lastWin.isBonus && (
                      <span className="free-spins-tag">{lastWin.scatterCount} SCATTERS</span>
                    )}
                  </div>
                ) : (
                  <span className="text-[#98a3b8] text-xs font-mono">No win this spin — try again!</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== RIGHT: CONTROLS ===== */}
      <div className="w-full lg:w-80 flex flex-col gap-2.5 min-h-0">
        {/* Bet amount */}
        <div className="slots-panel p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="slots-panel-label">BET AMOUNT</span>
            <button
              onClick={() => setShowPaytable(!showPaytable)}
              className="flex items-center gap-1 text-[11px] text-[#98a3b8] hover:text-[#f0b45c] transition"
            >
              <Info className="w-3.5 h-3.5" /> Paytable
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => adjustAmount(-100)} disabled={spinning}
              className="adjust-btn" title="Decrease bet">
              <Minus className="w-4 h-4" />
            </button>
            <div className="flex-1 bet-input-wrap">
              <span className="text-[#f0b45c] font-bold text-xs">KSh</span>
              <input
                type="number"
                disabled={spinning}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bet-input"
              />
            </div>
            <button onClick={() => adjustAmount(100)} disabled={spinning}
              className="adjust-btn" title="Increase bet">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Quick chips */}
          <div className="quick-chips mt-2">
            {[100, 500, 1000, 2000, 5000, 10000].map((val) => (
              <button
                key={val}
                disabled={spinning}
                onClick={() => setQuick(val)}
                className={`quick-chip ${amount === String(val) ? 'active' : ''}`}
              >
                {val >= 1000 ? `${val / 1000}K` : val}
              </button>
            ))}
          </div>
        </div>

        {/* Spin button */}
        <button
          onClick={handleSpin}
          disabled={spinning}
          className={`slot-spin-btn ${spinning ? 'disabled' : 'enabled'}`}
        >
          {spinning ? (
            <span className="flex items-center gap-2">
              <RefreshCcw className="w-5 h-5 animate-spin" /> Spinning...
            </span>
          ) : (
            <span className="flex flex-col items-center leading-tight">
              SPIN
              <span className="text-[10px] font-mono font-bold opacity-80">
                KSh {Number(amount || 0).toLocaleString()}
              </span>
            </span>
          )}
        </button>

        {/* Paytable card */}
        {showPaytable && (
          <div className="paytable-card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="slots-panel-label">PAYTABLE</span>
              <button onClick={() => setShowPaytable(false)} className="text-[#98a3b8] hover:text-[#eef2f8] text-xs">✕</button>
            </div>
            <div className="paytable-grid">
              {[
                { sym: 'SEVEN', label: '7', mult: 'x100' },
                { sym: 'DIAMOND', label: '◆ Diamond', mult: 'x50' },
                { sym: 'BELL', label: '🔔 Bell', mult: 'x25' },
                { sym: 'BAR', label: 'BAR', mult: 'x15' },
                { sym: 'CHERRY', label: '🍒 Cherry', mult: 'x10' },
                { sym: 'A', label: 'A', mult: 'x5' },
                { sym: 'K', label: 'K', mult: 'x4' },
                { sym: 'Q', label: 'Q', mult: 'x3' },
                { sym: 'WILD', label: '⭐ Wild', mult: 'SUBS' },
                { sym: 'SCATTER', label: '💎 Scatter', mult: 'x100' },
              ].map((row) => (
                <div key={row.sym} className="paytable-row">
                  <span className="paytable-sym"><SymbolTile sym={row.sym} size="sm" /></span>
                  <span className="paytable-label">{row.label}</span>
                  <span className="paytable-mult">{row.mult}</span>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-[#6f7b90] mt-2 leading-snug">
              Wins pay left-to-right across 10 fixed paylines. Star = Wild (substitutes all except Scatter).
              3+ Scatters triggers a bonus multiplier.
            </p>
          </div>
        )}

        <div className="text-[10px] text-[#6f7b90] font-mono text-center">
          10 Paylines • 3 Scatters = Bonus
        </div>
      </div>

      <style>{`
        /* === Cabinet === */
        .slot-cabinet {
          background: #0e1015;
          border-color: #232733;
          box-shadow: 0 1px 2px rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.85);
          justify-content: center;
        }
        .slot-cabinet-title {
          background: linear-gradient(180deg, #c21533, #7a0d20);
          border: 1px solid #e94560;
          border-radius: 12px;
          box-shadow: 0 3px 12px rgba(233,69,96,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
        }
        .slot-marquee {
          font-family: 'JetBrains Mono', monospace;
          font-weight: 900; font-size: 13px; letter-spacing: 0.14em;
          color: #fff; text-shadow: 0 0 12px rgba(255,255,255,0.6), 0 0 24px rgba(233,69,96,0.7);
          animation: marquee-pulse 2s ease-in-out infinite;
        }
        @keyframes marquee-pulse { 0%,100%{text-shadow:0 0 10px rgba(255,255,255,0.5),0 0 22px rgba(233,69,96,0.7);}50%{text-shadow:0 0 18px rgba(255,255,255,0.9),0 0 34px rgba(233,69,96,1);} }
        .slot-led-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 8px #4ade80; animation: led-blink 1s steps(2) infinite; }
        @keyframes led-blink { 50% { opacity: 0.4; } }
        .slot-balance-chip { display: flex; align-items: center; gap: 5px; color: #fde68a; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 11px; background: rgba(0,0,0,0.3); padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(251,191,36,0.35); }

        /* Lights */
        .slot-lights { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; padding: 2px; }
        .slot-light { width: 12px; height: 6px; border-radius: 3px; background: #e94560; opacity: 0.8; box-shadow: 0 0 6px #e94560; animation: light-chase 1.2s linear infinite; }
        .slot-light.alt { background: #60a5fa; box-shadow: 0 0 6px #60a5fa; animation-delay: 0.6s; }
        .slot-light:nth-child(3n) { background: #34d399; box-shadow: 0 0 6px #34d399; }
        @keyframes light-chase { 0%,100%{opacity:0.25;} 50%{opacity:1;} }
        @keyframes led-blink2 { 50%{opacity:0;} }

        /* Reels window */
        .reels-window {
          background: linear-gradient(180deg, #12151d 0%, #0b0d12 100%);
          border: 2px solid #232733; box-shadow: inset 0 3px 14px rgba(0,0,0,0.5);
          max-height: 560px;
        }
        .reel { border-radius: 8px; overflow: hidden; background: #0e1015; position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.5); }
        .reel-line-mid { position: absolute; top: 50%; left: 0; right: 0; height: 2px; transform: translateY(-50%); background: rgba(217,119,6,0.3); box-shadow: 0 0 10px rgba(217,119,6,0.35); z-index: 5; pointer-events: none; }
        .reel-center-badge { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); z-index: 6; font-size: 7px; font-weight: 900; color: #f0b45c; background: rgba(255,255,255,0.92); padding: 1px 5px; border-radius: 6px; border: 1px solid #5c4620; letter-spacing: 0.1em; pointer-events: none; }

        /* Reel strips */
        .reel-strip { display: flex; flex-direction: column; }
        .reel-strip.stopped { gap: 2px; height: 100%; justify-content: center; }
        .reel-slot-content { display: flex; align-items: center; justify-content: center; padding: 3px; flex: 1; min-height: 0; }
        .reel-strip.stopped .reel-slot-content { flex: none; }

        .reel-strip.spinning { animation: reel-scroll 0.5s linear infinite; }
        @keyframes reel-scroll { 0% { transform: translateY(0); } 100% { transform: translateY(-33.333%); } }

        /* Symbol tile */
        .symbol-tile {
          width: 100%; aspect-ratio: 1 / 1; max-width: 90px;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(180deg, #0e1015 0%, #12151d 100%);
          border: 1px solid #232733; border-radius: 10px; margin: auto;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
          font-family: 'JetBrains Mono', monospace; font-weight: 900;
          transition: transform 0.1s, box-shadow 0.2s;
          position: relative;
        }
        .tile-lg { border-width: 2px; }
        .tile-dimmed { opacity: 0.4; filter: grayscale(0.35); }
        .tile-win { animation: tile-win-pulse 0.9s ease-in-out infinite; }
        @keyframes tile-win-pulse {
          0%,100% { box-shadow: 0 0 6px rgba(217,119,6,0.35), 0 0 0 1px rgba(217,119,6,0.55); }
          50% { box-shadow: 0 0 20px rgba(217,119,6,0.6), 0 0 0 2px rgba(217,119,6,0.9); }
        }
        .symbol-svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }

        /* Payline bar */
        .payline-bar { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 8px; background: #12151d; border: 1px solid #232733; }
        .payline-label { font-size: 8px; font-weight: 800; color: #98a3b8; letter-spacing: 0.1em; }
        .payline-pips { display: flex; gap: 3px; flex: 1; justify-content: center; }
        .payline-pip { width: 9px; height: 9px; border-radius: 50%; background: #232733; border: 1px solid #2c313d; transition: all 0.2s; }
        .payline-pip.lit { background: #fbbf24; border-color: #d19a16; box-shadow: 0 0 8px rgba(217,119,6,0.45); }
        .payline-count { font-size: 9px; font-weight: 800; color: #f0b45c; font-family: 'JetBrains Mono', monospace; }

        /* Win banner */
        .win-banner { text-align: center; padding: 6px; border-radius: 10px; border: 1px solid; }
        .win-banner.win { background: linear-gradient(180deg, #2a2113, #2e1218); border-color: #5c4620; animation: win-banner-pop 0.4s cubic-bezier(0.2,1,0.3,1); }
        .win-banner.bonus { border-color: #6b2536; box-shadow: 0 0 16px rgba(220,28,52,0.18); }
        .win-banner.lose { background: #12151d; border-color: #232733; }
        @keyframes win-banner-pop { 0%{transform:scale(0.8);opacity:0;}100%{transform:scale(1);opacity:1;} }
        .win-amount { font-family: 'JetBrains Mono', monospace; font-weight: 900; font-size: 15px; color: #f0b45c; }
        .free-spins-tag { font-size: 9px; font-weight: 800; color: #fff; background: #dc1c34; padding: 2px 8px; border-radius: 20px; }

        /* Panels */
        .slots-panel { background: #0e1015; border: 1px solid #232733; border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.85); }
        .slots-panel-label { font-size: 10px; font-weight: 800; letter-spacing: 0.14em; color: #98a3b8; }
        .adjust-btn { width: 36px; height: 36px; border-radius: 10px; background: #12151d; color: #c2cbda; border: 1px solid #232733; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s, color 0.15s; }
        .adjust-btn:hover:not(:disabled) { background: #1f232d; color: #eef2f8; }
        .adjust-btn:disabled { opacity: 0.4; cursor: default; }
        .bet-input-wrap { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: #12151d; border: 1px solid #232733; padding: 0 12px; border-radius: 10px; height: 40px; }
        .bet-input { flex: 1; min-width: 0; background: transparent; color: #eef2f8; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 14px; outline: none; }

        .quick-chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .quick-chip { padding: 7px 0; border-radius: 8px; background: #12151d; border: 1px solid #232733; color: #98a3b8; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 11px; cursor: pointer; transition: all 0.12s; }
        .quick-chip:hover:not(:disabled) { background: #1f232d; color: #eef2f8; }
        .quick-chip.active { background: #fbbf24; color: #3a2500; border-color: #d19a16; box-shadow: 0 3px 10px rgba(217,119,6,0.28); }
        .quick-chip:disabled { opacity: 0.4; cursor: default; }

        .slot-spin-btn {
          width: 100%; height: 64px; border-radius: 16px; font-family: inherit;
          font-weight: 900; font-size: 18px; text-transform: uppercase; letter-spacing: 0.12em;
          cursor: pointer; transition: all 0.12s;
        }
        .slot-spin-btn.enabled {
          background: linear-gradient(180deg, #fbbf24, #f59e0b 60%, #d97706);
          color: #3a2500; box-shadow: 0 5px 18px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.4);
          border: 1px solid #d19a16;
        }
        .slot-spin-btn.enabled:hover { transform: translateY(-2px); filter: brightness(1.04); box-shadow: 0 8px 22px rgba(245,158,11,0.45); }
        .slot-spin-btn.enabled:active { transform: translateY(1px); }
        .slot-spin-btn.disabled { background: #1f232d; color: #6f7b90; cursor: not-allowed; }

        .paytable-card { background: #0e1015; border: 1px solid #232733; border-radius: 14px; overflow: hidden; animation: pop 0.25s ease-out; box-shadow: 0 8px 24px -12px rgba(0,0,0,0.85); }
        .paytable-grid { display: flex; flex-direction: column; }
        .paytable-row { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 8px; }
        .paytable-row:nth-child(odd) { background: #12151d; }
        .paytable-sym { width: 34px; height: 34px; flex-shrink: 0; }
        .paytable-label { flex: 1; font-size: 11px; font-weight: 600; color: #c2cbda; }
        .paytable-mult { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 800; color: #f0b45c; }

        @keyframes pop { 0%{transform:scale(0.95);opacity:0;}100%{transform:scale(1);opacity:1;} }

        /* Responsive */
        @media (max-width: 1023px) {
          .reels-window { min-height: 260px; }
          .symbol-tile { max-width: 64px; }
        }
        @media (max-width: 480px) {
          .reels-window { min-height: 220px; }
          .symbol-tile { max-width: 52px; border-radius: 7px; }
          .slot-plights { gap: 4px; }
        }
      `}</style>
    </div>
  );
};
