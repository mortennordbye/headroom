'use strict';

// Assert the packaged app actually contains the app.
//
// electron-builder does not fail when a `files` glob matches nothing, so a
// build that skipped `npm run sync` produces a perfectly valid installer with
// no server and no frontend inside it. That app installs, launches, and then
// dies on a missing module — and CI called it green. This turns that into a
// build failure.

const fs = require('fs');
const path = require('path');
const { listPackage } = require('@electron/asar');

const releaseDir = path.join(__dirname, '..', 'release');
const REQUIRED = ['/server/index.js', '/server/dist/index.html', '/main.js'];

// mac: release/mac-<arch>/Headroom.app/Contents/Resources/app.asar
// win: release/win-unpacked/resources/app.asar
function findArchives(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'app.asar') found.push(full);
    else if (entry.isDirectory()) findArchives(full, found);
  }
  return found;
}

if (!fs.existsSync(releaseDir)) {
  console.error(`No build output at ${releaseDir}.`);
  process.exit(1);
}

const archives = findArchives(releaseDir);
if (archives.length === 0) {
  console.error('No app.asar found in the build output.');
  process.exit(1);
}

let failed = false;
for (const archive of archives) {
  // listPackage builds entries with the platform separator, so on Windows they
  // come back as \server\index.js. Normalise before comparing.
  const files = listPackage(archive).map((f) => f.split(path.sep).join('/'));
  const missing = REQUIRED.filter((f) => !files.includes(f));
  const rel = path.relative(releaseDir, archive);
  if (missing.length) {
    console.error(`${rel}: missing ${missing.join(', ')}`);
    console.error(`  archive holds ${files.length} entries, e.g. ${files.slice(0, 5).join(', ')}`);
    failed = true;
  } else {
    console.log(`${rel}: contains the server and the frontend (${files.length} entries)`);
  }
}

process.exit(failed ? 1 : 0);
