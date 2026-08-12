'use strict';

// The update check: ask GitHub what the latest release is and say whether it is
// newer than what is running. Everything that touches Electron — the dialog,
// remembering a skipped version — stays in main.js, so this stays testable.
//
// It only ever *tells* the user. Installing the update is a download and a
// double-click, the same as the first install. A silent self-installing updater
// would need a signed build to work on macOS (Squirrel.Mac refuses the ad-hoc
// signature this app ships with), so it would be Windows-only — see BACKLOG.

const REPO = 'mortennordbye/headroom';
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;

// release-please only ever cuts plain x.y.z tags, so there is no prerelease
// ordering to get right. Anything else is unparseable and treated as "no news".
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// Resolves to the newer version string, or null — up to date, deliberately
// skipped, offline, rate-limited, GitHub having a bad day. A check the user
// never asked for has no business reporting its own failures at them, so every
// error path is just null.
async function findUpdate({ currentVersion, skippedVersion = null, fetchImpl = fetch, timeoutMs = 10000 }) {
  let tag;
  try {
    const res = await fetchImpl(LATEST_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    tag = (await res.json()).tag_name;
  } catch {
    return null;
  }
  if (!isNewer(tag, currentVersion)) return null;
  // Report the normalised version, not the raw tag: the skip file stores this
  // form, and it is what goes in front of the user.
  const version = parseVersion(tag).join('.');
  return version === skippedVersion ? null : version;
}

module.exports = { parseVersion, isNewer, findUpdate, LATEST_PAGE };
