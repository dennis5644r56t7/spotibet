import { Server as SocketIOServer } from 'socket.io';
import { ProvablyFair } from '../../utils/provably-fair';
import { prisma } from '../../config/db';
import { WalletService } from '../../services/wallet.service';
import {
  RoundPool,
  HousePoolService,
  AviatorRoundSummary,
} from '../../services/house-pool.service';

export type RoundState = 'COUNTDOWN' | 'FLYING' | 'CRASHED';

export interface ActiveBet {
  betId: string;
  userId: string;
  username: string;
  amount: number;
  balanceType: 'REAL' | 'DEMO';
  autoCashout?: number;
  cashedOut: boolean;
  cashedOutMultiplier?: number;
  payout?: number;
  /** Lifetime REAL deposits at bet time — the basis for the payout ceiling. */
  depositTotal: number;
  /** Maximum payout this bet can ever produce (deposit-based exposure limit). */
  maxPayout: number;
}

export interface CrashHistoryItem {
  roundId: string;
  crashPoint: number;
  serverSeedHash: string;
  serverSeed?: string;
  clientSeed: string;
  nonce: number;
  createdAt: Date;
}

export interface AviatorRoundResult {
  roomId: string;
  roundId: string;
  roundNumber: number;
  reachedMultiplier: number;
  targetMultiplier: number;
  endReason: 'NATURAL' | 'RISK_STOP';
  stoppedEarly: boolean;
  staked: number;
  paidOut: number;
  houseTake: number;
  players: number;
  at: string;
}

type CrashReason = 'NATURAL' | 'POOL_GUARD';

/** A user's maximum single payout is a multiple of their lifetime deposits. */
const MAX_PAYOUT_MULTIPLE_OF_DEPOSIT = Number(process.env.AVIATOR_MAX_PAYOUT_MULTIPLE || 10);
/** End a flight early when worst-case cashouts exceed this multiple of the distributable pool. */
const RISK_STOP_RATIO = Number(process.env.AVIATOR_RISK_STOP_RATIO || 1.5);

/**
 * Aviator multiplayer crash game with a HOUSE POOL GUARD.
 *
 * Every round:
 *  1. All bets placed during the countdown form the round pool.
 *  2. The house cut (rake) of the pool is reserved off the top — untouchable.
 *  3. The distributable pool (1 - rake) × staked pays cashouts.
 *  4. The flight ends the moment cashed payouts would breach the
 *     distributable pool, so the house take is GUARANTEED on every round.
 */
export class AviatorEngine {
  private io: SocketIOServer;
  /** Socket.IO room this engine owns. Every broadcast is scoped to it. */
  public readonly roomId: string;
  public readonly roomName: string;
  public readonly maxPlayers: number;
  private state: RoundState = 'COUNTDOWN';
  private currentRoundId: string = '';
  private currentRoundDbId: string = ''; // real GameRound.id in DB
  private currentMultiplier: number = 1.00;
  private crashPoint: number = 1.00;
  private effectiveCrashPoint: number = 1.00; // actual crash (may end early via pool guard)
  private guardTriggered: boolean = false;
  private crashing: boolean = false;
  private serverSeed: string = '';
  private serverSeedHash: string = '';
  private clientSeed: string = 'public_global_aviator_seed';
  private nonce: number = 1;
  private flightStartTime: number = 0;
  private countdownTimer: NodeJS.Timeout | null = null;
  private flightLoopInterval: NodeJS.Timeout | null = null;
  private exposureInterval: NodeJS.Timeout | null = null;
  private activeBets: Map<string, ActiveBet> = new Map(); // betId -> ActiveBet
  private roundPools: { REAL: RoundPool; DEMO: RoundPool } = {
    REAL: new RoundPool(),
    DEMO: new RoundPool(),
  };
  private history: CrashHistoryItem[] = [];
  private roundResults: AviatorRoundResult[] = [];

  constructor(io: SocketIOServer, roomId = 'default', roomName = 'Main', maxPlayers = 1000) {
    this.io = io;
    this.roomId = roomId;
    this.roomName = roomName;
    this.maxPlayers = maxPlayers;
    this.initialize();
  }

  private async initialize() {
    console.log('🚀 Initializing Aviator Game Engine...');
    // Seed some initial dummy history for smooth UI display on fresh start
    this.history = [
      { roundId: 'init-1', crashPoint: 1.45, serverSeedHash: 'abc1', clientSeed: 'seed', nonce: 1, createdAt: new Date() },
      { roundId: 'init-2', crashPoint: 2.82, serverSeedHash: 'abc2', clientSeed: 'seed', nonce: 2, createdAt: new Date() },
      { roundId: 'init-3', crashPoint: 1.15, serverSeedHash: 'abc3', clientSeed: 'seed', nonce: 3, createdAt: new Date() },
      { roundId: 'init-4', crashPoint: 14.20, serverSeedHash: 'abc4', clientSeed: 'seed', nonce: 4, createdAt: new Date() },
      { roundId: 'init-5', crashPoint: 3.65, serverSeedHash: 'abc5', clientSeed: 'seed', nonce: 5, createdAt: new Date() },
      { roundId: 'init-6', crashPoint: 1.02, serverSeedHash: 'abc6', clientSeed: 'seed', nonce: 6, createdAt: new Date() },
      { roundId: 'init-7', crashPoint: 5.40, serverSeedHash: 'abc7', clientSeed: 'seed', nonce: 7, createdAt: new Date() },
    ];
    this.startCountdownPhase();
  }

  /**
   * Phase 1: Countdown (5 seconds betting window)
   */
  private async startCountdownPhase() {
    this.state = 'COUNTDOWN';
    this.currentMultiplier = 1.00;
    this.activeBets.clear();
    this.crashing = false;
    this.guardTriggered = false;
    this.roundPools = { REAL: new RoundPool(), DEMO: new RoundPool() };
    this.nonce++;

    // Cryptographic Provably Fair Seeds
    this.serverSeed = ProvablyFair.generateServerSeed();
    this.serverSeedHash = ProvablyFair.hashServerSeed(this.serverSeed);
    this.crashPoint = ProvablyFair.calculateCrashPoint(this.serverSeed, this.clientSeed, this.nonce);
    this.currentRoundId = `round-${Date.now()}-${this.nonce}`;

    // Persist a GameRound row so Aviator bets can reference a valid FK
    try {
      const round = await prisma.gameRound.create({
        data: {
          gameType: 'AVIATOR',
          serverSeed: this.serverSeed,
          serverSeedHash: this.serverSeedHash,
          clientSeed: this.clientSeed,
          nonce: this.nonce,
          crashPoint: this.crashPoint,
          status: 'WAITING',
        },
      });
      this.currentRoundDbId = round.id;
    } catch (err) {
      console.error('[Aviator] Failed to persist GameRound:', err);
      this.currentRoundDbId = '';
    }

    console.log(`[Aviator] New Round ${this.currentRoundId} prepared. Target crash: ${this.crashPoint.toFixed(2)}x`);

    let timeLeft = 5.0;
    const intervalMs = 100;

    this.countdownTimer = setInterval(() => {
      timeLeft = Math.max(0, timeLeft - 0.1);

      this.io.to(this.roomId).emit('aviator:countdown', {
        roundId: this.currentRoundId,
        serverSeedHash: this.serverSeedHash,
        timeLeft: parseFloat(timeLeft.toFixed(1)),
        betsCount: this.activeBets.size,
        pool: this.roundPoolSnapshot(),
      });

      if (timeLeft <= 0) {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.startFlyingPhase();
      }
    }, intervalMs);
  }

  /**
   * Phase 2: Flying (Multiplier takes off at 60 FPS / broadcast at 50ms)
   */
  private startFlyingPhase() {
    this.state = 'FLYING';
    this.flightStartTime = Date.now();
    this.currentMultiplier = 1.00;

    this.io.to(this.roomId).emit('aviator:takeoff', {
      roundId: this.currentRoundId,
      serverSeedHash: this.serverSeedHash,
      activeBets: Array.from(this.activeBets.values()).map((b) => this.publicBet(b)),
      pool: this.roundPoolSnapshot(),
    });
    this.broadcastExposure();

    // 50ms tick rate for smooth multiplier progression
    this.flightLoopInterval = setInterval(() => {
      const elapsedSeconds = (Date.now() - this.flightStartTime) / 1000;

      // Realistic Aviator exponential flight curve
      // Multiplier grows exponentially over time
      const calculatedMultiplier = parseFloat(
        (1.0 + 0.06 * elapsedSeconds + 0.05 * Math.pow(elapsedSeconds, 1.8)).toFixed(2)
      );

      this.currentMultiplier = Math.max(1.00, calculatedMultiplier);

      // Check auto-cashouts (each goes through the same pool guard)
      this.checkAutoCashouts(this.currentMultiplier);

      // ── HOUSE POOL GUARD: know when to stop ────────────────────────────
      // End the flight before cashed payouts can breach the distributable
      // pool, so the house cut of this round is never touched.
      if (this.shouldPoolGuardStop()) {
        this.endFlight('POOL_GUARD');
        return;
      }

      // Broadcast tick to all connected players
      this.io.to(this.roomId).emit('aviator:tick', {
        roundId: this.currentRoundId,
        multiplier: this.currentMultiplier,
        elapsed: elapsedSeconds,
        pool: this.roundPoolSnapshot(),
      });

      // Check if crash threshold reached
      if (this.currentMultiplier >= this.crashPoint) {
        this.endFlight('NATURAL');
      }
    }, 50);

    // Live exposure board at 4Hz — each player's potential cashout at the
    // current multiplier, who has cashed out, and the room's remaining funds.
    this.exposureInterval = setInterval(() => this.broadcastExposure(), 250);
  }

  /** Broadcast the room's real-time risk/exposure snapshot. */
  private broadcastExposure() {
    const total = this.roundPoolSnapshot().total;
    const users = Array.from(this.activeBets.values()).map((b) => ({
      betId: b.betId,
      username: b.username,
      amount: b.amount,
      cashedOut: b.cashedOut,
      payout: b.cashedOut ? b.payout || 0 : 0,
      potential: b.cashedOut ? 0 : parseFloat((b.amount * this.currentMultiplier).toFixed(2)),
      depositTotal: b.depositTotal,
      maxPayout: b.maxPayout,
    }));
    const atRisk = users.reduce((s, u) => s + u.potential, 0);
    // Admin-only risk telemetry — never broadcast to players in the room.
    this.io.to('admins').emit('aviator:exposure', {
      roomId: this.roomId,
      multiplier: this.currentMultiplier,
      staked: total.staked,
      paidOut: total.paidOut,
      distributable: total.distributable,
      remaining: total.remaining,
      atRisk: parseFloat(atRisk.toFixed(2)),
      riskLimit: parseFloat((total.distributable * RISK_STOP_RATIO).toFixed(2)),
      players: users,
    });
  }

  /** Fields safe to broadcast to players — no deposit or limit details. */
  private publicBet(b: ActiveBet) {
    return {
      betId: b.betId,
      userId: b.userId,
      username: b.username,
      amount: b.amount,
      balanceType: b.balanceType,
      autoCashout: b.autoCashout,
      cashedOut: b.cashedOut,
      cashedOutMultiplier: b.cashedOutMultiplier,
      payout: b.payout,
    };
  }

  /**
   * Live snapshot of the round pool economics (the "live math").
   */
  private roundPoolSnapshot() {
    const real = this.roundPools.REAL.snapshot();
    const demo = this.roundPools.DEMO.snapshot();
    return {
      REAL: real,
      DEMO: demo,
      total: {
        staked: parseFloat((real.staked + demo.staked).toFixed(2)),
        paidOut: parseFloat((real.paidOut + demo.paidOut).toFixed(2)),
        distributable: parseFloat((real.distributable + demo.distributable).toFixed(2)),
        remaining: parseFloat((real.remaining + demo.remaining).toFixed(2)),
        players: real.betCount + demo.betCount,
      },
    };
  }

  /**
   * The soft stop only applies when paying the *remaining* flyers would
   * breach the pool. It must never end a round early just because players who
   * already cashed out were paid — that is the round working as intended.
   */
  private shouldPoolGuardStop(): boolean {
    for (const type of ['REAL', 'DEMO'] as const) {
      const pool = this.roundPools[type];
      if (pool.staked <= 0) continue;
      if (!this.hasUncashedBets(type)) continue;
      // Worst case: every remaining flyer cashes out at the current multiplier.
      // Proactive risk stop — end the flight before we could owe more than the
      // distributable pool can cover (plus a configurable tolerance).
      const atRisk = this.uncashedPayoutAt(this.currentMultiplier, type);
      const riskLimit = pool.distributable * RISK_STOP_RATIO;
      if (pool.paidOut + atRisk > riskLimit) {
        console.log(
          `[Aviator] Risk stop: ${type} paid ${pool.paidOut.toFixed(2)} + at-risk ${atRisk.toFixed(2)} ` +
            `exceeds ${riskLimit.toFixed(2)} — ending flight at ${this.currentMultiplier.toFixed(2)}x`
        );
        return true;
      }
    }
    return false;
  }

  private uncashedPayoutAt(multiplier: number, balanceType: 'REAL' | 'DEMO'): number {
    let total = 0;
    for (const bet of this.activeBets.values()) {
      if (bet.balanceType === balanceType && !bet.cashedOut) {
        total += bet.amount * multiplier;
      }
    }
    return total;
  }

  private hasUncashedBets(balanceType: 'REAL' | 'DEMO'): boolean {
    for (const bet of this.activeBets.values()) {
      if (bet.balanceType === balanceType && !bet.cashedOut) return true;
    }
    return false;
  }

  /**
   * Check and execute auto-cashout for eligible bets
   */
  private async checkAutoCashouts(multiplier: number) {
    for (const [betId, bet] of this.activeBets.entries()) {
      if (!bet.cashedOut && bet.autoCashout && multiplier >= bet.autoCashout) {
        try {
          await this.cashoutBet(bet.userId, betId, bet.autoCashout);
        } catch {
          // The cashout was rejected (round ended / already cashed / pool
          // guard ended the flight) — the crash broadcast handles the UX.
        }
      }
    }
  }

  /**
   * Phase 3: End the flight. Syncronous state change so the guard can never
   * fire twice; settlement continues asynchronously.
   */
  private endFlight(reason: CrashReason) {
    if (this.state !== 'FLYING' || this.crashing) return;

    this.crashing = true;
    this.state = 'CRASHED';
    this.effectiveCrashPoint = reason === 'POOL_GUARD' ? this.currentMultiplier : this.crashPoint;
    this.guardTriggered = reason === 'POOL_GUARD';

    if (this.flightLoopInterval) {
      clearInterval(this.flightLoopInterval);
      this.flightLoopInterval = null;
    }
    if (this.exposureInterval) {
      clearInterval(this.exposureInterval);
      this.exposureInterval = null;
    }

    void this.settleCrash(reason).catch((err) =>
      console.error('[Aviator] Crash settlement failed:', err)
    );
  }

  /**
   * Phase 3 settlement: mark losses, record pool economics, reveal history.
   */
  private async settleCrash(reason: CrashReason) {
    const finalCrash = this.effectiveCrashPoint;

    console.log(
      `[Aviator] 💥 Crashed at ${finalCrash.toFixed(2)}x${reason === 'POOL_GUARD' ? ' (pool guard)' : ''}`
    );

    // Settle all remaining active bets as lost
    for (const [betId, bet] of this.activeBets.entries()) {
      if (!bet.cashedOut) {
        bet.cashedOut = false;
        bet.payout = 0;
        try {
          await WalletService.settleLoss(betId);
        } catch (err) {
          console.error(`Error settling loss for bet ${betId}:`, err);
        }
      }
    }

    // Save to history & reveal serverSeed for auditing
    const historyItem: CrashHistoryItem = {
      roundId: this.currentRoundId,
      crashPoint: finalCrash,
      serverSeedHash: this.serverSeedHash,
      serverSeed: this.serverSeed,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      createdAt: new Date(),
    };

    this.history.unshift(historyItem);
    if (this.history.length > 50) this.history.pop();

    // ── House pool economics: the live math settles here ──────────────────
    const byBalance: AviatorRoundSummary['byBalance'] = {
      REAL: {
        staked: this.roundPools.REAL.staked,
        paidOut: this.roundPools.REAL.paidOut,
        houseTake: this.roundPools.REAL.houseTake,
      },
      DEMO: {
        staked: this.roundPools.DEMO.staked,
        paidOut: this.roundPools.DEMO.paidOut,
        houseTake: this.roundPools.DEMO.houseTake,
      },
    };

    const totalStaked = byBalance.REAL.staked + byBalance.DEMO.staked;
    const totalTake = byBalance.REAL.houseTake + byBalance.DEMO.houseTake;
    const takePct = totalStaked > 0 ? ((totalTake / totalStaked) * 100).toFixed(2) : '0.00';
    console.log(
      `[Aviator] 💰 Round ${this.currentRoundId}: staked ${totalStaked.toFixed(2)} · paid out ${(
        byBalance.REAL.paidOut + byBalance.DEMO.paidOut
      ).toFixed(2)} · HOUSE TAKE ${totalTake.toFixed(2)} KSh (${takePct}% of pool)`
    );

    const summary: AviatorRoundSummary = {
      roundId: this.currentRoundId,
      crashPoint: finalCrash,
      guardTriggered: this.guardTriggered,
      byBalance,
    };
    HousePoolService.recordAviatorRound(summary);

    // Per-round record: what multiplier was actually reached, what the natural
    // target was, and whether the system itself ended the flight early.
    const result: AviatorRoundResult = {
      roomId: this.roomId,
      roundId: this.currentRoundId,
      roundNumber: this.nonce,
      reachedMultiplier: finalCrash,
      targetMultiplier: this.crashPoint,
      endReason: reason === 'POOL_GUARD' ? 'RISK_STOP' : 'NATURAL',
      stoppedEarly: reason === 'POOL_GUARD',
      staked: parseFloat(totalStaked.toFixed(2)),
      paidOut: parseFloat((byBalance.REAL.paidOut + byBalance.DEMO.paidOut).toFixed(2)),
      houseTake: parseFloat(totalTake.toFixed(2)),
      players: this.activeBets.size,
      at: new Date().toISOString(),
    };
    this.roundResults.unshift(result);
    if (this.roundResults.length > 100) this.roundResults.pop();

    console.log(
      `[Aviator][${this.roomId}] ROUND ${this.nonce} reached ${finalCrash.toFixed(2)}x ` +
        `(target ${this.crashPoint.toFixed(2)}x) — ` +
        (result.stoppedEarly
          ? 'SYSTEM FLEW AWAY EARLY (risk stop)'
          : 'natural crash') +
        ` | house ${result.houseTake.toFixed(2)} KSh`
    );
    this.io.to('admins').emit('aviator:round_result', result);

    // Mark the persisted GameRound as completed with the pool economics
    if (this.currentRoundDbId) {
      prisma.gameRound.update({
        where: { id: this.currentRoundDbId },
        data: {
          status: 'COMPLETED',
          crashPoint: finalCrash,
          resultData: JSON.stringify({
            crashPoint: finalCrash,
            naturalCrashPoint: this.crashPoint,
            guardTriggered: this.guardTriggered,
            economics: {
              REAL: byBalance.REAL,
              DEMO: byBalance.DEMO,
            },
          }),
          endedAt: new Date(),
        },
      }).catch((err) => console.error('[Aviator] Failed to mark round completed:', err));
    }

    this.io.to(this.roomId).emit('aviator:crashed', {
      roundId: this.currentRoundId,
      crashPoint: finalCrash,
      serverSeed: this.serverSeed,
      serverSeedHash: this.serverSeedHash,
      historyItem,
      pool: this.roundPoolSnapshot(),
    });

    // Wait 3.5 seconds before starting next round
    setTimeout(() => {
      this.startCountdownPhase();
    }, 3500);
  }

  /**
   * Player Places a Bet
   */
  public async placeBet(params: {
    userId: string;
    username: string;
    amount: number;
    balanceType: 'REAL' | 'DEMO';
    autoCashout?: number;
  }) {
    if (this.state !== 'COUNTDOWN') {
      throw new Error('Betting is only allowed during the countdown phase');
    }

    if (!Number.isFinite(params.amount) || params.amount < 10 || params.amount > 500000) {
      throw new Error('Bet amount must be between KES 10 and KES 500,000.');
    }

    // Deduct bet from player's wallet
    const { bet, newBalance } = await WalletService.placeBet({
      userId: params.userId,
      amount: params.amount,
      balanceType: params.balanceType,
      gameType: 'AVIATOR',
      gameRoundId: this.currentRoundDbId || undefined,
      betData: { autoCashout: params.autoCashout },
    });

    // The stake joins this round's pool (the wallet debit already succeeded)
    this.roundPools[params.balanceType].addStake(params.amount);

    // Lifetime REAL deposits decide how much this user can ever win from one
    // bet. Demo money is unlimited because it has no cash value.
    let depositTotal = 0;
    if (params.balanceType === 'REAL') {
      const agg = await prisma.walletTransaction.aggregate({
        where: { userId: params.userId, type: 'DEPOSIT', status: 'SUCCESS', balanceType: 'REAL' },
        _sum: { amount: true },
      });
      depositTotal = Number(agg._sum.amount || 0);
    }
    const maxPayout = params.balanceType === 'REAL'
      ? Math.max(params.amount, depositTotal * MAX_PAYOUT_MULTIPLE_OF_DEPOSIT)
      : Number.MAX_SAFE_INTEGER;

    const activeBet: ActiveBet = {
      betId: bet.id,
      userId: params.userId,
      username: params.username,
      amount: params.amount,
      balanceType: params.balanceType,
      autoCashout: params.autoCashout,
      cashedOut: false,
      depositTotal,
      maxPayout,
    };

    this.activeBets.set(bet.id, activeBet);

    // Broadcast bet placed event to all players
    this.io.to(this.roomId).emit('aviator:bet_placed', {
      betId: bet.id,
      username: params.username,
      amount: params.amount,
      totalBets: this.activeBets.size,
      pool: this.roundPoolSnapshot(),
    });
    this.broadcastExposure();

    return { bet, newBalance };
  }

  /**
   * Player Cancels Bet (during COUNTDOWN)
   */
  public async cancelBet(userId: string, betId: string) {
    if (this.state !== 'COUNTDOWN') {
      throw new Error('Bets can only be cancelled during the countdown phase');
    }

    const bet = this.activeBets.get(betId);
    if (!bet) {
      throw new Error('Active bet not found');
    }
    if (bet.userId !== userId) {
      throw new Error('Unauthorized bet cancellation');
    }

    this.activeBets.delete(betId);

    const { newBalance } = await WalletService.refundBet({
      userId,
      betId,
      amount: bet.amount,
      balanceType: bet.balanceType,
      gameType: 'AVIATOR',
    });

    // The stake leaves the round pool
    this.roundPools[bet.balanceType].voidStake(bet.amount);

    this.io.to(this.roomId).emit('aviator:bet_cancelled', {
      betId,
      userId,
      totalBets: this.activeBets.size,
      pool: this.roundPoolSnapshot(),
    });

    return { success: true, newBalance };
  }

  /**
   * Player Cashes Out — guarded by the round pool.
   */
  public async cashoutBet(userId: string, betId: string, customMultiplier?: number) {
    if (this.state !== 'FLYING') {
      throw new Error('Cashout is only available while the plane is flying');
    }

    const bet = this.activeBets.get(betId);
    if (!bet) {
      throw new Error('Active bet not found');
    }
    if (bet.userId !== userId) {
      throw new Error('Unauthorized cashout');
    }
    if (bet.cashedOut) {
      throw new Error('Bet has already been cashed out');
    }

    // Cashouts always pay, but a REAL-money bet can never pay more than the
    // exposure ceiling derived from the player's lifetime deposits. This is
    // disclosed in the UI before the round starts.
    const cashoutMultiplier = customMultiplier || this.currentMultiplier;
    const rawPayout = bet.amount * cashoutMultiplier;
    const capped = bet.balanceType === 'REAL' && rawPayout > bet.maxPayout;
    const payout = parseFloat((capped ? bet.maxPayout : rawPayout).toFixed(2));

    // ── FAIRNESS RULE ────────────────────────────────────────────────────
    // A cashout accepted while the plane is still flying ALWAYS pays at the
    // live multiplier. The round pool is a house risk-reporting device, never
    // a reason to void a bet the player already won. Previously this checked
    // `pool.canAfford()` and threw — which meant a solo player (whose payout
    // always exceeds 90% of their own stake) could never cash out, and the
    // rejected cashout also ended the flight on the spot.
    const pool = this.roundPools[bet.balanceType];
    if (!pool.canAfford(payout)) {
      console.warn(
        `[Aviator] Pool overdraw paid anyway: ${payout.toFixed(2)} on ${bet.balanceType} ` +
          `(remaining ${pool.remaining.toFixed(2)}) at ${cashoutMultiplier.toFixed(2)}x`
      );
    }
    pool.commitPayout(payout);

    bet.cashedOut = true;
    bet.cashedOutMultiplier = cashoutMultiplier;
    bet.payout = payout;

    // Credit win atomically to user's wallet
    const { newBalance } = await WalletService.settleWin({
      userId,
      betId,
      payout,
      multiplier: cashoutMultiplier,
      balanceType: bet.balanceType,
      gameType: 'AVIATOR',
    });

    // Broadcast cashout to multiplayer room
    this.io.to(this.roomId).emit('aviator:cashed_out', {
      betId,
      userId,
      username: bet.username,
      multiplier: cashoutMultiplier,
      payout,
      amount: bet.amount,
      pool: this.roundPoolSnapshot(),
    });

    return { payout, multiplier: cashoutMultiplier, newBalance, capped, maxPayout: bet.maxPayout };
  }

  /** Last 100 settled rounds for this room (admin audit). */
  public getRoundResults() {
    return this.roundResults.slice();
  }

  /**
   * Get Current State for newly connected clients
   */
  public getCurrentState() {
    const room = this.io.sockets.adapter.rooms.get(this.roomId);
    return {
      state: this.state,
      roundId: this.currentRoundId,
      multiplier: this.currentMultiplier,
      serverSeedHash: this.serverSeedHash,
      history: this.history.slice(0, 30),
      activeBets: Array.from(this.activeBets.values()).map((b) => this.publicBet(b)),
      pool: this.roundPoolSnapshot(),
      roomId: this.roomId,
      roomName: this.roomName,
      players: room ? room.size : 0,
      maxPlayers: this.maxPlayers,
    };
  }
}
