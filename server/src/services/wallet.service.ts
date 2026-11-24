import { prisma } from '../config/db';
import { roundMoney } from '../config/payments';

export type BalanceType = 'REAL' | 'DEMO';

export class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient balance') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class WalletService {
  // Process-local mutex for a user. Database conditional updates are the real
  // guard against overspending; this lock keeps the surrounding ledger writes
  // tidy and prevents concurrent read-modify-write sequences in one process.
  private static userLocks = new Map<string, Promise<void>>();

  private static async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.userLocks.get(userId) || Promise.resolve();
    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.userLocks.set(userId, tail);

    await previous;

    try {
      return await fn();
    } finally {
      release();
      if (this.userLocks.get(userId) === tail) {
        this.userLocks.delete(userId);
      }
    }
  }

  static async getBalance(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        realBalance: true,
        demoBalance: true,
        role: true,
        username: true,
      },
    });

    if (!user) throw new Error('User not found');
    return user;
  }

  /**
   * Debit a stake atomically. `updateMany` with a `gte` guard is a single
   * conditional UPDATE, so two concurrent requests can never overdraw.
   */
  static async placeBet(params: {
    userId: string;
    amount: number;
    balanceType: BalanceType;
    gameType: 'AVIATOR' | 'ROULETTE' | 'BLACKJACK' | 'SLOTS' | 'MINES' | 'DICE';
    gameRoundId?: string;
    betData?: any;
  }) {
    const amount = roundMoney(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Bet amount must be greater than zero');
    }

    return this.withUserLock(params.userId, async () => {
      const serializedBetData =
        typeof params.betData === 'string' ? params.betData : JSON.stringify(params.betData ?? null);

      return prisma.$transaction(async (tx) => {
        const debit =
          params.balanceType === 'REAL'
            ? await tx.user.updateMany({
                where: { id: params.userId, realBalance: { gte: amount } },
                data: { realBalance: { decrement: amount } },
              })
            : await tx.user.updateMany({
                where: { id: params.userId, demoBalance: { gte: amount } },
                data: { demoBalance: { decrement: amount } },
              });

        if (debit.count === 0) {
          const exists = await tx.user.findUnique({ where: { id: params.userId }, select: { id: true } });
          if (!exists) throw new Error('User not found');
          throw new InsufficientFundsError(
            `Insufficient ${params.balanceType.toLowerCase()} balance`
          );
        }

        const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
        const balanceAfter =
          params.balanceType === 'REAL' ? roundMoney(user.realBalance) : roundMoney(user.demoBalance);

        const bet = await tx.bet.create({
          data: {
            userId: params.userId,
            gameRoundId: params.gameRoundId,
            gameType: params.gameType,
            amount,
            balanceType: params.balanceType,
            status: 'ACTIVE',
            betData: serializedBetData,
          },
        });

        await tx.walletTransaction.create({
          data: {
            userId: params.userId,
            type: 'BET_PLACED',
            amount,
            balanceType: params.balanceType,
            balanceAfter,
            description: `Bet placed on ${params.gameType}`,
          },
        });

        return { bet, newBalance: balanceAfter };
      });
    });
  }

  /**
   * Credit a win exactly once. The bet status is claimed inside the same
   * transaction as the balance update, so retries and races cannot double-pay.
   */
  static async settleWin(params: {
    userId: string;
    betId: string;
    payout: number;
    multiplier: number;
    balanceType: BalanceType;
    gameType: string;
  }) {
    const payout = roundMoney(params.payout);
    if (!Number.isFinite(payout) || payout < 0) throw new Error('Invalid payout');

    return this.withUserLock(params.userId, async () => {
      return prisma.$transaction(async (tx) => {
        const bet = await tx.bet.findUnique({ where: { id: params.betId } });
        if (!bet) throw new Error('Bet not found');
        if (bet.userId !== params.userId) throw new Error('Unauthorized bet settlement');

        // Already settled/refunded: return the current state without paying again.
        if (bet.status !== 'ACTIVE' && bet.status !== 'PENDING') {
          const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
          return {
            bet,
            newBalance:
              params.balanceType === 'REAL'
                ? roundMoney(user.realBalance)
                : roundMoney(user.demoBalance),
            alreadySettled: true,
          };
        }

        const claim = await tx.bet.updateMany({
          where: { id: params.betId, status: { in: ['ACTIVE', 'PENDING'] } },
          data: {
            status: settlementStatus(payout),
            payout,
            multiplier: params.multiplier,
            settledAt: new Date(),
          },
        });

        if (claim.count === 0) {
          const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
          const currentBet = await tx.bet.findUniqueOrThrow({ where: { id: params.betId } });
          return {
            bet: currentBet,
            newBalance:
              params.balanceType === 'REAL'
                ? roundMoney(user.realBalance)
                : roundMoney(user.demoBalance),
            alreadySettled: true,
          };
        }

        const user =
          params.balanceType === 'REAL'
            ? await tx.user.update({
                where: { id: params.userId },
                data: { realBalance: { increment: payout } },
              })
            : await tx.user.update({
                where: { id: params.userId },
                data: { demoBalance: { increment: payout } },
              });

        const balanceAfter =
          params.balanceType === 'REAL' ? roundMoney(user.realBalance) : roundMoney(user.demoBalance);

        if (payout > 0) {
          await tx.walletTransaction.create({
            data: {
              userId: params.userId,
              type: 'BET_WON',
              amount: payout,
              balanceType: params.balanceType,
              balanceAfter,
              description: `Win on ${params.gameType} (${params.multiplier.toFixed(2)}x)`,
            },
          });
        }

        const settledBet = await tx.bet.findUniqueOrThrow({ where: { id: params.betId } });
        return { bet: settledBet, newBalance: balanceAfter };
      });
    });
  }

  /** Mark a lost bet. The stake was already debited when the bet was placed. */
  static async settleLoss(betId: string) {
    await prisma.bet.updateMany({
      where: { id: betId, status: { in: ['ACTIVE', 'PENDING'] } },
      data: { status: 'LOST', payout: 0, settledAt: new Date() },
    });
    return prisma.bet.findUnique({ where: { id: betId } });
  }

  /**
   * Refund an active bet (cancel / stale session). Conditional on the bet not
   * already having been settled so a crash + refund race cannot double-credit.
   */
  static async refundBet(params: {
    userId: string;
    betId: string;
    amount: number;
    balanceType: BalanceType;
    gameType: string;
  }) {
    const amount = roundMoney(params.amount);

    return this.withUserLock(params.userId, async () => {
      return prisma.$transaction(async (tx) => {
        const bet = await tx.bet.findUnique({ where: { id: params.betId } });
        if (!bet) throw new Error('Bet not found');
        if (bet.userId !== params.userId) throw new Error('Unauthorized bet refund');

        if (bet.status !== 'ACTIVE' && bet.status !== 'PENDING') {
          const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
          return {
            bet,
            newBalance:
              params.balanceType === 'REAL'
                ? roundMoney(user.realBalance)
                : roundMoney(user.demoBalance),
            alreadyRefunded: true,
          };
        }

        const claim = await tx.bet.updateMany({
          where: { id: params.betId, status: { in: ['ACTIVE', 'PENDING'] } },
          data: { status: 'CANCELLED', payout: amount, settledAt: new Date() },
        });

        if (claim.count === 0) {
          const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
          const currentBet = await tx.bet.findUniqueOrThrow({ where: { id: params.betId } });
          return {
            bet: currentBet,
            newBalance:
              params.balanceType === 'REAL'
                ? roundMoney(user.realBalance)
                : roundMoney(user.demoBalance),
            alreadyRefunded: true,
          };
        }

        const user =
          params.balanceType === 'REAL'
            ? await tx.user.update({
                where: { id: params.userId },
                data: { realBalance: { increment: amount } },
              })
            : await tx.user.update({
                where: { id: params.userId },
                data: { demoBalance: { increment: amount } },
              });

        const balanceAfter =
          params.balanceType === 'REAL' ? roundMoney(user.realBalance) : roundMoney(user.demoBalance);

        await tx.walletTransaction.create({
          data: {
            userId: params.userId,
            type: 'BET_REFUND',
            amount,
            balanceType: params.balanceType,
            balanceAfter,
            description: `Cancelled bet refund on ${params.gameType}`,
          },
        });

        const refundedBet = await tx.bet.findUniqueOrThrow({ where: { id: params.betId } });
        return { bet: refundedBet, newBalance: balanceAfter };
      });
    });
  }

  /**
   * Credit a verified Paystack deposit exactly once.
   *
   * The reference must have been created by us for this user and the verified
   * amount/currency must match the amount we requested. The PaystackPayment
   * row is claimed with a conditional update inside the same transaction that
   * moves the balance, which makes duplicate webhooks and duplicate client
   * verification calls safe.
   */
  static async creditDeposit(params: {
    userId: string;
    reference: string;
    paystackAmountSubunit: number;
    paystackCurrency: string;
    channel?: string;
  }) {
    return this.withUserLock(params.userId, async () => {
      const payment = await prisma.paystackPayment.findUnique({
        where: { reference: params.reference },
      });

      if (!payment) throw new Error('Unknown payment reference');
      if (payment.userId !== params.userId) throw new Error('Payment does not belong to this user');

      if (payment.status === 'SUCCESS') {
        const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });
        return { newBalance: roundMoney(user.realBalance), alreadyProcessed: true };
      }

      const expectedCurrency = String(payment.currency || '').toUpperCase();
      const paidCurrency = String(params.paystackCurrency || '').toUpperCase();
      if (expectedCurrency !== paidCurrency) {
        throw new Error(
          `Payment currency mismatch (expected ${expectedCurrency}, received ${paidCurrency})`
        );
      }

      const expectedSubunit = Math.round(roundMoney(payment.amount) * 100);
      if (expectedSubunit !== Math.round(params.paystackAmountSubunit)) {
        throw new Error('Payment amount does not match the initialized deposit');
      }

      return prisma.$transaction(async (tx) => {
        const claim = await tx.paystackPayment.updateMany({
          where: { id: payment.id, status: { not: 'SUCCESS' } },
          data: {
            status: 'SUCCESS',
            paidAt: new Date(),
            channel: params.channel,
          },
        });

        if (claim.count === 0) {
          const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
          return { newBalance: roundMoney(user.realBalance), alreadyProcessed: true };
        }

        const user = await tx.user.update({
          where: { id: params.userId },
          data: { realBalance: { increment: roundMoney(payment.amount) } },
        });
        const balanceAfter = roundMoney(user.realBalance);

        const transaction = await tx.walletTransaction.create({
          data: {
            userId: params.userId,
            type: 'DEPOSIT',
            amount: roundMoney(payment.amount),
            currency: payment.currency,
            balanceType: 'REAL',
            balanceAfter,
            reference: payment.reference,
            status: 'SUCCESS',
            description: `Paystack deposit (${params.channel || 'checkout'})`,
          },
        });

        return { newBalance: balanceAfter, transaction, alreadyProcessed: false };
      });
    });
  }

  /**
   * Debit the user and create the withdrawal + ledger entry atomically. Payout
   * is only attempted after this commit; if it definitively fails the caller
   * must call failWithdrawal() to reverse the debit.
   */
  static async createWithdrawal(params: {
    userId: string;
    reference: string;
    amount: number;
    currency: string;
    channel: 'MOBILE_MONEY' | 'BANK';
    provider: string;
    accountNumber: string;
    accountName: string;
  }) {
    const amount = roundMoney(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid withdrawal amount');

    return this.withUserLock(params.userId, async () => {
      return prisma.$transaction(async (tx) => {
        const debit = await tx.user.updateMany({
          where: { id: params.userId, realBalance: { gte: amount } },
          data: { realBalance: { decrement: amount } },
        });

        if (debit.count === 0) {
          const exists = await tx.user.findUnique({ where: { id: params.userId }, select: { id: true } });
          if (!exists) throw new Error('User not found');
          throw new InsufficientFundsError('Insufficient real balance');
        }

        const user = await tx.user.findUniqueOrThrow({ where: { id: params.userId } });
        const balanceAfter = roundMoney(user.realBalance);

        const withdrawal = await tx.withdrawal.create({
          data: {
            userId: params.userId,
            reference: params.reference,
            amount,
            fee: 0,
            netAmount: amount,
            currency: params.currency,
            channel: params.channel,
            provider: params.provider,
            accountNumber: params.accountNumber,
            accountName: params.accountName,
            status: 'PENDING',
          },
        });

        await tx.walletTransaction.create({
          data: {
            userId: params.userId,
            type: 'WITHDRAWAL',
            amount,
            currency: params.currency,
            balanceType: 'REAL',
            balanceAfter,
            reference: `WD-${params.reference}`,
            status: 'PENDING',
            description: `Withdrawal to ${params.accountName} (${params.accountNumber})`,
          },
        });

        return { withdrawal, newBalance: balanceAfter };
      });
    });
  }

  static async markWithdrawalProcessing(params: {
    reference: string;
    recipientCode: string;
    transferCode?: string;
  }) {
    await prisma.withdrawal.updateMany({
      where: { reference: params.reference, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        recipientCode: params.recipientCode,
        transferCode: params.transferCode,
      },
    });

    return prisma.withdrawal.findUnique({ where: { reference: params.reference } });
  }

  /**
   * Mark a successfully paid transfer as PAID. No balance change: the funds
   * were debited when the withdrawal was created.
   */
  static async completeWithdrawal(reference: string, transferCode?: string) {
    return prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { reference } });
      if (!withdrawal) return null;

      if (withdrawal.status === 'PAID') return withdrawal;

      if (withdrawal.status === 'FAILED' || withdrawal.status === 'REVERSED') {
        // A transfer succeeded after we already refunded the player. Never
        // silently ignore this: it requires manual reconciliation.
        console.error(
          `[WITHDRAWAL RECONCILIATION] Transfer ${reference} succeeded but withdrawal is ${withdrawal.status}`
        );
        return withdrawal;
      }

      const claim = await tx.withdrawal.updateMany({
        where: { reference, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'PAID',
          transferCode,
          processedAt: new Date(),
        },
      });

      if (claim.count > 0) {
        await tx.walletTransaction.updateMany({
          where: { reference: `WD-${reference}` },
          data: { status: 'SUCCESS' },
        });
      }

      return tx.withdrawal.findUnique({ where: { reference } });
    });
  }

  /**
   * Definitively failed payout: reverse the debit and record a separate credit
   * entry so the player's ledger explains exactly what happened.
   */
  static async failWithdrawal(reference: string, reason: string) {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
    if (!withdrawal) return null;

    if (withdrawal.status === 'FAILED' || withdrawal.status === 'REVERSED') {
      return { withdrawal, refunded: false };
    }
    if (withdrawal.status === 'PAID') {
      console.error(
        `[WITHDRAWAL RECONCILIATION] Refusing to refund ${reference}: transfer is already PAID`
      );
      return { withdrawal, refunded: false };
    }

    return this.withUserLock(withdrawal.userId, async () => {
      return prisma.$transaction(async (tx) => {
        const claim = await tx.withdrawal.updateMany({
          where: { reference, status: { in: ['PENDING', 'PROCESSING'] } },
          data: {
            status: 'FAILED',
            failureReason: reason,
            processedAt: new Date(),
          },
        });

        if (claim.count === 0) {
          const current = await tx.withdrawal.findUnique({ where: { reference } });
          return { withdrawal: current, refunded: false };
        }

        const user = await tx.user.update({
          where: { id: withdrawal.userId },
          data: { realBalance: { increment: roundMoney(withdrawal.amount) } },
        });
        const balanceAfter = roundMoney(user.realBalance);

        await tx.walletTransaction.updateMany({
          where: { reference: `WD-${reference}` },
          data: { status: 'FAILED' },
        });

        await tx.walletTransaction.create({
          data: {
            userId: withdrawal.userId,
            type: 'WITHDRAWAL_REVERSED',
            amount: roundMoney(withdrawal.amount),
            currency: withdrawal.currency,
            balanceType: 'REAL',
            balanceAfter,
            reference: `WDREV-${reference}`,
            status: 'SUCCESS',
            description: `Withdrawal refunded: ${reason}`,
          },
        });

        const current = await tx.withdrawal.findUnique({ where: { reference } });
        return { withdrawal: current, refunded: true, newBalance: balanceAfter };
      });
    });
  }

  /**
   * A transfer that was previously successful was reversed by the bank/telco.
   * Return the funds once, and only if the withdrawal was actually PAID.
   */
  static async reverseWithdrawal(reference: string, reason: string) {
    const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
    if (!withdrawal) return null;

    if (withdrawal.status === 'REVERSED' || withdrawal.status === 'FAILED') {
      return { withdrawal, refunded: false };
    }
    if (withdrawal.status !== 'PAID') {
      return this.failWithdrawal(reference, reason);
    }

    return this.withUserLock(withdrawal.userId, async () => {
      return prisma.$transaction(async (tx) => {
        const claim = await tx.withdrawal.updateMany({
          where: { reference, status: 'PAID' },
          data: {
            status: 'REVERSED',
            failureReason: reason,
            processedAt: new Date(),
          },
        });

        if (claim.count === 0) {
          const current = await tx.withdrawal.findUnique({ where: { reference } });
          return { withdrawal: current, refunded: false };
        }

        const user = await tx.user.update({
          where: { id: withdrawal.userId },
          data: { realBalance: { increment: roundMoney(withdrawal.amount) } },
        });
        const balanceAfter = roundMoney(user.realBalance);

        await tx.walletTransaction.create({
          data: {
            userId: withdrawal.userId,
            type: 'WITHDRAWAL_REVERSED',
            amount: roundMoney(withdrawal.amount),
            currency: withdrawal.currency,
            balanceType: 'REAL',
            balanceAfter,
            reference: `WDREV-${reference}`,
            status: 'SUCCESS',
            description: `Withdrawal reversed by provider: ${reason}`,
          },
        });

        const current = await tx.withdrawal.findUnique({ where: { reference } });
        return { withdrawal: current, refunded: true, newBalance: balanceAfter };
      });
    });
  }

  static async getWithdrawals(userId: string, take = 20) {
    return prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Reset demo balance for test play. */
  static async resetDemoBalance(userId: string, amount: number = 10000) {
    const demoBalance = roundMoney(amount);
    if (!Number.isFinite(demoBalance) || demoBalance < 0) throw new Error('Invalid demo amount');

    return this.withUserLock(userId, async () => {
      return prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: userId },
          data: { demoBalance },
        });

        await tx.walletTransaction.create({
          data: {
            userId,
            type: 'BONUS',
            amount: demoBalance,
            balanceType: 'DEMO',
            balanceAfter: roundMoney(user.demoBalance),
            description: 'Demo balance refill',
          },
        });

        return roundMoney(user.demoBalance);
      });
    });
  }
}

function settlementStatus(payout: number): 'WON' | 'LOST' {
  return payout > 0 ? 'WON' : 'LOST';
}
