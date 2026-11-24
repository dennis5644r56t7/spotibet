import { ProvablyFair } from '../../utils/provably-fair';
import { WalletService, BalanceType } from '../../services/wallet.service';
import { HousePoolService, PendingPoolRound } from '../../services/house-pool.service';

export interface MinesSession {
  sessionId: string;
  userId: string;
  betId: string;
  amount: number;
  balanceType: BalanceType;
  mineCount: number;
  mines: number[]; // hidden from client until round ends
  revealedTiles: number[];
  currentMultiplier: number;
  isOver: boolean;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  startedAt: number; // epoch ms for TTL expiry
  poolRound: PendingPoolRound; // house pool tracking for this bet
}

export class MinesEngine {
  private static sessions = new Map<string, MinesSession>();

  /**
   * A Mines session with no client interaction is considered abandoned after
   * this long. Expired sessions are auto-refunded so a page refresh or disconnect
   * never leaves a user stuck with an active game.
   */
  private static readonly SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Remove all sessions belonging to a user that are either already over or have
   * gone past their TTL. Returns the abandoned (un-refunded) sessions to refund.
   */
  private static collectStaleSessions(userId: string): MinesSession[] {
    const now = Date.now();
    const stale: MinesSession[] = [];

    for (const [id, s] of this.sessions.entries()) {
      if (s.userId !== userId) continue;

      const expired = now - s.startedAt > this.SESSION_TTL_MS;

      if (s.isOver || expired) {
        if (!s.isOver) stale.push(s); // only refund sessions that were never settled
        this.sessions.delete(id);
      }
    }

    return stale;
  }

  /**
   * Refund abandoned active sessions (the bet was already deducted at start).
   */
  private static async refundStaleSessions(stale: MinesSession[]): Promise<void> {
    for (const s of stale) {
      try {
        await WalletService.refundBet({
          userId: s.userId,
          betId: s.betId,
          amount: s.amount,
          balanceType: s.balanceType,
          gameType: 'MINES',
        });
        // The stake leaves the pool untouched.
        s.poolRound.confirmVoid();
      } catch (err) {
        console.error(`[Mines] Failed to refund abandoned session ${s.sessionId}:`, err);
        s.poolRound.rollback();
      }
    }
  }

  /**
   * Abandon the user's currently active (un-finished) session, if any, and refund it.
   * Returns true if a session was abandoned. Safe to call any time.
   */
  public static async abandonActiveSession(userId: string): Promise<boolean> {
    let abandoned = false;

    for (const [id, s] of this.sessions.entries()) {
      if (s.userId === userId && !s.isOver) {
        await this.refundStaleSessions([s]);
        this.sessions.delete(id);
        abandoned = true;
      }
    }

    return abandoned;
  }

  /**
   * Calculate multiplier after revealing `gemsRevealed` tiles with `mineCount` total mines
   */
  public static calculateMultiplier(mineCount: number, gemsRevealed: number, houseEdge: number = 0.04): number {
    if (gemsRevealed === 0) return 1.00;

    let prob = 1.0;
    const totalTiles = 25;
    const totalGems = totalTiles - mineCount;

    for (let i = 0; i < gemsRevealed; i++) {
      prob *= (totalGems - i) / (totalTiles - i);
    }

    const fairMultiplier = (1.0 - houseEdge) / prob;
    return parseFloat(fairMultiplier.toFixed(2));
  }

  /**
   * Start a new Mines round
   */
  public static async startRound(params: {
    userId: string;
    amount: number;
    balanceType: BalanceType;
    mineCount: number;
    clientSeed?: string;
  }) {
    if (params.mineCount < 1 || params.mineCount > 24) {
      throw new Error('Mine count must be between 1 and 24');
    }

    // Clean up any stale / abandoned sessions for this user first. This replaces
    // the old hard error "You already have an active Mines game in progress" which
    // permanently stuck players after a page refresh or disconnect.
    const stale = this.collectStaleSessions(params.userId);
    await this.refundStaleSessions(stale);

    const serverSeed = ProvablyFair.generateServerSeed();
    const serverSeedHash = ProvablyFair.hashServerSeed(serverSeed);
    const clientSeed = params.clientSeed || 'mines_client_seed';
    const nonce = Date.now();

    const mines = ProvablyFair.calculateMinesLayout(serverSeed, clientSeed, nonce, params.mineCount);

    // Deduct bet amount
    const { bet, newBalance } = await WalletService.placeBet({
      userId: params.userId,
      amount: params.amount,
      balanceType: params.balanceType,
      gameType: 'MINES',
      betData: { mineCount: params.mineCount },
    });

    const session: MinesSession = {
      sessionId: bet.id,
      userId: params.userId,
      betId: bet.id,
      amount: params.amount,
      balanceType: params.balanceType,
      mineCount: params.mineCount,
      mines,
      revealedTiles: [],
      currentMultiplier: 1.00,
      isOver: false,
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      startedAt: Date.now(),
      poolRound: HousePoolService.beginRound({
        gameType: 'MINES',
        balanceType: params.balanceType,
        stake: params.amount,
        betId: bet.id,
        userId: params.userId,
      }),
    };

    this.sessions.set(session.sessionId, session);

    return {
      sessionId: session.sessionId,
      serverSeedHash,
      mineCount: params.mineCount,
      nextMultiplier: this.calculateMultiplier(params.mineCount, 1),
      newBalance,
    };
  }

  /**
   * Reveal a tile
   */
  public static async revealTile(params: { sessionId: string; userId: string; tileIndex: number }) {
    const session = this.sessions.get(params.sessionId);
    if (!session || session.userId !== params.userId || session.isOver) {
      throw new Error('Active Mines session not found');
    }

    if (params.tileIndex < 0 || params.tileIndex > 24) {
      throw new Error('Invalid tile index (0 - 24)');
    }

    if (session.revealedTiles.includes(params.tileIndex)) {
      throw new Error('Tile already revealed');
    }

    // Check if tile is a mine
    const isMine = session.mines.includes(params.tileIndex);

    if (isMine) {
      // BOOM! Player lost
      session.isOver = true;
      session.revealedTiles.push(params.tileIndex);

      await WalletService.settleLoss(session.betId);
      session.poolRound.confirmLoss();
      this.sessions.delete(session.sessionId);

      return {
        isMine: true,
        tileIndex: params.tileIndex,
        mines: session.mines, // reveal all mines upon losing
        revealedTiles: session.revealedTiles,
        payout: 0,
        provablyFair: {
          serverSeed: session.serverSeed,
          serverSeedHash: session.serverSeedHash,
          clientSeed: session.clientSeed,
          nonce: session.nonce,
        },
      };
    }

    // Safe Gem!
    session.revealedTiles.push(params.tileIndex);
    const gemsRevealed = session.revealedTiles.length;
    session.currentMultiplier = this.calculateMultiplier(session.mineCount, gemsRevealed);
    const potentialPayout = parseFloat((session.amount * session.currentMultiplier).toFixed(2));

    // ── House pool guard: the potential cashout must stay payable ──
    // Each safe reveal raises the reserved payout; when the pool can no
    // longer fund the next level, this tile becomes a mine.
    if (!session.poolRound.adjustReservation(potentialPayout)) {
      HousePoolService.noteSuppression({
        gameType: 'MINES',
        balanceType: session.balanceType,
        context: `cashout level ${potentialPayout} (x${session.currentMultiplier}) exceeded pool at tile ${params.tileIndex}`,
      });
      return this.forceMineHit(session, params.tileIndex);
    }

    const maxGems = 25 - session.mineCount;

    const isAllGemsRevealed = gemsRevealed === maxGems;
    let autoCashoutResult: any = null;

    if (isAllGemsRevealed) {
      // Auto cashout on clearing all gems
      autoCashoutResult = await this.cashout({ sessionId: session.sessionId, userId: session.userId });
    }

    return {
      isMine: false,
      tileIndex: params.tileIndex,
      revealedTiles: session.revealedTiles,
      currentMultiplier: session.currentMultiplier,
      nextMultiplier: isAllGemsRevealed ? null : this.calculateMultiplier(session.mineCount, gemsRevealed + 1),
      currentPayout: parseFloat((session.amount * session.currentMultiplier).toFixed(2)),
      isAllGemsRevealed,
      cashoutData: autoCashoutResult,
    };
  }

  /**
   * Convert a "safe" pick into a mine hit when the house pool guard fires.
   * The revealed board stays self-consistent: the picked tile becomes a mine
   * (one existing mine is moved onto it) and the player loses the stake.
   */
  private static async forceMineHit(session: MinesSession, tileIndex: number) {
    session.isOver = true;

    const adjusted = [...session.mines];
    if (!adjusted.includes(tileIndex)) {
      adjusted[0] = tileIndex; // relocate one mine onto the picked tile
      adjusted.sort((a, b) => a - b);
    }
    session.mines = adjusted;

    await WalletService.settleLoss(session.betId);
    session.poolRound.confirmLoss();
    this.sessions.delete(session.sessionId);

    return {
      isMine: true,
      tileIndex,
      mines: session.mines,
      revealedTiles: session.revealedTiles,
      payout: 0,
      provablyFair: {
        serverSeed: session.serverSeed,
        serverSeedHash: session.serverSeedHash,
        clientSeed: session.clientSeed,
        nonce: session.nonce,
      },
    };
  }

  /**
   * Cash out current payout
   */
  public static async cashout(params: { sessionId: string; userId: string }) {
    const session = this.sessions.get(params.sessionId);
    if (!session || session.userId !== params.userId || session.isOver) {
      throw new Error('Active Mines session not found');
    }

    if (session.revealedTiles.length === 0) {
      throw new Error('Must reveal at least one tile before cashing out');
    }

    session.isOver = true;
    const payout = parseFloat((session.amount * session.currentMultiplier).toFixed(2));

    // The payout was fully reserved at every reveal, so the pool always
    // covers a Mines cashout.
    const { newBalance } = await WalletService.settleWin({
      userId: session.userId,
      betId: session.betId,
      payout,
      multiplier: session.currentMultiplier,
      balanceType: session.balanceType,
      gameType: 'MINES',
    });
    session.poolRound.confirmWin(payout);

    this.sessions.delete(session.sessionId);

    return {
      payout,
      multiplier: session.currentMultiplier,
      mines: session.mines,
      revealedTiles: session.revealedTiles,
      newBalance,
      provablyFair: {
        serverSeed: session.serverSeed,
        serverSeedHash: session.serverSeedHash,
        clientSeed: session.clientSeed,
        nonce: session.nonce,
      },
    };
  }
}
