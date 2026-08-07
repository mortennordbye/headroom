'use strict';

// Desktop wrapper. It runs the *same* Express server as the Docker image in a
// child process and points a window at it — no second data path, no fork of the
// API. The only things that differ are where the data lives (the OS app-data
// dir instead of a volume) and that the listener is loopback-only.

const { app, BrowserWindow, dialog, session, shell } = require('electron');
const path = require('path');
const net = require('net');
const { fork } = require('child_process');

const SERVER_ENTRY = path.join(__dirname, 'server', 'index.js');
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const HOST = '127.0.0.1';
// A fixed default port keeps the app's origin stable across launches, which the
// Enable Banking redirect URL depends on (it's registered upstream, so it can't
// move per launch). Falls forward if something else already holds the port.
const FIRST_PORT = 3737;
const PORT_TRIES = 20;
// Mirrors --bg in src/index.css so the window doesn't flash white before the
// SPA paints.
const BACKGROUND = '#0E100D';

let serverProcess = null;
let mainWindow = null;
let origin = null;
let quitting = false;
let failed = false;

// One error dialog, then out. Guarded because a dead server trips both the exit
// handler and the readiness timeout.
function fatal(message) {
  if (failed) return;
  failed = true;
  if (serverProcess) serverProcess.kill();
  dialog.showErrorBox('Headroom could not start', message);
  app.exit(1);
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function pickPort() {
  for (let port = FIRST_PORT; port < FIRST_PORT + PORT_TRIES; port += 1) {
    if (await portAvailable(port)) return port;
  }
  return null;
}

function startServer(port) {
  serverProcess = fork(SERVER_ENTRY, [], {
    // No cwd override: in the packaged app the server lives inside app.asar,
    // which is not a real directory, and spawn would fail with ENOTDIR. The
    // server resolves every path from __dirname or DATA_DIR anyway.
    env: {
      ...process.env,
      // fork() re-launches this binary; without this it would boot a second
      // copy of the Electron app instead of a plain Node process.
      ELECTRON_RUN_AS_NODE: '1',
      DATA_DIR,
      BIND_HOST: HOST,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  serverProcess.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!quitting) fatal(`The Headroom server stopped unexpectedly (exit code ${code}).`);
  });
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!serverProcess) return false; // it died — its exit handler reports why
    try {
      const res = await fetch(`${origin}/healthz`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: BACKGROUND,
    title: 'Headroom',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Anything that isn't the local app — a bank's BankID page, an outbound link —
  // belongs in the user's real browser, not inside this window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(origin);
}

async function start() {
  const port = await pickPort();
  if (!port) {
    return fatal(`No free port between ${FIRST_PORT} and ${FIRST_PORT + PORT_TRIES - 1}.`);
  }
  origin = `http://${HOST}:${port}`;
  // The SPA registers a service worker for the browser/PWA build. Here it buys
  // nothing (the assets are already local) and only adds the stale-shell failure
  // mode after an app update, so drop any registration left by a previous run.
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  startServer(port);
  if (!(await waitForServer())) return fatal('The Headroom server did not start in time.');
  createWindow();
}

// A second instance would open a second server against the same SQLite file.
// Focus the running window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  // Without the catch, a throw in start() is an unhandled rejection: no window,
  // no error, nothing for the user to act on.
  app.whenReady().then(start).catch((err) => fatal(String((err && err.message) || err)));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!mainWindow && origin) createWindow();
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  if (serverProcess) serverProcess.kill();
});
