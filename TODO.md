# To do

Things we know we want, not yet done. Newest first. Updated 2026-11-07. (The long Raspberry Pi planning notes of 2026-11-02 to 11-04 are in the git history: `git log -p TODO.md`; what they asked for is built, see "Built" at the end.)

## In flight (2026-11-07)

- **Publish the first signed release, `native-v0.2.0`.** The signing key is made (public half: `native/release-key.pem`, private half: the `NATIVE_SIGNING_KEY` secret). A tag cannot be pushed from the
  working session (the git proxy refuses it), so `native-release.yml` can now be started by hand with a version and makes the tag itself (Actions > Native release > Run workflow, version `0.2.0`).
  After it: install the armv6 `.deb` from the release page once on the clock Pi (it carries the public key), `sudo systemctl enable --now wobbly-clock-update.timer`, then
  `sudo WOBBLY_DRY_RUN=1 wobbly-clock-update` to prove the update path before trusting the timer.
- **Prove the time is exact on the Zero.** From the seconds-off rung the next minute is drawn ahead and shown on the minute, no sky redraw starts where it could cross the minute, the sky is drawn once a
  minute there (built 2026-11-06, tested only on a CPU-drawn host). Re-run 720p and 1080p (`ladder2-*.txt`), watch the minute turn on the real screen several times.
- **HDMI on this Zero.** It showed nothing until a cable was reseated; the screen gives no EDID (`/sys/class/drm/card0-HDMI-A-1/edid` is 0 bytes), so the resolution cannot be detected: the kernel
  command line still holds `video=HDMI-A-1:640x480M@60D`. Settle on `video=HDMI-A-1:1280x720@60D` (or 1920x1080) and note it in `docs/TRY-ON-A-PI.md`.
- **A long run on the real Zero**: a week or two, then read `journalctl -u wobbly-clock | grep health` (rss and canvases must stay flat) and `vcgencmd get_throttled` (0x0). The CI soak runs on the CPU
  renderer, not the Zero's GPU driver.
- **The iPhone**: the status line under Settings > Scene > Quality, `?stats`, and the sunrise banding fix (version 67 and later; "Update and reload").

## The capability ladder: what is left

Built: ten rungs (weather, ambient, tick, seconds off, slow clock, solid digits, flat ground, gradient sky, half and quarter picture) layered over the resolution governor, on the Pi and on the web
(`js/sky/capability.js`); the settings screens grey out what it gave up; the `adapt` setting (Automatic, Off, or hold at a step); the Pi program logs `ladder: rung N (name)` whenever it moves.

- **Where the Zero settles.** Measured 2026-11-06: 640x480 settles on rung 3 (tick, about 220 ms a frame); 720p and 1080p settle on rung 4 (seconds off). Rungs 5 to 8 have not run on hardware.
- **Sky redraws take 5 to 10 s wall for about 2 s of CPU on the Zero** (the GPU is the limit). Find which passes (tables, sky, terrain) and whether they can be cached or drawn smaller.
- **Astronomy costs 250 to 580 ms of JavaScript per sky redraw** (`_updateAstro`): cache it by the minute or cut what it recomputes.
- **Start-up is 35 to 45 s** (shader compile and link about 10 s, plants' first draw 3 s). Check that Mesa's shader cache (`MESA_SHADER_CACHE_DIR`, now capped at 64 MB) makes the second boot faster; keep the program binaries between boots if not.
- **Several redraw triggers a second** (the light timer, layout events, the clock loop) each cost a glass pass: coalesce them.
- **The gradient sky and flat ground are my own design** (`js/sky/flatsky.js`); "like the Zeus repo" was asked for, but that repository has no gradients. Ask what was meant.
- **`wobbly-clock status` could print the rung** (it prints only the service state).

## Raspberry Pi: what is left

- **Digits centred (2026-11-07).** The clock row sat 1 to 4% of the screen's width left of centre (web and Pi alike): a 93%-wide box laid out from the left edge plus a fixed 6% nudge for a hidden leading digit. `centreMargin` (js/clocklayout.js) now works the margin out from where the digits are; every layout is within 0.8% of centre. Left: a row that starts with a 1 still sits about 0.6% right of one that starts with a 2 (ink differs); countdown mode (hundreds digit) and phone-size screens were checked only by the layout function, not by eye.

- **First tests on a Pi 4 (ES 3.1), a Pi 3 and an LED panel.** Only the Zero W has run on real hardware.
- **An LED panel on the Zero**: the panel library's busy loop against a one-core Zero is unmeasured.
- **2038**: the 32-bit builds use a 32-bit time counter (glibc 2.31, bullseye). Fix: Raspberry Pi OS built on Debian 13 (trixie) plus a build with 64-bit time. Whether trixie still runs the ARMv6 Zero is
  unconfirmed (a blog says yes): try a spare SD card (`dpkg --print-architecture`, `date -d @2147483648`). The `aarch64` build is not affected.
- **`docs/TRY-ON-A-PI.md` is behind**: add removing an old kiosk (`startx` in `.bash_profile`, `.xinitrc`, browser and X packages), the `video=` kernel option, the service's wait for the GPU, the update timer, `journalctl ... | grep ladder`.
- **Pills on the Pi: built 2026-11-07** (sun countdown, umbrella alert, countdown name: `native/host/js/pills.js`, text from an embedded Inter subset). Not done: the settings drawer and the toast, wake, shared and update banners (page furniture with nothing to tap on a headless clock); backdrop blur behind the pills (a darker capsule instead); a custom font for names outside Latin letters (they show a box).
- Direct scan-out through KMS/GBM: not built, on purpose (a clock draws about once a second; the framebuffer copy costs a few milliseconds).

## CI performance breakdown: what is left

Done: the recording (per-suite table on every run), each suite's covers line, docs/TESTS.md generated from a CI run (refreshed 2026-11-07 from run 207), and the three shares dealt by measured cost (FULL_COST in
tests/run.mjs, refreshed from the same run: the shares now come out at about 270, 272 and 275 s of suites; they were 191, 350 and 276 s, so CI's browser wall time should fall from 5:52 to about 4:40).
Still to do: cut page opens (46% of the browser time is opening pages: 182 pages at about 2.1 s) by reusing a page for several checks; shorter settles (37% is deliberate waiting: perf 75 s, idle 32 s, alerts 37 s);
decide what belongs in the fast local tier (`tests/impact.mjs`). Browser tests flake on slow runners: some poll instead of waiting a fixed time (wind, ladder); digitweather once failed the same way.

## CI hygiene: never merge on a red CI

Added 2026-11-02 after CI was red for about eight runs without anyone noticing. Done: the README badge, `npm test` warns when a shared file changed. Rule kept: read CI and Native before merging.
Still to do: (a) **protect `main`** so a merge needs green CI. Only the repository owner can: GitHub > Settings > Branches > add a rule for `main` > "Require status checks to pass before merging" > "Lint and unit tests"
and the three "Browser tests (share N of 3)" jobs (Native's jobs are not in that list yet). (d) have the impact map say which deep suites a change can break and run them in `npm test` when cheap enough.

## Share links and manual location

Built: short and readable links, kiosk mode, a place by coordinates, search or the built-in city list (`js/cities.js`, offline), QR code, time at another place, kiosk updates in the quiet hour.
(Done 2026-11-07) a QR code for any link up to 2331 characters: the encoder makes versions 1 to 40, every version at both levels decoded with OpenCV; a link over about 210 characters says its code is dense and the short link is easier to scan.

## Built (was planning on 2026-11-02 to 11-04)

- **One engine, two hosts**: the Pi program (`wobbly-clock-run`, `native/host`) runs the web page's own JavaScript and GLSL; its frame matches Chromium's (a CI job). 2D canvas, DOM stub, the glass digits.
- **Outputs**: HDMI through the framebuffer, LED panels through `wobbly-matrix`, night dimming, settings file, live weather.
- **OpenGL ES 2 profile** for the Zero and the Pi 3: packed 8-bit sky tables, no instancing (`js/sky/portable.js`); a Pi without any GPU context falls back to Mesa's CPU renderer.
- **The command line and the packaging**: `wobbly-clock get / set / presets / preset / apply / setup / test / status / logs / restart / update / capabilities / install-service`, `import-matrix-cfg` and
  `export-matrix-cfg`, one settings schema that generates the web settings, the share codec, the CLI and the man pages, hardware gating (`requires`), the `.deb` and static binaries per Pi family,
  the signed self-update with rollback, the systemd service (notify, watchdog, memory valve, waits for the framebuffer and the GPU at boot), `docs/LED-PANELS.md`.
- **Long-run safety**: hourly `health:` line (uptime, memory, canvases, pictures), `--maxrss 350` restart, the shader cache capped at 64 MB, a CI soak test.
- **The Pi's own time zone** is used when no `timeZone` is set (it showed UTC before).
