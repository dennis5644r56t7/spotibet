/**
 * Central payment configuration.
 *
 * Everything is resolved lazily from process.env so that dotenv has always
 * finished loading before a value is read (the previous Paystack config was
 * captured at import time and therefore permanently saw the placeholder key).
 */

export type WithdrawalChannel = 'MOBILE_MONEY' | 'BANK';

function readAmount(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function getPaymentConfig() {
  return {
    currency: (process.env.DEFAULT_CURRENCY || 'KES').toUpperCase(),
    minDeposit: readAmount('MIN_DEPOSIT', 50),
    maxDeposit: readAmount('MAX_DEPOSIT', 500000),
    minWithdrawal: readAmount('MIN_WITHDRAWAL', 100),
    maxWithdrawal: readAmount('MAX_WITHDRAWAL', 500000),
    // Dev top-ups mint real currency, so they must never exist in production
    // and must be explicitly opted into.
    devDepositsEnabled:
      process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_DEPOSIT === 'true',
  };
}

/** Round to the smallest supported currency unit (2 decimal places for KES). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Paystack expects amounts in the lowest currency unit (cents). */
export function toSubunit(amount: number): number {
  return Math.round(roundMoney(amount) * 100);
}

export function fromSubunit(subunit: number): number {
  return roundMoney(Number(subunit) / 100);
}

/**
 * Normalise Kenyan mobile numbers to the 2547XXXXXXXX / 2541XXXXXXXX form
 * Paystack expects. Accepts 07..., 01..., +254..., 254... and 7... inputs.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = String(input || '').replace(/[^\d]/g, '');
  let normalized = digits;

  if (/^0[71]\d{8}$/.test(digits)) {
    normalized = `254${digits.slice(1)}`;
  } else if (/^[71]\d{8}$/.test(digits)) {
    normalized = `254${digits}`;
  }

  return /^254[71]\d{8}$/.test(normalized) ? normalized : null;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}
