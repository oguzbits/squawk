// Starts the API on its own port and measures GET /dashboard/due with autocannon.
// Usage: node --env-file=.env scripts/load-dashboard.ts <label>
import { spawn } from 'node:child_process';
import autocannon from 'autocannon';

const label = process.argv[2] ?? 'unlabeled';
const port = 3100;
const base = `http://127.0.0.1:${port}`;

const api = spawn('node', ['src/server.ts'], {
  cwd: new URL('../apps/api', import.meta.url),
  env: { ...process.env, PORT: String(port), RATE_LIMIT_MAX: '1000000', LOG_LEVEL: 'warn' },
  stdio: 'inherit',
});

try {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('API did not start');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Warm-up so connection setup and a cold cache do not distort the first numbers.
  await autocannon({ url: `${base}/dashboard/due`, connections: 2, amount: 3 });
  const result = await autocannon({ url: `${base}/dashboard/due`, connections: 10, duration: 10 });
  if (result.non2xx > 0 || result.errors > 0) {
    throw new Error(`${result.non2xx} non-2xx responses, ${result.errors} errors`);
  }
  console.log(
    JSON.stringify({
      label,
      requestsPerSecond: result.requests.average,
      latencyP50Ms: result.latency.p50,
      latencyP99Ms: result.latency.p99,
    }),
  );
} finally {
  api.kill();
}
