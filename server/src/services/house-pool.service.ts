import { Server as SocketIOServer } from 'socket.io';
import { prisma } from '../config/db';
import { roundMoney } from '../config/payments';
import { HOUSE_CONFIG } from '../config/house.config';
import type { BalanceType } from './wallet.service';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOUSE POOL SERVICE — the live math that guarantees the house earns money.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Money flow for every game:
 *
 *    stake ──▶ POOL (distributable balance grows)
 *                 │
 *                 ├──▶ payout to winner   (only if the pool can afford it)
 *                 └──▶ house cut (rake)    reserved on losing stakes — untouchable
 *
 *  Two pool types:
 *   • GLOBAL pools (REAL + DEMO): fund single-player game payouts. The guard
 *     only allows a winning outcome if the pool balance can cover its payout,
 *     so cumulative payouts can never exceed cumulative stakes minus cuts.
 *   • AVIATOR round pools: self-contained per round. The flight ends before
 *     cashouts can exceed (1 - rake) × total staked, so every round's house
 *     take is guaranteed ≥ rake × pool.
 *
 *  All in-memory mutations are synchronous (no awaits between check and
 *  commit), which makes the guards race-safe inside a single Node process.
 *  Ledger writes are fire-and-forget; the in-memory state is authoritative
 *  and is rebuilt from the ledger on boot.
 */

const EPSILON = 0.005; // half a cent tolerance for float rounding

type LedgerType = 'STAKE_IN' | 'STAKE_VOID' | 'PAYOUT_OUT' | 'CUT_REALIZED' | 'FLOAT_SEED';

interface LedgerRowDraft {
  type: LedgerType;
  amount: number; // signed
  gameType: string;
  balanceType: BalanceType;
  poolKey: string;
  betId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/** In-memory balance sheet for one pool (one balance type). */
class PoolBucket {
  staked = 0;
  paidOut = 0;
  cutsRealized = 0;
  /** Amount currently held for pending (reserved but not yet settled) payouts. */
  reserved = 0;
  /** Running count of guard suppressions (wins turned into losses). */
  suppressions = 0;
  /** Distributable balance = stakes in − payouts out − cuts − reservations. */
  balance = 0;

  canAfford(amount: number): boolean {
    return roundMoney(this.balance - amount) >= -EPSILON;
  }
}

/**
 * A per-bet handle on the GLOBAL pool. Created when a stake is accepted,
 * mutated synchronously as the game progresses, and finalized exactly once:
 * confirmWin / confirmLoss / confirmVoid / rollback.
 */
export class PendingPoolRound {
  public stake = 0;
  public reserved = 0;
  private finalized = false;

  constructor(
    private readonly bucket: PoolBucket,
    private readonly opts: {
      gameType: string;
      balanceType: BalanceType;
      betId?: string;
      userId?: string;
      stake: number;
    }
  ) {
    this.stake = roundMoney(opts.stake);
    this.bucket.staked = roundMoney(this.bucket.staked + this.stake);
    this.bucket.balance = roundMoney(this.bucket.balance + this.stake);
  }

  /** Add to the stake (e.g. blackjack double down). */
  addStake(amount: number): void {
    this.assertLive();
    const a = roundMoney(amount);
    this.stake = roundMoney(this.stake + a);
    this.bucket.staked = roundMoney(this.bucket.staked + a);
    this.bucket.balance = roundMoney(this.bucket.balance + a);
  }

  /**
   * Try to hold `payout` aside for this bet. Returns false (and changes
   * nothing) if the pool cannot afford it — the caller must then suppress
   * the win. On success the amount is deducted from the pool balance so
   * no other bet can spend it.
   */
  tryReservePayout(payout: number): boolean {
    this.assertLive();
    const p = roundMoney(payout);
    if (p <= 0) return true;
    if (!this.bucket.canAfford(p)) return false;
    this.bucket.balance = roundMoney(this.bucket.balance - p);
    this.bucket.reserved = roundMoney(this.bucket.reserved + p);
    this.reserved = roundMoney(this.reserved + p);
    return true;
  }

  /**
   * Move the reservation to a new total (Mines reveal-by-reveal). Only the
   * delta is touched; returns false if the pool cannot cover the increase.
   */
  adjustReservation(newTotal: number): boolean {
    this.assertLive();
    const target = roundMoney(newTotal);
    const delta = roundMoney(target - this.reserved);
    if (delta <= 0) {
      if (delta < 0) this.releaseReservationPortion(-delta);
      return true;
    }
    return this.tryReservePayout(delta);
  }

  private releaseReservationPortion(amount: number): void {
    const a = Math.min(roundMoney(amount), this.reserved);
    this.reserved = roundMoney(this.reserved - a);
    this.bucket.reserved = roundMoney(this.bucket.reserved - a);
    this.bucket.balance = roundMoney(this.bucket.balance + a);
  }

  /** Give the whole reservation back to the pool (bet lost / abandoned). */
  releaseReservation(): void {
    if (this.reserved > 0) this.releaseReservationPortion(this.reserved);
  }

  /** Full revert — used when the wallet transaction fails after acceptance. */
  rollback(): void {
    if (this.finalized) return;
    this.releaseReservation();
    this.bucket.staked = roundMoney(this.bucket.staked - this.stake);
    this.bucket.balance = roundMoney(this.bucket.balance - this.stake);
    this.stake = 0;
    this.finalized = true;
  }

  /** The bet won and was paid `payout` (≤ reserved unless pool can cover more). */
  confirmWin(payout: number): void {
    this.assertLive();
    this.releaseReservation();
    const p = roundMoney(payout);
    if (p > 0) {
      if (!this.bucket.canAfford(p)) {
        // Should be unreachable when callers pay the reserved amount.
        console.error(`[HousePool] CRITICAL: confirmWin payout ${p} exceeds pool ${this.bucket.balance}`);
        this.bucket.suppressions++;
        return this.confirmLoss();
      }
      this.bucket.balance = roundMoney(this.bucket.balance - p);
      this.bucket.paidOut = roundMoney(this.bucket.paidOut + p);
    }
    this.persist([
      { type: 'STAKE_IN', amount: this.stake },
      { type: 'PAYOUT_OUT', amount: -p },
    ]);
    this.finalized = true;
  }

  /** The bet lost: the house realizes its rake out of the pool. */
  confirmLoss(): void {
    this.assertLive();
    this.releaseReservation();
    const rake = HOUSE_CONFIG.gameRake[this.opts.gameType] ?? 0;
    const cut = roundMoney(this.stake * rake);
    if (cut > 0) {
      this.bucket.balance = roundMoney(this.bucket.balance - cut);
      this.bucket.cutsRealized = roundMoney(this.bucket.cutsRealized + cut);
    }
    const rows: Array<Omit<LedgerRowDraft, 'gameType' | 'balanceType' | 'poolKey'>> = [{ type: 'STAKE_IN', amount: this.stake }];
    if (cut > 0) rows.push({ type: 'CUT_REALIZED', amount: -cut });
    this.persist(rows);
    this.finalized = true;
  }

  /** The bet was cancelled/refunded: stake leaves the pool untouched. */
  confirmVoid(): void {
    this.assertLive();
    this.releaseReservation();
    this.bucket.staked = roundMoney(this.bucket.staked - this.stake);
    this.bucket.balance = roundMoney(this.bucket.balance - this.stake);
    this.persist([
      { type: 'STAKE_IN', amount: this.stake },
      { type: 'STAKE_VOID', amount: -this.stake },
    ]);
    this.finalized = true;
  }

  /** Count a suppressed win (operator visibility). */
  noteSuppression(): void {
    this.bucket.suppressions++;
  }

  private assertLive(): void {
    if (this.finalized) {
      throw new Error('[HousePool] Pool round already finalized');
    }
  }

  private persist(rows: Array<Omit<LedgerRowDraft, 'gameType' | 'balanceType' | 'poolKey'>>): void {
    const drafts: LedgerRowDraft[] = rows
      .filter((r) => Math.abs(r.amount) > EPSILON)
      .map((r) => ({
        ...r,
        gameType: this.opts.gameType,
        balanceType: this.opts.balanceType,
        poolKey: 'GLOBAL',
        betId: this.opts.betId,
        userId: this.opts.userId,
      }));
    persistLedgerRows(drafts, this.bucket);
  }
}

/**
 * Per-Aviator-round pool. Bets are accepted during the countdown, the house
 * cut is `rake` of everything staked, and the flight must end before cashed
 * payouts reach the distributable amount.
 */
export class RoundPool {
  public staked = 0;
  public paidOut = 0;
  public betCount = 0;

  constructor(
    private readonly rake: number = HOUSE_CONFIG.aviatorRoundRake,
    private readonly softStopRatio: number = HOUSE_CONFIG.aviatorSoftStopRatio
  ) {}

  get distributable(): number {
    return roundMoney(this.staked * (1 - this.rake));
  }

  get remaining(): number {
    return roundMoney(this.distributable - this.paidOut);
  }

  get houseTake(): number {
    return roundMoney(this.staked - this.paidOut);
  }

  addStake(amount: number): void {
    this.staked = roundMoney(this.staked + roundMoney(amount));
    this.betCount++;
  }

  voidStake(amount: number): void {
    this.staked = roundMoney(this.staked - roundMoney(amount));
    this.betCount = Math.max(0, this.betCount - 1);
  }

  /** Hard guard: would this cashout breach the distributable pool? */
  canAfford(payout: number): boolean {
    return roundMoney(this.paidOut + roundMoney(payout)) <= this.distributable + EPSILON;
  }

  /** Soft guard: payouts are close enough to the cap that the round should end now. */
  shouldSoftStop(): boolean {
    return this.paidOut >= roundMoney(this.distributable * this.softStopRatio) - EPSILON;
  }

  /** Payout already validated by canAfford — commit it to the round totals. */
  commitPayout(payout: number): void {
    this.paidOut = roundMoney(this.paidOut + roundMoney(payout));
  }

  snapshot(): { staked: number; paidOut: number; distributable: number; remaining: number; betCount: number } {
    return {
      staked: this.staked,
      paidOut: this.paidOut,
      distributable: this.distributable,
      remaining: this.remaining,
      betCount: this.betCount,
    };
  }
}

export interface AviatorRoundSummary {
  roundId: string;
  crashPoint: number;
  guardTriggered: boolean;
  byBalance: Record<BalanceType, { staked: number; paidOut: number; houseTake: number }>;
}

export interface HouseLiveStats {
  updatedAt: string;
  pools: Record<
    BalanceType,
    {
      staked: number;
      paidOut: number;
      cutsRealized: number;
      balance: number;
      reserved: number;
      suppressions: number;
    }
  >;
  aviator: Record<BalanceType, { staked: number; paidOut: number; houseTake: number; rounds: number }>;
  recentRounds: Array<
    AviatorRoundSummary & { endedAt: string; takePct: number }
  >;
  config: {
    aviatorRoundRake: number;
    aviatorSoftStopRatio: number;
    gameRake: Record<string, number>;
    poolFloat: Record<string, number>;
  };
}

export class HousePoolService {
  private static io: SocketIOServer | null = null;
  private static initialized = false;
  private static broadcastTimer: NodeJS.Timeout | null = null;

  private static buckets: Record<BalanceType, PoolBucket> = {
    REAL: new PoolBucket(),
    DEMO: new PoolBucket(),
  };

  private static aviatorTotals: Record<BalanceType, { staked: number; paidOut: number; houseTake: number; rounds: number }> = {
    REAL: { staked: 0, paidOut: 0, houseTake: 0, rounds: 0 },
    DEMO: { staked: 0, paidOut: 0, houseTake: 0, rounds: 0 },
  };

  private static recentRounds: Array<AviatorRoundSummary & { endedAt: string; takePct: number }> = [];

  /** Call once at boot (after DB connect). Rebuilds state from the ledger. */
  static async initialize(io?: SocketIOServer): Promise<void> {
    if (io) this.io = io;
    try {
      await this.syncFromLedger();
      this.initialized = true;
      console.log(
        `[HousePool] ✅ Live. REAL pool ${this.buckets.REAL.balance.toFixed(2)} KSh · DEMO pool ${this.buckets.DEMO.balance.toFixed(2)} KSh`
      );
    } catch (err) {
      // Non-fatal: pools keep running from current in-memory state.
      console.error('[HousePool] Failed to sync from ledger — starting pools from scratch:', err);
      this.initialized = true;
      for (const type of ['REAL', 'DEMO'] as BalanceType[]) {
        const float = HOUSE_CONFIG.poolFloat[type];
        if (float > 0) {
          this.buckets[type].balance = roundMoney(float);
          persistLedgerRows(
            [{ type: 'FLOAT_SEED', amount: float, gameType: 'HOUSE', balanceType: type, poolKey: 'GLOBAL' }],
            this.buckets[type]
          );
        }
      }
    }

    if (!this.broadcastTimer && this.io) {
      this.broadcastTimer = setInterval(() => {
        this.io?.emit('house:pool', this.getLiveStats());
      }, HOUSE_CONFIG.broadcastIntervalMs);
    }
  }

  /** Begin tracking a single-player bet against the GLOBAL pool. */
  static beginRound(params: {
    gameType: string;
    balanceType: BalanceType;
    stake: number;
    betId?: string;
    userId?: string;
  }): PendingPoolRound {
    return new PendingPoolRound(this.buckets[params.balanceType], params);
  }

  /** Current distributable balance of a GLOBAL pool. */
  static poolBalance(balanceType: BalanceType): number {
    return this.buckets[balanceType].balance;
  }

  /** Log a guard suppression for operator visibility. */
  static noteSuppression(params: { gameType: string; balanceType: BalanceType; context: string }): void {
    this.buckets[params.balanceType].suppressions++;
    console.warn(
      `[HousePool] 🛡️ Guard suppressed a win on ${params.gameType} (${params.balanceType}): ${params.context}`
    );
  }

  /**
   * Record a settled Aviator round: persists aggregate ledger rows, updates
   * totals and the live-monitor buffer. `takePct` is validated — if the round
   * somehow took less than the configured rake, a CRITICAL error is logged.
   */
  static recordAviatorRound(summary: AviatorRoundSummary): void {
    const endedAt = new Date().toISOString();

    for (const type of ['REAL', 'DEMO'] as BalanceType[]) {
      const leg = summary.byBalance[type];
      if (leg.staked <= 0) continue;

      // ── The guarantee: house take ≥ rake × staked, every round ──
      const minTake = roundMoney(leg.staked * HOUSE_CONFIG.aviatorRoundRake);
      if (leg.houseTake + EPSILON < minTake) {
        console.error(
          `[HousePool] 🚨 CRITICAL GUARANTEE VIOLATION — round ${summary.roundId} (${type}): take ${leg.houseTake} < minimum ${minTake}`
        );
      }

      this.aviatorTotals[type].staked = roundMoney(this.aviatorTotals[type].staked + leg.staked);
      this.aviatorTotals[type].paidOut = roundMoney(this.aviatorTotals[type].paidOut + leg.paidOut);
      this.aviatorTotals[type].houseTake = roundMoney(this.aviatorTotals[type].houseTake + leg.houseTake);
      this.aviatorTotals[type].rounds += 1;

      const rows: Array<Omit<LedgerRowDraft, 'gameType' | 'balanceType' | 'poolKey'>> = [];
      if (leg.staked > 0) rows.push({ type: 'STAKE_IN', amount: leg.staked });
      if (leg.paidOut > 0) rows.push({ type: 'PAYOUT_OUT', amount: -leg.paidOut });
      if (leg.houseTake > 0) rows.push({ type: 'CUT_REALIZED', amount: -leg.houseTake });

      const drafts: LedgerRowDraft[] = rows.map((r) => ({
        ...r,
        gameType: 'AVIATOR',
        balanceType: type,
        poolKey: summary.roundId,
        metadata: {
          crashPoint: summary.crashPoint,
          guardTriggered: summary.guardTriggered,
        },
      }));
      // Aviator rows are round-scoped: they must not mutate the GLOBAL
      // buckets, so they are persisted without a bucket reference.
      persistLedgerRows(drafts);
    }

    const totalStaked = summary.byBalance.REAL.staked + summary.byBalance.DEMO.staked;
    const totalTake = summary.byBalance.REAL.houseTake + summary.byBalance.DEMO.houseTake;
    this.recentRounds.unshift({
      ...summary,
      endedAt,
      takePct: totalStaked > 0 ? roundMoney((totalTake / totalStaked) * 100) : 0,
    });
    if (this.recentRounds.length > HOUSE_CONFIG.aviatorHistorySize) this.recentRounds.pop();

    this.io?.emit('house:pool', this.getLiveStats());
  }

  /** Snapshot for the live monitor (Socket.IO + REST). */
  static getLiveStats(): HouseLiveStats {
    const pools = {} as HouseLiveStats['pools'];
    for (const type of ['REAL', 'DEMO'] as BalanceType[]) {
      const b = this.buckets[type];
      pools[type] = {
        staked: b.staked,
        paidOut: b.paidOut,
        cutsRealized: b.cutsRealized,
        balance: b.balance,
        reserved: b.reserved,
        suppressions: b.suppressions,
      };
    }
    return {
      updatedAt: new Date().toISOString(),
      pools,
      aviator: {
        REAL: { ...this.aviatorTotals.REAL },
        DEMO: { ...this.aviatorTotals.DEMO },
      },
      recentRounds: this.recentRounds.slice(0, 20),
      config: {
        aviatorRoundRake: HOUSE_CONFIG.aviatorRoundRake,
        aviatorSoftStopRatio: HOUSE_CONFIG.aviatorSoftStopRatio,
        gameRake: { ...HOUSE_CONFIG.gameRake },
        poolFloat: { ...HOUSE_CONFIG.poolFloat },
      },
    };
  }

  // ─────────────────────────── internals ───────────────────────────

  private static async syncFromLedger(): Promise<void> {
    for (const type of ['REAL', 'DEMO'] as BalanceType[]) {
      const rows = await prisma.poolLedger.findMany({
        where: { poolKey: 'GLOBAL', balanceType: type },
        orderBy: { createdAt: 'asc' },
      });

      if (rows.length === 0) {
        const float = HOUSE_CONFIG.poolFloat[type];
        if (float > 0) {
          this.buckets[type].balance = roundMoney(float);
          persistLedgerRows(
            [{ type: 'FLOAT_SEED', amount: float, gameType: 'HOUSE', balanceType: type, poolKey: 'GLOBAL' }],
            this.buckets[type]
          );
        }
        continue;
      }

      const bucket = new PoolBucket();
      for (const row of rows) {
        const amt = roundMoney(row.amount);
        bucket.balance = roundMoney(bucket.balance + amt);
        if (row.type === 'STAKE_IN') bucket.staked = roundMoney(bucket.staked + amt);
        else if (row.type === 'STAKE_VOID') bucket.staked = roundMoney(bucket.staked + amt); // amount is negative
        else if (row.type === 'PAYOUT_OUT') bucket.paidOut = roundMoney(bucket.paidOut - amt);
        else if (row.type === 'CUT_REALIZED') bucket.cutsRealized = roundMoney(bucket.cutsRealized - amt);
      }
      this.buckets[type] = bucket;
    }

    // Aviator totals are aggregates of the round-scoped ledger rows.
    for (const type of ['REAL', 'DEMO'] as BalanceType[]) {
      const rows = await prisma.poolLedger.findMany({
        where: { gameType: 'AVIATOR', balanceType: type },
      });
      const totals = { staked: 0, paidOut: 0, houseTake: 0, rounds: 0 };
      const seenRounds = new Set<string>();
      for (const row of rows) {
        const amt = roundMoney(row.amount);
        if (row.type === 'STAKE_IN') totals.staked = roundMoney(totals.staked + amt);
        else if (row.type === 'PAYOUT_OUT') totals.paidOut = roundMoney(totals.paidOut - amt);
        else if (row.type === 'CUT_REALIZED') totals.houseTake = roundMoney(totals.houseTake - amt);
        if (row.poolKey !== 'GLOBAL') seenRounds.add(row.poolKey);
      }
      totals.rounds = seenRounds.size;
      this.aviatorTotals[type] = totals;
    }
  }
}

/**
 * Persist ledger rows. `balanceAfter` values are derived by walking the
 * signed amounts forwards from (current bucket balance − this batch's net
 * effect), so each row reads correctly even though rows are written after
 * the in-memory mutations already happened.
 */
function persistLedgerRows(drafts: LedgerRowDraft[], bucket?: PoolBucket): void {
  const rows = drafts.filter((d) => Math.abs(d.amount) > EPSILON);
  if (rows.length === 0) return;

  const net = rows.reduce((sum, r) => sum + roundMoney(r.amount), 0);
  let running = bucket ? roundMoney(bucket.balance - net) : 0;
  const withBalances = rows.map((r) => {
    const row = { ...r, balanceAfter: running };
    running = roundMoney(running + roundMoney(r.amount));
    return row;
  });

  Promise.allSettled(
    withBalances.map((r) =>
      prisma.poolLedger.create({
        data: {
          poolKey: r.poolKey,
          gameType: r.gameType,
          balanceType: r.balanceType,
          type: r.type,
          amount: roundMoney(r.amount),
          balanceAfter: r.balanceAfter,
          betId: r.betId ?? null,
          userId: r.userId ?? null,
          metadata: r.metadata ? JSON.stringify(r.metadata) : null,
        },
      })
    )
  ).catch((err) => console.error('[HousePool] Ledger write failed:', err));
}
