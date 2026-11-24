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

type CrashReason = 'NATURAL' | 'POOL_GUARD';

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
  private activeBets: Map<string, ActiveBet> = new Map(); // betId -> ActiveBet
  private roundPools: { REAL: RoundPool; DEMO: RoundPool } = {
    REAL: new RoundPool(),
    DEMO: new RoundPool(),
  };
  private history: CrashHistoryItem[] = [];

  constructor(io: SocketIOServer) {
    this.io = io;
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

      this.io.emit('aviator:countdown', {
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

    this.io.emit('aviator:takeoff', {
      roundId: this.currentRoundId,
      serverSeedHash: this.serverSeedHash,
      activeBets: Array.from(this.activeBets.values()),
      pool: this.roundPoolSnapshot(),
    });

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
      this.io.emit('aviator:tick', {
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
      if (pool.staked <= 0 || pool.paidOut <= 0) continue;
      if (!this.hasUncashedBets(type)) continue;
      // Worst case: every remaining flyer cashes out at the current multiplier.
      const atRisk = this.uncashedPayoutAt(this.currentMultiplier, type);
      if (pool.paidOut + atRisk > pool.distributable && pool.shouldSoftStop()) {
        console.log(
          `[Aviator] Pool guard: ${type} paid ${pool.paidOut.toFixed(2)} of ${pool.distributable.toFixed(2)}, ` +
            `remaining flyers at risk ${atRisk.toFixed(2)} — ending flight at ${this.currentMultiplier.toFixed(2)}x`
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

    this.io.emit('aviator:crashed', {
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

    const activeBet: ActiveBet = {
      betId: bet.id,
      userId: params.userId,
      username: params.username,
      amount: params.amount,
      balanceType: params.balanceType,
      autoCashout: params.autoCashout,
      cashedOut: false,
    };

    this.activeBets.set(bet.id, activeBet);

    // Broadcast bet placed event to all players
    this.io.emit('aviator:bet_placed', {
      betId: bet.id,
      username: params.username,
      amount: params.amount,
      totalBets: this.activeBets.size,
      pool: this.roundPoolSnapshot(),
    });

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

    this.io.emit('aviator:bet_cancelled', {
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

    const cashoutMultiplier = customMultiplier || this.currentMultiplier;
    const payout = parseFloat((bet.amount * cashoutMultiplier).toFixed(2));

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
    this.io.emit('aviator:cashed_out', {
      betId,
      userId,
      username: bet.username,
      multiplier: cashoutMultiplier,
      payout,
      amount: bet.amount,
      pool: this.roundPoolSnapshot(),
    });

    return { payout, multiplier: cashoutMultiplier, newBalance };
  }

  /**
   * Get Current State for newly connected clients
   */
  public getCurrentState() {
    return {
      state: this.state,
      roundId: this.currentRoundId,
      multiplier: this.currentMultiplier,
      serverSeedHash: this.serverSeedHash,
      history: this.history.slice(0, 30),
      activeBets: Array.from(this.activeBets.values()),
      pool: this.roundPoolSnapshot(),
    };
  }
}
