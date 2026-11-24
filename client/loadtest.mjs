// Staged HTTP load test against the local unified server.
const BASE = 'http://localhost:3001/api/wallet/config';
const stages = [100, 500, 1000, 5000, 10000];

async function run(n) {
  const start = performance.now();
  let ok = 0, fail = 0;
  const latencies = [];
  await Promise.all(
    Array.from({ length: n }, async () => {
      const t = performance.now();
      try {
        const r = await fetch(BASE);
        if (r.ok) ok++; else fail++;
        await r.arrayBuffer();
      } catch {
        fail++;
      }
      latencies.push(performance.now() - t);
    })
  );
  const total = performance.now() - start;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(n * 0.5)] || 0;
  const p95 = latencies[Math.floor(n * 0.95)] || 0;
  const p99 = latencies[Math.floor(n * 0.99)] || 0;
  console.log(
    `N=${String(n).padStart(5)} total=${(total/1000).toFixed(2)}s ok=${ok} fail=${fail} ` +
    `rps=${Math.round((ok+fail)/(total/1000))} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms`
  );
}

for (const n of stages) await run(n);
