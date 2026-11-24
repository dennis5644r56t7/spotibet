import { spawn } from 'node:child_process';

async function stage(total, workers) {
  const per = Math.floor(total / workers);
  const procs = [];
  let connected = 0, errors = 0, ticks = 0;
  const start = performance.now();
  for (let i = 0; i < workers; i++) {
    procs.push(new Promise((resolve) => {
      const child = spawn('node', ['socket-worker.mjs', String(per), `w${i}`], { cwd: process.cwd() });
      let out = '';
      child.stdout.on('data', (d) => out += d);
      child.stderr.on('data', (d) => out += d);
      child.on('close', () => {
        const m = out.match(/connected=(\d+) errors=(\d+) ticks=(\d+)/);
        if (m) { connected += +m[1]; errors += +m[2]; ticks += +m[3]; }
        else console.log('WORKER_FAIL', out.slice(0, 200));
        resolve();
      });
    }));
  }
  await Promise.all(procs);
  const secs = (performance.now() - start) / 1000;
  console.log(`TOTAL=${total} workers=${workers} connected=${connected}/${total} errors=${errors} ticks=${ticks} time=${secs.toFixed(1)}s`);
}

await stage(3000, 6);
await stage(10000, 20);
