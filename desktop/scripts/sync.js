'use strict';

// Assemble the tree the desktop app runs: the server sources plus the built
// frontend, laid out exactly where the server already looks for them
// (server/dist). Both `npm start` and `npm run dist` run this first, so the
// development run and the released app execute an identical layout.
//
// Server runtime deps deliberately come from desktop/package.json, not
// server/node_modules — the child process is Electron's Node, so the native
// better-sqlite3 binary has to be the Electron-ABI build.

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const serverSrc = path.join(repoRoot, 'server');
const frontendDist = path.join(repoRoot, 'dist');
const target = path.join(__dirname, '..', 'server');

if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
  console.error(`No frontend build at ${frontendDist}. Run \`npm run build\` in the repo root first.`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

for (const entry of fs.readdirSync(serverSrc, { withFileTypes: true })) {
  const { name } = entry;
  if (entry.isDirectory()) {
    // postnummer.js reads data/postnummer.tsv relative to its own directory.
    if (name === 'data') fs.cpSync(path.join(serverSrc, name), path.join(target, name), { recursive: true });
    continue;
  }
  // package.json comes along because index.js reads its version for /api/version.
  const wanted = (name.endsWith('.js') && !name.endsWith('.test.js')) || name === 'package.json';
  if (wanted) fs.copyFileSync(path.join(serverSrc, name), path.join(target, name));
}

fs.cpSync(frontendDist, path.join(target, 'dist'), { recursive: true });

console.log(`Synced server + frontend into ${target}`);
