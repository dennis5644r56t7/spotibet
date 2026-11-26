// 1000 users, bet amounts 10..1000 in steps of 10 (10 users per amount).
// Every bet gets its own provably-fair personal crash point.
import crypto from 'node:crypto';

const USERS = Number(process.env.SIM_USERS || 1000);
const RAKE = 0.10;
const HOUSE_EDGE = 0.04;

function personalCrash(serverSeed, nonce, betId) {
  const hm = crypto.createHmac('sha256', serverSeed).update(`public:${nonce}:${betId}`).digest('hex');
  if (parseInt(hm.slice(0, 8), 16) % 33 === 0) return 1.00;
  const h = parseInt(hm.slice(0, 13), 16), e = 2 ** 52;
  return Math.min(10000, Math.max(1, Math.floor((100 * e - h * HOUSE_EDGE * 100) / (e - h)) / 100));
}
function randomTarget() {
  const r = Math.random();
  if (r < 0.05) return Infinity; // never cashes out
  if (r < 0.50) return 1.05 + Math.random() * 0.45;
  if (r < 0.80) return 1.5 + Math.random() * 1.5;
  if (r < 0.95) return 3 + Math.random() * 5;
  return 8 + Math.random() * 32;
}

const serverSeed = crypto.randomBytes(32).toString('hex');
const bets = Array.from({ length: USERS }, (_, i) => {
  const amount = 10 * ((i % 100) + 1); // 10,20,...,1000 repeated
  const id = `BET-${i + 1}`;
  return { id, amount, crash: personalCrash(serverSeed, 1, id), target: randomTarget() };
});
const staked = bets.reduce((s, b) => s + b.amount, 0);
const winners = bets.filter((b) => b.target <= b.crash);
const rawPaid = winners.reduce((s, b) => s + b.amount * b.target, 0);
const cap = staked * (1 - RAKE);
const scale = rawPaid > cap ? cap / rawPaid : 1;
const paid = rawPaid * scale;
const profit = staked - paid;

const m = (n) => 'KES ' + Math.round(n).toLocaleString();
console.log(`USERS=${USERS} amounts 10..1000 in steps of 10 (10 users each)`);
console.log(`Total staked        : ${m(staked)}`);
console.log(`Winners             : ${winners.length}/${USERS} (${(winners.length / USERS * 100).toFixed(1)}%)`);
console.log(`Money paid out      : ${m(paid)}${scale < 1 ? ' (capped to pool)' : ''}`);
console.log(`SYSTEM PROFIT       : ${m(profit)} (${(profit / staked * 100).toFixed(1)}% of stakes)`);
console.log('\nExamples (first 3 amounts):');
for (const b of bets.slice(0, 3)) {
  console.log(`  bet ${m(b.amount)} plane reached ${b.crash.toFixed(2)}x target ${b.target === Infinity ? 'held' : b.target.toFixed(2) + 'x'} => ${b.target <= b.crash ? 'WIN ' + m(b.amount * b.target) : 'LOST'}`);
}
console.log('\nBiggest wins:');
for (const b of [...winners].sort((x, y) => y.amount * y.target - x.amount * x.target).slice(0, 5)) {
  console.log(`  bet ${m(b.amount)} reached ${b.crash.toFixed(2)}x cashed ${b.target.toFixed(2)}x => ${m(b.amount * b.target * scale)}`);
}
const small = bets.filter((b) => b.amount <= 100), big = bets.filter((b) => b.amount >= 900);
console.log(`\nSmall bets (10-100): ${small.filter(b => b.target <= b.crash).length}/${small.length} won`);
console.log(`Big bets (900-1000) : ${big.filter(b => b.target <= b.crash).length}/${big.length} won`);
