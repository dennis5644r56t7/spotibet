import axios, { AxiosError, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { roundMoney, toSubunit } from '../config/payments';

/**
 * Errors raised by the Paystack integration.
 *
 * `ambiguous` means Paystack may still have processed the request even though
 * we did not receive a definitive answer (network error / 5xx / timeout). Money
 * must NOT be automatically refunded in that case because the payout could
 * still land; the withdrawal stays pending for webhook reconciliation.
 */
export class PaystackError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly ambiguous: boolean = false,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

export interface PaystackTransaction {
  id?: number;
  status: string;
  reference: string;
  amount: number; // subunits (cents)
  currency: string;
  channel?: string;
  paid_at?: string | null;
  gateway_response?: string;
  metadata?: Record<string, any> | string | null;
}

export interface PaystackTransfer {
  id?: number;
  status: string;
  reference: string;
  amount: number;
  currency?: string;
  recipient?: string;
  transfer_code?: string;
  reason?: string;
  fail_reason?: string | null;
}

export interface PaystackRecipient {
  recipient_code: string;
  type: string;
  name: string;
  details?: Record<string, any>;
}

export interface PaystackBank {
  id?: number;
  name: string;
  code: string;
  currency: string;
  type: string;
  active?: boolean;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

const REQUEST_TIMEOUT_MS = 20_000;

export class PaystackService {
  /** Resolve the secret lazily so dotenv/config is always loaded first. */
  static getSecretKey(): string {
    const key = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
    if (!key || key.toLowerCase().includes('placeholder')) return '';
    return key;
  }

  static isConfigured(): boolean {
    return this.getSecretKey().length > 0;
  }

  private static requireSecretKey(): string {
    const key = this.getSecretKey();
    if (!key) {
      throw new PaystackError(
        'Paystack is not configured. Set a valid PAYSTACK_SECRET_KEY before accepting payments.',
        503,
        false,
        'PAYSTACK_NOT_CONFIGURED'
      );
    }
    return key;
  }

  private static getBaseUrl(): string {
    return (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/+$/, '');
  }

  private static client() {
    return axios.create({
      baseURL: this.getBaseUrl(),
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${this.requireSecretKey()}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private static async send<T>(
    request: () => Promise<AxiosResponse<PaystackEnvelope<T>>>
  ): Promise<T> {
    try {
      const response = await request();
      if (!response.data?.status) {
        throw new PaystackError(
          response.data?.message || 'Paystack rejected the request',
          response.status || 502,
          false,
          'PAYSTACK_REJECTED'
        );
      }
      return response.data.data;
    } catch (error) {
      if (error instanceof PaystackError) throw error;

      const axiosError = error as AxiosError<PaystackEnvelope<unknown>>;
      const statusCode = axiosError.response?.status;
      const message =
        (axiosError.response?.data as any)?.message ||
        axiosError.message ||
        'Paystack request failed';
      // No response, a timeout, or a 5xx means the outcome is unknown.
      const ambiguous = !axiosError.response || (statusCode !== undefined && statusCode >= 500);

      throw new PaystackError(message, statusCode, ambiguous, axiosError.code);
    }
  }

  static async initializePayment(params: {
    email: string;
    amount: number; // major units, e.g. KES 500
    currency: string;
    reference: string;
    callbackUrl?: string;
    channels?: string[];
    metadata?: Record<string, any>;
  }): Promise<{ authorization_url: string; access_code: string; reference: string }> {
    return this.send(() =>
      this.client().post('/transaction/initialize', {
        email: params.email,
        amount: toSubunit(params.amount),
        currency: params.currency,
        reference: params.reference,
        callback_url: params.callbackUrl,
        channels: params.channels?.length ? params.channels : undefined,
        metadata: params.metadata,
      })
    );
  }

  static async verifyPayment(reference: string): Promise<PaystackTransaction> {
    return this.send(() =>
      this.client().get(`/transaction/verify/${encodeURIComponent(reference)}`)
    );
  }

  /**
   * Paystack signs webhooks with HMAC-SHA512 over the exact raw request bytes
   * using the secret key. Re-serialising the parsed JSON breaks the signature.
   */
  static verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const secret = this.getSecretKey();
    if (!secret || !signature) return false;

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const expected = crypto.createHmac('sha512', secret).update(body).digest('hex');
    const provided = String(signature).trim().toLowerCase();

    if (expected.length !== provided.length) return false;

    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  }

  static async getBankList(currency = 'KES', type?: string): Promise<PaystackBank[]> {
    const params = new URLSearchParams({ currency });
    if (type) params.set('type', type);

    return this.send(() => this.client().get(`/bank?${params.toString()}`));
  }

  /**
   * Kenyan recipients:
   *  - individual M-Pesa:  type=mobile_money, bank_code=MPESA
   *  - bank account:       type=kepss,        bank_code=<bank code>
   */
  static async createTransferRecipient(params: {
    type: 'mobile_money' | 'kepss';
    name: string;
    accountNumber: string;
    bankCode: string;
    currency: string;
  }): Promise<PaystackRecipient> {
    return this.send(() =>
      this.client().post('/transferrecipient', {
        type: params.type,
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: params.currency,
      })
    );
  }

  static async initiateTransfer(params: {
    recipientCode: string;
    amount: number;
    currency: string;
    reference: string;
    reason?: string;
  }): Promise<PaystackTransfer> {
    return this.send(() =>
      this.client().post('/transfer', {
        source: 'balance',
        recipient: params.recipientCode,
        amount: toSubunit(roundMoney(params.amount)),
        currency: params.currency,
        reference: params.reference,
        reason: params.reason || 'Spotibet withdrawal payout',
      })
    );
  }
}
