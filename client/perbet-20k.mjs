/* 20,000 users / 20 rooms / 20 rounds each — staggered joins, personal planes. */
import crypto from 'node:crypto';

const USERS = 20_000, ROOMS = 20, ROUNDS_PER_USER = 20, MAX_ROOM_ROUNDS = 25;
const RAKE = 0.10, HOUSE_EDGE = 0.04, RISK_STOP_MULT = 9.0, PAYOUT_MULTIPLE = 10;

function hmacVal(seed, msg) {
  return crypto.createHmac('sha256', seed).update(msg).digest('hex');
}
function crashFromHash(h) {
  if (parseInt(h.slice(0, 8), 16) % 33 === 0) return 1.00;
  const x = parseInt(h.slice(0, 13), 16), e = 2 ** 52;
  return Math.min(10000, Math.max(1, Math.floor((100 * e - x * HOUSE_EDGE * 100) / (e - x)) / 100));
}
function randomTarget() {
  const r = Math.random();
  if (r < 0.05) return Infinity;
  if (r < 0.50) return 1.05 + Math.random() * 0.45;
  if (r < 0.80) return 1.5 + Math.random() * 1.5;
  if (r < 0.95) return 3 + Math.random() * 5;
  return 8 + Math.random() * 32;
}

function nextBet(amount, won) {
  const r = Math.random();
  let next;
  if (won) {
    // After a win most players raise the stake a little; some chase a big one.
    next = r < 0.12 ? 1000 : amount * (1.4 + Math.random() * 0.9);
  } else {
    // After a loss most cut back, many reset to the minimum to "try luck".
    next = r < 0.35 ? 10 : amount * (0.35 + Math.random() * 0.5);
  }
  return Math.min(1000, Math.max(10, Math.round(next / 10) * 10));
}

const users = Array.from({ length: USERS }, (_, i) => ({
  id: i + 1,
  room: i % ROOMS,
  amount: 10,            // everyone starts small, like a real new player
  deposit: 10_000,       // enough float so the live payout cap never distorts
  start: Math.floor(Math.random() * 5), // staggered joins: some arrive mid-flight
  history: [],
}));
const deposits = users.reduce((s, u) => s + u.deposit, 0);

let staked = 0, paid = 0, wins = 0, bets = 0, riskStops = 0, stillFlying = 0;
const records = [];
const userProfit = new Map();
const roomSeeds = Array.from({ length: ROOMS }, () => crypto.randomBytes(32).toString('hex'));

const userById = new Map(users.map((u) => [u.id, u]));
for (let room = 0; room < ROOMS; room++) {
  const members = users.filter((u) => u.room === room);
  const seed = roomSeeds[room];
  for (let round = 1; round <= MAX_ROOM_ROUNDS; round++) {
    let global = crashFromHash(hmacVal(seed, `global:${round}`));
    const natural = global;
    if (global > RISK_STOP_MULT) { global = RISK_STOP_MULT; riskStops++; }

    const roundBets = [];
    let roundStaked = 0;
    for (const u of members) {
      if (round < u.start + 1 || round > u.start + ROUNDS_PER_USER) continue;
      const betId = `R${room}-RD${round}-U${u.id}`;
      const personal = crashFromHash(hmacVal(seed, `bet:${betId}`));
      const effective = Math.min(personal, global);
      if (personal > global) stillFlying++;
      const target = randomTarget();
      const win = target <= effective;
      const raw = win ? Math.min(u.amount * target, u.deposit * PAYOUT_MULTIPLE) : 0;
      roundBets.push({ amount: u.amount, win, payout: raw, raw, personal, effective, target, userId: u.id });
      roundStaked += u.amount;
    }
    if (!roundBets.length) continue;
    const rawTotal = roundBets.reduce((s, b) => s + b.payout, 0);
    const cap = roundStaked * (1 - RAKE);
    const scale = rawTotal > cap ? cap / rawTotal : 1;
    const roundPaid = rawTotal * scale;
    for (const rb of roundBets) {
      const actual = rb.raw * scale;
      const profit = actual - rb.amount;
      records.push({ amount: rb.amount, payout: actual, profit, target: rb.target });
      userProfit.set(rb.userId, (userProfit.get(rb.userId) || 0) + profit);
      const u = userById.get(rb.userId);
      u.history.push({ amount: rb.amount, result: profit > 0 ? 'W' : 'L', profit });
      u.amount = nextBet(rb.amount, profit > 0);
    }
    staked += roundStaked;
    paid += roundPaid;
    wins += roundBets.filter((b) => b.win).length;
    bets += roundBets.length;
  }
}

const profit = staked - paid;
const m = (n) => 'KES ' + Math.round(n).toLocaleString();
console.log(`=== ${USERS.toLocaleString()} users / ${ROOMS} rooms / ${ROUNDS_PER_USER} rounds each ===`);
console.log(`staggered joins: users start at random rounds 1-5; personal planes; pool cap 90%; risk stop ${RISK_STOP_MULT}x`);
console.log(`Money deposited        : ${m(deposits)}`);
console.log(`Total bets placed      : ${bets.toLocaleString()}`);
console.log(`Total money bet        : ${m(staked)}`);
console.log(`Winning bets           : ${wins.toLocaleString()} (${(wins / bets * 100).toFixed(1)}%)`);
console.log(`Money paid out         : ${m(paid)}`);
console.log(`SYSTEM PROFIT          : ${m(profit)} (${(profit / staked * 100).toFixed(1)}%)`);
console.log(`Risk stops             : ${riskStops} rounds`);
console.log(`Flights cut by round end: ${stillFlying.toLocaleString()} bets`);

const maxAmount = records.reduce((mx, r) => (r.amount > mx ? r.amount : mx), 0);
const biggestBet = records.filter((r) => r.amount === maxAmount).sort((a, b) => b.payout - a.payout)[0];
const bestBigUser = Array.from(userProfit.entries())
  .filter(([id]) => userById.get(id).history.some((h) => h.amount === maxAmount))
  .sort((a, b) => b[1] - a[1])[0];
const tenBets = records.filter((r) => r.amount === 10);
const bestTen = tenBets.reduce((a, b) => (b.payout > a.payout ? b : a), tenBets[0]);
console.log('\n asked numbers:');
console.log(`Highest single bet by any user : ${m(maxAmount)}`);
console.log(`Best payout on that bet         : ${m(biggestBet.payout)} (profit ${m(biggestBet.profit)})`);
console.log(`Best total profit for a KES ${maxAmount} user over 20 rounds: ${m(bestBigUser[1])}`);
console.log(`Highest amount a KES 10 bet received: ${m(bestTen.payout)} (profit ${m(bestTen.profit)})`);
console.log('\nOne real player sequence (bet -> result):');
console.log(users[0].history.map((h) => `${h.amount}:${h.result}${h.profit > 0 ? '+' + Math.round(h.profit) : ''}`).join('  '));
