#!/bin/sh
# Builds the program for the Pis (ARMv6 for every 32-bit Pi, aarch64 for the 64-bit ones) and runs each under QEMU user-mode emulation as far as a
# machine with no GPU can: it must start, answer --version and --help, read a settings file and report, in words, that there is no GPU driver.
# (The pictures are checked on the build machine; a Pi's drivers are checked on a Pi.)   Needs: gcc-arm-linux-gnueabihf gcc-aarch64-linux-gnu qemu-user
# Usage: native/scripts/cross-check.sh
set -eu
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/wobbly-cross-$$"
rm -rf "$OUT"; mkdir -p "$OUT"
printf 'location_latitude = 40.7\nlocation_longitude = -74\nweatherMode = clear\n' > "$OUT/c.conf"
for triple in "arm-unknown-linux-gnueabihf:qemu-arm:/usr/arm-linux-gnueabihf" "aarch64-unknown-linux-gnu:qemu-aarch64:/usr/aarch64-linux-gnu"; do
  target="${triple%%:*}"; rest="${triple#*:}"; emu="${rest%%:*}"; libs="${rest#*:}"
  WOBBLY_NO_LIBATOMIC=1 cargo zigbuild --release -q --target "$target.2.31"
  bin="target/$target/release/wobbly-clock-run"
  newest="$(readelf --version-info "$bin" | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -1)"
  [ "$(printf '%s\n2.31\n' "$newest" | sort -V | tail -1)" = "2.31" ] || { echo "FAIL: $target needs glibc $newest (Raspberry Pi OS Bullseye has 2.31)"; exit 1; }
  "$emu" -L "$libs" "$bin" --version | grep '^wobbly-clock-run ' >/dev/null || { echo "FAIL: $target does not report its version"; exit 1; }
  "$emu" -L "$libs" "$bin" --help | grep -- '--sink' >/dev/null || { echo "FAIL: $target does not print its help"; exit 1; }
  # no GPU driver in the emulator: it has to say so plainly and stop (not crash)
  if msg="$("$emu" -L "$libs" "$bin" --config "$OUT/c.conf" --sink "ppm:$OUT/frames" --size 64x32 --frames 1 2>&1)"; then echo "FAIL: $target claims to have drawn without a GPU"; exit 1; fi
  echo "$msg" | grep -qi 'EGL' || { echo "FAIL: $target did not say what is missing: $msg"; exit 1; }
  echo "ok: $target starts, reads its settings and reports the missing GPU driver in words"
done
rm -rf "$OUT"
