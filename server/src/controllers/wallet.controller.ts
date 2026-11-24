import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { InsufficientFundsError, WalletService } from '../services/wallet.service';
import { PaystackError, PaystackService } from '../services/paystack.service';
import { prisma } from '../config/db';
import {
  getPaymentConfig,
  isValidEmail,
  normalizeKenyanPhone,
  roundMoney,
} from '../config/payments';

const FALLBACK_KENYAN_BANKS = [
  { name: 'Equity Bank', code: '068', currency: 'KES', type: 'kepss' },
  { name: 'Kenya Commercial Bank (KCB)', code: '001', currency: 'KES', type: 'kepss' },
  { name: 'Co-operative Bank of Kenya', code: '011', currency: 'KES', type: 'kepss' },
  { name: 'NCBA Bank', code: '007', currency: 'KES', type: 'kepss' },
  { name: 'Absa Bank Kenya', code: '003', currency: 'KES', type: 'kepss' },
  { name: 'Standard Chartered Bank', code: '002', currency: 'KES', type: 'kepss' },
  { name: 'Diamond Trust Bank (DTB)', code: '063', currency: 'KES', type: 'kepss' },
  { name: 'Stanbic Bank', code: '031', currency: 'KES', type: 'kepss' },
  { name: 'I&M Bank', code: '067', currency: 'KES', type: 'kepss' },
];

let bankCache: { fetchedAt: number; banks: any[] } | null = null;

function generateReference(prefix: 'DEP' | 'DEV' | 'WD'): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

function fail(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof InsufficientFundsError) {
    return res.status(400).json({ message: error.message, code: 'INSUFFICIENT_FUNDS' });
  }

  if (error instanceof PaystackError) {
    let status = error.statusCode;
    if (!status || status < 400 || status > 499 || status === 401 || status === 403) {
      status = error.code === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 502;
    }
    return res.status(status).json({
      message: error.message,
      code: error.code || 'PAYSTACK_ERROR',
      ambiguous: error.ambiguous,
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({
    message: error instanceof Error ? error.message : fallbackMessage,
  });
}

function parseAmount(value: unknown): number {
  return roundMoney(Number(value));
}

export class WalletController {
  static async getBalance(req: AuthRequest, res: Response) {
    try {
      const balance = await WalletService.getBalance(req.user!.id);
      return res.json({
        ...balance,
        realBalance: roundMoney(balance.realBalance),
        demoBalance: roundMoney(balance.demoBalance),
        currency: getPaymentConfig().currency,
      });
    } catch (error) {
      return fail(res, error, 'Could not load balance');
    }
  }

  /** Public cashier configuration used by the client before opening checkout. */
  static async getConfig(_req: Request, res: Response) {
    const config = getPaymentConfig();
    return res.json({
      currency: config.currency,
      provider: 'paystack',
      paystackConfigured: PaystackService.isConfigured(),
      devDepositsEnabled: config.devDepositsEnabled,
      minDeposit: config.minDeposit,
      maxDeposit: config.maxDeposit,
      minWithdrawal: config.minWithdrawal,
      maxWithdrawal: config.maxWithdrawal,
    });
  }

  static async getBanks(_req: AuthRequest, res: Response) {
    if (!PaystackService.isConfigured()) {
      return res.json({ banks: FALLBACK_KENYAN_BANKS, source: 'fallback' });
    }

    if (bankCache && Date.now() - bankCache.fetchedAt < 60 * 60 * 1000) {
      return res.json({ banks: bankCache.banks, source: 'paystack' });
    }

    try {
      const banks = await PaystackService.getBankList('KES');
      const kepssBanks = banks.filter((bank) => bank.type === 'kepss');
      const normalized = (kepssBanks.length ? kepssBanks : banks).map((bank) => ({
        name: bank.name,
        code: bank.code,
        currency: bank.currency || 'KES',
        type: bank.type,
      }));
      bankCache = { fetchedAt: Date.now(), banks: normalized };
      return res.json({ banks: normalized, source: 'paystack' });
    } catch (error) {
      console.warn('Could not fetch Paystack bank list, using fallback:', error);
      return res.json({ banks: FALLBACK_KENYAN_BANKS, source: 'fallback' });
    }
  }

  static async refillDemo(req: AuthRequest, res: Response) {
    try {
      const demoBalance = await WalletService.resetDemoBalance(req.user!.id, 10000);
      return res.json({ message: 'Demo balance refilled', demoBalance });
    } catch (error) {
      return fail(res, error, 'Could not refill demo balance');
    }
  }

  /**
   * Initialize a Paystack checkout. The amount/currency are fixed by us and
   * recorded before redirecting, so the callback can never choose its own value.
   */
  static async initializeDeposit(req: AuthRequest, res: Response) {
    const config = getPaymentConfig();
    const amount = parseAmount(req.body?.amount);
    const requestedCurrency = String(req.body?.currency || config.currency).toUpperCase();

    if (!Number.isFinite(amount) || amount < config.minDeposit || amount > config.maxDeposit) {
      return res.status(400).json({
        message: `Deposit must be between ${config.currency} ${config.minDeposit.toLocaleString()} and ${config.currency} ${config.maxDeposit.toLocaleString()}`,
        code: 'INVALID_AMOUNT',
      });
    }
    if (requestedCurrency !== config.currency) {
      return res.status(400).json({
        message: `Deposits are only supported in ${config.currency}`,
        code: 'INVALID_CURRENCY',
      });
    }
    if (!PaystackService.isConfigured()) {
      return res.status(503).json({
        message: 'Card and M-Pesa deposits are not configured yet. Add a valid PAYSTACK_SECRET_KEY to enable them.',
        code: 'PAYSTACK_NOT_CONFIGURED',
      });
    }

    const reference = generateReference('DEP');
    // Guest/social logins often have no email. Paystack requires a valid one,
    // so derive a deterministic address instead of letting checkout fail.
    const rawEmail = String(req.user?.email || '').trim().toLowerCase();
    const handle = String(req.user?.username || 'player')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase() || 'player';
    // Paystack's validator rejects underscores in the local part, which guest
    // accounts use. Keep the real address when it's clean, otherwise derive one.
    let email = `${handle}@spotibet.app`;
    if (isValidEmail(rawEmail)) {
      const [local, domain] = rawEmail.split('@');
      const cleanLocal = local.replace(/[^a-z0-9.+-]/g, '');
      // Paystack also validates the domain; fake TLDs like .demo are rejected.
      const cleanDomain = /\.[a-z]{2,}$/.test(domain) && !/\.(demo|local|test)$/.test(domain)
        ? domain
        : 'spotibet.app';
      if (cleanLocal) email = `${cleanLocal}@${cleanDomain}`;
    }
    const method = String(req.body?.method || 'ANY').toUpperCase();
    const channels =
      method === 'MPESA' ? ['mobile_money'] : method === 'CARD' ? ['card'] : undefined;

    await prisma.paystackPayment.create({
      data: {
        userId: req.user!.id,
        reference,
        amount,
        currency: config.currency,
        status: 'INITIALIZED',
        metadata: JSON.stringify({ method }),
      },
    });

    try {
      const result = await PaystackService.initializePayment({
        email,
        amount,
        currency: config.currency,
        reference,
        callbackUrl: `${getFrontendUrl()}/?payment=callback&reference=${encodeURIComponent(reference)}`,
        channels,
        metadata: {
          userId: req.user!.id,
          username: req.user!.username,
          source: 'spotibet-cashier',
        },
      });

      if (!result?.authorization_url) {
        throw new Error('Paystack did not return a checkout URL');
      }

      await prisma.paystackPayment.update({
        where: { reference },
        data: { metadata: JSON.stringify({ method, accessCode: result.access_code }) },
      });

      return res.json({
        message: 'Deposit initialized',
        authorizationUrl: result.authorization_url,
        accessCode: result.access_code,
        reference,
        amount,
        currency: config.currency,
      });
    } catch (error) {
      await prisma.paystackPayment.updateMany({
        where: { reference, status: 'INITIALIZED' },
        data: { status: 'FAILED' },
      });
      return fail(res, error, 'Deposit initialization failed');
    }
  }

  /**
   * Development-only instant top-up so the wallet can be tested without live
   * Paystack credentials. Hard-disabled whenever NODE_ENV=production.
   */
  static async devDeposit(req: AuthRequest, res: Response) {
    const config = getPaymentConfig();
    if (!config.devDepositsEnabled) {
      return res.status(403).json({
        message: 'Development deposits are disabled.',
        code: 'DEV_DEPOSIT_DISABLED',
      });
    }

    const amount = parseAmount(req.body?.amount);
    if (!Number.isFinite(amount) || amount < config.minDeposit || amount > config.maxDeposit) {
      return res.status(400).json({
        message: `Test deposit must be between ${config.minDeposit} and ${config.maxDeposit} ${config.currency}`,
        code: 'INVALID_AMOUNT',
      });
    }

    const reference = generateReference('DEV');
    try {
      await prisma.paystackPayment.create({
        data: {
          userId: req.user!.id,
          reference,
          amount,
          currency: config.currency,
          status: 'INITIALIZED',
          metadata: JSON.stringify({ dev: true }),
        },
      });

      const result = await WalletService.creditDeposit({
        userId: req.user!.id,
        reference,
        paystackAmountSubunit: Math.round(amount * 100),
        paystackCurrency: config.currency,
        channel: 'development',
      });

      return res.json({
        message: 'Test deposit credited',
        reference,
        amount,
        currency: config.currency,
        balance: result.newBalance,
      });
    } catch (error) {
      await prisma.paystackPayment.updateMany({
        where: { reference, status: 'INITIALIZED' },
        data: { status: 'FAILED' },
      });
      return fail(res, error, 'Test deposit failed');
    }
  }

  /**
   * Called when the player returns from Paystack checkout. The reference is
   * looked up in our database and must belong to the authenticated user before
   * we ever ask Paystack about it.
   */
  static async verifyDeposit(req: AuthRequest, res: Response) {
    const reference = String(req.params.reference || '');
    if (!reference || reference.length > 120) {
      return res.status(400).json({ message: 'Reference is required', code: 'INVALID_REFERENCE' });
    }

    const payment = await prisma.paystackPayment.findUnique({ where: { reference } });
    // Return 404 for another user's reference so references cannot be probed.
    if (!payment || payment.userId !== req.user!.id) {
      return res.status(404).json({ message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' });
    }

    if (payment.status === 'SUCCESS') {
      const balance = await WalletService.getBalance(req.user!.id);
      return res.json({
        status: 'SUCCESS',
        alreadyProcessed: true,
        balance: roundMoney(balance.realBalance),
        amount: roundMoney(payment.amount),
        currency: payment.currency,
      });
    }

    if (!PaystackService.isConfigured()) {
      return res.status(503).json({
        message: 'Paystack is not configured, so this payment cannot be verified.',
        code: 'PAYSTACK_NOT_CONFIGURED',
      });
    }

    try {
      const transaction = await PaystackService.verifyPayment(reference);

      if (String(transaction.reference) !== reference) {
        return res.status(400).json({
          message: 'Paystack returned a mismatched reference',
          code: 'REFERENCE_MISMATCH',
        });
      }

      if (transaction.status !== 'success') {
        if (['failed', 'abandoned', 'reversed'].includes(transaction.status)) {
          await prisma.paystackPayment.updateMany({
            where: { reference, status: { not: 'SUCCESS' } },
            data: { status: 'FAILED' },
          });
        }
        return res.status(400).json({
          status: transaction.status,
          message: `Payment is ${transaction.status}`,
          code: 'PAYMENT_NOT_SUCCESSFUL',
        });
      }

      const result = await WalletService.creditDeposit({
        userId: payment.userId,
        reference,
        paystackAmountSubunit: transaction.amount,
        paystackCurrency: transaction.currency,
        channel: transaction.channel,
      });

      return res.json({
        status: 'SUCCESS',
        alreadyProcessed: result.alreadyProcessed,
        message: 'Payment verified and credited',
        balance: result.newBalance,
        amount: roundMoney(payment.amount),
        currency: payment.currency,
      });
    } catch (error) {
      return fail(res, error, 'Deposit verification failed');
    }
  }

  /**
   * Paystack webhook endpoint. Signature is checked against the exact raw
   * request bytes captured by express.json({ verify }), never re-serialized.
   */
  static async handleWebhook(req: Request, res: Response) {
    if (!PaystackService.isConfigured()) {
      console.error('[Paystack Webhook] Received but PAYSTACK_SECRET_KEY is not configured');
      return res.status(503).json({ message: 'Paystack is not configured' });
    }

    const signature = req.headers['x-paystack-signature'];
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (
      typeof signature !== 'string' ||
      !rawBody ||
      !PaystackService.verifyWebhookSignature(rawBody, signature)
    ) {
      console.warn('[Paystack Webhook] Invalid or missing signature rejected');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const event = req.body || {};
    const eventName = String(event.event || '');
    const data = event.data || {};

    try {
      switch (eventName) {
        case 'charge.success': {
          const reference = String(data.reference || '');
          const payment = reference
            ? await prisma.paystackPayment.findUnique({ where: { reference } })
            : null;

          if (!payment) {
            console.warn(`[Paystack Webhook] Ignoring unknown charge reference ${reference}`);
            break;
          }

          try {
            await WalletService.creditDeposit({
              userId: payment.userId,
              reference,
              paystackAmountSubunit: Number(data.amount),
              paystackCurrency: String(data.currency || ''),
              channel: data.channel,
            });
          } catch (error) {
            // Amount/currency mismatches are security events. Acknowledge the
            // webhook (so Paystack stops retrying) but never credit.
            if (
              error instanceof Error &&
              (error.message.includes('does not match') || error.message.includes('mismatch'))
            ) {
              console.error(
                `[PAYMENT RECONCILIATION] Charge ${reference} failed validation: ${error.message}`
              );
              break;
            }
            throw error;
          }
          break;
        }

        case 'transfer.success': {
          await WalletService.completeWithdrawal(
            String(data.reference || ''),
            data.transfer_code ? String(data.transfer_code) : undefined
          );
          break;
        }

        case 'transfer.failed': {
          const reason = String(data.reason || data.fail_reason || 'Transfer failed');
          await WalletService.failWithdrawal(String(data.reference || ''), reason);
          break;
        }

        case 'transfer.reversed': {
          const reason = String(data.reason || 'Transfer reversed by provider');
          await WalletService.reverseWithdrawal(String(data.reference || ''), reason);
          break;
        }

        case 'charge.failed': {
          await prisma.paystackPayment.updateMany({
            where: { reference: String(data.reference || ''), status: 'INITIALIZED' },
            data: { status: 'FAILED' },
          });
          break;
        }

        default:
          // Unknown event types are acknowledged so Paystack does not retry.
          break;
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      // Return 500 on transient failures so Paystack retries the webhook.
      console.error('[Paystack Webhook] Processing failed:', error);
      return res.status(500).json({ message: 'Webhook processing failed' });
    }
  }

  /**
   * Withdraw to M-Pesa (individual) or a Kenyan bank account (KEPSS).
   *
   * Sequence: atomically debit + create ledger, then create recipient, then
   * initiate transfer. Definitive failures are refunded automatically; unknown
   * outcomes stay pending so the webhook can decide without double-paying.
   */
  static async requestWithdrawal(req: AuthRequest, res: Response) {
    const config = getPaymentConfig();
    const amount = parseAmount(req.body?.amount);
    const requestedChannel = String(req.body?.channel || 'MOBILE_MONEY').toUpperCase();
    const channel = requestedChannel === 'BANK' ? 'BANK' : 'MOBILE_MONEY';

    if (!Number.isFinite(amount) || amount < config.minWithdrawal || amount > config.maxWithdrawal) {
      return res.status(400).json({
        message: `Withdrawal must be between ${config.currency} ${config.minWithdrawal.toLocaleString()} and ${config.currency} ${config.maxWithdrawal.toLocaleString()}`,
        code: 'INVALID_AMOUNT',
      });
    }
    if (!PaystackService.isConfigured()) {
      return res.status(503).json({
        message: 'Payouts are not configured yet. Add a valid PAYSTACK_SECRET_KEY to enable withdrawals.',
        code: 'PAYSTACK_NOT_CONFIGURED',
      });
    }

    let provider: string;
    let destination: string;
    let accountName: string;
    let bankCode = '';

    if (channel === 'MOBILE_MONEY') {
      const normalizedPhone = normalizeKenyanPhone(
        String(req.body?.phone || req.body?.accountNumber || '')
      );
      if (!normalizedPhone) {
        return res.status(400).json({
          message: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.',
          code: 'INVALID_PHONE',
        });
      }
      provider = 'MPESA';
      destination = normalizedPhone;
      accountName = String(req.body?.accountName || req.user!.username).trim();
      bankCode = 'MPESA';
    } else {
      const rawAccount = String(req.body?.accountNumber || '').replace(/\s+/g, '');
      bankCode = String(req.body?.bankCode || '').trim();
      accountName = String(req.body?.accountName || '').trim();

      if (!/^[A-Za-z0-9]{5,24}$/.test(rawAccount)) {
        return res.status(400).json({
          message: 'Enter a valid bank account number.',
          code: 'INVALID_ACCOUNT_NUMBER',
        });
      }
      if (!/^[A-Za-z0-9]{2,10}$/.test(bankCode)) {
        return res.status(400).json({ message: 'Select a valid bank.', code: 'INVALID_BANK' });
      }
      if (accountName.length < 3) {
        return res.status(400).json({
          message: 'Enter the account holder full name.',
          code: 'INVALID_ACCOUNT_NAME',
        });
      }

      provider = 'KEPSS';
      destination = rawAccount;
    }

    const reference = generateReference('WD');
    let created: { withdrawal: any; newBalance: number };

    try {
      created = await WalletService.createWithdrawal({
        userId: req.user!.id,
        reference,
        amount,
        currency: config.currency,
        channel,
        provider,
        accountNumber: destination,
        accountName,
      });
    } catch (error) {
      return fail(res, error, 'Withdrawal failed');
    }

    try {
      const recipient = await PaystackService.createTransferRecipient({
        type: channel === 'BANK' ? 'kepss' : 'mobile_money',
        name: accountName,
        accountNumber: destination,
        bankCode,
        currency: config.currency,
      });

      const transfer = await PaystackService.initiateTransfer({
        recipientCode: recipient.recipient_code,
        amount,
        currency: config.currency,
        reference,
        reason: `Spotibet withdrawal ${reference}`,
      });

      await WalletService.markWithdrawalProcessing({
        reference,
        recipientCode: recipient.recipient_code,
        transferCode: transfer.transfer_code,
      });

      if (String(transfer.status || '').toLowerCase() === 'success') {
        await WalletService.completeWithdrawal(reference, transfer.transfer_code);
      }

      return res.status(202).json({
        message: 'Withdrawal submitted for payout',
        reference,
        status: 'PROCESSING',
        amount,
        currency: config.currency,
        channel,
        balance: created.newBalance,
      });
    } catch (error) {
      if (error instanceof PaystackError && error.ambiguous) {
        // The transfer may still land. Keep the debit and wait for webhook.
        await prisma.withdrawal.updateMany({
          where: { reference, status: 'PENDING' },
          data: { status: 'PROCESSING', failureReason: 'Awaiting provider confirmation' },
        });
        return res.status(202).json({
          message: 'Withdrawal is processing. We will confirm the payout shortly.',
          reference,
          status: 'PROCESSING',
          amount,
          currency: config.currency,
          channel,
          balance: created.newBalance,
        });
      }

      const reason = error instanceof Error ? error.message : 'Payout failed';
      const refund = await WalletService.failWithdrawal(reference, reason);
      const refundedBalance =
        refund && 'newBalance' in refund ? (refund as any).newBalance : created.newBalance;

      return res.status(502).json({
        message: `Withdrawal could not be processed and your balance was restored: ${reason}`,
        code: 'WITHDRAWAL_FAILED',
        reference,
        refunded: refund?.refunded ?? false,
        balance: refundedBalance,
      });
    }
  }

  static async getWithdrawals(req: AuthRequest, res: Response) {
    try {
      const withdrawals = await WalletService.getWithdrawals(req.user!.id);
      return res.json({ withdrawals });
    } catch (error) {
      return fail(res, error, 'Could not load withdrawals');
    }
  }

  static async getTransactions(req: AuthRequest, res: Response) {
    try {
      const transactions = await prisma.walletTransaction.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return res.json({ transactions });
    } catch (error) {
      return fail(res, error, 'Could not load transactions');
    }
  }

  static async getBets(req: AuthRequest, res: Response) {
    try {
      const bets = await prisma.bet.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return res.json({ bets });
    } catch (error) {
      return fail(res, error, 'Could not load bets');
    }
  }
}
