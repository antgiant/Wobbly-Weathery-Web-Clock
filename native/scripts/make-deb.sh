#!/bin/sh
# Builds a .deb of the static renderer: native/scripts/make-deb.sh <armhf|arm64> <path to wobbly-clock-run> <version> <output dir>
# armhf carries the ARMv6 build, which runs on every 32-bit Pi (Zero to 4); arm64 the 64-bit one. No dependencies: the binary is static.
set -eu
arch="$1"; bin="$2"; version="$3"; out="$4"
here="$(cd "$(dirname "$0")/.." && pwd)"; root="$(cd "$here/.." && pwd)"
pkg="$(mktemp -d)"; trap 'rm -rf "$pkg"' EXIT
install -d "$pkg/DEBIAN" "$pkg/usr/bin" "$pkg/lib/systemd/system" "$pkg/usr/share/man/man1" "$pkg/usr/share/man/man5" "$pkg/usr/share/doc/wobbly-clock" "$pkg/etc/wobbly-clock"
install -m 755 "$bin" "$pkg/usr/bin/wobbly-clock-run"
gzip -9n -c "$here/man/wobbly-clock.1" > "$pkg/usr/share/man/man1/wobbly-clock.1.gz"
gzip -9n -c "$here/man/wobbly-clock.conf.5" > "$pkg/usr/share/man/man5/wobbly-clock.conf.5.gz"
node "$root/native/cli/main.mjs" install-service --print 2>/dev/null | sed 's|^ExecStart=.*|ExecStart=/usr/bin/wobbly-clock-run --config /etc/wobbly-clock/wobbly-clock.conf|' > "$pkg/lib/systemd/system/wobbly-clock.service" || true
if [ ! -s "$pkg/lib/systemd/system/wobbly-clock.service" ]; then
  cat > "$pkg/lib/systemd/system/wobbly-clock.service" <<UNIT
[Unit]
Description=Wobbly Weathery Web Clock
After=time-sync.target

[Service]
ExecStart=/usr/bin/wobbly-clock-run --config /etc/wobbly-clock/wobbly-clock.conf
Restart=on-failure
RestartSec=5
SupplementaryGroups=video render

[Install]
WantedBy=multi-user.target
UNIT
fi
cat > "$pkg/etc/wobbly-clock/wobbly-clock.conf" <<'CONF'
# wobbly-clock settings: the same names and values as the web page (see wobbly-clock.conf(5)). Only what differs from the defaults is needed.
# location_latitude = 41.88
# location_longitude = -87.63
# timeZone = America/Chicago
# brightnessNight = 0.3
# For an LED panel: output = matrix, and matrixConfig = /etc/wobbly-clock/matrix.cfg (rpi-fb-matrix's format)
CONF
cp "$root/docs/LED-PANELS.md" "$pkg/usr/share/doc/wobbly-clock/LED-PANELS.md"
cat > "$pkg/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
if [ "$1" = configure ]; then
  getent passwd wobbly >/dev/null || adduser --system --group --no-create-home --home /var/lib/wobbly-clock wobbly >/dev/null
  adduser wobbly video >/dev/null 2>&1 || true
  if getent group render >/dev/null; then adduser wobbly render >/dev/null 2>&1 || true; fi
  echo "wobbly-clock: edit /etc/wobbly-clock/wobbly-clock.conf, then: systemctl enable --now wobbly-clock"
fi
exit 0
POST
chmod 755 "$pkg/DEBIAN/postinst"
cat > "$pkg/DEBIAN/conffiles" <<'CF'
/etc/wobbly-clock/wobbly-clock.conf
CF
size=$(du -sk "$pkg" | cut -f1)
cat > "$pkg/DEBIAN/control" <<CTRL
Package: wobbly-clock
Version: $version
Architecture: $arch
Maintainer: Wobbly Weathery Web Clock <noreply@users.noreply.github.com>
Installed-Size: $size
Section: misc
Priority: optional
Homepage: https://github.com/antgiant/Wobbly-Weathery-Web-Clock
Description: a clock in front of a real-time sky, for a Raspberry Pi
 The native renderer of Wobbly Weathery Web Clock: shows the time over a sky
 computed for your place, on an HDMI screen or (with wobbly-matrix) an LED
 panel. One static program, no browser, no desktop; works on Raspberry Pi OS
 Lite. Settings are the web page's, in /etc/wobbly-clock/wobbly-clock.conf.
CTRL
mkdir -p "$out"
dpkg-deb --root-owner-group --build "$pkg" "$out/wobbly-clock_${version}_${arch}.deb" >/dev/null
echo "$out/wobbly-clock_${version}_${arch}.deb"
