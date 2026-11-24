import crypto from 'crypto';

export interface ProvablyFairResult {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export class ProvablyFair {
  /**
   * Generates a secure random 64-char hex string as the server seed
   */
  static generateServerSeed(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generates SHA-256 hash of the server seed to be shared publicly before round starts
   */
  static hashServerSeed(serverSeed: string): string {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
  }

  /**
   * Calculates HMAC-SHA256 hash from serverSeed and clientSeed:nonce
   */
  static getHmacSha256(serverSeed: string, clientSeed: string, nonce: number): string {
    const message = `${clientSeed}:${nonce}`;
    return crypto.createHmac('sha256', serverSeed).update(message).digest('hex');
  }

  /**
   * Standard Aviator / Crash Multiplier calculation
   * Uses HMAC-SHA256 and 52-bit float conversion with 3% house edge instant crash check
   */
  static calculateCrashPoint(serverSeed: string, clientSeed: string, nonce: number, houseEdge: number = 0.04): number {
    const hash = this.getHmacSha256(serverSeed, clientSeed, nonce);

    // 1 in 33 chance of instant crash at 1.00x (~3.03% house edge buffer)
    const instantCrashCheck = parseInt(hash.substring(0, 8), 16);
    if (instantCrashCheck % 33 === 0) {
      return 1.00;
    }

    // Use first 52 bits (13 hex characters)
    const h = parseInt(hash.substring(0, 13), 16);
    const e = Math.pow(2, 52);

    // Formula: floor((100 * e - h * (1 - houseEdge)) / (e - h)) / 100
    // Standard provably fair multiplier formula
    const multiplier = Math.floor((100 * e - h * houseEdge * 100) / (e - h)) / 100;

    // Minimum multiplier is 1.00x
    const finalMultiplier = Math.max(1.00, multiplier);
    // Cap at reasonable max (e.g. 10000x)
    return Math.min(finalMultiplier, 10000.00);
  }

  /**
   * Deterministic Roulette Spin outcome (0 - 36)
   */
  static calculateRouletteOutcome(serverSeed: string, clientSeed: string, nonce: number): number {
    const hash = this.getHmacSha256(serverSeed, clientSeed, nonce);
    const value = parseInt(hash.substring(0, 8), 16);
    return value % 37; // 0 to 36 European Roulette
  }

  /**
   * Deterministic Mines Board (5x5 grid with mineCount mines placed)
   */
  static calculateMinesLayout(serverSeed: string, clientSeed: string, nonce: number, mineCount: number = 3): number[] {
    const hash = this.getHmacSha256(serverSeed, clientSeed, nonce);
    const positions = Array.from({ length: 25 }, (_, i) => i);
    const mines: number[] = [];

    let currentHash = hash;
    let round = 0;

    while (mines.length < mineCount && positions.length > 0) {
      if (round > 0) {
        currentHash = crypto.createHash('sha256').update(currentHash).digest('hex');
      }
      const val = parseInt(currentHash.substring(0, 8), 16);
      const index = val % positions.length;
      mines.push(positions.splice(index, 1)[0]);
      round++;
    }

    return mines.sort((a, b) => a - b);
  }

  /**
   * Deterministic Card Deck Shuffle for Blackjack (Fisher-Yates via HMAC)
   */
  static shuffleDeck(serverSeed: string, clientSeed: string, nonce: number, decks: number = 6): string[] {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let cards: string[] = [];

    for (let d = 0; d < decks; d++) {
      for (const s of suits) {
        for (const r of ranks) {
          cards.push(`${r}${s}`);
        }
      }
    }

    const hash = this.getHmacSha256(serverSeed, clientSeed, nonce);
    let seedBuffer = Buffer.from(hash, 'hex');

    for (let i = cards.length - 1; i > 0; i--) {
      const byteIdx = (cards.length - i) % seedBuffer.length;
      const j = seedBuffer[byteIdx] % (i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    return cards;
  }
}
