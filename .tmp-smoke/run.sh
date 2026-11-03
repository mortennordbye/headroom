#!/bin/bash
# Temporary: launch old and new packaged builds on this runner and print timings.
set -u
export REPO=$GITHUB_WORKSPACE
T=$RUNNER_TEMP/smoke; mkdir -p "$T"
swiftc -O -o "$T/winwatch" "$REPO/.tmp-smoke/winwatch.swift" || exit 0
fetch() { curl -fsSL -o "$T/$1.dmg" "https://github.com/mortennordbye/headroom/releases/download/v3.17.1/$2" || return 1
  hdiutil attach -nobrowse -readonly -mountpoint "$T/m-$1" "$T/$1.dmg" >/dev/null 2>&1
  cp -R "$T/m-$1/Headroom.app" "$T/$1.app"; hdiutil detach "$T/m-$1" >/dev/null 2>&1; }
one() { # label app profile settle
  node "$REPO/.tmp-smoke/launch.cjs" "$2/Contents/MacOS/Headroom" "$T/u-$3" "$1" "$T/winwatch" "$4" 2>&1 | grep -E '^RESULT|rror' | cut -c1-300
  pkill -f winwatch; sleep 1; }
compare() { # oldApp newApp
  for r in 1 2 3 4; do sudo purge; one "old-cold$r" "$1" old 8; sudo purge; one "new-cold$r" "$2" new 8; done
  for r in 1 2 3 4 5 6 7 8; do one "old-warm$r" "$1" old 5; one "new-warm$r" "$2" new 5; done
}
uname -m; sysctl -n machdep.cpu.brand_string
NEW=$(ls -d "$REPO"/desktop/release/mac*/Headroom.app)
if [ "$(uname -m)" = arm64 ]; then
  fetch old Headroom-3.17.1-arm64.dmg; fetch oldx64 Headroom-3.17.1.dmg
  compare "$T/old.app" "$NEW"
  if arch -x86_64 /bin/bash -c true 2>/dev/null; then
    for r in 1 2; do sudo purge; one "rosetta-cold$r" "$T/oldx64.app" ros 25; done
    for r in 1 2 3 4; do one "rosetta-warm$r" "$T/oldx64.app" ros 15; done
  fi
else
  fetch old Headroom-3.17.1.dmg
  compare "$T/old.app" "$NEW"
fi
exit 0
