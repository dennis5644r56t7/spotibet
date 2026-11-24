import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { WalletController } from '../controllers/wallet.controller';
import { CasinoController } from '../controllers/casino.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// --- Auth Routes ---
router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);
router.post('/auth/guest', AuthController.guest);
router.get('/auth/me', authMiddleware, AuthController.me);

// --- Wallet & Paystack Routes ---
router.get('/wallet/config', WalletController.getConfig);
router.get('/wallet/balance', authMiddleware, WalletController.getBalance);
router.get('/wallet/banks', authMiddleware, WalletController.getBanks);
router.post('/wallet/refill-demo', authMiddleware, WalletController.refillDemo);
router.post('/wallet/deposit', authMiddleware, WalletController.initializeDeposit);
router.post('/wallet/dev-deposit', authMiddleware, WalletController.devDeposit);
router.get('/wallet/verify/:reference', authMiddleware, WalletController.verifyDeposit);
router.post('/wallet/withdraw', authMiddleware, WalletController.requestWithdrawal);
router.get('/wallet/withdrawals', authMiddleware, WalletController.getWithdrawals);
router.get('/wallet/transactions', authMiddleware, WalletController.getTransactions);
router.get('/wallet/bets', authMiddleware, WalletController.getBets);
router.post('/wallet/paystack/webhook', WalletController.handleWebhook);

// --- Casino Routes ---
router.post('/casino/roulette/spin', authMiddleware, CasinoController.playRoulette);

router.post('/casino/mines/start', authMiddleware, CasinoController.startMines);
router.post('/casino/mines/abandon', authMiddleware, CasinoController.abandonMines);
router.post('/casino/mines/reveal', authMiddleware, CasinoController.revealMinesTile);
router.post('/casino/mines/cashout', authMiddleware, CasinoController.cashoutMines);

router.post('/casino/blackjack/deal', authMiddleware, CasinoController.dealBlackjack);
router.post('/casino/blackjack/abandon', authMiddleware, CasinoController.abandonBlackjack);
router.post('/casino/blackjack/hit', authMiddleware, CasinoController.hitBlackjack);
router.post('/casino/blackjack/stand', authMiddleware, CasinoController.standBlackjack);
router.post('/casino/blackjack/double', authMiddleware, CasinoController.doubleBlackjack);

router.post('/casino/slots/spin', authMiddleware, CasinoController.spinSlots);

router.post('/casino/verify-fairness', CasinoController.verifyFairness);

router.post('/casino/dice/roll', authMiddleware, CasinoController.rollDice);

export default router;
