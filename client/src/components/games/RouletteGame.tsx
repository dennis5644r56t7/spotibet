'use client';

import React, { useEffect, useRef, useState } from 'react';
import { sound } from '../../lib/sound';
import { api } from '../../lib/api';
import { Undo2, RotateCcw, X } from 'lucide-react';
import confetti from 'canvas-confetti';

interface RouletteGameProps {
  user: any;
  balanceType: 'REAL' | 'DEMO';
  onBalanceChange: () => void;
  onOpenFairness?: () => void;
}

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

// Canonical European roulette wheel order (clockwise from 0)
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const CHIPS = [100, 500, 1000, 5000, 10000];

interface RouletteBet {
  type: string;
  value: string | number;
  amount: number;
}

export const RouletteGame: React.FC<RouletteGameProps> = ({
  user,
  balanceType,
  onBalanceChange,
}) => {
  const [selectedChip, setSelectedChip] = useState(500);
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [ballAngle, setBallAngle] = useState<number | null>(null);
  const [winPocket, setWinPocket] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [justWon, setJustWon] = useState(false);
  const ballAnimRef = useRef<number | null>(null);

  const totalBet = bets.reduce((sum, b) => sum + b.amount, 0);

  useEffect(() => {
    return () => {
      if (ballAnimRef.current) cancelAnimationFrame(ballAnimRef.current);
    };
  }, []);

  const addBet = (type: string, value: string | number) => {
    if (spinning) return;
    sound.rouletteChip();
    setBets((prev) => {
      const existing = prev.find((b) => b.type === type && String(b.value) === String(value));
      if (existing) {
        return prev.map((b) =>
          b.type === type && String(b.value) === String(value)
            ? { ...b, amount: b.amount + selectedChip }
            : b
        );
      }
      return [...prev, { type, value, amount: selectedChip }];
    });
  };

  const removeBet = (type: string, value: string | number) => {
    sound.rouletteChip();
    setBets((prev) => prev.filter((b) => !(b.type === type && String(b.value) === String(value))));
  };

  const clearBets = () => {
    sound.rouletteChip();
    setBets([]);
    setWinPocket(null);
  };

  const undoBet = () => {
    sound.rouletteChip();
    setBets((prev) => prev.slice(0, -1));
  };

  const pocketAngleFrom = (num: number): number => {
    const idx = WHEEL_ORDER.indexOf(num);
    if (idx === -1) return 0;
    return (360 - (360 / 37) * idx) % 360;
  };

  const celebrate = () => {
    const colors =
      lastResult?.winningColor === 'red'
        ? ['#c21835', '#ffffff', '#ffb3b3']
        : lastResult?.winningColor === 'green'
        ? ['#1a7a4c', '#4ade80', '#ffffff']
        : ['#fde68a', '#ffffff'];
    confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.35 },
      colors,
      disableForReducedMotion: true,
    });
  };

  const handleSpin = async () => {
    if (bets.length === 0 || spinning) return;
    setSpinning(true);
    setLastResult(null);
    setJustWon(false);
    setWinPocket(null);

    try {
      const res = await api.playRoulette({ bets, balanceType });

      const target = pocketAngleFrom(res.winningNumber);
      const current = wheelRotation % 360;
      const spins = 6 + Math.floor(Math.random() * 3);
      const travel = (360 - current) + target + spins * 360;
      const newRotation = wheelRotation + travel;

      setWheelRotation(newRotation);
      setBallAngle(null);

      // Animate the ball counter-rotating into the winning pocket (top)
      let start: number | null = null;
      const ballStartAngle = (-target + spins * 360) % 360;
      setBallAngle(ballStartAngle);
      const duration = 2700;

      const animateBall = (ts: number) => {
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const angle = (ballStartAngle - (spins * 360) * eased + target * eased) % 360;
        setBallAngle(angle);
        if (t < 1) {
          ballAnimRef.current = requestAnimationFrame(animateBall);
        } else {
          ballAnimRef.current = null;
        }
      };
      ballAnimRef.current = requestAnimationFrame(animateBall);

      setTimeout(() => {
        setLastResult(res);
        setWinPocket(res.winningNumber);
        setHistory((prev) => [res.winningNumber, ...prev].slice(0, 14));
        setSpinning(false);
        if (res.totalPayout > 0) {
          setJustWon(true);
          sound.rouletteWin();
          celebrate();
          setTimeout(() => setJustWon(false), 2200);
        } else {
          sound.rouletteLoss();
        }
        onBalanceChange();
      }, 2900);
    } catch (err: any) {
      alert(err.message || 'Spin failed');
      setSpinning(false);
    }
  };

  const betAmountFor = (type: string, value: string | number) =>
    bets.find((b) => b.type === type && String(b.value) === String(value))?.amount;

  const chipOn = (type: string, value: string | number) => {
    const amt = betAmountFor(type, value);
    if (!amt) return null;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); removeBet(type, value); }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 chip-landing"
        title={`KSh ${amt.toLocaleString()} (click to remove)`}
      >
        <span className="chip-token block">{amt.toLocaleString()}</span>
      </button>
    );
  };

  const isWinNum = (n: number) => winPocket === n;

  const renderNumberGrid = () => (
    <div className="flex flex-1 min-h-0">
      {/* Zero (left, spans all 3 rows) */}
      <button onClick={() => addBet('straight', 0)} disabled={spinning}
        className={`num-cell zero-cell ${isWinNum(0) ? 'num-win' : ''}`}>
        0
        {chipOn('straight', 0)}
      </button>

      {/* Number grid 3 rows x 12 cols */}
      <div className="flex-1 grid grid-rows-[repeat(3,minmax(0,1fr))] gap-px">
        {[3, 2, 1].map((rowStart) => (
          <div key={rowStart} className="grid grid-cols-12 gap-px">
            {Array.from({ length: 12 }).map((_, c) => {
              const num = rowStart + c * 3;
              const isRed = RED_NUMBERS.includes(num);
              return (
                <button key={num} onClick={() => addBet('straight', num)} disabled={spinning}
                  className={`num-cell ${isRed ? 'num-red' : 'num-black'} ${isWinNum(num) ? 'num-win' : ''}`}>
                  {num}
                  {chipOn('straight', num)}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Column bets (right side) */}
      <div className="grid grid-rows-[repeat(3,minmax(0,1fr))] gap-px ml-px">
        {['col3', 'col2', 'col1'].map((c) => (
          <button key={c} onClick={() => addBet('column', c)} disabled={spinning}
            className="num-cell col-cell relative">
            2:1
            {chipOn('column', c)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-[1650px] mx-auto flex flex-col lg:flex-row items-stretch gap-2 sm:gap-5 h-full min-h-0 p-1 sm:p-3 overflow-y-auto lg:overflow-hidden">
      {/* ===== LEFT: WHEEL ===== */}
      <div className="w-full lg:w-[38%] lg:flex-none bg-card-panel rounded-2xl sm:rounded-3xl border border-panel-edge shadow-2xl p-3 sm:p-6 flex flex-col items-center justify-center">
        <div className="wheel-container">
          {/* Top pointer */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-2 z-30 flex flex-col items-center pointer-events-none">
            <div className="w-0 h-0 border-x-[9px] border-x-transparent border-t-[14px] border-t-[#e6c268] drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"></div>
            <div className="w-7 h-1.5 bg-[#e6c268] rounded-sm -mt-px shadow"></div>
          </div>

          {/* Rotating wheel */}
          <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full rounded-full wheel-rotate wheel-spin-smooth"
            style={{ transform: `rotate(${wheelRotation}deg)` }}>
            <defs>
              <radialGradient id="wheelFace" cx="50%" cy="45%" r="62%">
                <stop offset="0%" stopColor="#6b5a3f" />
                <stop offset="55%" stopColor="#463a28" />
                <stop offset="100%" stopColor="#2b2318" />
              </radialGradient>
              <linearGradient id="metalBezel" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f0cf7a" />
                <stop offset="35%" stopColor="#9c7c34" />
                <stop offset="65%" stopColor="#5a4920" />
                <stop offset="100%" stopColor="#e6c268" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="98" fill="url(#metalBezel)" />
            <circle cx="100" cy="100" r="90" fill="#221d14" />
            {WHEEL_ORDER.map((num, i) => {
              const startAngle = (360 / 37) * i - 90 - 90 / 37;
              const color = num === 0 ? '#0f7a4a' : RED_NUMBERS.includes(num) ? '#c81e3a' : '#16191e';
              const largeArc = 0;
              const ang1 = (startAngle * Math.PI) / 180;
              const ang2 = ((startAngle + (360 / 37) * 0.93) * Math.PI) / 180;
              const r0 = 88, r1 = 60;
              const p0 = { x: 100 + r0 * Math.cos(ang1), y: 100 + r0 * Math.sin(ang1) };
              const p1 = { x: 100 + r0 * Math.cos(ang2), y: 100 + r0 * Math.sin(ang2) };
              const p2 = { x: 100 + r1 * Math.cos(ang2), y: 100 + r1 * Math.sin(ang2) };
              const p3 = { x: 100 + r1 * Math.cos(ang1), y: 100 + r1 * Math.sin(ang1) };
              const midAngle = ((startAngle + 90 / 37) * Math.PI) / 180;
              const labelR = (r0 + r1) / 2;
              const lx = 100 + labelR * Math.cos(midAngle);
              const ly = 100 + labelR * Math.sin(midAngle);
              const isWinning = winPocket === num;
              return (
                <g key={num}>
                  <path
                    d={`M ${p0.x} ${p0.y} A ${r0} ${r0} 0 ${largeArc} 1 ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${r1} ${r1} 0 ${largeArc} 0 ${p3.x} ${p3.y} Z`}
                    fill={color} stroke="#221d14" strokeWidth="1"
                    className={isWinning ? 'pocket-win' : ''}
                  />
                  <text x={lx} y={ly} fill="#fff" fontSize="6.4" fontWeight="700"
                    fontFamily="'JetBrains Mono', monospace" textAnchor="middle" dominantBaseline="middle"
                  >{num}</text>
                </g>
              );
            })}
            <circle cx="100" cy="100" r="60" fill="none" stroke="#6b5a3f" strokeWidth="2.5" />
          </svg>

          {/* Animated ball */}
          {ballAngle !== null && (
            <div className="absolute left-1/2 top-1/2 z-20 pointer-events-none" style={{ width: 0, height: 0 }}>
              <div className="ball-3d" style={{ position: 'absolute', transform: `rotate(${ballAngle}deg) translateY(-78px)` }} />
            </div>
          )}

          {/* Center hub */}
          <div className="absolute inset-0 m-auto flex items-center justify-center" style={{ width: '52%', height: '52%' }}>
            <div className="w-full h-full rounded-full flex items-center justify-center hub-gold">
              <div className="w-[62%] h-[62%] rounded-full flex items-center justify-center border border-[#5a4920] hub-dark">
                <span className="text-[#e6c268] font-black tracking-tighter hub-text">
                  <span className="block text-center leading-none opacity-70 hub-sub">SPOTIBET</span>
                  ROULETTE
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Result / state */}
        <div className="mt-3 w-full flex flex-col items-center">
          {lastResult ? (
            <div className="flex items-center gap-3 result-pop">
              <div className={`win-card ${lastResult.winningColor === 'green' ? 'win-green' : lastResult.winningColor === 'red' ? 'win-red' : 'win-black'}`}>
                <div className="text-center">
                  <div className="text-[9px] uppercase tracking-[0.2em] text-[#6f7b90] font-bold">Number</div>
                  <div className="win-num" style={{ color: lastResult.winningColor === 'green' ? '#2fd08a' : lastResult.winningColor === 'red' ? '#f4587a' : '#eef2f8' }}>
                    {lastResult.winningNumber}
                  </div>
                </div>
                <div className="text-left pl-3 border-l border-[#232733]">
                  <div className="win-color">{lastResult.winningColor}</div>
                  <div className="win-eo">{lastResult.isEven ? 'Even' : 'Odd'}</div>
                </div>
              </div>
              <div className={`font-mono text-base sm:text-lg font-extrabold ${lastResult.totalPayout > 0 ? 'text-[#2fd08a]' : 'text-[#6f7b90]'}`}>
                {lastResult.totalPayout > 0 ? `+KSh ${lastResult.totalPayout.toLocaleString()}` : 'No win'}
              </div>
            </div>
          ) : (
            <div className="text-[#6f7b90] text-xs sm:text-sm font-mono">
              {spinning ? 'Spinning the wheel…' : 'Place your bets on the table'}
            </div>
          )}

          {/* History strip */}
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {history.map((h, i) => (
              <span key={i} className={`hist-num ${h === 0 ? 'hist-green' : RED_NUMBERS.includes(h) ? 'hist-red' : 'hist-black'}`}>
                {h}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ===== RIGHT: TABLE + CONTROLS ===== */}
      <div className="w-full lg:flex-1 flex flex-col gap-2 min-h-0 overflow-hidden">
        {/* Table */}
        <div className="table-wrap flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <div className="table-min table-glow">
            {/* Table header */}
            <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-[#1d3a2e]">
              <div className="flex items-center gap-2">
                <span className="hidden sm:flex w-6 h-6 rounded-full bg-[#5fd39c] border border-[#1c8a67] items-center justify-center text-white text-xs font-black">R</span>
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-[#5fd39c]">European Roulette</span>
              </div>
              <span className="text-[9px] font-mono text-[#2f8f6c] hidden sm:inline">Single zero • house edge 2.7%</span>
            </div>

            {/* Betting grid (authentic layout) */}
            {renderNumberGrid()}

            {/* Dozens */}
            <div className="grid grid-cols-3 gap-px mt-px">
              {[{ val: '1st12', label: '1st 12' }, { val: '2nd12', label: '2nd 12' }, { val: '3rd12', label: '3rd 12' }].map((d) => (
                <button key={d.val} onClick={() => addBet('dozen', d.val)} disabled={spinning} className="outside-cell relative">
                  {d.label}
                  {chipOn('dozen', d.val)}
                </button>
              ))}
            </div>

            {/* Outside bets: full-width evenly spaced row (like a real table) */}
            <div className="grid grid-cols-6 gap-px mt-px">
              <button onClick={() => addBet('low', 'low')} disabled={spinning} className="outside-cell relative">
                1 to 18
                {chipOn('low', 'low')}
              </button>
              <button onClick={() => addBet('even', 'even')} disabled={spinning} className="outside-cell relative">
                EVEN
                {chipOn('even', 'even')}
              </button>
              <button onClick={() => addBet('black', 'black')} disabled={spinning} className="outside-cell black-cell relative">
                BLACK
                {chipOn('black', 'black')}
              </button>
              <button onClick={() => addBet('red', 'red')} disabled={spinning} className="outside-cell red-cell relative">
                RED
                {chipOn('red', 'red')}
              </button>
              <button onClick={() => addBet('odd', 'odd')} disabled={spinning} className="outside-cell relative">
                ODD
                {chipOn('odd', 'odd')}
              </button>
              <button onClick={() => addBet('high', 'high')} disabled={spinning} className="outside-cell relative">
                19 to 36
                {chipOn('high', 'high')}
              </button>
            </div>
          </div>
        </div>

        {/* Control bar */}
        <div className="control-bar">
          <div className="flex items-center gap-1 flex-wrap">
            {CHIPS.map((val) => (
              <button key={val} onClick={() => { sound.rouletteChip(); setSelectedChip(val); }}
                className={`chip-button ${selectedChip === val ? 'active' : ''}`}>
                {val >= 1000 ? `${val / 1000}K` : val}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button onClick={undoBet} disabled={bets.length === 0 || spinning} className="ctrl-btn" title="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={clearBets} disabled={bets.length === 0 || spinning} className="ctrl-btn" title="Clear">
            <X className="w-4 h-4" />
          </button>

          <div className="total-box">
            <div className="total-label">Total</div>
            <div className="total-value">KSh {totalBet.toLocaleString()}</div>
          </div>

          <button onClick={handleSpin} disabled={totalBet === 0 || spinning}
            className={`spin-btn ${totalBet > 0 && !spinning ? 'spin-active' : 'spin-disabled'}`}>
            {spinning ? (<span className="flex items-center gap-2"><RotateCcw className="w-4 h-4 animate-spin" /> Spinning</span>) : ('Spin')}
          </button>
        </div>
      </div>

      {justWon && <div className="win-flash pointer-events-none" />}

      <style>{`
        /* === Panel === */
        .bg-card-panel { background: #0e1015; }
        .border-panel-edge { border-color: #232733; }

        /* === Wheel responsive sizing === */
        .wheel-container {
          position: relative;
          width: min(72vw, 250px);
          height: min(72vw, 250px);
          filter: drop-shadow(0 8px 24px rgba(0,0,0,0.7));
        }
        @media (max-width: 1023px) { .wheel-container { width: min(62vw, 250px); height: min(62vw, 250px); } }
        @media (max-width: 430px) { .wheel-container { width: min(55vh, 240px, 84vw); height: min(55vh, 240px, 84vw); } }

        .wheel-rotate { will-change: transform; }

        /* ball 3D render */
        .ball-3d {
          width: 13px; height: 13px; border-radius: 50%;
          background: radial-gradient(circle at 30% 25%, #ffffff 0%, #d9dee3 45%, #8a9096 100%);
          box-shadow: 0 0 8px rgba(255,255,255,0.8), 2px 3px 6px rgba(0,0,0,0.5);
          animation: ball-spin 0.12s linear infinite;
        }
        @keyframes ball-spin {
          0% { box-shadow: 0 0 8px rgba(255,255,255,0.85), 2px 3px 6px rgba(0,0,0,0.5); }
          50% { box-shadow: 0 0 14px rgba(255,255,255,1), 2px 3px 6px rgba(0,0,0,0.4); }
          100% { box-shadow: 0 0 8px rgba(255,255,255,0.85), 2px 3px 6px rgba(0,0,0,0.5); }
        }

        /* winning pocket glow */
        .pocket-win {
          animation: pocket-glow 1.2s ease-in-out infinite;
        }
        @keyframes pocket-glow {
          0%, 100% { filter: brightness(1) drop-shadow(0 0 3px rgba(255,255,255,0.6)); }
          50% { filter: brightness(1.7) drop-shadow(0 0 12px rgba(255,255,255,0.95)); }
        }

        .hub-gold {
          background: radial-gradient(circle at 50% 32%, #e6c268 0%, #8a6d2f 55%, #4a3a17 100%);
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.5), 0 0 18px rgba(230,194,104,0.25);
        }
        .hub-dark { background: radial-gradient(circle at 50% 30%, #3a3226 0%, #14120d 100%); }
        .hub-text { font-size: clamp(10px, 2.8vw, 15px); line-height: 0.85; }
        .hub-sub { font-size: 0.55em; letter-spacing: 0.18em; }

        /* === Result card === */
        .result-pop { animation: pop 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
        @keyframes pop { 0% { transform: scale(0.7); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .win-card { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-radius: 16px; border: 1px solid; }
        .win-green { background: #0e2a1e; border-color: #1f5c41; }
        .win-red { background: #2b1218; border-color: #6b2536; }
        .win-black { background: #1a1e27; border-color: #2c313d; }
        .win-num { font-size: 30px; font-weight: 900; font-family: 'JetBrains Mono', monospace; line-height: 1; }
        .win-color { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; color: #c2cbda; }
        .win-eo { font-size: 11px; font-family: 'JetBrains Mono', monospace; color: #98a3b8; }

        .hist-num {
          width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; font-family: 'JetBrains Mono', monospace; border: 1px solid;
        }
        .hist-green { background: #047857; color: #fff; border-color: #34d399; }
        .hist-red { background: #c81e3a; color: #fff; border-color: #fb7185; }
        .hist-black { background: #16191e; color: #fff; border-color: #6b7280; }

        /* === Table === */
        .table-wrap { background: #0f1a16; border: 1px solid #1d3a2e; border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.85); }
        .table-min {
          min-width: 480px; padding: 6px;
          display: flex; flex-direction: column; height: 100%;
        }
        .table-glow { box-shadow: inset 0 0 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.5); }

        /* Inside cells */
        .num-cell {
          position: relative; display: flex; align-items: center; justify-content: center;
          height: 100%; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 15px;
          border-radius: 3px; border: 1px solid rgba(0,0,0,0.6); cursor: pointer;
          user-select: none; transition: transform 0.12s, filter 0.12s, box-shadow 0.12s;
          min-height: 40px;
        }
        .num-cell:hover:not(:disabled) { filter: brightness(1.08); }
        .num-cell:active:not(:disabled) { transform: scale(0.94); }
        .num-cell:disabled { cursor: default; }
        .num-red { background: linear-gradient(180deg, #e0384f, #b3182f); color: #fff; }
        .num-black { background: linear-gradient(180deg, #3b414b, #22262d); color: #fff; }
        .zero-cell { width: 48px; height: auto; align-self: stretch; background: linear-gradient(180deg, #17a26a, #0b6640); color: #fff; font-size: 24px; }
        .col-cell { background: linear-gradient(180deg, #16241d, #12201a); color: #5fd39c; font-size: 13px; border-color: rgba(0,0,0,0.55); }
        .outside-cell {
          position: relative; height: 40px; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(180deg, #16241d, #12201a); color: #5fd39c; border: 1px solid rgba(0,0,0,0.55);
          font-size: 12px; font-weight: 700; border-radius: 3px; cursor: pointer; user-select: none;
          transition: filter 0.12s, transform 0.12s;
        }
        .outside-cell:hover:not(:disabled) { filter: brightness(0.97); }
        .outside-cell:active:not(:disabled) { transform: scale(0.97); }
        .outside-cell:disabled { cursor: default; }
        .black-cell { background: linear-gradient(180deg, #3b414b, #22262d); color: #fff; }
        .red-cell { background: linear-gradient(180deg, #e0384f, #b3182f); color: #fff; }

        /* winning cell highlight on table */
        .num-win { animation: table-win 1.4s ease-in-out infinite; z-index: 5; }
        @keyframes table-win {
          0%, 100% { box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 16px rgba(255,255,255,0.6); filter: brightness(1.35); }
          50% { box-shadow: 0 0 0 4px rgba(255,255,255,1), 0 0 26px rgba(255,255,255,0.9); filter: brightness(1.7); }
        }

        /* === Chips === */
        .chip-token {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 26px; height: 26px; border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #ffd257, #e09f00 70%);
          border: 2px dashed rgba(255,255,255,0.65); color: #3a2500;
          font-weight: 900; font-size: 10px; font-family: 'JetBrains Mono', monospace;
          box-shadow: 0 2px 6px rgba(0,0,0,0.6), inset 0 1px 2px rgba(255,255,255,0.5);
          transform: scale(0.85);
        }
        .chip-landing { animation: chip-drop 0.25s cubic-bezier(0.2, 1.4, 0.4, 1); }
        @keyframes chip-drop { 0% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }

        .chip-button {
          min-width: 42px; height: 38px; border-radius: 12px;
          background: radial-gradient(circle at 35% 28%, #ffd257, #c78b00 65%);
          border: 2px dashed rgba(255,255,255,0.55); color: #3a2500;
          font-weight: 900; font-size: 12px; font-family: 'JetBrains Mono', monospace;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.5);
          transition: transform 0.1s, box-shadow 0.1s; cursor: pointer;
        }
        .chip-button:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 6px 14px rgba(0,0,0,0.5); }
        .chip-button.active {
          transform: translateY(-4px) scale(1.12);
          box-shadow: 0 8px 18px rgba(224,159,0,0.55), 0 0 0 3px rgba(255,255,255,0.2);
        }
        .chip-button:disabled { opacity: 0.4; cursor: default; }

        /* === Control bar === */
        .control-bar {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          background: #0e1015; border: 1px solid #232733; border-radius: 14px; padding: 8px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.5), 0 8px 24px -12px rgba(0,0,0,0.85);
        }
        .ctrl-btn {
          width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
          background: #12151d; color: #c2cbda; border: 1px solid #232733; cursor: pointer; transition: background 0.12s, color 0.12s;
        }
        .ctrl-btn:hover:not(:disabled) { background: #1f232d; color: #eef2f8; }
        .ctrl-btn:disabled { opacity: 0.4; cursor: default; }
        .total-box { padding: 4px 12px; border-radius: 10px; background: #12151d; border: 1px solid #232733; text-align: center; }
        .total-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.16em; color: #6f7b90; font-weight: 700; line-height: 1; }
        .total-value { font-size: 13px; font-family: 'JetBrains Mono', monospace; font-weight: 800; color: #f0b45c; line-height: 1.2; }

        .spin-btn {
          padding: 0 26px; height: 44px; border-radius: 14px; font-family: inherit;
          font-weight: 900; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
          transition: all 0.1s; cursor: pointer;
        }
        .spin-active {
          background: linear-gradient(180deg, #34d399, #10b981); color: #fff;
          box-shadow: 0 4px 14px rgba(16,185,129,0.4); border: 1px solid #6ee7b7;
        }
        .spin-active:hover { filter: brightness(1.08); transform: translateY(-1px); }
        .spin-active:active { transform: translateY(1px); }
        .spin-disabled { background: #1f232d; color: #6f7b90; cursor: not-allowed; }

        /* === Win flash overlay === */
        .win-flash {
          position: fixed; inset: 0; z-index: 60;
          background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18), transparent 60%);
          animation: flash-fade 0.8s ease-out forwards;
        }
        @keyframes flash-fade { 0% { opacity: 1; } 100% { opacity: 0; } }

        /* === Mobile fit === */
        @media (max-width: 1023px) {
          .table-min { min-width: 0; width: 100%; }
          .num-cell { min-height: 34px; font-size: 11px; }
          .zero-cell { width: 40px; font-size: 16px; }
          .outside-cell { height: 32px; font-size: 10px; }
          .col-cell { font-size: 10px; }
          .chip-token { min-width: 22px; height: 22px; font-size: 9px; }
        }
        @media (max-width: 480px) {
          .num-cell { min-height: 30px; }
          .outside-cell { height: 28px; }
        }
      `}</style>
    </div>
  );
};
