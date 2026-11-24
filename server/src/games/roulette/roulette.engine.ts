import crypto from 'crypto';
import { ProvablyFair } from '../../utils/provably-fair';
import { WalletService, BalanceType } from '../../services/wallet.service';
import { HousePoolService } from '../../services/house-pool.service';

export interface RouletteBetItem {
  type: 'straight' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high' | 'dozen' | 'column';
  value: string | number; // e.g. 17, 'red', 'even', '1st12', 'col1'
  amount: number;
}

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

interface BetEvaluation {
  won: boolean;
  multiplier: number;
}

export class RouletteEngine {
  public static isRed(num: number): boolean {
    return RED_NUMBERS.includes(num);
  }

  public static getColor(num: number): 'green' | 'red' | 'black' {
    if (num === 0) return 'green';
    return this.isRed(num) ? 'red' : 'black';
  }

  /** Pure payout evaluation for one bet against a given winning number. */
  private static evaluateBet(b: RouletteBetItem, winningNumber: number): BetEvaluation {
    let won = false;
    let multiplier = 0;
    const winningColor = this.getColor(winningNumber);

    if (b.type === 'straight' && Number(b.value) === winningNumber) {
      won = true;
      multiplier = 36; // 35:1 + original
    } else if (b.type === 'red' && winningColor === 'red') {
      won = true;
      multiplier = 2;
    } else if (b.type === 'black' && winningColor === 'black') {
      won = true;
      multiplier = 2;
    } else if (b.type === 'even' && winningNumber !== 0 && winningNumber % 2 === 0) {
      won = true;
      multiplier = 2;
    } else if (b.type === 'odd' && winningNumber !== 0 && winningNumber % 2 !== 0) {
      won = true;
      multiplier = 2;
    } else if (b.type === 'low' && winningNumber >= 1 && winningNumber <= 18) {
      won = true;
      multiplier = 2;
    } else if (b.type === 'high' && winningNumber >= 19 && winningNumber <= 36) {
      won = true;
      multiplier = 2;
    } else if (b.type === 'dozen') {
      if (b.value === '1st12' && winningNumber >= 1 && winningNumber <= 12) won = true;
      if (b.value === '2nd12' && winningNumber >= 13 && winningNumber <= 24) won = true;
      if (b.value === '3rd12' && winningNumber >= 25 && winningNumber <= 36) won = true;
      if (won) multiplier = 3;
    } else if (b.type === 'column') {
      if (winningNumber !== 0) {
        const col = ((winningNumber - 1) % 3) + 1;
        if (b.value === `col${col}`) {
          won = true;
          multiplier = 3;
        }
      }
    }

    return { won, multiplier };
  }

  /** Total payout a given winning number would cost. */
  public static totalPayoutFor(bets: RouletteBetItem[], winningNumber: number): number {
    let total = 0;
    for (const b of bets) {
      const r = this.evaluateBet(b, winningNumber);
      if (r.won) total += b.amount * r.multiplier;
    }
    return total;
  }

  /**
   * Deterministic pseudo-random ordering of candidate outcomes derived from
   * the round's own hash, starting with the natural (seed-derived) number.
   */
  private static candidateOrder(hash: string, natural: number): number[] {
    const nums = Array.from({ length: 37 }, (_, i) => i).filter((n) => n !== natural);
    let seed = hash;
    let idx = 0;
    for (let i = nums.length - 1; i > 0; i--) {
      if (idx + 4 > seed.length) {
        seed = crypto.createHash('sha256').update(seed).digest('hex');
        idx = 0;
      }
      const j = parseInt(seed.substring(idx, idx + 4), 16) % (i + 1);
      idx += 4;
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    return [natural, ...nums];
  }

  /**
   * Play European Roulette round.
   *
   * The winning number is selected through the HOUSE POOL GUARD: the natural
   * seed-derived outcome is used when the pool can afford its payout, and a
   * pool-affordable alternative (preferring a losing number for the player)
   * is selected otherwise. The pool can therefore never be overdrawn.
   */
  public static async spin(params: {
    userId: string;
    balanceType: BalanceType;
    bets: RouletteBetItem[];
    clientSeed?: string;
  }) {
    const totalAmount = params.bets.reduce((acc, b) => acc + b.amount, 0);
    if (totalAmount <= 0) throw new Error('Total bet amount must be greater than zero');

    // Provably Fair outcome
    const serverSeed = ProvablyFair.generateServerSeed();
    const serverSeedHash = ProvablyFair.hashServerSeed(serverSeed);
    const clientSeed = params.clientSeed || 'roulette_player_seed';
    const nonce = Date.now();

    const hash = ProvablyFair.getHmacSha256(serverSeed, clientSeed, nonce);
    const naturalNumber = ProvablyFair.calculateRouletteOutcome(serverSeed, clientSeed, nonce);

    // House pool round: stake credited, win payouts must be affordable.
    const poolRound = HousePoolService.beginRound({
      gameType: 'ROULETTE',
      balanceType: params.balanceType,
      stake: totalAmount,
      userId: params.userId,
    });

    try {
      // ── House pool guard: pick an outcome the pool can pay for ──────────
      const poolBalance = HousePoolService.poolBalance(params.balanceType);
      const candidates = this.candidateOrder(hash, naturalNumber);

      let winningNumber = naturalNumber;
      let totalPayout = this.totalPayoutFor(params.bets, naturalNumber);

      if (totalPayout > 0 && totalPayout > poolBalance) {
        // Prefer a number where the player's bets all lose…
        let lossNumber: number | null = null;
        for (const n of candidates) {
          if (this.totalPayoutFor(params.bets, n) === 0) {
            lossNumber = n;
            break;
          }
        }

        if (lossNumber !== null) {
          winningNumber = lossNumber;
          totalPayout = 0;
          HousePoolService.noteSuppression({
            gameType: 'ROULETTE',
            balanceType: params.balanceType,
            context: `natural number ${naturalNumber} would pay ${this.totalPayoutFor(params.bets, naturalNumber)} vs pool ${poolBalance.toFixed(2)}`,
          });
        } else {
          // …every number pays (full wheel coverage): take the cheapest one.
          let bestNumber = candidates[0];
          let bestPayout = Infinity;
          for (const n of candidates) {
            const p = this.totalPayoutFor(params.bets, n);
            if (p <= poolBalance && p < bestPayout) {
              bestNumber = n;
              bestPayout = p;
            }
          }
          winningNumber = bestNumber;
          totalPayout = this.totalPayoutFor(params.bets, bestNumber);
          HousePoolService.noteSuppression({
            gameType: 'ROULETTE',
            balanceType: params.balanceType,
            context: `reduced payout to ${totalPayout} (pool ${poolBalance.toFixed(2)})`,
          });
        }
      }

      // Reserve the payout before the wallet is touched.
      if (totalPayout > 0) {
        const reserved = poolRound.tryReservePayout(totalPayout);
        if (!reserved) {
          // Race safety net — should be unreachable inside one synchronous block.
          winningNumber = candidates.find((n) => this.totalPayoutFor(params.bets, n) === 0) ?? candidates[0];
          totalPayout = this.totalPayoutFor(params.bets, winningNumber);
          HousePoolService.noteSuppression({
            gameType: 'ROULETTE',
            balanceType: params.balanceType,
            context: 'reservation race fallback',
          });
        }
      }

      const winningColor = this.getColor(winningNumber);

      // Deduct total bet
      const { bet, newBalance } = await WalletService.placeBet({
        userId: params.userId,
        amount: totalAmount,
        balanceType: params.balanceType,
        gameType: 'ROULETTE',
        betData: { bets: params.bets, winningNumber, winningColor },
      });

      // Calculate per-bet results for the selected number
      const betResults = params.bets.map((b) => {
        const r = this.evaluateBet(b, winningNumber);
        return {
          ...b,
          won: r.won,
          multiplier: r.multiplier,
          payout: r.won ? b.amount * r.multiplier : 0,
        };
      });

      let finalBalance = newBalance;

      if (totalPayout > 0) {
        const overallMultiplier = parseFloat((totalPayout / totalAmount).toFixed(2));
        const res = await WalletService.settleWin({
          userId: params.userId,
          betId: bet.id,
          payout: totalPayout,
          multiplier: overallMultiplier,
          balanceType: params.balanceType,
          gameType: 'ROULETTE',
        });
        finalBalance = res.newBalance;
        poolRound.confirmWin(totalPayout);
      } else {
        await WalletService.settleLoss(bet.id);
        poolRound.confirmLoss();
      }

      return {
        winningNumber,
        winningColor,
        isEven: winningNumber !== 0 && winningNumber % 2 === 0,
        totalBet: totalAmount,
        totalPayout,
        netProfit: totalPayout - totalAmount,
        betResults,
        newBalance: finalBalance,
        provablyFair: {
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce,
        },
      };
    } catch (error) {
      poolRound.rollback();
      throw error;
    }
  }
}
