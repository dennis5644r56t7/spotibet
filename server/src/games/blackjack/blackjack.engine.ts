import { ProvablyFair } from '../../utils/provably-fair';
import { WalletService, BalanceType } from '../../services/wallet.service';
import { HousePoolService, PendingPoolRound } from '../../services/house-pool.service';

export interface Card {
  rank: string;
  suit: string;
  value: number;
}

export interface BlackjackSession {
  sessionId: string;
  userId: string;
  betId: string;
  amount: number;
  balanceType: BalanceType;
  deck: string[];
  playerHand: string[];
  dealerHand: string[];
  status: 'PLAYER_TURN' | 'DEALER_TURN' | 'RESOLVED';
  result?: 'PLAYER_WIN' | 'DEALER_WIN' | 'PUSH' | 'BLACKJACK';
  payout?: number;
  multiplier?: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  startedAt: number; // epoch ms for TTL expiry
  poolRound: PendingPoolRound; // house pool tracking for this hand
}

export class BlackjackEngine {
  private static sessions = new Map<string, BlackjackSession>();

  /** Abandoned Blackjack hands (no client interaction) auto-expire after this long. */
  private static readonly SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /** Collect & remove a user's over / expired hands, returning the un-refunded ones. */
  private static collectStaleSessions(userId: string): BlackjackSession[] {
    const now = Date.now();
    const stale: BlackjackSession[] = [];

    for (const [id, s] of this.sessions.entries()) {
      if (s.userId !== userId) continue;

      const expired = s.startedAt ? now - s.startedAt > this.SESSION_TTL_MS : false;

      if (s.status === 'RESOLVED' || expired) {
        if (s.status !== 'RESOLVED') stale.push(s);
        this.sessions.delete(id);
      }
    }

    return stale;
  }

  /** Refund un-finished abandoned hands (bet was already deducted at deal). */
  private static async refundStaleSessions(stale: BlackjackSession[]): Promise<void> {
    for (const s of stale) {
      try {
        await WalletService.refundBet({
          userId: s.userId,
          betId: s.betId,
          amount: s.amount,
          balanceType: s.balanceType,
          gameType: 'BLACKJACK',
        });
      } catch (err) {
        console.error(`[Blackjack] Failed to refund abandoned session ${s.sessionId}:`, err);
      }
    }
  }

  /** Abandon the user's active un-finished hand, if any, refunding its bet. */
  public static async abandonActiveSession(userId: string): Promise<boolean> {
    let abandoned = false;
    for (const [id, s] of this.sessions.entries()) {
      if (s.userId === userId && s.status !== 'RESOLVED') {
        await this.refundStaleSessions([s]);
        this.sessions.delete(id);
        abandoned = true;
      }
    }
    return abandoned;
  }

  public static calculateHandScore(cards: string[]): { score: number; isSoft: boolean; isBlackjack: boolean } {
    let score = 0;
    let aces = 0;

    for (const card of cards) {
      const rank = card.slice(0, -1);
      if (rank === 'A') {
        aces++;
        score += 11;
      } else if (['K', 'Q', 'J', '10'].includes(rank)) {
        score += 10;
      } else {
        score += parseInt(rank, 10);
      }
    }

    while (score > 21 && aces > 0) {
      score -= 10;
      aces--;
    }

    const isBlackjack = cards.length === 2 && score === 21;
    return { score, isSoft: aces > 0, isBlackjack };
  }

  public static async deal(params: {
    userId: string;
    amount: number;
    balanceType: BalanceType;
    clientSeed?: string;
  }) {
    // Clean up any stale / abandoned hands before dealing a new one.
    const stale = this.collectStaleSessions(params.userId);
    await this.refundStaleSessions(stale);

    const serverSeed = ProvablyFair.generateServerSeed();
    const serverSeedHash = ProvablyFair.hashServerSeed(serverSeed);
    const clientSeed = params.clientSeed || 'blackjack_player_seed';
    const nonce = Date.now();

    const deck = ProvablyFair.shuffleDeck(serverSeed, clientSeed, nonce);

    // Initial 2 cards each: Player, Dealer, Player, Dealer
    const playerHand = [deck.pop()!, deck.pop()!];
    const dealerHand = [deck.pop()!, deck.pop()!];

    const { bet, newBalance } = await WalletService.placeBet({
      userId: params.userId,
      amount: params.amount,
      balanceType: params.balanceType,
      gameType: 'BLACKJACK',
      betData: { playerHand, dealerUpCard: dealerHand[0] },
    });

    const playerCalc = this.calculateHandScore(playerHand);
    const dealerCalc = this.calculateHandScore(dealerHand);

    let session: BlackjackSession = {
      sessionId: bet.id,
      userId: params.userId,
      betId: bet.id,
      amount: params.amount,
      balanceType: params.balanceType,
      deck,
      playerHand,
      dealerHand,
      status: 'PLAYER_TURN',
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      startedAt: Date.now(),
    };

    // Check immediate Natural Blackjack
    if (playerCalc.isBlackjack) {
      if (dealerCalc.isBlackjack) {
        // Push
        session.status = 'RESOLVED';
        session.result = 'PUSH';
        session.multiplier = 1.0;
        session.payout = session.amount;
        const res = await WalletService.settleWin({
          userId: params.userId,
          betId: bet.id,
          payout: session.amount,
          multiplier: 1.0,
          balanceType: params.balanceType,
          gameType: 'BLACKJACK',
        });
        return { session: this.formatClientSession(session, true), newBalance: res.newBalance };
      } else {
        // Player Blackjack 3:2 payout (2.5x total payout)
        session.status = 'RESOLVED';
        session.result = 'BLACKJACK';
        session.multiplier = 2.5;
        session.payout = session.amount * 2.5;
        const res = await WalletService.settleWin({
          userId: params.userId,
          betId: bet.id,
          payout: session.payout,
          multiplier: 2.5,
          balanceType: params.balanceType,
          gameType: 'BLACKJACK',
        });
        return { session: this.formatClientSession(session, true), newBalance: res.newBalance };
      }
    }

    this.sessions.set(session.sessionId, session);
    return { session: this.formatClientSession(session, false), newBalance };
  }

  public static async hit(params: { sessionId: string; userId: string }) {
    const session = this.sessions.get(params.sessionId);
    if (!session || session.userId !== params.userId || session.status !== 'PLAYER_TURN') {
      throw new Error('Active hand not found');
    }

    session.playerHand.push(session.deck.pop()!);
    const playerCalc = this.calculateHandScore(session.playerHand);

    if (playerCalc.score > 21) {
      // Player Bust!
      session.status = 'RESOLVED';
      session.result = 'DEALER_WIN';
      session.multiplier = 0;
      session.payout = 0;
      await WalletService.settleLoss(session.betId);
      this.sessions.delete(session.sessionId);
      return { session: this.formatClientSession(session, true) };
    }

    return { session: this.formatClientSession(session, false) };
  }

  public static async stand(params: { sessionId: string; userId: string }) {
    const session = this.sessions.get(params.sessionId);
    if (!session || session.userId !== params.userId || session.status !== 'PLAYER_TURN') {
      throw new Error('Active hand not found');
    }

    session.status = 'DEALER_TURN';

    // Dealer draws until score is 17 or more
    let dealerCalc = this.calculateHandScore(session.dealerHand);
    while (dealerCalc.score < 17) {
      session.dealerHand.push(session.deck.pop()!);
      dealerCalc = this.calculateHandScore(session.dealerHand);
    }

    const playerCalc = this.calculateHandScore(session.playerHand);
    session.status = 'RESOLVED';

    let newBalance: number | undefined;

    if (dealerCalc.score > 21 || playerCalc.score > dealerCalc.score) {
      // Player Wins 1:1
      session.result = 'PLAYER_WIN';
      session.multiplier = 2.0;
      session.payout = session.amount * 2.0;
      const res = await WalletService.settleWin({
        userId: session.userId,
        betId: session.betId,
        payout: session.payout,
        multiplier: 2.0,
        balanceType: session.balanceType,
        gameType: 'BLACKJACK',
      });
      newBalance = res.newBalance;
    } else if (playerCalc.score === dealerCalc.score) {
      // Push
      session.result = 'PUSH';
      session.multiplier = 1.0;
      session.payout = session.amount;
      const res = await WalletService.settleWin({
        userId: session.userId,
        betId: session.betId,
        payout: session.amount,
        multiplier: 1.0,
        balanceType: session.balanceType,
        gameType: 'BLACKJACK',
      });
      newBalance = res.newBalance;
    } else {
      // Dealer Wins
      session.result = 'DEALER_WIN';
      session.multiplier = 0;
      session.payout = 0;
      await WalletService.settleLoss(session.betId);
    }

    this.sessions.delete(session.sessionId);
    return { session: this.formatClientSession(session, true), newBalance };
  }

  public static async doubleDown(params: { sessionId: string; userId: string }) {
    const session = this.sessions.get(params.sessionId);
    if (!session || session.userId !== params.userId || session.status !== 'PLAYER_TURN') {
      throw new Error('Active hand not found');
    }
    if (session.playerHand.length !== 2) {
      throw new Error('Double down is only allowed on the first two cards');
    }

    // Deduct additional bet amount equal to original bet
    await WalletService.placeBet({
      userId: session.userId,
      amount: session.amount,
      balanceType: session.balanceType,
      gameType: 'BLACKJACK',
      betData: { action: 'DOUBLE_DOWN' },
    });

    session.amount *= 2;

    // Draw exactly one card then stand
    session.playerHand.push(session.deck.pop()!);
    const playerCalc = this.calculateHandScore(session.playerHand);

    if (playerCalc.score > 21) {
      session.status = 'RESOLVED';
      session.result = 'DEALER_WIN';
      session.multiplier = 0;
      session.payout = 0;
      await WalletService.settleLoss(session.betId);
      this.sessions.delete(session.sessionId);
      return { session: this.formatClientSession(session, true) };
    }

    return this.stand(params);
  }

  private static formatClientSession(session: BlackjackSession, revealDealerHoleCard: boolean) {
    const playerCalc = this.calculateHandScore(session.playerHand);
    const visibleDealerCards = revealDealerHoleCard
      ? session.dealerHand
      : [session.dealerHand[0], 'HIDDEN'];
    const dealerCalc = revealDealerHoleCard
      ? this.calculateHandScore(session.dealerHand)
      : { score: this.calculateHandScore([session.dealerHand[0]]).score, isSoft: false, isBlackjack: false };

    return {
      sessionId: session.sessionId,
      amount: session.amount,
      playerHand: session.playerHand,
      playerScore: playerCalc.score,
      dealerHand: visibleDealerCards,
      dealerScore: dealerCalc.score,
      status: session.status,
      result: session.result,
      payout: session.payout,
      multiplier: session.multiplier,
      serverSeedHash: session.serverSeedHash,
      serverSeed: revealDealerHoleCard ? session.serverSeed : undefined,
    };
  }
}
