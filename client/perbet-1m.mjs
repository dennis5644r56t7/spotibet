/* 1,000,000 users / 1,000 rooms (1k each) / 20 rounds each.
   Streaming aggregates only — no 20M-record arrays. */
import crypto from 'node:crypto';

const USERS = 1_000_000, ROOMS = USERS / 1000, PER_ROOM = 1000;
const ROUNDS = 20, MAX_ROOM_ROUNDS = 25;
const RAKE = 0.10, EDGE = 0.04, RISK_STOP = 9.0, PAYOUT_MULT = 10, DEPOSIT = 10_000, WINDOW = 10;

function bias(m, recent) {
  if (recent.length < 2) return m;
  const losses = recent.filter((w) => !w).length;
  const wins = recent.length - losses;
  const threshold = Math.ceil(WINDOW * 0.6);
  const last2 = recent.slice(-2);
  if (losses >= threshold || (last2.length === 2 && last2.every((w) => !w))) return Math.max(2.4, m * 1.8);
  if (wins >= threshold || (last2.length === 2 && last2.every((w) => w))) return Math.min(1.35, m * 0.55);
  return m;
}

function crash(h) {
  if (parseInt(h.slice(0, 8), 16) % 33 === 0) return 1;
  const x = parseInt(h.slice(0, 13), 16), e = 2 ** 52;
  return Math.min(10000, Math.max(1, Math.floor((100 * e - x * EDGE * 100) / (e - x)) / 100));
}
function target() {
  const r = Math.random();
  if (r < .05) return Infinity;
  if (r < .50) return 1.05 + Math.random() * .45;
  if (r < .80) return 1.5 + Math.random() * 1.5;
  if (r < .95) return 3 + Math.random() * 5;
  return 8 + Math.random() * 32;
}
function nextBet(amount, won) {
  const r = Math.random();
  const n = won
    ? (r < .12 ? 1000 : amount * (1.4 + Math.random() * .9))
    : (r < .35 ? 10 : amount * (.35 + Math.random() * .5));
  return Math.min(1000, Math.max(10, Math.round(n / 10) * 10));
}

let staked = 0, paid = 0, wins = 0, bets = 0, riskStops = 0;
let best1000Payout = 0, best1000Profit = 0, bestUserProfit = -Infinity, best10Payout = 0, best10Profit = 0;
let sample = null;
const started = Date.now();

for (let room = 0; room < ROOMS; room++) {
  const seed = crypto.randomBytes(32).toString('hex');
  const users = Array.from({ length: PER_ROOM }, (_, i) => ({
    id: room * PER_ROOM + i + 1,
    amount: 10,
    start: Math.floor(Math.random() * 5),
    profit: 0,
    had1000: false,
    outcomes: [],
    history: null,
  }));
  if (!sample) { users[0].history = []; sample = users[0]; }

  for (let round = 1; round <= MAX_ROOM_ROUNDS; round++) {
    let global = crash(crypto.createHmac('sha256', seed).update(`global:${round}`).digest('hex'));
    if (global > RISK_STOP) { global = RISK_STOP; riskStops++; }

    let roundStaked = 0, rawTotal = 0;
    const placed = [];
    for (const u of users) {
      if (round < u.start + 1 || round > u.start + ROUNDS) continue;
      const personal = bias(crash(crypto.createHmac('sha256', seed).update(`bet:${room}:${round}:${u.id}`).digest('hex')), u.outcomes);
      const t = target();
      const win = t <= Math.min(personal, global);
      u.outcomes.push(win);
      if (u.outcomes.length > WINDOW) u.outcomes.shift();
      const raw = win ? Math.min(u.amount * t, DEPOSIT * PAYOUT_MULT) : 0;
      placed.push([u, raw, win]);
      roundStaked += u.amount;
      rawTotal += raw;
    }
    if (!placed.length) continue;
    const scale = rawTotal > roundStaked * (1 - RAKE) ? (roundStaked * (1 - RAKE)) / rawTotal : 1;
    for (const [u, raw, win] of placed) {
      const actual = raw * scale;
      const profit = actual - u.amount;
      staked += u.amount; paid += actual; if (win) wins++; bets++;
      u.profit += profit;
      if (u.amount === 1000) { u.had1000 = true; if (actual > best1000Payout) best1000Payout = actual; if (profit > best1000Profit) best1000Profit = profit; }
      if (u.amount === 10 && actual > best10Payout) { best10Payout = actual; best10Profit = profit; }
      if (u.history) u.history.push(`${u.amount}:${profit > 0 ? 'W' : 'L'}`);
      u.amount = nextBet(u.amount, profit > 0);
    }
    for (const u of users) if (u.had1000 && u.profit > bestUserProfit) bestUserProfit = u.profit;
  }
  if ((room + 1) % 100 === 0) console.error(`rooms ${room + 1}/${ROOMS} ...`);
}

const m = (n) => 'KES ' + Math.round(n).toLocaleString();
console.log(`\n=== ${USERS.toLocaleString()} users / ${ROOMS.toLocaleString()} rooms / ${ROUNDS} rounds each ===`);
console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`Money deposited        : ${m(USERS * DEPOSIT)}`);
console.log(`Bets placed            : ${bets.toLocaleString()}`);
console.log(`Total money bet        : ${m(staked)}`);
console.log(`Winning bets           : ${wins.toLocaleString()} (${(wins / bets * 100).toFixed(1)}%)`);
console.log(`Money paid out         : ${m(paid)}`);
console.log(`SYSTEM PROFIT          : ${m(staked - paid)} (${((staked - paid) / staked * 100).toFixed(1)}%)`);
console.log(`Risk stops             : ${riskStops} rounds`);
console.log(`\nHighest 1,000 bet payout : ${m(best1000Payout)} (profit ${m(best1000Profit)})`);
console.log(`Best 20-round profit for a 1k-level player: ${m(bestUserProfit)}`);
console.log(`Highest KES 10 payout    : ${m(best10Payout)} (profit ${m(best10Profit)})`);
console.log(`Sample player: ${sample.history.join(' ')}`);
