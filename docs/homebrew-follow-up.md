# Homebrew install: follow-up

Status as of 2026-11-03: built and tested locally, not live. [PR #373](https://github.com/mortennordbye/headroom/pull/373)
is a draft and the tap repository does not exist yet.

Do not merge #373 before steps 1 to 3. Its `homebrew` release job would fail on the next release
without the tap.

## Steps

1. **Create the tap repository.** This needs the owner, since it creates a new public repository.

   ```bash
   gh repo create mortennordbye/homebrew-tap --public --description "Homebrew tap for Headroom"
   ```

2. **Give the release App access to it.** Check
   [the App's installation settings](https://github.com/settings/installations). If it is limited to
   selected repositories, add `homebrew-tap`. The App needs write access to its contents.

3. **Publish the tap.** Create the two files under [Tap contents](#tap-contents) in an empty
   directory, then:

   ```bash
   git init -b main
   git add README.md Casks/headroom.rb
   git commit -m "headroom 3.17.2"
   git remote add origin git@github.com:mortennordbye/homebrew-tap.git
   git push -u origin main
   ```

   If a newer version has shipped, set `version` and both `sha256` values from that release's
   `SHA256SUMS.txt`.

4. **Merge the PR.** Mark #373 ready and squash-merge once CI is green.

5. **Run the workflow once.**

   ```bash
   gh workflow run homebrew-tap.yml -f version=3.17.2
   ```

   If the cask is already at that version, the run changes nothing. That proves the token and the
   checkout, but not that the App can push.

6. **Check the next release.** It is the first real test of the push. Afterwards the tap should have
   a new `headroom <version>` commit, and these should work:

   ```bash
   brew install --cask mortennordbye/tap/headroom
   brew upgrade --cask headroom
   ```

Delete this file and the matching `BACKLOG.md` entry when step 6 passes.

## What has been tested

- With a local copy of the tap, a clean `brew tap` and `brew install --cask` picked the arm64 build
  on an Apple-chip Mac.
- `brew style` and `brew audit --cask --strict --online` pass on the cask below (Homebrew 7.0.12).
- The workflow's `sed` patterns match the cask. The workflow itself has never run.

## Open decision: Gatekeeper

Homebrew does not remove the Gatekeeper warning. After a brew install the app is still quarantined
and `spctl` rejects it, so users still need System Settings, then **Open Anyway**. The step probably
returns on every upgrade, but that has not been tested because it needs someone to open the app.

- **Apple Developer signing (recommended):** $99 a year. Removes the warning for DMG and brew users,
  and self-updating on Mac needs it as well.
- **Strip the quarantine flag in the cask:** free, but it silently bypasses a security check on a
  finance app for everyone who installs it. Not recommended.

## Tap contents

The cask and README live in the tap repository once it exists. Until then, this is the only saved
copy.

`Casks/headroom.rb`:

```ruby
cask "headroom" do
  arch arm: "arm64", intel: "x64"

  version "3.17.2"
  sha256 arm:   "cb88df8cf093d69a0fc8ccb27654f6c7d44f4f2244be7e5f971a3e844b89512c",
         intel: "127cfc5ed7f115e76e24d5505ed12e5f78e7eebbcafb883f846dc2e3121a2bd9"

  url "https://github.com/mortennordbye/headroom/releases/download/v#{version}/Headroom-#{version}-#{arch}.dmg"
  name "Headroom"
  desc "Personal finance app for budgets, assets, investments and loans"
  homepage "https://github.com/mortennordbye/headroom"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :ventura

  app "Headroom.app"
end
```

`README.md`:

````markdown
# Homebrew tap

Installs [Headroom](https://github.com/mortennordbye/headroom) on a Mac. It picks the right build for your chip.

```bash
brew install --cask mortennordbye/tap/headroom
brew upgrade --cask headroom
```

The cask is updated automatically by each Headroom release.
````
