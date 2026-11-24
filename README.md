# AERO CASINO | Aviator & Provably Fair Casino Platform

A modern online betting and casino platform featuring real-time multiplayer **Aviator (Crash)**, a complete classic casino suite (**Roulette, Blackjack, Slots, Mines**), hardened **Paystack KES** deposits and M-Pesa / bank withdrawals, and **Provably Fair** cryptographic verification.

---

## 🚀 Live Demo & Tech Stack

- **Frontend**: Next.js 14 (React, TypeScript, Tailwind CSS, HTML5 Canvas 60 FPS, Web Audio API). Optimized for **Netlify** deployment.
- **Backend & Game Engine**: Node.js, Express, Socket.io, TypeScript.
- **Database**: Local **SQLite** via Prisma + LibSQL (the schema is PostgreSQL-ready for a Neon migration).
- **Payment Gateway**: **Paystack Kenya** — KES card and M-Pesa checkout, with M-Pesa and KEPSS bank payouts.
- **Fairness Engine**: HMAC-SHA256 (Server Seed + Client Seed + Nonce).

---

## ✈️ Flagship Features

### 1. Aviator (Crash Game)
- **Continuous Multiplayer Flight**: Shared real-time continuous flight loop with sub-millisecond Socket.io synchronization.
- **Dual Bet Panels**: Place two distinct bets in the exact same round with independent auto-cashout multipliers.
- **60 FPS Canvas Graphics**: Realistic jet flight trajectory, glowing red smoke trail particles, dynamic camera acceleration, and fly-away states.
- **Multiplayer Live Feeds**: Real-time ticker showing active players, bets, cashout multipliers, and winnings.
- **Recent Multipliers Strip**: Color-coded past round badges (<2x blue, 2x–10x purple, >10x gold).

### 2. Casino Suite
- **European Roulette (0–36)**: 37-pocket spinning wheel with inside/outside bets (Straight up 36x, Red/Black 2x, Even/Odd 2x, Dozens 3x).
- **Classic Blackjack (21)**: Felt table, multi-deck shoe, Hit, Stand, Double Down, dealer stands on 17, natural 21 pays 3:2.
- **Neon Vegas Slots (5x3 Reels)**: 10 fixed paylines, Wild substitution, Scatter bonus Free Spins trigger.
- **Mines (5x5 Grid)**: Configurable 1–24 mines, cash out anytime as payout multiplier increases with every uncovered gem.

### 3. Financial & Wallet System
- **Dual Mode**: Instant **Demo Play (KSh 10,000 starter refill)** & **Real Money (Paystack KES)**.
- **Paystack Deposits**: Card and M-Pesa checkout in **KES**, initiated server-side with a fixed reference, amount, and currency.
- **Signed Webhooks**: HMAC-SHA512 verified against the **raw request bytes**, with duplicate-delivery protection and strict amount/currency matching.
- **Withdrawals**: Paystack Transfers to individual **M-Pesa** wallets and **KEPSS** Kenyan bank accounts. The balance is debited atomically and refunded automatically if the payout is definitively rejected.
- **Complete Ledgers**: Full transaction and bet history, atomic conditional balance updates, and idempotent payment processing.
- **Local Testing**: `ENABLE_DEV_DEPOSIT=true` exposes a development-only top-up endpoint; it is ignored automatically in production.

---

## 🛠️ Quick Start

### 1. Configure the Backend
```bash
cd server
cp .env.example .env
# Set JWT_SECRET, PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY, and FRONTEND_URL
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
# Server listens on http://localhost:5000 with WebSockets active
```

For local wallet testing without Paystack credentials, keep
`ENABLE_DEV_DEPOSIT=true` and use the **Test top-up** button in the cashier.
Set a real Paystack **test secret key** to exercise checkout, M-Pesa payouts,
and webhook delivery.

Register the webhook URL in the Paystack dashboard:

```
https://your-backend-domain.com/api/wallet/paystack/webhook
```

### 2. Start the Frontend
```bash
cd client
cp .env.example .env.local
npm install
npm run dev
# Next.js app available at http://localhost:3001
```

On Windows, `.\Start-Sportibet.ps1` starts both services and writes logs to
`%LOCALAPPDATA%\Sportibet\logs`.

---

## 🌐 Netlify Deployment (Frontend)

The `client` folder includes `netlify.toml` pre-configured for `@netlify/plugin-nextjs`.

1. Connect your repository to Netlify.
2. Set the **Base directory** to `client`.
3. Set **Build command** to `npm run build` and **Publish directory** to `.next`.
4. Configure Netlify Environment Variables:
   - `NEXT_PUBLIC_API_URL`: `https://your-backend-api-url.com/api`
   - `NEXT_PUBLIC_SOCKET_URL`: `https://your-backend-api-url.com`
5. Set the backend `FRONTEND_URL` and `CORS_ORIGINS` to your Netlify domain so
   Paystack callbacks and Socket.IO connections are accepted.

---

## 🔒 Provably Fair Verification Formula

The platform guarantees mathematical fairness using HMAC-SHA256:

```
HMAC = HMAC_SHA256(ServerSeed, ClientSeed + ":" + Nonce)
Multiplier = Math.floor((100 * 2^52 - h * HouseEdge * 100) / (2^52 - h)) / 100
```

Players can click the **Provably Fair** badge at any time to verify past rounds independently.
