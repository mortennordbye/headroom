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
"unidentified developer" prompt on macOS and a SmartScreen prompt on Windows. Removing those needs
paid certificates, see `BACKLOG.md`.
