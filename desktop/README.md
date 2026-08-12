# Desktop app

Wraps the existing app as a downloadable Mac/Windows program for people who do not run Docker.
It is not a second implementation: `main.js` starts `server/index.js` in a child process and points
an Electron window at it. The API, the SQLite storage, the backups and the SSB fetches are all the
same code the container runs.

What differs from the container:

- `DATA_DIR` is the OS app-data dir (`~/Library/Application Support/Headroom/data`,
  `%APPDATA%\Headroom\data`) instead of a volume.
- `HOST=127.0.0.1`, so the listener is loopback-only (the container relies on the compose port
  mapping for that).
- The service worker is cleared at startup. It buys nothing when the assets are already local and
  would only reintroduce the stale-shell problem after an app update.
- It checks for a new release on launch (`update.js`), which the browser and container versions have
  no need for.

## The update check

`update.js` asks the GitHub releases API for the latest tag once per launch and, if it is newer than
`app.getVersion()`, `main.js` offers **Download / Later / Skip this version**. Download opens the
releases page in the browser; Skip writes the version to `update-state.json` in the app-data dir
(next to `data/`, not inside it — that folder is the user's financial data and what the backups
promise to hold). Every failure path is silent: offline, rate-limited, unparseable tag. A check
nobody asked for should not interrupt anyone with its own problems.

It does not install anything. A self-installing updater needs a real signature to work on macOS —
Squirrel.Mac refuses the ad-hoc signature these builds carry — so it would be Windows-only, which is
not worth `electron-updater` plus `latest.yml` publishing. See `BACKLOG.md`.

The check is skipped when `app.isPackaged` is false, so `npm start` never nags: in development
`getVersion()` is `desktop/package.json`'s, which trails the released tag between releases.

## Building locally

```bash
npm run build        # in the repo root, produces dist/
cd desktop
npm install          # postinstall rebuilds better-sqlite3 against Electron's ABI
npm start            # run it
npm run dist         # produce an installer in desktop/release/
```

`npm run sync` (which `start` and `dist` both run) copies the server sources and the frontend build
into `desktop/server/`, so development and the released app execute an identical tree. That
directory is generated and gitignored.

## Releasing

Nothing to do by hand. release-please watches the conventional-commit messages on `main` and keeps
a `chore(main): release x.y.z` PR up to date. Merging that PR cuts the GitHub release, and
`.github/workflows/release.yml` then builds macOS arm64, macOS x64 and Windows x64 and attaches
the installers to it, in the same run. The version comes from release-please, which also writes it
into `package.json`, `server/package.json` and this package.

The build (without the release) also runs on any PR touching `desktop/` or `server/`, so a break
shows up there rather than at release time.

## Two things to keep in mind

**The dependency list is duplicated.** `desktop/package.json` repeats the four runtime deps from
`server/package.json` because Electron's Node needs its own (ABI-matched) copy. `deps.test.js`
fails the build if the two drift, so adding a server dependency without adding it here is caught by
`npm test`. Dependabot updates both.

**The builds are unsigned.** macOS is ad-hoc signed (`identity: '-'` in `electron-builder.yml`),
which is what keeps Apple Silicon from rejecting the download outright, but users still get an
"unidentified developer" prompt on macOS and a SmartScreen prompt on Windows.

macOS needs a paid Apple Developer account, see `BACKLOG.md`. **Windows does not:**
[SignPath Foundation](https://signpath.org/) issues free OV code signing certificates to open source
projects, and `desktop-build.yml` is already wired for it. The steps are skipped while
`SIGNPATH_API_TOKEN` is unset, so today's releases ship unsigned exactly as before. Turning it on is
configuration, not a code change:

1. Apply at [signpath.org](https://signpath.org/). Headroom meets the stated conditions — OSI
   license with no dual-licensing, no proprietary components, actively maintained, already released,
   built from source in CI by a repository the team owns, and every signing request approved by a
   human. Expect days to weeks.
2. Set the repository secret `SIGNPATH_API_TOKEN`, and four repository variables:
   `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`,
   `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`. Use SignPath's Electron/NSIS artifact configuration so
   the binaries nested inside the installer get signed too, not just the outer `.exe`.
3. The next release build uploads the unsigned `.exe`, waits (up to an hour) for the signing request
   to be approved in SignPath, and attaches the signed installer instead.

Worth knowing before applying: the certificate is issued to SignPath Foundation, so **that** is the
publisher Windows names — not Morten Nordbye. The trade is a known, reputable publisher instead of
an unknown one. Their terms also require the project to publish a code signing policy saying so, so
on approval add to the root `README.md` (not before — until it is signed the sentence is untrue):

> Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
> [SignPath Foundation](https://signpath.org/).
