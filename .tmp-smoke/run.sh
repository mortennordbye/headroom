#!/bin/bash
# Temporary: launch old and new packaged builds on this runner and print timings.
set -u
export REPO=$GITHUB_WORKSPACE
T=$RUNNER_TEMP/smoke; mkdir -p "$T"
fetch() { # name asset
  curl -fsSL -o "$T/$1.dmg" "https://github.com/mortennordbye/headroom/releases/download/v3.17.1/$2" || return 1
  hdiutil attach -nobrowse -readonly -mountpoint "$T/m-$1" "$T/$1.dmg" >/dev/null 2>&1
  cp -R "$T/m-$1/Headroom.app" "$T/$1.app"; hdiutil detach "$T/m-$1" >/dev/null 2>&1
}
bench() { # label appdir
  echo "=== $1 ($(file -b "$2/Contents/MacOS/Headroom"))"
  for i in 1 2 3 4 5 6; do
    node "$REPO/.tmp-smoke/launch.cjs" "$2/Contents/MacOS/Headroom" none "$T/u-$1" "$1-run$i" 2>&1 | grep -E '^\{|Error' | cut -c1-400
    sleep 2
  done
}
uname -m; sysctl -n machdep.cpu.brand_string; sysctl -n hw.memsize
if [ "$(uname -m)" = arm64 ]; then
  fetch old Headroom-3.17.1-arm64.dmg; fetch oldx64 Headroom-3.17.1.dmg
  bench old-arm64 "$T/old.app"
  bench new-arm64 "$(ls -d "$REPO"/desktop/release/mac*/Headroom.app)"
  if arch -x86_64 /bin/bash -c true 2>/dev/null; then bench old-x64-rosetta "$T/oldx64.app"; else echo "=== no Rosetta on this runner"; fi
else
  fetch old Headroom-3.17.1.dmg
  bench old-intel "$T/old.app"
  bench new-intel "$(ls -d "$REPO"/desktop/release/mac*/Headroom.app)"
fi
ls "$REPO"/desktop/release/*.dmg
exit 0
