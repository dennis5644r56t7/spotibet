import type { BalanceType } from '../services/wallet.service';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  HOUSE ECONOMY CONFIGURATION — "The system always earns money every round."
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  HOW THE POOL MODEL WORKS
 *  ─────────────────────────
 *  1. Every round, the total staked by players forms a POOL.
 *  2. The HOUSE CUT (rake) is reserved off the top — it is untouchable profit.
 *  3. The remainder is the DISTRIBUTABLE pool that pays winners.
 *  4. LIVE MATH tracks every stake and payout in real time.
 *  5. GUARDS make sure a payout can NEVER eat into the house cut:
 *       • Aviator: the flight ends the moment payouts would breach the
 *         distributable pool ("know when to stop").
 *       • Single-player games: an outcome is only allowed if the pool can
 *         afford its payout; otherwise a losing outcome is selected.
 *
 *  GUARANTEES
 *  ───────────
 *  • Aviator: every round, houseTake ≥ aviatorRoundRake × total staked. 100% of rounds.
 *  • Single-player games: the distributable pool can never go negative, so
 *    cumulative payouts can never exceed cumulative stakes minus realized cuts.
 *    The house can never be net-negative against players.
 *  • REAL and DEMO money are tracked in separate pools so demo play never
 *    eats into real payouts.
 *
 *  TUNING NOTES
 *  ────────────
 *  • `gameRake` values are matched to each game's natural mathematical edge
 *    so play feels normal and the guard only kicks in on unlucky streaks.
 *    Raising a rake above the natural edge increases how often the guard
 *    suppresses wins (lower effective RTP for players).
 *  • `aviatorRoundRake` is the guaranteed take of every Aviator round. With
 *    rake 0.10, a solo tester can never cash out (0.9 × their own stake is
 *    the max payout) — that is the math of pool-funded payouts: winners are
 *    paid from other players' stakes. Lower it for smoother play.
 */
export const HOUSE_CONFIG = {
  /**
   * Guaranteed house share of every Aviator round pool.
   * The round CANNOT pay out more than (1 - rake) × total staked.
   */
  aviatorRoundRake: 0.10,

  /**
   * Proactively end the Aviator flight once cashed-out payouts reach this
   * share of the round's distributable pool. Keeps the hard guard (which
   * denies a breaching cashout) from ever being hit in practice.
   */
  aviatorSoftStopRatio: 0.98,

  /**
   * House rake realized on losing stakes for the single-player games
   * (percentage of the stake, taken as profit when the player loses).
   * Defaults match each game's natural edge:
   *   DICE 2%, ROULETTE 2.7% (single-zero), SLOTS ~3.5%, MINES 4%, BLACKJACK ~0.5%.
   */
  gameRake: {
    DICE: 0.02,
    ROULETTE: 0.027,
    SLOTS: 0.035,
    MINES: 0.04,
    BLACKJACK: 0.005,
  } as Record<string, number>,

  /**
   * Optional working-capital float seeded into each single-player pool on
   * first boot (REAL and DEMO separately). This is house capital, NOT profit:
   * the guarantee "payouts ≤ stakes − cuts" still holds because the float is
   * tracked as a credit the house must be able to return. Set 0 for a
   * completely cold start (early winners are then suppressed until stakes
   * build up the pool).
   */
  poolFloat: {
    REAL: 0,
    DEMO: 5000,
  } as Record<BalanceType, number>,

  /** Broadcast interval (ms) for live house-pool stats over Socket.IO. */
  broadcastIntervalMs: 2000,

  /** How many recent Aviator rounds to keep in the live stats buffer. */
  aviatorHistorySize: 50,
};

export type HouseGameType = keyof typeof HOUSE_CONFIG.gameRake;
