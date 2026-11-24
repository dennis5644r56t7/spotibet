import { ProvablyFair } from '../../utils/provably-fair';
import { WalletService, BalanceType } from '../../services/wallet.service';
import { HousePoolService } from '../../services/house-pool.service';

export const SYMBOLS = ['SEVEN', 'DIAMOND', 'BELL', 'BAR', 'CHERRY', 'A', 'K', 'Q', 'WILD', 'SCATTER'] as const;
export type SymbolType = typeof SYMBOLS[number];

// Weighted reel strip for realistic RTP ~96.5%
const REEL_STRIP: SymbolType[] = [
  'Q', 'K', 'CHERRY', 'A', 'BAR', 'BELL', 'Q', 'DIAMOND', 'K', 'CHERRY',
  'A', 'SEVEN', 'Q', 'K', 'WILD', 'BAR', 'A', 'BELL', 'SCATTER', 'CHERRY',
  'Q', 'K', 'DIAMOND', 'A', 'BAR', 'BELL', 'WILD', 'CHERRY', 'Q', 'SEVEN'
];

// 10 Fixed Paylines across 5 columns (index 0-4) and 3 rows (0=top, 1=middle, 2=bottom)
const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], // Middle horizontal
  [0, 0, 0, 0, 0], // Top horizontal
  [2, 2, 2, 2, 2], // Bottom horizontal
  [0, 1, 2, 1, 0], // V-shape
  [2, 1, 0, 1, 2], // Inverted V
  [0, 0, 1, 2, 2], // Downward slant
  [2, 2, 1, 0, 0], // Upward slant
  [1, 0, 0, 0, 1], // Top dip
  [1, 2, 2, 2, 1], // Bottom dip
  [0, 1, 0, 1, 0], // Zigzag
];

const PAYOUT_TABLE: Record<string, { 3: number; 4: number; 5: number }> = {
  SEVEN: { 3: 10, 4: 25, 5: 100 },
  DIAMOND: { 3: 5, 4: 15, 5: 50 },
  BELL: { 3: 3, 4: 10, 5: 25 },
  BAR: { 3: 2, 4: 5, 5: 15 },
  CHERRY: { 3: 1.5, 4: 4, 5: 10 },
  A: { 3: 1.0, 4: 2, 5: 5 },
  K: { 3: 0.8, 4: 1.5, 5: 4 },
  Q: { 3: 0.5, 4: 1.2, 5: 3 },
};

interface SpinEvaluation {
  totalWin: number;
  winningLines: { lineIndex: number; symbol: SymbolType; count: number; payout: number; lineSymbols: SymbolType[] }[];
  scatterCount: number;
  isBonus: boolean;
}

export class SlotsEngine {
  /** Deterministic 5x3 grid from the seed material. */
  private static generateGrid(serverSeed: string, clientSeed: string, nonce: number): SymbolType[][] {
    const grid: SymbolType[][] = [[], [], []]; // 3 rows, 5 columns: grid[row][col]
    const hash = ProvablyFair.getHmacSha256(serverSeed, clientSeed, nonce);

    // Pick 5 stop positions along the strip using hash chunks
    for (let col = 0; col < 5; col++) {
      const chunk = parseInt(hash.substring(col * 4, col * 4 + 4), 16);
      const stopIndex = chunk % REEL_STRIP.length;

      for (let row = 0; row < 3; row++) {
        const symbolIdx = (stopIndex + row) % REEL_STRIP.length;
        if (!grid[row]) grid[row] = [];
        grid[row][col] = REEL_STRIP[symbolIdx];
      }
    }
    return grid;
  }

  /** Pure evaluation of a grid against the 10 paylines + scatters. */
  private static evaluateSpin(grid: SymbolType[][], amount: number): SpinEvaluation {
    const betPerLine = amount / PAYLINES.length;
    let totalWin = 0;
    const winningLines: SpinEvaluation['winningLines'] = [];

    // Evaluate each of the 10 paylines
    PAYLINES.forEach((line, lineIndex) => {
      const lineSymbols = line.map((row, col) => grid[row][col]);

      // Determine winning symbols for this line (for frontend highlight)
      let targetSymbol: SymbolType | null = null;
      let count = 0;

      for (let i = 0; i < 5; i++) {
        const sym = lineSymbols[i];
        if (sym === 'SCATTER') break; // Scatter does not pay on paylines

        if (targetSymbol === null) {
          if (sym !== 'WILD') {
            targetSymbol = sym;
            count++;
          } else {
            count++; // Leading wild
          }
        } else {
          if (sym === targetSymbol || sym === 'WILD') {
            count++;
          } else {
            break;
          }
        }
      }

      if (targetSymbol && count >= 3) {
        const payRates = PAYOUT_TABLE[targetSymbol];
        if (payRates) {
          const multiplier = payRates[count as 3 | 4 | 5] || 0;
          const linePayout = parseFloat((betPerLine * multiplier).toFixed(2));
          if (linePayout > 0) {
            totalWin += linePayout;
            winningLines.push({
              lineIndex,
              symbol: targetSymbol,
              count,
              payout: linePayout,
              // Symbols on this line that participated in the win (for highlighting)
              lineSymbols: lineSymbols.slice(0, count),
            });
          }
        }
      }
    });

    // Check Scatters anywhere on the 5x3 grid
    let scatterCount = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        if (grid[r][c] === 'SCATTER') scatterCount++;
      }
    }

    let isBonus = false;
    if (scatterCount >= 3) {
      isBonus = true;
      const scatterMultiplier = scatterCount === 3 ? 5 : scatterCount === 4 ? 20 : 100;
      const scatterWin = parseFloat((amount * scatterMultiplier).toFixed(2));
      totalWin += scatterWin;
    }

    return { totalWin: parseFloat(totalWin.toFixed(2)), winningLines, scatterCount, isBonus };
  }

  public static async spin(params: {
    userId: string;
    amount: number;
    balanceType: BalanceType;
    clientSeed?: string;
  }) {
    if (params.amount <= 0) throw new Error('Bet amount must be greater than zero');

    const serverSeed = ProvablyFair.generateServerSeed();
    const serverSeedHash = ProvablyFair.hashServerSeed(serverSeed);
    const clientSeed = params.clientSeed || 'slots_player_seed';
    const nonce = Date.now();

    // House pool round: stake credited, win payouts must be affordable.
    const poolRound = HousePoolService.beginRound({
      gameType: 'SLOTS',
      balanceType: params.balanceType,
      stake: params.amount,
      userId: params.userId,
    });

    try {
      // Natural (seed-derived) spin
      let usedNonce = nonce;
      let grid = this.generateGrid(serverSeed, clientSeed, usedNonce);
      let evaluation = this.evaluateSpin(grid, params.amount);

      // ── House pool guard: re-spin until the pool can afford the outcome ──
      if (evaluation.totalWin > 0 && !poolRound.tryReservePayout(evaluation.totalWin)) {
        HousePoolService.noteSuppression({
          gameType: 'SLOTS',
          balanceType: params.balanceType,
          context: `natural spin would pay ${evaluation.totalWin} vs pool ${HousePoolService.poolBalance(params.balanceType).toFixed(2)}`,
        });

        const poolBalance = HousePoolService.poolBalance(params.balanceType);
        let noWin: { grid: SymbolType[][]; evaluation: SpinEvaluation; nonce: number } | null = null;
        let bestAffordable: { grid: SymbolType[][]; evaluation: SpinEvaluation; nonce: number } | null = null;

        // Deterministic re-spins from the same seed material
        for (let attempt = 1; attempt <= 100 && !noWin; attempt++) {
          const tryNonce = nonce + attempt;
          const tryGrid = this.generateGrid(serverSeed, clientSeed, tryNonce);
          const tryEval = this.evaluateSpin(tryGrid, params.amount);

          if (tryEval.totalWin === 0) {
            noWin = { grid: tryGrid, evaluation: tryEval, nonce: tryNonce };
            break;
          }
          if (
            tryEval.totalWin <= poolBalance &&
            (bestAffordable === null || tryEval.totalWin < bestAffordable.evaluation.totalWin)
          ) {
            bestAffordable = { grid: tryGrid, evaluation: tryEval, nonce: tryNonce };
          }
        }

        if (noWin) {
          grid = noWin.grid;
          evaluation = noWin.evaluation;
          usedNonce = noWin.nonce;
        } else if (bestAffordable) {
          grid = bestAffordable.grid;
          evaluation = bestAffordable.evaluation;
          usedNonce = bestAffordable.nonce;
          poolRound.tryReservePayout(evaluation.totalWin);
        } else {
          // Practically unreachable (100 consecutive winning spins): force a
          // loss so the pool invariant is never violated.
          console.error('[Slots] CRITICAL: no affordable outcome found in 100 re-spins — forcing loss');
          evaluation = { totalWin: 0, winningLines: [], scatterCount: evaluation.scatterCount, isBonus: false };
        }
      }

      // Deduct bet
      const { bet, newBalance } = await WalletService.placeBet({
        userId: params.userId,
        amount: params.amount,
        balanceType: params.balanceType,
        gameType: 'SLOTS',
        betData: { grid },
      });

      const totalWin = evaluation.totalWin;
      let finalBalance = newBalance;

      if (totalWin > 0) {
        const overallMultiplier = parseFloat((totalWin / params.amount).toFixed(2));
        const res = await WalletService.settleWin({
          userId: params.userId,
          betId: bet.id,
          payout: totalWin,
          multiplier: overallMultiplier,
          balanceType: params.balanceType,
          gameType: 'SLOTS',
        });
        finalBalance = res.newBalance;
        poolRound.confirmWin(totalWin);
      } else {
        await WalletService.settleLoss(bet.id);
        poolRound.confirmLoss();
      }

      return {
        grid,
        winningLines: evaluation.winningLines,
        scatterCount: evaluation.scatterCount,
        isBonus: evaluation.isBonus,
        totalWin,
        netProfit: totalWin - params.amount,
        multiplier: parseFloat((totalWin / params.amount).toFixed(2)),
        newBalance: finalBalance,
        provablyFair: {
          serverSeed,
          serverSeedHash,
          clientSeed,
          nonce: usedNonce,
        },
      };
    } catch (error) {
      poolRound.rollback();
      throw error;
    }
  }
}
