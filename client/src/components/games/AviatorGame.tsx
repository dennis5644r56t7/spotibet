'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { sound } from '../../lib/sound';
import {
  HelpCircle,
  Trophy,
  User as UserIcon,
  Minus,
  Plus,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  X,
  Home as HomeIcon,
  Volume2,
  VolumeX,
  Music,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';

const MIN_AVIATOR_BET = 10;
const MAX_AVIATOR_BET = 500000;
const AVIATOR_BET_STEP = 10;
const AVIATOR_QUICK_BETS = [100, 200, 500, 10000];
const normalizeBetAmount = (value: string) => {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? Math.max(MIN_AVIATOR_BET, Math.min(MAX_AVIATOR_BET, amount)) : MIN_AVIATOR_BET;
  // The live game always shows the stake with two decimals ("10.00").
  return safe.toFixed(2);
};
// Spribe always renders the stake with two decimals ("10.00").
const formatAmount = (value: number | string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

interface AviatorGameProps {
  socket: Socket | null;
  user: any;
  balanceType: 'REAL' | 'DEMO';
  setBalanceType?: (type: 'REAL' | 'DEMO') => void;
  onBalanceChange: () => void;
  onOpenFairness?: () => void;
  onNavigateHome?: () => void;
  onOpenDeposit?: () => void;
  onOpenWithdraw?: () => void;
  onRefillDemo?: () => void;
}

export const AviatorGame: React.FC<AviatorGameProps> = ({
  socket,
  user,
  balanceType,
  setBalanceType,
  onBalanceChange,
  onOpenFairness,
  onNavigateHome,
  onOpenDeposit,
  onOpenWithdraw,
  onRefillDemo,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Game Engine State
  const [gameState, setGameState] = useState<'COUNTDOWN' | 'FLYING' | 'CRASHED'>('COUNTDOWN');
  const [multiplier, setMultiplier] = useState(1.00);
  const [crashPoint, setCrashPoint] = useState(1.00);
  const [timeLeft, setTimeLeft] = useState(5.0);
  const [roundId, setRoundId] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [activeBets, setActiveBets] = useState<any[]>([]);
  const [leftTab, setLeftTab] = useState<'ALL' | 'MY' | 'TOP'>('ALL');
  const [myBetsHistory, setMyBetsHistory] = useState<any[]>([]);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [isBetsExpanded, setIsBetsExpanded] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Animates the slideout out before unmounting (state alone would pop it away).
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [musicOn, setMusicOn] = useState(true);
  const [soundMuted, setSoundMuted] = useState(false);

  // Bet Panel 1 State
  const [bet1Mode, setBet1Mode] = useState<'BET' | 'AUTO'>('BET');
  const [bet1Amount, setBet1Amount] = useState(MIN_AVIATOR_BET.toFixed(2));
  const [bet1AutoCashout, setBet1AutoCashout] = useState(false);
  const [bet1Target, setBet1Target] = useState('2.00');
  const [bet1Placed, setBet1Placed] = useState<any>(null);
  const [bet1CashedOut, setBet1CashedOut] = useState<any>(null);

  // Bet Panel 2 State
  const [bet2Mode, setBet2Mode] = useState<'BET' | 'AUTO'>('BET');
  const [bet2Amount, setBet2Amount] = useState(MIN_AVIATOR_BET.toFixed(2));
  const [bet2AutoCashout, setBet2AutoCashout] = useState(false);
  const [bet2Target, setBet2Target] = useState('1.50');
  const [bet2Placed, setBet2Placed] = useState<any>(null);
  const [bet2CashedOut, setBet2CashedOut] = useState<any>(null);

  // Stable Refs for Realtime Sockets & 60fps Loop
  const liveMultiplierRef = useRef(1.00);
  const liveStateRef = useRef<'COUNTDOWN' | 'FLYING' | 'CRASHED'>('COUNTDOWN');
  const animFrameRef = useRef<number | null>(null);
  const crashOffsetRef = useRef<number>(0);
  const bet1PlacedRef = useRef<any>(null);
  const bet2PlacedRef = useRef<any>(null);
  const bet1ModeRef = useRef(bet1Mode);
  const bet2ModeRef = useRef(bet2Mode);
  const bet1AutoCashoutRef = useRef(bet1AutoCashout);
  const bet2AutoCashoutRef = useRef(bet2AutoCashout);
  const bet1TargetRef = useRef(bet1Target);
  const bet2TargetRef = useRef(bet2Target);
  const bet1CashedOutRef = useRef<any>(null);
  const bet2CashedOutRef = useRef<any>(null);

  useEffect(() => { bet1PlacedRef.current = bet1Placed; }, [bet1Placed]);
  useEffect(() => { bet2PlacedRef.current = bet2Placed; }, [bet2Placed]);
  useEffect(() => { bet1ModeRef.current = bet1Mode; }, [bet1Mode]);
  useEffect(() => { bet2ModeRef.current = bet2Mode; }, [bet2Mode]);
  useEffect(() => { bet1AutoCashoutRef.current = bet1AutoCashout; }, [bet1AutoCashout]);
  useEffect(() => { bet2AutoCashoutRef.current = bet2AutoCashout; }, [bet2AutoCashout]);
  useEffect(() => { bet1TargetRef.current = bet1Target; }, [bet1Target]);
  useEffect(() => { bet2TargetRef.current = bet2Target; }, [bet2Target]);
  useEffect(() => { bet1CashedOutRef.current = bet1CashedOut; }, [bet1CashedOut]);
  useEffect(() => { bet2CashedOutRef.current = bet2CashedOut; }, [bet2CashedOut]);

  // Preload Authentic Official Spribe Assets
  const planeFramesRef = useRef<HTMLImageElement[]>([]);
  const propImgRef = useRef<HTMLImageElement | null>(null);
  const sunImgRef = useRef<HTMLImageElement | null>(null);

  // Keep the menu toggles in sync with the engine and start the music.
  useEffect(() => {
    setMusicOn(sound.getMusicEnabled());
    setSoundMuted(sound.getMuted());
    sound.startMusic();
  }, []);

  useEffect(() => {
    const frameUrls = [
      '/spribe/plane-0.svg',
      '/spribe/plane-1.svg',
      '/spribe/plane-2.svg',
      '/spribe/plane-3.svg',
    ];

    planeFramesRef.current = frameUrls.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });

    const prop = new Image();
    prop.src = '/spribe/prop.svg';
    propImgRef.current = prop;

    const sun = new Image();
    sun.src = '/spribe/bg-sun.svg';
    sunImgRef.current = sun;

  }, []);

  // Populate active bets table initially
  useEffect(() => {
    if (activeBets.length === 0) {
      setActiveBets([
        { betId: 'm1', username: 'Alex_Vip', amount: 2500, cashedOut: true, multiplier: 2.15, payout: 5375 },
        { betId: 'm2', username: 'David_K', amount: 500, cashedOut: true, multiplier: 1.45, payout: 725 },
        { betId: 'm3', username: 'Chioma_99', amount: 5000, cashedOut: false },
        { betId: 'm4', username: 'Tunde_Bet', amount: 1000, cashedOut: false },
        { betId: 'm5', username: 'PilotPro', amount: 15000, cashedOut: true, multiplier: 4.80, payout: 72000 },
        { betId: 'm6', username: 'Samuel_O', amount: 750, cashedOut: false },
        { betId: 'm7', username: 'Emeka_Lagos', amount: 2000, cashedOut: false },
      ]);
    }
  }, []);

  // Socket listener setup
  useEffect(() => {
    if (!socket) return;

    socket.on('aviator:state', (data) => {
      setGameState(data.state);
      liveStateRef.current = data.state;
      setRoundId(data.roundId);
      setMultiplier(data.multiplier);
      liveMultiplierRef.current = data.multiplier;
      if (Array.isArray(data.history)) setHistory(data.history);
      if (data.activeBets && data.activeBets.length > 0) setActiveBets(data.activeBets);
    });

    socket.on('aviator:countdown', (data) => {
      setGameState('COUNTDOWN');
      liveStateRef.current = 'COUNTDOWN';
      setRoundId(data.roundId);
      setTimeLeft(data.timeLeft);
      setMultiplier(1.00);
      liveMultiplierRef.current = 1.00;
      setBet1CashedOut(null);
      setBet2CashedOut(null);
      crashOffsetRef.current = 0;
    });

    socket.on('aviator:takeoff', (data) => {
      setGameState('FLYING');
      liveStateRef.current = 'FLYING';
      setRoundId(data.roundId);
      setMultiplier(1.00);
      liveMultiplierRef.current = 1.00;
      crashOffsetRef.current = 0;
      sound.playTakeoff();
    });

    socket.on('aviator:tick', (data) => {
      setMultiplier(data.multiplier);
      liveMultiplierRef.current = data.multiplier;

      // Auto Cashout checks
      if (
        bet1PlacedRef.current &&
        bet1ModeRef.current === 'AUTO' &&
        bet1AutoCashoutRef.current
      ) {
        const target = parseFloat(bet1TargetRef.current || '2.0');
        if (data.multiplier >= target) {
          handleCashout(1);
        }
      }

      if (
        bet2PlacedRef.current &&
        bet2ModeRef.current === 'AUTO' &&
        bet2AutoCashoutRef.current
      ) {
        const target = parseFloat(bet2TargetRef.current || '2.0');
        if (data.multiplier >= target) {
          handleCashout(2);
        }
      }
    });

    socket.on('aviator:crashed', (data) => {
      setGameState('CRASHED');
      liveStateRef.current = 'CRASHED';
      setCrashPoint(data.crashPoint);
      liveMultiplierRef.current = data.crashPoint;
      sound.playCrash();

      setHistory((prev) => [data.historyItem, ...prev.slice(0, 39)]);

      if (bet1PlacedRef.current && !bet1CashedOutRef.current) {
        setMyBetsHistory((prev) => [
          { roundId: data.roundId, amount: bet1PlacedRef.current.amount, status: 'LOST', payout: 0, time: new Date() },
          ...prev,
        ]);
      }
      if (bet2PlacedRef.current && !bet2CashedOutRef.current) {
        setMyBetsHistory((prev) => [
          { roundId: data.roundId, amount: bet2PlacedRef.current.amount, status: 'LOST', payout: 0, time: new Date() },
          ...prev,
        ]);
      }

      setBet1Placed(null);
      setBet2Placed(null);
      onBalanceChange();
    });

    socket.on('aviator:bet_placed', (data) => {
      setActiveBets((prev) => [data, ...prev]);
    });

    socket.on('aviator:cashed_out', (data) => {
      setActiveBets((prev) =>
        prev.map((b) => (b.betId === data.betId ? { ...b, cashedOut: true, ...data } : b))
      );
      if (user && data.userId === user.id) {
        sound.playCashout();
        onBalanceChange();
      }
    });

    socket.on('aviator:bet_cancelled', (data) => {
      setActiveBets((prev) => prev.filter((b) => b.betId !== data.betId));
    });

    // Ask for a fresh snapshot: this component can mount long after the socket
    // connected, so the initial server push may have been missed. Also repeat
    // on (re)connect so history is never left empty after a reconnect.
    const requestState = () => socket.emit('aviator:get_state');
    socket.on('connect', requestState);
    requestState();

    return () => {
      socket.off('connect', requestState);
      socket.off('aviator:state');
      socket.off('aviator:countdown');
      socket.off('aviator:takeoff');
      socket.off('aviator:tick');
      socket.off('aviator:crashed');
      socket.off('aviator:bet_placed');
      socket.off('aviator:cashed_out');
      socket.off('aviator:bet_cancelled');
    };
  }, [socket, user, onBalanceChange]);

  // 60 FPS HTML5 Canvas Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const handleResize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);
    handleResize();
    let frameCount = 0;
    let propAngle = 0;
    let sunAngle = 0;
    let lastTime = performance.now();
    let displayedMultiplier = liveMultiplierRef.current;
    let previousState = liveStateRef.current;
    let flightTime = 0;
    let flightProgress = 0;
    let progressVelocity = 0;

    const render = (now: number) => {
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.05);
      lastTime = now;
      ctx.clearRect(0, 0, width, height);
      frameCount += dt * 60;
      propAngle += dt * 4.8;
      sunAngle += dt * 0.174;

      const st = liveStateRef.current;
      if (st === 'COUNTDOWN' || (st === 'FLYING' && previousState !== 'FLYING')) {
        displayedMultiplier = 1;
        flightTime = 0;
        flightProgress = 0;
        progressVelocity = 0;
      }
      if (st === 'FLYING') {
        flightTime += dt;
        displayedMultiplier += (liveMultiplierRef.current - displayedMultiplier) * (1 - Math.exp(-dt * 8));
        // One continuous climb with a critically damped response to network updates.
        // Solved against the live board: at 1.84x the plane sits ~75% across, which
        // is 1 - m^-2.25. The old -4.2 exponent sent the plane to the edge by ~2x.
        const targetProgress = 1 - Math.pow(Math.max(1, displayedMultiplier), -2.25);
        const omega = 7;
        const offset = flightProgress - targetProgress;
        const decay = Math.exp(-omega * dt);
        const step = (progressVelocity + omega * offset) * dt;
        flightProgress = targetProgress + (offset + step) * decay;
        progressVelocity = (progressVelocity - omega * step) * decay;
      }
      previousState = st;

      // 1. Spribe Arena Background: pure black stage
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // 2. Rotating Sun Rays centred at the bottom-left runway origin
      if (sunImgRef.current && sunImgRef.current.complete) {
        ctx.save();
        ctx.translate(0, height);
        ctx.rotate(sunAngle);
        ctx.globalAlpha = 1;
        const sunSize = Math.max(width, height) * 3.6;
        ctx.drawImage(sunImgRef.current, -sunSize / 2, -sunSize / 2, sunSize, sunSize);
        ctx.restore();
      }

      // 3. Teal runway glow — low-centre, core sampled at #206285 fading through
      //    #1d5d78 / #154865 / #0c2635, exactly the live board's light.
      //    The warm shift is tied to the REAL multiplier thresholds (the same
      //    ones used by the history bands): teal below 8x, violet from 8x,
      //    crimson from 20x. The old log(m)/log(8) ramp went violet by ~2.8x,
      //    which is why the board looked purple while the counter was still 5x.
      const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
      const teal = [32, 98, 133];
      const violet = [92, 54, 150];
      const crimson = [168, 26, 66];
      const m = Math.max(1, displayedMultiplier);
      let base = teal;
      if (m >= 20) {
        // Crisp crossfade right at the threshold, then hold crimson.
        const t = Math.min(1, (m - 20) / 0.5);
        base = [lerp(violet[0], crimson[0], t), lerp(violet[1], crimson[1], t), lerp(violet[2], crimson[2], t)];
      } else if (m >= 8) {
        const t = Math.min(1, (m - 8) / 0.5);
        base = [lerp(teal[0], violet[0], t), lerp(teal[1], violet[1], t), lerp(teal[2], violet[2], t)];
      }
      const [baseR, baseG, baseB] = base;
      // Separate intensity ramp: only radius/alpha grow with the flight, never
      // the hue — the hue must wait for its exact multiplier threshold.
      const heat = Math.min(1, Math.log(m) / Math.log(30));
      const glowCx = width * 0.46;
      const glowCy = height * 0.60;
      const glowR = Math.max(width * 0.42, height * 0.58) * (1 + heat * 0.12);
      const glow = ctx.createRadialGradient(glowCx, glowCy, 0, glowCx, glowCy, glowR);
      const a = (m: number) => Math.min(0.92, m * (1 + heat * 0.22));
      glow.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${a(0.80).toFixed(3)})`);
      glow.addColorStop(0.20, `rgba(${lerp(baseR, 0, 0.10)}, ${lerp(baseG, 0, 0.06)}, ${lerp(baseB, 0, 0.10)}, ${a(0.60).toFixed(3)})`);
      glow.addColorStop(0.42, `rgba(${lerp(baseR, 0, 0.26)}, ${lerp(baseG, 0, 0.20)}, ${lerp(baseB, 0, 0.24)}, ${a(0.36).toFixed(3)})`);
      glow.addColorStop(0.64, `rgba(${lerp(baseR, 0, 0.52)}, ${lerp(baseG, 0, 0.50)}, ${lerp(baseB, 0, 0.48)}, ${a(0.18).toFixed(3)})`);
      glow.addColorStop(0.84, `rgba(${lerp(baseR, 0, 0.76)}, ${lerp(baseG, 0, 0.76)}, ${lerp(baseB, 0, 0.74)}, ${a(0.06).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // 3. Countdown State: Propeller Spinner + Progress Bar in Center
      if (st === 'COUNTDOWN') {
        const cx = width / 2;
        const cy = height / 2;

        // Spinning red propeller — sits above the countdown copy but clear of
        // the FUN MODE bar at the top of the stage.
        if (propImgRef.current && propImgRef.current.complete) {
          ctx.save();
          ctx.translate(cx, cy - 66);
          ctx.rotate(propAngle);
          const propSize = Math.min(58, height * 0.16);
          ctx.drawImage(propImgRef.current, -propSize / 2, -propSize / 2, propSize, propSize);
          ctx.restore();
        }
      }

      // 4. Flight State: Authentic Spribe Aerodynamic Trajectory Curve + 4-Frame Plane
      if (st === 'FLYING' || st === 'CRASHED') {
        const originX = width > 600 ? 20 : 12;
        const originY = height - 14;

        // Reserve space for the plane so its nose stays inside the board.
        // Spribe's plane is small relative to the stage and sits high on the curve.
        const scale = Math.min(1, Math.max(0.55, Math.min(width / 900, height / 380)));
        const pWidth = 118 * scale;
        const pHeight = pWidth * (74 / 150);
        const progress = Math.max(0, Math.min(1, flightProgress));
        const floatY = Math.sin(flightTime * 1.3) * 2 * progress;
        const floatX = Math.sin(flightTime * 0.9) * 1.5 * progress;
        const startX = originX + 16;
        const startY = originY - 12;
        const endX = Math.max(startX, width - pWidth - 12);
        const endY = Math.max(pHeight, height * 0.25);
        const planeX = Math.min(endX, startX + (endX - startX) * progress + floatX);
        const planeY = Math.max(endY, startY + (endY - startY) * progress + floatY);

        const dx = planeX - originX;
        const dy = originY - planeY;

        // The fill and rounded stroke share the same curve and plane-tail anchor.
        const cp1x = originX + dx * 0.42;
        const cp1y = originY;
        const cp2x = originX + dx * 0.82;
        const cp2y = originY - dy * 0.35;

        // In Spribe, on crash the trajectory curve is cleared immediately
        if (st === 'FLYING') {
          ctx.save();

          // Gradient fill under curve (#e50539 fading to transparent)
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, planeX, planeY);
          ctx.lineTo(planeX, originY);
          ctx.lineTo(originX, originY);
          ctx.closePath();
          const fillGrad = ctx.createLinearGradient(0, planeY, 0, originY);
          fillGrad.addColorStop(0, 'rgba(126, 12, 32, 0.97)');
          fillGrad.addColorStop(0.5, 'rgba(110, 8, 22, 0.95)');
          fillGrad.addColorStop(1, 'rgba(96, 4, 16, 0.92)');
          ctx.fillStyle = fillGrad;
          ctx.fill();

          // Bright red trajectory line (#e71542, as sampled from the live game)
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, planeX, planeY);
          ctx.strokeStyle = '#e71542';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = 'rgba(231, 21, 66, 0.9)';
          ctx.shadowBlur = 10;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();

          ctx.restore();
        }

        // Zoom off-screen animation on crash
        let crashOffsetX = 0;
        let crashOffsetY = 0;
        if (st === 'CRASHED') {
          crashOffsetRef.current += 1440 * dt;
          crashOffsetX = crashOffsetRef.current;
          crashOffsetY = -crashOffsetRef.current * 0.72;
        }

        // Draw 4-Frame Animated Airplane Sprite
        if (st === 'FLYING' || (st === 'CRASHED' && planeX + crashOffsetX < width + 180)) {
          ctx.save();
          ctx.translate(planeX + crashOffsetX, planeY + crashOffsetY);

          // Calculate authentic curve tangent angle
          let tangentAngle = Math.atan2(planeY - cp2y, planeX - cp2x);
          if (st === 'FLYING') {
            tangentAngle += Math.sin(flightTime * 1.3) * 0.02;
          } else {
            tangentAngle = -0.38;
          }
          ctx.rotate(Math.max(-0.18, Math.min(0.08, tangentAngle * 0.18)));

          // Animation speed: 1 frame every 7 frames (~116ms)
          const frameIdx = Math.floor(frameCount / 7) % 4;
          const currentPlaneImg = planeFramesRef.current[frameIdx];

          if (currentPlaneImg && currentPlaneImg.complete && currentPlaneImg.naturalWidth > 0) {
            // Exact Spribe plane tail anchor (tail tip connects seamlessly to the red curve)
            ctx.drawImage(
              currentPlaneImg,
              -pWidth * 0.055,
              -pHeight * 0.755,
              pWidth,
              pHeight
            );
          }

          ctx.restore();
        }
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      resizeObserver.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Bet placement handler
  const handlePlaceBet = (panel: 1 | 2) => {
    if (!socket || !user) return;
    const amount = Number(panel === 1 ? bet1Amount : bet2Amount);
    if (!Number.isFinite(amount) || amount < MIN_AVIATOR_BET || amount > MAX_AVIATOR_BET) {
      alert('Bet amount must be between KES 10 and KES 500,000.');
      return;
    }
    sound.playBet();
    const isAuto = panel === 1 ? (bet1Mode === 'AUTO' && bet1AutoCashout) : (bet2Mode === 'AUTO' && bet2AutoCashout);
    const autoMult = parseFloat(panel === 1 ? bet1Target : bet2Target);

    socket.emit(
      'aviator:bet',
      {
        amount,
        balanceType,
        autoCashout: isAuto ? autoMult : undefined,
      },
      (res: any) => {
        if (res.error) {
          alert(res.error);
        } else {
          if (panel === 1) setBet1Placed(res.bet);
          if (panel === 2) setBet2Placed(res.bet);
          onBalanceChange();
        }
      }
    );
  };

  // Bet cancel handler (during countdown)
  const handleCancelBet = (panel: 1 | 2) => {
    if (!socket) return;
    const bet = panel === 1 ? bet1Placed : bet2Placed;
    if (!bet) return;

    sound.playChip();
    socket.emit('aviator:cancel', { betId: bet.id }, (res: any) => {
      if (res.error) {
        alert(res.error);
      } else {
        if (panel === 1) setBet1Placed(null);
        if (panel === 2) setBet2Placed(null);
        onBalanceChange();
      }
    });
  };

  // Cashout handler
  const handleCashout = (panel: 1 | 2) => {
    if (!socket) return;
    const bet = panel === 1 ? bet1PlacedRef.current : bet2PlacedRef.current;
    if (!bet) return;

    socket.emit('aviator:cashout', { betId: bet.id }, (res: any) => {
      if (res.error) {
        alert(res.error);
      } else {
        sound.playCashout();
        if (panel === 1) {
          setBet1CashedOut(res);
          setBet1Placed(null);
        }
        if (panel === 2) {
          setBet2CashedOut(res);
          setBet2Placed(null);
        }
        setMyBetsHistory((prev) => [
          { roundId, amount: bet.amount, status: 'WON', multiplier: res.multiplier, payout: res.payout, time: new Date() },
          ...prev,
        ]);
        onBalanceChange();
      }
    });
  };

  const adjustBet = (panel: 1 | 2, delta: number) => {
    sound.playChip();
    if (panel === 1) {
      setBet1Amount((prev) => normalizeBetAmount(String(Number(prev || 0) + delta)));
    } else {
      setBet2Amount((prev) => normalizeBetAmount(String(Number(prev || 0) + delta)));
    }
  };
  // The live game steps by a stake-appropriate increment: 10 up to 100,
  // 100 up to 1,000, then 1,000.
  const stepFor = (value: string) => {
    const n = Number(value) || 0;
    if (n < 100) return AVIATOR_BET_STEP;
    if (n < 1000) return 100;
    return 1000;
  };

  // Menu open/close with a real exit animation. Without this the panel would
  // unmount instantly and only the entry would ever be seen.
  const openMenu = () => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    setIsMenuClosing(false);
    setIsMobileMenuOpen(true);
  };

  const closeMenu = () => {
    if (!isMobileMenuOpen || isMenuClosing) return;
    setIsMenuClosing(true);
    menuCloseTimerRef.current = setTimeout(() => {
      setIsMobileMenuOpen(false);
      setIsMenuClosing(false);
      menuCloseTimerRef.current = null;
    }, 200);
  };

  // Run whatever the menu item does *after* the close animation finishes.
  const closeMenuThen = (action?: () => void) => {
    closeMenu();
    if (!action) return;
    setTimeout(action, 200);
  };

  useEffect(
    () => () => {
      if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current);
    },
    []
  );

  // Escape closes the menu.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileMenuOpen, isMenuClosing]);

  return (
    <div className="aviator-layout w-full max-w-[1680px] mx-auto px-1 sm:px-3 py-1 flex flex-col lg:flex-row gap-1 sm:gap-2.5 lg:h-full lg:overflow-hidden lg:min-h-0">
      {/* DESKTOP LEFT SIDEBAR: Authentic Spribe Live Bets Feed (Desktop Only) */}
      <div className="hidden lg:flex w-72 xl:w-80 bg-[#0e1015] border border-[#232733] rounded-2xl p-2 sm:p-2.5 flex-col lg:h-full shadow-card flex-shrink-0 min-h-0">
        {/* Sidebar Tabs: All Bets | My Bets | Top */}
        <div className="flex bg-[#12151d] p-0.5 rounded-full mb-2 flex-shrink-0">
          <button
            onClick={() => setLeftTab('ALL')}
            className={`flex-1 py-1 rounded-full text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              leftTab === 'ALL' ? 'bg-[#2c2d30] text-[#eef2f8]' : 'text-[#98a3b8] hover:text-[#c2cbda]'
            }`}
          >
            <span>All Bets</span>
            <span className="text-[10px] bg-[#2e1218] text-[#dc1c34] px-1.5 py-0.2 rounded-full font-mono">
              {activeBets.length}
            </span>
          </button>
          <button
            onClick={() => setLeftTab('MY')}
            className={`flex-1 py-1 rounded-full text-xs font-bold transition ${
              leftTab === 'MY' ? 'bg-[#2c2d30] text-[#eef2f8]' : 'text-[#98a3b8] hover:text-[#c2cbda]'
            }`}
          >
            My Bets
          </button>
          <button
            onClick={() => setLeftTab('TOP')}
            className={`flex-1 py-1 rounded-full text-xs font-bold transition flex items-center justify-center gap-1 ${
              leftTab === 'TOP' ? 'bg-[#2c2d30] text-[#eef2f8]' : 'text-[#98a3b8] hover:text-[#c2cbda]'
            }`}
          >
            <Trophy className="w-3.5 h-3.5 text-[#f0b45c]" />
            Top
          </button>
        </div>

        {/* Authentic Spribe Bets Summary Sub-Bar (Matching Image 2) */}
        <div className="flex items-center justify-between px-2 py-1.5 mb-1 bg-[#12151d] rounded-xl border border-[#232733] text-xs flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1">
              <div className="w-3.5 h-3.5 rounded-full bg-[#dc1c34] border border-[#232733]" />
              <div className="w-3.5 h-3.5 rounded-full bg-[#2fd08a] border border-[#232733]" />
              <div className="w-3.5 h-3.5 rounded-full bg-[#5cc0f2] border border-[#232733]" />
            </div>
            <span className="text-[11px] font-mono font-bold text-[#98a3b8]">
              {activeBets.length}/128 Bets
            </span>
          </div>
          <div className="text-right">
            <div className="text-xs font-mono font-black text-[#eef2f8]">
              KES {activeBets.reduce((acc, b) => acc + (b.cashedOut ? Number(b.payout || b.amount * (b.multiplier || 1)) : 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[9px] uppercase font-bold text-[#6f7b90] tracking-wider">
              Total win KES
            </div>
          </div>
        </div>

        {/* Table Column Headers */}
        <div className="grid grid-cols-4 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6f7b90] border-b border-[#232733] flex-shrink-0">
          <span>User</span>
          <span className="text-right">Bet (KES)</span>
          <span className="text-right">Mult</span>
          <span className="text-right">Cash Out</span>
        </div>

        {/* Table Body Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#1f232d] pr-1 mt-1 no-scrollbar">
          {leftTab === 'ALL' &&
            activeBets.map((b, idx) => (
              <div
                key={b.betId || idx}
                className={`grid grid-cols-4 px-2 py-1.5 text-xs font-mono items-center transition ${
                  b.cashedOut
                    ? 'bg-[#0e2a1e] text-[#4ade80] font-bold'
                    : 'text-[#c2cbda] hover:bg-[#07080c]'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <UserIcon className="w-3 h-3 text-[#6f7b90] flex-shrink-0" />
                  <span className="truncate text-[11px]">{b.username || 'Pilot'}</span>
                </div>
                <div className="text-right text-[#c2cbda]">
                  {Number(b.amount || 0).toLocaleString()}
                </div>
                <div className="text-right">
                  {b.cashedOut ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#0e2a1e] text-[#2fd08a] border border-[#1f5c41]">
                      {Number(b.multiplier || b.cashedOutMultiplier || 0).toFixed(2)}x
                    </span>
                  ) : (
                    <span className="text-[#6f7b90]">-</span>
                  )}
                </div>
                <div className="text-right font-bold">
                  {b.cashedOut ? (
                    <span className="text-[#2fd08a]">
                      KES {Number(b.payout || b.amount * (b.multiplier || 1)).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-[#6f7b90]">-</span>
                  )}
                </div>
              </div>
            ))}

          {leftTab === 'MY' &&
            myBetsHistory.map((mb, idx) => (
              <div key={idx} className="grid grid-cols-4 px-2 py-1.5 text-xs font-mono items-center">
                <span className="text-[11px] text-[#98a3b8]">Round</span>
                <span className="text-right">KES {Number(mb.amount).toLocaleString()}</span>
                <span className="text-right font-bold">
                  {mb.status === 'WON' ? `${mb.multiplier}x` : '0x'}
                </span>
                <span className={`text-right font-bold ${mb.status === 'WON' ? 'text-[#2fd08a]' : 'text-[#dc1c34]'}`}>
                  {mb.status === 'WON' ? `+KES ${mb.payout.toLocaleString()}` : '-'}
                </span>
              </div>
            ))}

          {leftTab === 'TOP' && (
            <div className="p-2.5 space-y-2">
              <div className="p-2.5 rounded-xl bg-[#2a2113] border border-[#5c4620] text-xs">
                <div className="flex justify-between font-bold text-[#f0b45c]">
                  <span>🏆 StarPilot_99</span>
                  <span>142.50x</span>
                </div>
                <div className="flex justify-between text-[#98a3b8] mt-1 font-mono text-[11px]">
                  <span>Bet: KES 2,000</span>
                  <span className="text-[#2fd08a] font-bold">Won: KES 285,000</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#1c1730] border border-[#3d3163] text-xs">
                <div className="flex justify-between font-bold text-[#a78bfa]">
                  <span>🥈 AceLagos</span>
                  <span>58.20x</span>
                </div>
                <div className="flex justify-between text-[#98a3b8] mt-1 font-mono text-[11px]">
                  <span>Bet: KES 5,000</span>
                  <span className="text-[#2fd08a] font-bold">Won: KES 291,000</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Clean Spribe Brand Footer */}
        <div className="pt-2 border-t border-[#232733] flex items-center justify-between text-[11px] text-[#6f7b90] flex-shrink-0">
          <span className="text-[10px] text-[#98a3b8] font-mono tracking-wider">OFFICIAL GAME</span>
          <span className="text-[10px] text-[#6f7b90] font-mono">SPRIBE</span>
        </div>
      </div>

      {/* RIGHT MAIN ARENA: order-1 on mobile (TOP!), lg:order-2 on desktop (RIGHT!) */}
      <div className={`aviator-main order-1 lg:order-2 flex-1 flex flex-col lg:h-full gap-1 sm:gap-2 min-h-0 ${!isBetsExpanded ? 'aviator-bets-collapsed' : ''}`}>
        {/* TOP BAR — exactly like the live game: balance + menu get their own
            row, and the recent multipliers scroll on a separate strip below it.
            Sharing one line is what made the header look cramped/amateur. */}
        <div className="flex flex-col flex-shrink-0 select-none gap-0.5">
          {/* Row 1: Go Back (left) + balance (green, right) + three-line menu */}
          <div className="flex items-center justify-between gap-2 h-5 flex-shrink-0">
            {onNavigateHome && (
              <button
                onClick={() => {
                  sound.playChip();
                  onNavigateHome();
                }}
                aria-label="Home"
                className="flex items-center gap-1 text-[11px] font-bold text-[#98a3b8] hover:text-[#eef2f8] active:text-[#2fd08a] transition select-none"
              >
                <HomeIcon className="w-3.5 h-3.5" />
                <span>Home</span>
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto">
            <div className="font-mono font-black text-xs sm:text-sm text-[#2fd08a] tracking-tight whitespace-nowrap">
              {Number(balanceType === 'REAL' ? (user?.realBalance ?? 0) : (user?.demoBalance ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-[10px] font-sans font-bold text-[#98a3b8]">KES</span>
            </div>

            <button
              onClick={() => {
                sound.playChip();
                openMenu();
              }}
              aria-label="Open game menu"
              aria-expanded={isMobileMenuOpen}
              className="flex flex-col items-center justify-center gap-[3px] w-6 h-6 flex-shrink-0 active:opacity-60 transition"
            >
              <span className="block w-[15px] h-[1.5px] bg-[#c2cbda] rounded-full" />
              <span className="block w-[15px] h-[1.5px] bg-[#c2cbda] rounded-full" />
              <span className="block w-[15px] h-[1.5px] bg-[#c2cbda] rounded-full" />
            </button>
            </div>
          </div>

          {/* Row 2: recent multiplier history strip */}
          <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-0.5 px-0.5 no-scrollbar w-full min-w-0">
            {history.map((h, idx) => {
              const cp = Number(h.crashPoint || 1.0);
              const band = cp < 8 ? 'low' : cp < 20 ? 'medium' : 'high';

              return (
                <div
                  key={h.roundId || idx}
                  title={`Round ${h.roundId}`}
                  className={`text-[11px] sm:text-xs font-bold font-mono flex-shrink-0 whitespace-nowrap cursor-default select-none ${
                    band === 'low'
                      ? 'spribe-ribbon-low'
                      : band === 'medium'
                      ? 'spribe-ribbon-medium'
                      : 'spribe-ribbon-high'
                  }`}
                >
                  {cp.toFixed(2)}x
                </div>
              );
            })}
            {history.length > 0 && (
              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[#1f232d] text-[#98a3b8] text-[8px] leading-4 text-center tracking-tighter">
                •••
              </span>
            )}
          </div>
        </div>

        {/* Board: FUN MODE strip (demo only) stacked flush on top of the canvas,
            exactly like the live layout order. */}
        <div className="aviator-stage w-full flex flex-col flex-shrink-0 min-h-0 lg:flex-1 lg:min-h-[320px]">
          {balanceType === 'DEMO' && (
            <div className="aviator-fun-bar text-center select-none rounded-t-[14px] sm:rounded-t-[20px] flex-shrink-0">
              FUN MODE
            </div>
          )}

          {/* Flight Radar Canvas Visualizer: exact live ratio, no border/glow */}
          <div
            className={`aviator-arena relative w-full flex-1 min-h-0 aviator-arena-bg overflow-hidden flex items-center justify-center ${
              balanceType === 'DEMO'
                ? 'rounded-b-[14px] sm:rounded-b-[20px]'
                : 'rounded-[14px] sm:rounded-[20px]'
            }`}
          >
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full game-canvas z-0" />

          {/* Center Multiplier HUD */}
          <div className="relative z-10 text-center select-none pointer-events-none pt-[6%]">
            {gameState === 'COUNTDOWN' && (
              <div className="space-y-2 mt-4 sm:mt-10">
                <div className="text-[10px] sm:text-[11px] uppercase font-extrabold tracking-widest text-[#98a3b8] font-mono">
                  WAITING FOR NEXT ROUND
                </div>
                {/* Authentic Spribe Timer Bar */}
                <div className="w-40 sm:w-56 mx-auto bg-[#232733] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#dc1c34] h-full transition-all duration-100"
                    style={{ width: `${(timeLeft / 5.0) * 100}%` }}
                  />
                </div>
                <div className="text-lg sm:text-2xl font-black font-mono text-[#eef2f8]/90">
                  {timeLeft.toFixed(1)}s
                </div>
              </div>
            )}

            {gameState === 'FLYING' && (
              <div className="animate-in fade-in duration-100 relative flex items-center justify-center">
                <div className="aviator-multiplier relative">
                  {multiplier.toFixed(2)}
                  <span className="ml-0.5">x</span>
                </div>
              </div>
            )}

            {gameState === 'CRASHED' && (
              <div className="space-y-1 animate-in zoom-in-95 duration-100">
                {/* Live Spribe crash state: white callout, crimson multiplier. */}
                <div className="text-lg sm:text-2xl font-black text-white uppercase tracking-widest font-display">
                  FLEW AWAY!
                </div>
                <div className="aviator-crash-mult font-black font-mono text-[#e50539]">
                  {crashPoint.toFixed(2)}x
                </div>
              </div>
            )}
          </div>

          {/* Spribe Active Players Overlay Widget in bottom-right corner of radar */}
          <div className="absolute bottom-2 right-2 z-20 flex items-center bg-[#0b0d12]/85 backdrop-blur-xs px-2 py-0.5 rounded-full border border-[#232733] gap-1.5 pointer-events-none select-none">
            <div className="flex -space-x-1.5">
              <div className="w-3.5 h-3.5 rounded-full bg-[#dc1c34] border border-[#232733] text-[7px] flex items-center justify-center font-bold text-white">✈</div>
              <div className="w-3.5 h-3.5 rounded-full bg-[#2fd08a] border border-[#232733] text-[7px] flex items-center justify-center font-bold text-white">★</div>
              <div className="w-3.5 h-3.5 rounded-full bg-[#5cc0f2] border border-[#232733] text-[7px] flex items-center justify-center font-bold text-white">●</div>
            </div>
            <span className="text-[10px] font-mono font-black text-[#c2cbda]">
              {Math.max(18, activeBets.length || 65)}
            </span>
          </div>
          </div>
        </div>

        {/* DUAL BETTING BOARDS — side by side on every screen size, like the live game */}
        <div className="aviator-boards grid grid-cols-2 gap-1.5 sm:gap-2 flex-shrink-0">
          {/* PANEL 1 */}
          <div className="aviator-bet-panel bg-[#1b1c1e] rounded-xl sm:rounded-2xl p-1.5 sm:p-2.5">
            {/* Bet / Auto Segmented Toggle */}
            <div className="aviator-bet-tabs flex items-center justify-between mb-1">
              <div className="flex bg-[#141516] p-0.5 rounded-full border-[4px] border-[#141516]">
                <button
                  onClick={() => setBet1Mode('BET')}
                  className={`flex-1 px-2.5 sm:px-3 py-0.5 text-[12px] font-normal rounded-full transition ${
                    bet1Mode === 'BET' ? 'bg-[#2c2d30] text-[#ebebeb]' : 'text-[#a3a3a3]'
                  }`}
                >
                  Bet
                </button>
                <button
                  onClick={() => setBet1Mode('AUTO')}
                  className={`flex-1 px-2.5 sm:px-3 py-0.5 text-[12px] font-normal rounded-full transition ${
                    bet1Mode === 'AUTO' ? 'bg-[#2c2d30] text-[#ebebeb]' : 'text-[#a3a3a3]'
                  }`}
                >
                  Auto
                </button>
              </div>

              {bet1Mode === 'AUTO' && (
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] sm:text-[11px] text-[#98a3b8] flex items-center gap-1 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bet1AutoCashout}
                      onChange={(e) => setBet1AutoCashout(e.target.checked)}
                      className="rounded bg-[#1f232d] border-[#2c313d] text-[#dc1c34] focus:ring-0"
                    />
                    Auto Cash Out
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.01"
                    value={bet1Target}
                    onChange={(e) => setBet1Target(e.target.value)}
                    className="w-14 sm:w-16 bg-[#0e1015] border border-[#232733] rounded-lg px-1.5 py-0.5 text-xs font-mono font-bold text-center text-[#eef2f8]"
                  />
                </div>
              )}
            </div>

            <div className="aviator-bet-controls flex gap-1.5 sm:gap-2">
              <div className="flex-1 min-w-0 space-y-1">
                {/* Amount row: [−] [10.00] [+] */}
                <div className="aviator-amount-row flex items-center gap-1">
                  <button
                    onClick={() => adjustBet(1, -stepFor(bet1Amount))}
                    disabled={bet1Placed !== null}
                    className="w-6 h-6 shrink-0 rounded-full bg-[#2c2d30] hover:bg-[#3a3b3f] text-[#fafafa] flex items-center justify-center transition disabled:opacity-50"
                    aria-label="Decrease bet"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    disabled={bet1Placed !== null}
                    min={MIN_AVIATOR_BET}
                    max={MAX_AVIATOR_BET}
                    value={bet1Amount}
                    onChange={(e) => setBet1Amount(e.target.value)}
                    onBlur={() => setBet1Amount((value) => normalizeBetAmount(value))}
                    className="flex-1 min-w-0 bg-transparent text-center text-[17px] font-medium text-[#fafafa] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => adjustBet(1, stepFor(bet1Amount))}
                    disabled={bet1Placed !== null}
                    className="w-6 h-6 shrink-0 rounded-full bg-[#2c2d30] hover:bg-[#3a3b3f] text-[#fafafa] flex items-center justify-center transition disabled:opacity-50"
                    aria-label="Increase bet"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* Quick Chips: flat 2 x 2 grid under the amount */}
                <div className="aviator-quick-chips grid grid-cols-2 gap-x-1">
                  {AVIATOR_QUICK_BETS.map((val) => (
                    <button
                      key={val}
                      onClick={() => setBet1Amount(val.toFixed(2))}
                      disabled={bet1Placed !== null}
                      className="spribe-chip text-[13px] py-0.5"
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Giant 3D Action Button 1 */}
              <div className="aviator-bet-action w-32 xs:w-36 sm:w-44 flex flex-col justify-stretch">
                {bet1Placed ? (
                  gameState === 'FLYING' ? (
                    <button
                      onClick={() => handleCashout(1)}
                      className="h-full rounded-xl sm:rounded-2xl btn-spribe-orange flex flex-col items-center justify-center p-1 sm:p-1.5 shadow-card"
                    >
                      <span className="text-[20px] sm:text-[22px] font-normal leading-tight">Cash out</span>
                      <span className="text-[18px] sm:text-[22px] font-normal leading-tight">
                        KES {(Number(bet1Amount) * multiplier).toFixed(2)}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCancelBet(1)}
                      className="h-full rounded-xl sm:rounded-2xl btn-spribe-red flex flex-col items-center justify-center p-1 sm:p-1.5 shadow-xl"
                    >
                      <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider opacity-90">WAITING</span>
                      <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider font-display">CANCEL</span>
                    </button>
                  )
                ) : bet1CashedOut ? (
                  <div className="h-full rounded-xl sm:rounded-2xl bg-[#0e2a1e] border border-[#1f5c41] text-[#2fd08a] font-bold flex flex-col items-center justify-center p-1 sm:p-1.5">
                    <span className="text-[9px] uppercase tracking-wider">CASHED OUT</span>
                    <span className="text-xs sm:text-sm font-mono font-black">
                      KES {Number(bet1CashedOut.payout).toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => handlePlaceBet(1)}
                    disabled={gameState !== 'COUNTDOWN'}
                    className={`h-full rounded-xl sm:rounded-2xl flex flex-col items-center justify-center p-1 sm:p-1.5 ${
                      gameState === 'COUNTDOWN'
                        ? 'btn-spribe-green text-[#eef2f8] cursor-pointer'
                        : 'bg-[#1f232d] text-[#6f7b90] cursor-not-allowed border border-[#232733]'
                    }`}
                  >
                    <span className="text-[19px] sm:text-[22px] font-normal leading-tight">
                      {gameState === 'COUNTDOWN' ? 'Bet' : 'Waiting'}
                    </span>
                    <span className="text-[17px] sm:text-[21px] font-normal leading-tight">
                      {formatAmount(bet1Amount)} KES
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* PANEL 2 */}
          <div className="aviator-bet-panel bg-[#1b1c1e] rounded-xl sm:rounded-2xl p-1.5 sm:p-2.5">
            <div className="aviator-bet-tabs flex items-center justify-between mb-1">
              <div className="flex bg-[#141516] p-0.5 rounded-full border-[4px] border-[#141516]">
                <button
                  onClick={() => setBet2Mode('BET')}
                  className={`flex-1 px-2.5 sm:px-3 py-0.5 text-[12px] font-normal rounded-full transition ${
                    bet2Mode === 'BET' ? 'bg-[#2c2d30] text-[#ebebeb]' : 'text-[#a3a3a3]'
                  }`}
                >
                  Bet
                </button>
                <button
                  onClick={() => setBet2Mode('AUTO')}
                  className={`flex-1 px-2.5 sm:px-3 py-0.5 text-[12px] font-normal rounded-full transition ${
                    bet2Mode === 'AUTO' ? 'bg-[#2c2d30] text-[#ebebeb]' : 'text-[#a3a3a3]'
                  }`}
                >
                  Auto
                </button>
              </div>

              {bet2Mode === 'AUTO' && (
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] sm:text-[11px] text-[#98a3b8] flex items-center gap-1 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bet2AutoCashout}
                      onChange={(e) => setBet2AutoCashout(e.target.checked)}
                      className="rounded bg-[#1f232d] border-[#2c313d] text-[#dc1c34] focus:ring-0"
                    />
                    Auto Cash Out
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.01"
                    value={bet2Target}
                    onChange={(e) => setBet2Target(e.target.value)}
                    className="w-14 sm:w-16 bg-[#0e1015] border border-[#232733] rounded-lg px-1.5 py-0.5 text-xs font-mono font-bold text-center text-[#eef2f8]"
                  />
                </div>
              )}
            </div>

            <div className="aviator-bet-controls flex gap-1.5 sm:gap-2">
              <div className="flex-1 min-w-0 space-y-1">
                {/* Amount row: [−] [10.00] [+] */}
                <div className="aviator-amount-row flex items-center gap-1">
                  <button
                    onClick={() => adjustBet(2, -stepFor(bet2Amount))}
                    disabled={bet2Placed !== null}
                    className="w-6 h-6 shrink-0 rounded-full bg-[#2c2d30] hover:bg-[#3a3b3f] text-[#fafafa] flex items-center justify-center transition disabled:opacity-50"
                    aria-label="Decrease bet"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    disabled={bet2Placed !== null}
                    min={MIN_AVIATOR_BET}
                    max={MAX_AVIATOR_BET}
                    value={bet2Amount}
                    onChange={(e) => setBet2Amount(e.target.value)}
                    onBlur={() => setBet2Amount((value) => normalizeBetAmount(value))}
                    className="flex-1 min-w-0 bg-transparent text-center text-[17px] font-medium text-[#fafafa] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => adjustBet(2, stepFor(bet2Amount))}
                    disabled={bet2Placed !== null}
                    className="w-6 h-6 shrink-0 rounded-full bg-[#2c2d30] hover:bg-[#3a3b3f] text-[#fafafa] flex items-center justify-center transition disabled:opacity-50"
                    aria-label="Increase bet"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="aviator-quick-chips grid grid-cols-2 gap-x-1">
                  {AVIATOR_QUICK_BETS.map((val) => (
                    <button
                      key={val}
                      onClick={() => setBet2Amount(val.toFixed(2))}
                      disabled={bet2Placed !== null}
                      className="spribe-chip text-[13px] py-0.5"
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Giant 3D Action Button 2 */}
              <div className="aviator-bet-action w-32 xs:w-36 sm:w-44 flex flex-col justify-stretch">
                {bet2Placed ? (
                  gameState === 'FLYING' ? (
                    <button
                      onClick={() => handleCashout(2)}
                      className="h-full rounded-xl sm:rounded-2xl btn-spribe-orange flex flex-col items-center justify-center p-1 sm:p-1.5 shadow-card"
                    >
                      <span className="text-[20px] sm:text-[22px] font-normal leading-tight">Cash out</span>
                      <span className="text-[18px] sm:text-[22px] font-normal leading-tight">
                        KES {(Number(bet2Amount) * multiplier).toFixed(2)}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCancelBet(2)}
                      className="h-full rounded-xl sm:rounded-2xl btn-spribe-red flex flex-col items-center justify-center p-1 sm:p-1.5 shadow-xl"
                    >
                      <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider opacity-90">WAITING</span>
                      <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider font-display">CANCEL</span>
                    </button>
                  )
                ) : bet2CashedOut ? (
                  <div className="h-full rounded-xl sm:rounded-2xl bg-[#0e2a1e] border border-[#1f5c41] text-[#2fd08a] font-bold flex flex-col items-center justify-center p-1 sm:p-1.5">
                    <span className="text-[9px] uppercase tracking-wider">CASHED OUT</span>
                    <span className="text-xs sm:text-sm font-mono font-black">
                      KES {Number(bet2CashedOut.payout).toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => handlePlaceBet(2)}
                    disabled={gameState !== 'COUNTDOWN'}
                    className={`h-full rounded-xl sm:rounded-2xl flex flex-col items-center justify-center p-1 sm:p-1.5 ${
                      gameState === 'COUNTDOWN'
                        ? 'btn-spribe-green text-[#eef2f8] cursor-pointer'
                        : 'bg-[#1f232d] text-[#6f7b90] cursor-not-allowed border border-[#232733]'
                    }`}
                  >
                    <span className="text-[19px] sm:text-[22px] font-normal leading-tight">
                      {gameState === 'COUNTDOWN' ? 'Bet' : 'Waiting'}
                    </span>
                    <span className="text-[17px] sm:text-[21px] font-normal leading-tight">
                      {formatAmount(bet2Amount)} KES
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* MOBILE BETS DRAWER — expanded it owns the leftover height (a real,
            large live-bets panel); collapsed it becomes a single 46px bar and
            the arena grows to take the freed space (no dead gap). */}
        <div
          className={`aviator-bets-card lg:hidden w-full bg-[#0e1015] rounded-xl sm:rounded-2xl flex flex-col min-h-0 overflow-hidden transition-all duration-300 ${
            isBetsExpanded ? 'flex-1' : 'flex-none'
          }`}
        >
          {/* Header Bar - Click to Toggle */}
          <div
            onClick={() => setIsBetsExpanded(!isBetsExpanded)}
            className="flex items-center justify-between px-2 sm:px-3 py-1 sm:py-1.5 cursor-pointer transition flex-shrink-0 select-none"
          >
            {/* Tabs: All Bets | Previous | Top */}
            <div className="flex bg-[#12151d] p-0.5 rounded-full" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setLeftTab('ALL'); setIsBetsExpanded(true); }}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1 ${
                  leftTab === 'ALL' ? 'bg-[#2c2d30] text-[#eef2f8]' : 'text-[#98a3b8] hover:text-[#c2cbda]'
                }`}
              >
                <span>All Bets</span>
                <span className="text-[9px] bg-[#2e1218] text-[#dc1c34] px-1 py-0.2 rounded-full font-mono">
                  {activeBets.length}
                </span>
              </button>
              <button
                onClick={() => { setLeftTab('MY'); setIsBetsExpanded(true); }}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition ${
                  leftTab === 'MY' ? 'bg-[#2c2d30] text-[#eef2f8]' : 'text-[#98a3b8] hover:text-[#c2cbda]'
                }`}
              >
                Previous
              </button>
              <button
                onClick={() => { setLeftTab('TOP'); setIsBetsExpanded(true); }}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1 ${
                  leftTab === 'TOP' ? 'bg-[#2c2d30] text-[#eef2f8]' : 'text-[#98a3b8] hover:text-[#c2cbda]'
                }`}
              >
                <Trophy className="w-3 h-3 text-[#f0b45c]" />
                <span>Top</span>
              </button>
            </div>

            {/* Right Summary: total win + expand chevron */}
            <div className="flex items-center gap-2">
              <div className="text-right">
                <span className="text-[9px] text-[#6f7b90] uppercase tracking-wider block">Total win</span>
                <span className="text-xs font-mono font-black text-[#eef2f8]">
                  KES {activeBets.reduce((acc, b) => acc + (b.cashedOut ? Number(b.payout || b.amount * (b.multiplier || 1)) : 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setIsBetsExpanded(!isBetsExpanded); }}
                title={isBetsExpanded ? 'Collapse Bets' : 'Expand Bets'}
                className="p-1 rounded-lg bg-[#1f232d] text-[#c2cbda] hover:text-[#eef2f8] transition"
                aria-label={isBetsExpanded ? 'Collapse bets' : 'Expand bets'}
              >
                {isBetsExpanded ? <ChevronDown className="w-4 h-4 text-[#dc1c34]" /> : <ChevronUp className="w-4 h-4 text-[#2fd08a]" />}
              </button>
            </div>
          </div>

          {/* Bets content is ALWAYS rendered — collapsing shrinks it to a short
              live preview instead of hiding it behind an empty header. */}
          <div
            className={`flex flex-col min-h-0 overflow-hidden ${
              isBetsExpanded ? 'flex-1 p-2' : 'flex-none px-2 pb-1.5'
            }`}
          >
            {/* Table Column Headers (expanded only) */}
            {isBetsExpanded && (
              <div className="grid grid-cols-4 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6f7b90] border-b border-[#232733] flex-shrink-0">
                <span>User</span>
                <span className="text-right">Bet (KES)</span>
                <span className="text-right">Mult</span>
                <span className="text-right">Cash Out</span>
              </div>
            )}

            {/* Table Body Rows */}
            <div
              className={`overflow-y-auto divide-y divide-[#1f232d] pr-1 no-scrollbar min-h-0 ${
                isBetsExpanded ? 'flex-1 mt-1' : 'h-[84px] mt-0.5'
              }`}
            >
                {leftTab === 'ALL' &&
                  activeBets.map((b, idx) => (
                    <div
                      key={b.betId || idx}
                      className={`grid grid-cols-4 px-2 py-1.5 text-xs font-mono items-center transition ${
                        b.cashedOut
                          ? 'bg-[#0e2a1e] text-[#4ade80] font-bold'
                          : 'text-[#c2cbda] hover:bg-[#07080c]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <UserIcon className="w-3 h-3 text-[#6f7b90] flex-shrink-0" />
                        <span className="truncate text-[11px]">{b.username || 'Pilot'}</span>
                      </div>
                      <div className="text-right text-[#c2cbda]">
                        {Number(b.amount || 0).toLocaleString()}
                      </div>
                      <div className="text-right">
                        {b.cashedOut ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#0e2a1e] text-[#2fd08a] border border-[#1f5c41]">
                            {Number(b.multiplier || b.cashedOutMultiplier || 0).toFixed(2)}x
                          </span>
                        ) : (
                          <span className="text-[#6f7b90]">-</span>
                        )}
                      </div>
                      <div className="text-right font-bold">
                        {b.cashedOut ? (
                          <span className="text-[#2fd08a]">
                            KES {Number(b.payout || b.amount * (b.multiplier || 1)).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[#6f7b90]">-</span>
                        )}
                      </div>
                    </div>
                  ))}

                {leftTab === 'MY' &&
                  myBetsHistory.map((mb, idx) => (
                    <div key={idx} className="grid grid-cols-4 px-2 py-1.5 text-xs font-mono items-center">
                      <span className="text-[11px] text-[#98a3b8]">Round</span>
                      <span className="text-right">KES {Number(mb.amount).toLocaleString()}</span>
                      <span className="text-right font-bold">
                        {mb.status === 'WON' ? `${mb.multiplier}x` : '0x'}
                      </span>
                      <span className={`text-right font-bold ${mb.status === 'WON' ? 'text-[#2fd08a]' : 'text-[#dc1c34]'}`}>
                        {mb.status === 'WON' ? `+KES ${mb.payout.toLocaleString()}` : '-'}
                      </span>
                    </div>
                  ))}

                {leftTab === 'TOP' && (
                  <div className="p-2.5 space-y-2">
                    <div className="p-2.5 rounded-xl bg-[#2a2113] border border-[#5c4620] text-xs">
                      <div className="flex justify-between font-bold text-[#f0b45c]">
                        <span>🏆 StarPilot_99</span>
                        <span>142.50x</span>
                      </div>
                      <div className="flex justify-between text-[#98a3b8] mt-1 font-mono text-[11px]">
                        <span>Bet: KES 2,000</span>
                        <span className="text-[#2fd08a] font-bold">Won: KES 285,000</span>
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#1c1730] border border-[#3d3163] text-xs">
                      <div className="flex justify-between font-bold text-[#a78bfa]">
                        <span>🥈 AceLagos</span>
                        <span>58.20x</span>
                      </div>
                      <div className="flex justify-between text-[#98a3b8] mt-1 font-mono text-[11px]">
                        <span>Bet: KES 5,000</span>
                        <span className="text-[#2fd08a] font-bold">Won: KES 291,000</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Clean Brand Footer */}
              <div className={`pt-1.5 border-t border-[#232733] flex items-center justify-between text-[10px] text-[#6f7b90] flex-shrink-0 ${isBetsExpanded ? '' : 'hidden'}`}>
                <span className="text-[10px] text-[#98a3b8] font-mono tracking-wider">OFFICIAL GAME</span>
                <span className="font-mono">SPRIBE</span>
              </div>
            </div>
        </div>
      </div>

      {/* How to Play Modal */}
      {showHowToPlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0e1015] border border-[#232733] rounded-3xl w-full max-w-md p-6 shadow-card relative">
            <button
              onClick={() => setShowHowToPlay(false)}
              className="absolute top-4 right-4 text-[#98a3b8] hover:text-[#eef2f8]"
            >
              ✕
            </button>
            <h3 className="text-lg font-black text-[#dc1c34] uppercase font-display mb-3">
              How to Play Aviator
            </h3>
            <div className="space-y-3 text-xs text-[#c2cbda] leading-relaxed">
              <div className="p-3 bg-[#12151d] rounded-xl border border-[#232733]">
                <strong className="text-[#eef2f8] block mb-1">1. Place Your Bets</strong>
                Place one or two bets during the 5-second countdown window before the plane takes off. You can cancel your bet at any time before takeoff.
              </div>
              <div className="p-3 bg-[#12151d] rounded-xl border border-[#232733]">
                <strong className="text-[#eef2f8] block mb-1">2. Watch the Multiplier Rise</strong>
                As the plane ascends, the win multiplier starts at 1.00x and accelerates higher and higher.
              </div>
              <div className="p-3 bg-[#12151d] rounded-xl border border-[#232733]">
                <strong className="text-[#eef2f8] block mb-1">3. Cash Out Before it Flew Away!</strong>
                Hit <strong>CASH OUT</strong> anytime to lock in your profit. If the plane flies away before you cash out, the bet is lost.
              </div>
              <div className="p-3 bg-[#12151d] rounded-xl border border-[#232733]">
                <strong className="text-[#eef2f8] block mb-1">4. Provably Fair Verification</strong>
                Every round outcome is cryptographically generated using HMAC-SHA256 with server and client seeds. Click any multiplier in the top ribbon to verify.
              </div>
            </div>
            <button
              onClick={() => setShowHowToPlay(false)}
              className="w-full mt-4 py-2.5 rounded-xl bg-[#dc1c34] hover:bg-[#f02840] text-white font-bold text-xs uppercase"
            >
              Got it, let's fly!
            </button>
          </div>
        </div>
      )}

      {/* Spribe Mobile Menu Slideout Modal */}
      {isMobileMenuOpen && (
        <div
          className={`aviator-menu-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-end p-2.5 ${
            isMenuClosing ? 'is-closing' : ''
          }`}
          onClick={closeMenu}
        >
          <div
            className="aviator-menu-panel w-64 max-w-[calc(100vw-16px)] rounded-2xl border border-[#232733] bg-[#0e1015] p-2 text-[#c2cbda] shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — same avatar/username treatment as the home account menu */}
            <div className="flex items-center justify-between border-b border-[#1f232d] px-2 py-3 mb-1">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1a1e27] text-xs font-bold text-[#98a3b8]" aria-hidden="true">
                  {user?.username ? user.username.slice(0, 2).toUpperCase() : 'PI'}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[#eef2f8]">{user?.username || 'Pilot'}</div>
                  <div className="text-[10px] text-[#98a3b8]">
                    {balanceType === 'REAL' ? 'Real Account' : 'Fun Mode'}
                  </div>
                </div>
              </div>
              <button onClick={closeMenu} className="aviator-menu-close" aria-label="Close menu" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sound & Music — same switch component as the home menu */}
            <div className="border-b border-[#1f232d] py-1 mb-1">
              <div className="flex h-10 items-center justify-between px-2">
                <span className="flex items-center gap-2.5 text-xs font-medium text-[#c2cbda]">
                  {soundMuted ? <VolumeX className="h-4 w-4 text-[#6f7b90]" /> : <Volume2 className="h-4 w-4 text-[#6f7b90]" />}
                  Game sounds
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Game sounds"
                  aria-checked={!soundMuted}
                  data-on={!soundMuted}
                  onClick={() => {
                    const muted = sound.toggleMute();
                    setSoundMuted(muted);
                    setMusicOn(sound.getMusicEnabled());
                  }}
                  className="switch-track focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dc1c34]"
                >
                  <span className="switch-thumb" />
                </button>
              </div>
              <div className="flex h-10 items-center justify-between px-2">
                <span className="flex items-center gap-2.5 text-xs font-medium text-[#c2cbda]">
                  <Music className="h-4 w-4 text-[#6f7b90]" />
                  Background music
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Background music"
                  aria-checked={musicOn}
                  data-on={musicOn}
                  onClick={() => {
                    const enabled = sound.toggleMusic();
                    setMusicOn(enabled);
                  }}
                  className="switch-track focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dc1c34]"
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </div>

            {/* Account type — uses the same segmented control as the top bar */}
            {setBalanceType && (
              <div className="border-b border-[#1f232d] py-1 mb-1">
                <div className="flex h-10 items-center justify-between gap-2 px-2">
                  <span className="flex items-center gap-2.5 text-xs font-medium text-[#c2cbda]">
                    <RefreshCw className="h-4 w-4 text-[#6f7b90]" />
                    Account
                  </span>
                  <div className="segmented p-0.5">
                    <button
                      onClick={() => { sound.playChip(); setBalanceType('DEMO'); }}
                      aria-selected={balanceType === 'DEMO'}
                      className={balanceType === 'DEMO' ? 'is-brand' : ''}
                    >
                      Fun
                    </button>
                    <button
                      onClick={() => { sound.playChip(); setBalanceType('REAL'); }}
                      aria-selected={balanceType === 'REAL'}
                      className={balanceType === 'REAL' ? 'is-brand' : ''}
                    >
                      Real
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick actions — plain list rows, not coloured buttons */}
            <div className="py-1 mb-1 border-b border-[#1f232d]">
              {onOpenDeposit && (
                <button
                  type="button"
                  onClick={() => closeMenuThen(onOpenDeposit)}
                  className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8]"
                >
                  <Plus className="h-4 w-4 text-[#6f7b90]" />
                  Deposit
                </button>
              )}
              {onOpenWithdraw && (
                <button
                  type="button"
                  onClick={() => closeMenuThen(onOpenWithdraw)}
                  className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8]"
                >
                  <ArrowUpRight className="h-4 w-4 text-[#6f7b90]" />
                  Withdraw
                </button>
              )}
              {balanceType === 'DEMO' && onRefillDemo && (
                <button
                  type="button"
                  onClick={() => { sound.playCashout(); onRefillDemo(); }}
                  className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8]"
                >
                  <RefreshCw className="h-4 w-4 text-[#6f7b90]" />
                  Refill demo
                </button>
              )}
            </div>

            {/* Navigation & info — same rows as the home account menu */}
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => { sound.playChip(); closeMenuThen(() => setShowHowToPlay(true)); }}
                className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8]"
              >
                <HelpCircle className="h-4 w-4 text-[#6f7b90]" />
                How to play
              </button>
              {onOpenFairness && (
                <button
                  type="button"
                  onClick={() => { sound.playChip(); closeMenuThen(onOpenFairness); }}
                  className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8]"
                >
                  <ShieldCheck className="h-4 w-4 text-[#6f7b90]" />
                  Fairness
                </button>
              )}
              <button
                type="button"
                onClick={() => { sound.playChip(); closeMenuThen(onNavigateHome); }}
                className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-xs font-medium text-[#c2cbda] transition-colors hover:bg-[#07080c] hover:text-[#eef2f8]"
              >
                <HomeIcon className="h-4 w-4 text-[#6f7b90]" />
                Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
