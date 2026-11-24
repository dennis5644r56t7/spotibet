import { randomInt } from 'crypto';
import { prisma } from '../config/db';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { RouletteEngine } from '../games/roulette/roulette.engine';
import { MinesEngine } from '../games/mines/mines.engine';
import { BlackjackEngine } from '../games/blackjack/blackjack.engine';
import { SlotsEngine } from '../games/slots/slots.engine';
import { ProvablyFair } from '../utils/provably-fair';
import { WalletService } from '../services/wallet.service';
import { HousePoolService } from '../services/house-pool.service';

export class CasinoController {
  static async rollDice(req: AuthRequest, res: Response) {
    const { amount, balanceType = 'DEMO' } = req.body;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1000 || amount > 500000) {
      return res.status(400).json({ message: 'Bet amount must be between KSh 1,000 and KSh 500,000.' });
    }
    if (balanceType !== 'REAL' && balanceType !== 'DEMO') {
      return res.status(400).json({ message: 'Invalid account type.' });
    }

    // House pool round: the stake joins the distributable pool and any win
    // must be affordable by the pool before it is allowed to happen.
    const poolRound = HousePoolService.beginRound({
      gameType: 'DICE',
      balanceType,
      stake: amount,
      userId: req.user!.id,
    });

    try {
      const roll = randomInt(1, 101);
      let won = roll <= 50;
      let multiplier = won ? 1.96 : 0;
      let payout = Math.round(amount * multiplier * 100) / 100;

      // ── House pool guard: only allow a win the pool can actually pay ──
      if (won && payout > 0 && !poolRound.tryReservePayout(payout)) {
        HousePoolService.noteSuppression({
          gameType: 'DICE',
          balanceType,
          context: `dice win of ${payout} vs pool balance ${HousePoolService.poolBalance(balanceType).toFixed(2)}`,
        });
        won = false;
        multiplier = 0;
        payout = 0;
      }

      // Deduction, result, ledger entries and payout commit as one operation.
      await prisma.$transaction(async (tx) => {
        const userId = req.user!.id;
        const debited = await tx.user.updateMany({
          where: { id: userId, ...(balanceType === 'REAL' ? { realBalance: { gte: amount } } : { demoBalance: { gte: amount } }) },
          data: balanceType === 'REAL' ? { realBalance: { decrement: amount } } : { demoBalance: { decrement: amount } },
        });
        if (debited.count !== 1) throw new Error('Insufficient balance.');
        const user = await tx.user.update({
          where: { id: userId },
          data: balanceType === 'REAL' ? { realBalance: { increment: payout } } : { demoBalance: { increment: payout } },
        });
        const finalBalance = balanceType === 'REAL' ? user.realBalance : user.demoBalance;
        const bet = await tx.bet.create({ data: {
          userId, amount, balanceType, gameType: 'DICE', multiplier, payout,
          status: won ? 'WON' : 'LOST', settledAt: new Date(),
          betData: JSON.stringify({ roll, target: 50 }),
        } });
        await tx.walletTransaction.create({ data: {
          userId, type: 'BET_PLACED', amount, balanceType,
          balanceAfter: finalBalance - payout, description: 'Bet placed on DICE', reference: `dice-bet-${bet.id}`,
        } });
        if (won) await tx.walletTransaction.create({ data: {
          userId, type: 'BET_WON', amount: payout, balanceType,
          balanceAfter: finalBalance, description: 'Win on DICE (1.96x)', reference: `dice-win-${bet.id}`,
        } });
      });

      // Pool settlement: win paid from the pool / loss realizes the house cut.
      if (won) {
        poolRound.confirmWin(payout);
      } else {
        poolRound.confirmLoss();
      }

      return res.json({ roll, won, payout, multiplier });
    } catch (error: any) {
      poolRound.rollback();
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Roulette Spin
   */
  static async playRoulette(req: AuthRequest, res: Response) {
    try {
      const { bets, balanceType = 'DEMO', clientSeed } = req.body;
      if (!bets || !Array.isArray(bets) || bets.length === 0) {
        return res.status(400).json({ message: 'At least one bet is required' });
      }

      const result = await RouletteEngine.spin({
        userId: req.user!.id,
        balanceType,
        bets,
        clientSeed,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Mines: Start New Game
   */
  static async startMines(req: AuthRequest, res: Response) {
    try {
      const { amount, mineCount = 3, balanceType = 'DEMO', clientSeed } = req.body;
      const numAmount = parseFloat(amount);

      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: 'Valid bet amount is required' });
      }

      const result = await MinesEngine.startRound({
        userId: req.user!.id,
        amount: numAmount,
        mineCount: parseInt(mineCount, 10),
        balanceType,
        clientSeed,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Mines: Reveal Tile
   */
  static async revealMinesTile(req: AuthRequest, res: Response) {
    try {
      const { sessionId, tileIndex } = req.body;
      if (tileIndex === undefined || !sessionId) {
        return res.status(400).json({ message: 'sessionId and tileIndex are required' });
      }

      const result = await MinesEngine.revealTile({
        sessionId,
        userId: req.user!.id,
        tileIndex: parseInt(tileIndex, 10),
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Mines: Abandon the current active session (refund the bet). Used by the
   * client on page load / refresh so a stale server-side session never leaves
   * the user stuck with the "You already have an active Mines game" error.
   */
  static async abandonMines(req: AuthRequest, res: Response) {
    try {
      const abandoned = await MinesEngine.abandonActiveSession(req.user!.id);
      const balance = await WalletService.getBalance(req.user!.id);
      return res.json({
        abandoned,
        realBalance: balance.realBalance,
        demoBalance: balance.demoBalance,
      });
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Mines: Cashout
   */
  static async cashoutMines(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ message: 'sessionId is required' });
      }

      const result = await MinesEngine.cashout({
        sessionId,
        userId: req.user!.id,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Blackjack: Abandon the user's active un-finished hand (refund the bet).
   * Call on page load/refresh to clear stale "Active hand not found" issues.
   */
  static async abandonBlackjack(req: AuthRequest, res: Response) {
    try {
      const abandoned = await BlackjackEngine.abandonActiveSession(req.user!.id);
      const balance = await WalletService.getBalance(req.user!.id);
      return res.json({
        abandoned,
        realBalance: balance.realBalance,
        demoBalance: balance.demoBalance,
      });
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Blackjack: Deal Initial Hand
   */
  static async dealBlackjack(req: AuthRequest, res: Response) {
    try {
      const { amount, balanceType = 'DEMO', clientSeed } = req.body;
      const numAmount = parseFloat(amount);

      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: 'Valid bet amount is required' });
      }

      const result = await BlackjackEngine.deal({
        userId: req.user!.id,
        amount: numAmount,
        balanceType,
        clientSeed,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Blackjack: Hit
   */
  static async hitBlackjack(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.body;
      const result = await BlackjackEngine.hit({ sessionId, userId: req.user!.id });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Blackjack: Stand
   */
  static async standBlackjack(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.body;
      const result = await BlackjackEngine.stand({ sessionId, userId: req.user!.id });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Blackjack: Double Down
   */
  static async doubleBlackjack(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.body;
      const result = await BlackjackEngine.doubleDown({ sessionId, userId: req.user!.id });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Slots: Spin Reels
   */
  static async spinSlots(req: AuthRequest, res: Response) {
    try {
      const { amount, balanceType = 'DEMO', clientSeed } = req.body;
      const numAmount = parseFloat(amount);

      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: 'Valid bet amount is required' });
      }

      const result = await SlotsEngine.spin({
        userId: req.user!.id,
        amount: numAmount,
        balanceType,
        clientSeed,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  /**
   * Universal Provably Fair Verifier
   */
  static verifyFairness(req: AuthRequest, res: Response) {
    try {
      const { gameType, serverSeed, clientSeed, nonce, mineCount } = req.body;

      if (!serverSeed || !clientSeed || nonce === undefined) {
        return res.status(400).json({ message: 'serverSeed, clientSeed, and nonce are required' });
      }

      const serverSeedHash = ProvablyFair.hashServerSeed(serverSeed);
      const hmac = ProvablyFair.getHmacSha256(serverSeed, clientSeed, Number(nonce));

      let result: any = {};

      if (gameType === 'AVIATOR') {
        result.crashPoint = ProvablyFair.calculateCrashPoint(serverSeed, clientSeed, Number(nonce));
      } else if (gameType === 'ROULETTE') {
        result.winningNumber = ProvablyFair.calculateRouletteOutcome(serverSeed, clientSeed, Number(nonce));
        result.color = RouletteEngine.getColor(result.winningNumber);
      } else if (gameType === 'MINES') {
        // Use the actual mine count the player used (never trust the stored board
        // blindly — recompute from the verified seed). Default 3 for safety.
        const mines = parseInt(mineCount, 10);
        const validMines = Number.isFinite(mines) && mines >= 1 && mines <= 24 ? mines : 3;
        result.mines = ProvablyFair.calculateMinesLayout(serverSeed, clientSeed, Number(nonce), validMines);
        result.mineCount = validMines;
      }

      return res.json({
        serverSeed,
        serverSeedHash,
        clientSeed,
        nonce,
        hmac,
        outcome: result,
      });
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }
}
