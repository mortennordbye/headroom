import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealthy(url: string, server: { exitCode: number | null }) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early with code ${server.exitCode}`);
    try {
      if ((await fetch(`${url}/healthz`)).ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} did not become healthy`);
}

/**
 * Build the SPA (E2E_REUSE_BUILD=1 skips it when a build exists), stage the
 * server with the build in its dist/ (the layout desktop/scripts/sync.js makes)
 * in a temp dir, and start it against a fresh DATA_DIR seeded with
 * server/seed.js's synthetic demo data. Never touches the real data volume.
 * Returns the teardown.
 *
 * The server runs from the temp copy rather than from server/ because its SPA
 * fallback 404s every client route when the install path has a dot-directory
 * in it (a checkout under .claude/worktrees, for one).
 */
export default async function globalSetup() {
  const dist = path.join(root, 'dist');
  if (!(process.env.E2E_REUSE_BUILD && fs.existsSync(path.join(dist, 'index.html')))) {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-e2e-'));
  const serverSrc = path.join(root, 'server');
  const serverDir = path.join(tmp, 'server');
  fs.mkdirSync(serverDir);
  for (const name of fs.readdirSync(serverSrc)) {
    if ((name.endsWith('.js') && !name.endsWith('.test.js')) || name === 'package.json') {
      fs.copyFileSync(path.join(serverSrc, name), path.join(serverDir, name));
    }
  }
  fs.cpSync(path.join(serverSrc, 'data'), path.join(serverDir, 'data'), { recursive: true });
  fs.symlinkSync(path.join(serverSrc, 'node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.cpSync(dist, path.join(serverDir, 'dist'), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: path.join(tmp, 'data'),
    BIND_HOST: '127.0.0.1',
    BACKUP_INTERVAL_HOURS: '0',
    BANK_SYNC_INTERVAL_HOURS: '0',
  };
  delete env.AUTH_PASSWORD;
  delete env.DEMO_MODE;
  execFileSync(process.execPath, [path.join(serverDir, 'seed.js')], { env, stdio: 'ignore' });

  const port = await freePort();
  const server = spawn(process.execPath, [path.join(serverDir, 'index.js')], {
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const baseURL = `http://127.0.0.1:${port}`;
  await waitForHealthy(baseURL, server);

  // Keep the seeded blob so a spec can restore it before it starts.
  const seedPath = path.join(tmp, 'seed.json');
  fs.writeFileSync(seedPath, await (await fetch(`${baseURL}/api/data`)).text());

  process.env.E2E_BASE_URL = baseURL;
  process.env.E2E_SEED_PATH = seedPath;

  return async () => {
    if (server.exitCode === null) {
      const exited = new Promise((r) => server.once('exit', r));
      server.kill();
      await exited;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
}
