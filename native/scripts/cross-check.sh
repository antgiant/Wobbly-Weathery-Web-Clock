#!/bin/sh
# Builds the static binaries for the Pis and checks that each renders exactly the same frames as the machine's own build, by running them under
# QEMU user-mode emulation (needs qemu-user). Same settings, same moment, byte for byte.   Usage: native/scripts/cross-check.sh
set -eu
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/wobbly-cross-$$"
rm -rf "$OUT"; mkdir -p "$OUT"
cat > "$OUT/c.conf" <<CONF
location_latitude = 40.7
location_longitude = -74
timeZone = America/New_York
twentyFourHourClock = on
brightnessNight = 0.3
CONF
cargo build --release -q
./target/release/wobbly-clock-run --config "$OUT/c.conf" --sink "ppm:$OUT/host" --size 128x64 --frames 3 --at 1782086400000
for pair in "arm-unknown-linux-musleabihf:qemu-arm" "aarch64-unknown-linux-musl:qemu-aarch64"; do
  target="${pair%%:*}"; emu="${pair##*:}"
  cargo build --release -q --target "$target"
  "$emu" "target/$target/release/wobbly-clock-run" --config "$OUT/c.conf" --sink "ppm:$OUT/$target" --size 128x64 --frames 3 --at 1782086400000
  for f in "$OUT"/host/*.ppm; do
    cmp "$f" "$OUT/$target/$(basename "$f")" || { echo "FAIL: $target differs from the host build on $(basename "$f")"; exit 1; }
  done
  echo "ok: $target renders the same frames as the host build"
done
rm -rf "$OUT"
