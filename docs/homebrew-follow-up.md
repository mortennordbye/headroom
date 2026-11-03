# Homebrew install: follow-up

Status as of 2026-11-03: the tap is live at
[mortennordbye/homebrew-tap](https://github.com/mortennordbye/homebrew-tap) with version 3.17.2.
Releases can't update it yet, because the release App has no access to the tap.

```bash
brew install --cask mortennordbye/tap/headroom-finance
brew upgrade --cask headroom-finance
```

## Steps

1. **Give the release App access to the tap.** In
   [the App's installation settings](https://github.com/settings/installations), add `homebrew-tap`.
   Until then, the `homebrew` release job fails with `Not Found` when it requests a token.

2. **Point the tap at the latest release.** Run this with the current version:

   ```bash
   gh workflow run homebrew-tap.yml -f version=<version>
   ```

   If the version is newer than the cask, this is also the first real test of the App's push.

3. **Check the upgrade.** Install the older version first, then run `brew upgrade --cask headroom-finance`
   and confirm the app's bundle ID is still `it.nordbye.headroom`.

Delete this file and the matching `BACKLOG.md` entry when step 3 passes.

## Why the cask is not called `headroom`

Homebrew's own `headroom` cask is an unrelated app (`com.extraheadroom.headroom`). When our cask had
that name, `brew upgrade --cask headroom` replaced our app with it, even after a correct install from
the tap.

That cask's `zap` also trashes `~/Library/Application Support/Headroom`, the folder that holds our
database. Never run `brew uninstall --zap headroom` on a machine with real data.

## What has been tested

Using the published tap, on an Apple-chip Mac, installed to a scratch folder without opening the app:

- Installing by the full name picked the arm64 build, with no separate trust step.
- `brew upgrade --cask headroom-finance` stayed on our app, but there was no newer version to move to.
- `brew style` and `brew audit --cask --strict --online` pass.

## Open decision: Gatekeeper

Homebrew does not remove the Gatekeeper warning. After a brew install the app is still quarantined
and `spctl` rejects it, so users still need System Settings, then **Open Anyway**. The step probably
returns on every upgrade, but that has not been tested because it needs someone to open the app.

- **Apple Developer signing (recommended):** $99 a year. Removes the warning for DMG and brew users,
  and self-updating on Mac needs it as well.
- **Strip the quarantine flag in the cask:** free, but it silently bypasses a security check on a
  finance app for everyone who installs it. Not recommended.
