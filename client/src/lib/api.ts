const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('casino_token');
}

export function setAuthToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('casino_token', token);
  }
}

export function removeAuthToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('casino_token');
    localStorage.removeItem('casino_user');
  }
}

async function request(endpoint: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

export interface WalletConfig {
  currency: string;
  provider: 'paystack';
  paystackConfigured: boolean;
  devDepositsEnabled: boolean;
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
}

export interface Bank {
  name: string;
  code: string;
  currency?: string;
  type?: string;
}

export const api = {
  // Auth
  register: (payload: { email: string; username: string; password: string }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  
  login: (payload: { login: string; password: string }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  
  guest: () =>
    request('/auth/guest', { method: 'POST' }),

  me: () =>
    request('/auth/me'),

  // Wallet & Paystack
  getWalletConfig: (): Promise<WalletConfig> =>
    request('/wallet/config'),

  getBalance: () =>
    request('/wallet/balance'),

  refillDemo: () =>
    request('/wallet/refill-demo', { method: 'POST' }),

  deposit: (amount: number, currency = 'KES', method: 'MPESA' | 'CARD' | 'BANK' = 'MPESA') =>
    request('/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify({ amount, currency, method }),
    }),

  devDeposit: (amount: number) =>
    request('/wallet/dev-deposit', { method: 'POST', body: JSON.stringify({ amount }) }),

  verifyDeposit: (reference: string) =>
    request(`/wallet/verify/${encodeURIComponent(reference)}`),

  getBanks: (): Promise<{ banks: Bank[]; source: string }> =>
    request('/wallet/banks'),

  withdraw: (payload: {
    amount: number;
    channel: 'MOBILE_MONEY' | 'BANK';
    phone?: string;
    bankCode?: string;
    accountNumber: string;
    accountName: string;
  }) =>
    request('/wallet/withdraw', { method: 'POST', body: JSON.stringify(payload) }),

  getWithdrawals: () =>
    request('/wallet/withdrawals'),

  getTransactions: () =>
    request('/wallet/transactions'),

  getBets: () =>
    request('/wallet/bets'),

  // Casino
  playRoulette: (payload: { bets: any[]; balanceType: 'REAL' | 'DEMO'; clientSeed?: string }) =>
    request('/casino/roulette/spin', { method: 'POST', body: JSON.stringify(payload) }),

  startMines: (payload: { amount: number; mineCount: number; balanceType: 'REAL' | 'DEMO'; clientSeed?: string }) =>
    request('/casino/mines/start', { method: 'POST', body: JSON.stringify(payload) }),

  revealMines: (payload: { sessionId: string; tileIndex: number }) =>
    request('/casino/mines/reveal', { method: 'POST', body: JSON.stringify(payload) }),

  abandonMines: () =>
    request('/casino/mines/abandon', { method: 'POST', body: JSON.stringify({}) }),

  cashoutMines: (payload: { sessionId: string }) =>
    request('/casino/mines/cashout', { method: 'POST', body: JSON.stringify(payload) }),

  dealBlackjack: (payload: { amount: number; balanceType: 'REAL' | 'DEMO'; clientSeed?: string }) =>
    request('/casino/blackjack/deal', { method: 'POST', body: JSON.stringify(payload) }),

  abandonBlackjack: () =>
    request('/casino/blackjack/abandon', { method: 'POST', body: JSON.stringify({}) }),

  hitBlackjack: (sessionId: string) =>
    request('/casino/blackjack/hit', { method: 'POST', body: JSON.stringify({ sessionId }) }),

  standBlackjack: (sessionId: string) =>
    request('/casino/blackjack/stand', { method: 'POST', body: JSON.stringify({ sessionId }) }),

  doubleBlackjack: (sessionId: string) =>
    request('/casino/blackjack/double', { method: 'POST', body: JSON.stringify({ sessionId }) }),

  spinSlots: (payload: { amount: number; balanceType: 'REAL' | 'DEMO'; clientSeed?: string }) =>
    request('/casino/slots/spin', { method: 'POST', body: JSON.stringify(payload) }),

  rollDice: (payload: { amount: number; balanceType: 'REAL' | 'DEMO' }) =>
    request('/casino/dice/roll', { method: 'POST', body: JSON.stringify(payload) }),

  verifyFairness: (payload: { gameType: string; serverSeed: string; clientSeed: string; nonce: number; mineCount?: number }) =>
    request('/casino/verify-fairness', { method: 'POST', body: JSON.stringify(payload) }),
};
