/*
 * Revenue / risk simulator — 10k users across parallel rooms.
 * Models: rake levels, whale bettors, and exposure-based house controls.
 */
import crypto from 'node:crypto';

const USERS = Number(process.env.SIM_USERS || 10_000);
const ROOMS = Number(process.env.SIM_ROOMS || 10);
const ROUNDS = 5;
const DEP_FEE = 0.015;
const WD_FEE = 0.01;
const HOUSE_EDGE = 0.04;

const DEPOSITS = [[50, .40], [100, .30], [200, .20], [500, .10]];
const BETS = [[10, .40], [50, .30], [100, .20], [500, .10]];
const WHALE_BETS = [[5000, .40], [10000, .35], [50000, .25]];
const TARGETS = [[1.5, .40], [2, .25], [3, .15], [5, .10], [10, .10]];
const WHALE_TARGETS = [[2, .25], [3, .30], [5, .25], [10, .20]];

// Each player cashes out at a DIFFERENT random point every round — real-world
// reaction times, not a fixed target ladder. 5% never cash out (ride to crash).
function randomTarget(whale = false) {
  if (Math.random() < 0.05) return Infinity; // held to crash — loses
  const r = Math.random();
  let t;
  if (r < 0.50) t = 1.05 + Math.random() * 0.45;       // 1.05–1.50
  else if (r < 0.80) t = 1.5 + Math.random() * 1.5;    // 1.5–3.0
  else if (r < 0.95) t = 3 + Math.random() * 5;        // 3–8
  else t = 8 + Math.random() * 32;                     // 8–40
  if (whale) t *= 1.3;
  return Math.round(t * 100) / 100;
}

function pick(d, r = Math.random()) {
  let x = r;
  for (const [v, w] of d) if ((x -= w) <= 0) return v;
  return d[d.length - 1][0];
}
function crashPoint(seed, nonce) {
  const hm = crypto.createHmac('sha256', seed).update(`public_global_aviator_seed:${nonce}`).digest('hex');
  if (parseInt(hm.slice(0, 8), 16) % 33 === 0) return 1.00;
  const h = parseInt(hm.slice(0, 13), 16), e = 2 ** 52;
  return Math.min(10000, Math.max(1, Math.floor((100 * e - h * HOUSE_EDGE * 100) / (e - h)) / 100));
}

function simulate(cfg) {
  const {
    rake = .10, whalePct = 0, dynamic = 'none', bias = 1, capPayouts = true,
  } = cfg;
  let deposits = 0, staked = 0, paid = 0, guardRounds = 0, whaleWins = 0, maxWhaleWin = 0;
  const users = Array.from({ length: USERS }, (_, i) => ({
    room: i % ROOMS,
    whale: Math.random() < whalePct,
    deposit: pick(DEPOSITS),
  }));
  deposits = users.reduce((s, u) => s + u.deposit, 0);

  for (let room = 0; room < ROOMS; room++) {
    const members = users.filter((u) => u.room === room);
    for (let round = 0; round < ROUNDS; round++) {
      let crash = crashPoint(crypto.randomBytes(32).toString('hex'), round + 1);
      const bets = members.map((u) => ({
        amount: u.whale ? pick(WHALE_BETS) : pick(BETS),
        target: randomTarget(u.whale),
        whale: u.whale,
      }));
      const stake = bets.reduce((s, b) => s + b.amount, 0);

      // Exposure-based "controls" — these are what-if levers, not recommendations.
      let effRake = rake;
      if (dynamic === 'rake') {
        // Higher exposure => larger guaranteed cut (a bet-limit/rake equivalent).
        effRake = Math.min(.9, rake + Math.min(.35, (stake / 5_000_000) * .35));
      }
      if (dynamic === 'bias' && stake > 2_000_000) {
        // Rigging the crash point — breaks provable fairness. Shown for comparison only.
        crash = Math.max(1, crash * bias);
      }

      let payouts = bets.map((b) => (b.target <= crash ? b.amount * b.target : 0));
      payouts.forEach((p, i) => {
        if (p > 0 && bets[i].whale) { whaleWins++; maxWhaleWin = Math.max(maxWhaleWin, p); }
      });
      let total = payouts.reduce((s, p) => s + p, 0);
      const cap = stake * (1 - effRake);
      if (capPayouts && total > cap) {
        payouts = payouts.map((p) => p * (cap / total));
        total = cap;
        guardRounds++;
      }
      staked += stake; paid += total;
    }
  }
  const gross = staked - paid;
  const fees = deposits * DEP_FEE + (paid + staked) * WD_FEE;
  return { deposits, staked, paid, gross, edge: gross / staked, net: gross - fees, guardRounds, whaleWins, maxWhaleWin };
}

const m = (n) => 'KES ' + Math.round(n).toLocaleString();
const p = (n) => (n * 100).toFixed(1) + '%';
function row(label, r) {
  console.log(
    `${label.padEnd(30)} ${m(r.staked).padEnd(15)} ${m(r.paid).padEnd(15)} ${m(r.gross).padEnd(15)} ${p(r.edge).padStart(6)} ${m(r.net).padEnd(15)} guard:${String(r.guardRounds).padStart(3)} whaleWins:${r.whaleWins} maxWhale:${m(r.maxWhaleWin)}`
  );
}

console.log('=== 10,000 users / 10 rooms / 5 rounds / mixed deposits & bets ===');
console.log('scenario'.padEnd(30) + 'handle'.padEnd(15) + 'payouts'.padEnd(15) + 'gross revenue'.padEnd(15) + ' edge ' + 'net profit'.padEnd(15) + ' risk flags');
console.log('-'.repeat(140));

for (const rake of [.10, .40, .50, .60]) row(`Rake ${p(rake)} (no whales)`, simulate({ rake }));

console.log('-'.repeat(140));
for (const whalePct of [.01, .05, .10]) {
  row(`Whales ${p(whalePct)} rake10 capped`, simulate({ rake: .10, whalePct }));
  row(`Whales ${p(whalePct)} rake10 UNCAPPED`, simulate({ rake: .10, whalePct, capPayouts: false }));
}

console.log('-'.repeat(140));
row('5% whales + exposure rake', simulate({ rake: .10, whalePct: .05, dynamic: 'rake' }));
for (const bias of [.9, .7, .5]) {
  row(`5% whales + crash bias ${bias}`, simulate({ rake: .10, whalePct: .05, dynamic: 'bias', bias }));
}
