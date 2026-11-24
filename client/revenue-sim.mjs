/*
 * Monte-Carlo revenue model for 10,000 Aviator users distributed across
 * parallel rooms. Uses the platform's real crash formula and 10% pool rake.
 */
import crypto from 'node:crypto';

const USERS = 10_000;
const ROOMS = 10;
const ROUNDS_PER_ROOM = 5;
const RAKE = 0.10;                 // HOUSE_CONFIG.aviatorRoundRake
const HOUSE_EDGE = 0.04;           // ProvablyFair default
const DEPOSIT_FEE_RATE = 0.015;    // assumption: Paystack M-Pesa ~1.5%
const WITHDRAW_FEE_RATE = 0.01;    // assumption: payout fee ~1%

// --- helpers ---------------------------------------------------------------
function pick(dist, r) {
  let x = r;
  for (const [value, weight] of dist) {
    if ((x -= weight) <= 0) return value;
  }
  return dist[dist.length - 1][0];
}

function crashPoint(serverSeed, clientSeed, nonce) {
  const hmac = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
  if (parseInt(hmac.substring(0, 8), 16) % 33 === 0) return 1.00;
  const h = parseInt(hmac.substring(0, 13), 16);
  const e = Math.pow(2, 52);
  const m = Math.floor((100 * e - h * HOUSE_EDGE * 100) / (e - h)) / 100;
  return Math.min(Math.max(1.00, m), 10000.00);
}

// --- distributions ---------------------------------------------------------
// Deposits: 40% minimum (50), 30% 100, 20% 200, 10% 500
const DEPOSITS = [[50, 0.40], [100, 0.30], [200, 0.20], [500, 0.10]];
// Bets per round: 40% min 10, 30% 50, 20% 100, 10% 500
const BETS = [[10, 0.40], [50, 0.30], [100, 0.20], [500, 0.10]];
// Cashout targets: 40% conservative 1.5x, 25% 2x, 15% 3x, 10% 5x, 10% greedy 10x
const TARGETS = [[1.5, 0.40], [2, 0.25], [3, 0.15], [5, 0.10], [10, 0.10]];

// --- users -----------------------------------------------------------------
const users = Array.from({ length: USERS }, (_, i) => ({
  id: i,
  room: i % ROOMS,
  deposit: pick(DEPOSITS, Math.random()),
}));
const totalDeposits = users.reduce((s, u) => s + u.deposit, 0);

let totalStaked = 0, totalPaidOut = 0, totalWins = 0, totalBets = 0;
const roomStats = [];

for (let room = 0; room < ROOMS; room++) {
  const members = users.filter((u) => u.room === room);
  let rStaked = 0, rPaid = 0, rWins = 0, rBets = 0, guardRounds = 0;
  for (let round = 0; round < ROUNDS_PER_ROOM; round++) {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const crash = crashPoint(serverSeed, 'public_global_aviator_seed', round + 1);
    const bets = members.map(() => ({
      amount: pick(BETS, Math.random()),
      target: pick(TARGETS, Math.random()),
    }));
    const staked = bets.reduce((s, b) => s + b.amount, 0);
    let payouts = bets.map((b) => (b.target <= crash ? b.amount * b.target : 0));
    let rawPaid = payouts.reduce((s, p) => s + p, 0);
    // Pool guard: distributable is (1 - rake) * staked. Scale winners if exceeded.
    const cap = staked * (1 - RAKE);
    if (rawPaid > cap) {
      const scale = cap / rawPaid;
      payouts = payouts.map((p) => p * scale);
      rawPaid = cap;
      guardRounds++;
    }
    const wins = payouts.filter((p) => p > 0).length;
    rStaked += staked; rPaid += rawPaid; rWins += wins; rBets += bets.length;
  }
  totalStaked += rStaked; totalPaidOut += rPaid; totalWins += rWins; totalBets += rBets;
  roomStats.push({ room, players: members.length, staked: rStaked, paid: rPaid, house: rStaked - rPaid, wins: rWins, guardRounds });
}

const grossRevenue = totalStaked - totalPaidOut;               // house take
const effectiveRake = grossRevenue / totalStaked;
const depositFees = totalDeposits * DEPOSIT_FEE_RATE;
// Assume all winnings + unused balance are withdrawn; fee on the payout side.
const withdrawalAmount = totalPaidOut + Math.max(0, totalDeposits - totalStaked) + totalStaked;
const withdrawalFees = withdrawalAmount * WITHDRAW_FEE_RATE;
const netProfit = grossRevenue - depositFees - withdrawalFees;

const money = (n) => 'KES ' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (n) => (n * 100).toFixed(2) + '%';

console.log('=== SCENARIO: 10,000 users / 10 parallel rooms / 5 rounds each ===');
console.log('Users                 :', USERS.toLocaleString());
console.log('Rooms                 :', ROOMS, `(${(USERS / ROOMS).toLocaleString()} players each)`);
console.log('Total deposits        :', money(totalDeposits));
console.log('  min-only deposits   :', money(USERS * 50));
console.log('Total bets placed     :', totalBets.toLocaleString());
console.log('Total amount wagered  :', money(totalStaked));
console.log('Total paid to players :', money(totalPaidOut));
console.log('Winning bets          :', totalWins.toLocaleString(), pct(totalWins / totalBets));
console.log('GROSS REVENUE (rake)  :', money(grossRevenue), pct(effectiveRake), 'of handle');
console.log('Deposit fees (1.5%)   :', money(depositFees));
console.log('Withdrawal fees (1%)  :', money(withdrawalFees));
console.log('NET PROFIT            :', money(netProfit));
console.log('Profit per user       :', money(netProfit / USERS));
console.log('Return on deposits    :', pct(netProfit / totalDeposits));
console.log('');
console.log('Per-room breakdown:');
for (const r of roomStats) {
  console.log(`  Room ${String(r.room).padStart(2)} | players ${r.players} | staked ${money(r.staked).padEnd(14)} | house ${money(r.house).padEnd(12)} | wins ${r.wins} | guard ${r.guardRounds}`);
}
