# To do

Things we know we want, not yet done. Newest first. (Items added 2026-11-02 and 2026-11-03 are not started.)

## CI performance breakdown: what is tested and how long each part takes

**Done 2026-11-04:** the recording (per-suite table on every run, `timings*.json`, job summary), each suite's `covers` line, and `docs/TESTS.md` generated from CI run 63 by `tools/tests-report.mjs --log` (what is tested, pages, opening/waiting/other seconds, where it could be faster). The three CI shares are now dealt by measured cost (`FULL_COST` in `tests/run.mjs`: about 372, 378, 369 s instead of 523, 333, 237 s, so CI takes about 6.5 minutes, not 9). **Update 2026-11-04 (later):** a test-only switch (`?fastjobs=1`, the harness option `fast: true`) brings the page's first jobs sooner, and `alerts`, `led`, `digitweather`, `countdown` and `wind` use it: locally `alerts` went 175 s to 111 s, `led` 125 s to 85 s, `digitweather` 141 s to 99 s; the three CI shares of run 86 ran in about 3.9, 5.3 and 5.6 minutes (the whole run about 6 minutes). **`docs/TESTS.md` and `FULL_COST` in `tests/run.mjs` still hold run 63's numbers (the costs were adjusted by estimate): regenerate them from a CI run's three "where the time went" tables with `tools/tests-report.mjs --log`.** **Still to do:** use the table to cut time: fewer page opens (opening is 47% of browser time: `christmas`, `digitweather`, `led` and `alerts` open 15 to 26 pages each), shorter waits (`perf`, `alerts`, `idle` are mostly deliberate waits: 34% of the total), and refresh `docs/TESTS.md` and `FULL_COST` from a new CI run after any big change (the numbers are from run 63; `share` and `place` have grown since). The README should show the breakdown with its date.

A table of the **full** test run: every suite, what it covers (its checks, grouped), how many pages it opens, and how long it takes on
the CI machine, so we can see where the 7 minutes go and what to cut or move.

- **Record it:** have `tests/run.mjs` and the harness write `test-results/timings.json` on every run: per suite (start, end, checks), per
  page open (`t.open` to ready), per `settle()`/`waitForTimeout`, per unit test file. Print a markdown table to the job summary
  (`$GITHUB_STEP_SUMMARY`) sorted by cost, with the three shares side by side, and keep the JSON as an artifact so runs can be compared.
- **Describe it:** the same table lists each suite's one-line purpose and its check count (the suite files already export `name`; add a
  `covers` line), so "what is tested" and "how long it takes" are one page. Generate `docs/TESTS.md` from it rather than writing it by hand.
- **What we know now (rough, local, software WebGL):** a page open costs about 3 to 4 s (the first sky render is a heavy
  software-WebGL computation); the browser run is about 100 page opens; slowest suites are `alerts` (about 3 min, ten screen shapes),
  `options`, `perf` (about 90 s, real-time measurements), `digitweather` (about 100 s) and `led`; CI wall time is about 7 minutes, set by
  the slowest of three shares. Unit tests and lint take about 5 s.
- **Then use it:** list the biggest wins (fewer page opens by reusing a page for several checks, shorter settles, lower quality where the
  picture does not matter, rebalancing the shares by measured time instead of file order), and decide what belongs in the fast local
  tier (`tests/impact.mjs`). Show the breakdown in the README, with the date it was measured.

## Raspberry Pi targets: a range of Pis, full-resolution HDMI and LED panels of any size

**Decided 2026-11-03: it lives in this repository, in `native/`** (see `native/README.md`). **Decided 2026-11-04: one engine, two hosts.** The Pi runs the web page's own code (JavaScript + GLSL) in a small program, `wobbly-clock-run` (`native/host`: QuickJS, EGL/OpenGL ES, a tiny DOM, a 2D canvas), so there is nothing to keep in step; the earlier Rust re-implementation of the renderer was retired. **Done:** the control layer (`native/cli/`: settings, presets, share links, hardware gating, panel setup, test patterns, systemd unit, signed updates with rollback, man pages, the LED panel guide); the program runs the real page unmodified, with its settings file, live weather (curl), time zones, night dimming and the Liquid Glass digits (the digits' layout is `js/clocklayout.js`, tested against the real page); HDMI through the framebuffer and LED panels through `wobbly-matrix` (matrix mapping, gamma, PWM brightness); the comparison with Chromium in CI (sky, 2D canvas, whole page); cross builds for ARMv6 and aarch64 started under QEMU; the `.deb` and the release workflow. **Not done:** anything on a real Pi or a real panel (speed, drivers, heat, GPIO timing: the first things to try, with `wobbly-clock test`); the Pi 3 and Zero draw on the CPU (Mesa llvmpipe) because the page's shaders need OpenGL ES 3: their speed is unknown and an ES 2 version of the shaders is only worth writing if it is too slow (below); the pills and the settings drawer are not drawn natively; signing is switched off until you make a key (`native/scripts/make-signing-key.sh`); the sd_notify watchdog; the Pi measurements (questions 1 and 2 below).

(Replaces the earlier "original Pi Zero" entry; updated 2026-11-02.) **Goals:** run the clock on **a range of Raspberry Pis**, from the
original Zero up to a 4, in **two output modes**: (1) **full resolution over HDMI**, and (2) **an LED matrix panel of configurable
size**, driven through **[hzeller/rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix)** (the standard hub75 library) so any
panel and wiring it supports works. Not started.

### Can a Pi Zero do HDMI? (the question that decides the plan)

- **The hardware can:** the original Zero has a mini-HDMI port and drives 1080p fine. **The web page cannot run well on it.** The page
  needs WebGL2 with float render targets and a heavy sky; the Zero is a single ARMv6 core at 1 GHz with 512 MB, its GPU (VideoCore IV)
  offers only OpenGL ES 2.0, and browser support for ARMv6 is old and limited (check what the current Raspberry Pi OS ships before
  relying on any of it). Expect "does not start" or "a few frames a minute".
- **A native program can:** the sky does not need to be computed at screen resolution. It is a slow smooth gradient: render it at
  low resolution (say 480 x 270) about once a second and let the GPU scale it up, then draw the digits crisp at full resolution as vector
  shapes (four Bezier curves each; tessellated triangles, or an OpenGL ES 2 / DRM-KMS / SDL2 layer). That is well inside a Zero's budget
  and looks right for a clock. So **HDMI on a Zero = yes, with the native renderer below, not with the web page.**
- **The Pi 3 is the awkward middle:** 1 GB and four cores, but the same VideoCore IV GPU (OpenGL ES 2.0 only), so the web page is still
  unlikely to get WebGL2. The native renderer runs well on it.
- **The Pi 4 (and 5) is the easy case:** a modern GPU with OpenGL ES 3.x, so **Chromium in kiosk mode runs the existing page unchanged**
  over HDMI at full resolution (verify frame rate and heat at 1080p and 4K, probably at quality "medium"). You said you have a 3 and a 4:
  **use the 4 for the full web page over HDMI now** (almost no work: a kiosk-mode install guide and an auto-start service, plus the
  shareable link from the entry below), and keep the Zero and 3 for the native renderer later.

### Targets and how each would run (to be confirmed by measuring)

| Pi | HDMI, full resolution | LED panel (hzeller) |
|---|---|---|
| Zero / Zero W (ARMv6, 1 core) | native renderer only | native renderer; light CPU use so the panel refresh keeps its time slices |
| Zero 2 W, 3 (ARMv7/8, 4 cores) | native renderer (web page doubtful: GLES2 GPU) | native renderer |
| 4 (and 5, check library support) | **the web page in Chromium kiosk, unchanged** (or native) | web page + bridge, or native |

### Ways to build it (least work first)

1. **Web page on a Pi 4 over HDMI.** Nothing to build but the kiosk setup and the sign-link / kiosk mode (see the sign-link entry).
2. **A bridge from the page to an LED panel.** The page already computes the exact LED picture (the normal picture averaged into
   a cols x rows grid, in the LED pass). Expose that grid (a small WebSocket or a shared frame on localhost) and add a tiny C++ or Python
   program on the Pi that pushes each frame into the panel with the hzeller library. Same look as the web LED mode, for free. Needs a
   browser, so a Pi 4 (or anything that runs the page); the panel is on that Pi's GPIO.
   **Even less work: use `rpi-fb-matrix` itself as the bridge.** It mirrors the screen to the panel and your `matrix.cfg` already
   describes the panels. Show the page in a kiosk window **exactly `display_width x display_height` pixels** and let it copy that
   rectangle 1:1 with `crop_origin` (no scaling blur). For that the web LED look needs a **"raw" output mode**: one screen pixel per LED, no
   black lines between LEDs, no bezel, no countdown card drawn over it that the panel cannot show, so that what is on screen is what goes
   on the panel. (A new web setting under Extras, Advanced, next to the LED size: "Output for capture: raw LED pixels".)
3. **The native renderer (the real "range of Pis" answer).** One small compiled program that does not need a browser: astronomy (port of
   the page's logic or a crate), a simplified sky (precomputed lookup tables baked on a desktop, or an analytic sky model instead of ray
   marching), the digits and their morph as a tiny 2D rasteriser, the landscape strip, countdown mode, the sun countdown, night dimming,
   anti burn-in, and weather over HTTP. **Rust or C, cross-compiled for ARMv6 (`arm-unknown-linux-gnueabihf`) and 64-bit ARM**, with two
   output back ends: **a framebuffer / OpenGL ES / DRM-KMS back end for HDMI** at any resolution, and **a back end that links
   rpi-rgb-led-matrix** for panels. WebAssembly for the shared hot loops is an option if one code base for the web page and the native
   renderer is worth the build step.
4. **Pre-baked frames** (fallback): render a day of base frames on a desktop and play them back with live digits; weather means re-baking.

### LED panels: compatible with rpi-rgb-led-matrix

- **One setting maps to the library's geometry:** panel width x height = `--led-cols` x `--led-rows` x `--led-chain` (and `--led-parallel`
  rows of chains). Our existing "LEDs across / down" setting (and its presets) becomes the total pixel size; allow entering the library's
  own numbers (rows, cols, chain, parallel) as a convenience, and its pixel-mapper ideas (rotate, U-arrangement) for odd layouts.
- **Pass through the library's options** in a config file (and, for the sign link, as a few extra settings): `led-gpio-mapping` (regular,
  Adafruit HAT / HAT-PWM), `led-brightness`, `led-slowdown-gpio` (needed on faster Pis), `led-pwm-bits`, `led-pwm-lsb-nanoseconds`,
  `led-rgb-sequence`, `led-panel-type`, `led-multiplexing`, `led-row-addr-type`. A fixed example per common panel in the docs.
- **Brightness and gamma:** matrices are very bright and non-linear; apply a gamma curve and a brightness limit in our output, tied to
  the night-dimming setting (dim at night is the point of a bedroom matrix).
- **CPU budget:** the library drives the panel from GPIO with tight timing and wants a core to itself (it recommends isolating one,
  and disabling the Pi's onboard sound). On a **single-core Zero** every cycle our renderer uses is taken from the refresh and shows
  as flicker, so the native renderer must be light: update the sky once a second, redraw only the digits while they morph, and keep
  the frame rate modest. This is a design constraint for the native renderer, not an afterthought.
- Check current Pi 5 support in the library before promising it (it has been different hardware for GPIO).

### What the native version must be (requirements, added 2026-11-02)

Think of it as a proper small product, not a script. It should:

- **Ask what output you want** the first time it runs (and any time after, with `wobbly-clock setup`): HDMI (full resolution, with a
  choice of mode or "whatever the screen says") or an LED panel.
- **For an LED panel, ask for the panel configuration in a friendly way**, built on what your `rpi-fb-matrix` fork's `matrix.cfg` already
  expresses (sample read 2026-11-02). That file is libconfig text with: `display_width` / `display_height` (the **total** pixels of
  all the chained panels), `panel_width` (normally 32) and `panel_height` (8, 16 or 32; every panel the same height), `chain_length` (panels
  per chain; with parallel chains, the largest), `parallel_count` (1 on the Adafruit HAT, up to 3 on a Pi 2 or later), a **`panels` grid**
  (a two-dimensional list, one entry per panel in its physical place, each with `order` = its position along the chain and `rotate` in
  degrees for snaked runs, and an optional `parallel` chain id), and an optional `crop_origin` for pixel-perfect capture. What we keep and
  what we improve:
  - **Accept and write that same file.** `wobbly-clock import-matrix-cfg matrix.cfg` reads it (so the layout you already worked out is not
    typed twice) and `wobbly-clock export-matrix-cfg` writes one, so the same panels still work with `rpi-fb-matrix` and the library's own
    tools. The native program's own config stays one file with the same keys for the panel part, plus the clock settings (the CLI/web-mirroring
    entry below).
  - **Ask in plain questions instead of making people derive `order` and `rotate` by hand.** (1) Panel size: a menu (32 x 16, 32 x 32, 64 x 32,
    64 x 64, other). (2) How many panels across and down. (3) **Where the cable from the Pi goes in** (a corner) and **how the panels are
    wired from there**: a short menu of the usual patterns with a picture each ("one row", "one column", "snake across then down", "snake down
    then across", "every row starts at the same side"), or "custom". From those it **computes the grid of `order` and `rotate` values** (the
    snake pattern in the sample's comment: start top right, go left, drop down, come back with the lower panels rotated 180) and shows the
    result. (4) Parallel chains (only offered where the Pi and the wiring allow it).
  - **Draw it back in the terminal** as the comment in the sample does, with each panel's order number and an arrow for the direction of
    the chain, and the totals ("64 x 64 pixels, 4 panels, one chain of 4"), and ask "does this match what you built?" before anything is lit.
    The test pattern then proves it (next item).
  - **Check the answers** like the file's comments describe: total width a multiple of the panel width; total height a multiple of the
    panel height; all panels the same height; the HAT allows one chain; parallel chains need the right Pi; `display = panel x grid`
    consistent. Say what is wrong in words, and suggest the likely fix.
  - **No scaling step.** `rpi-fb-matrix` copies a screen and scales it (or crops 1:1 with `crop_origin`); the native renderer draws at exactly
    `display_width x display_height`, so there is nothing to resize or crop. `crop_origin` is only kept in the exported file.
- **Have a test option**: `wobbly-clock test` lights the output with patterns and stops (a few seconds each, Ctrl-C to quit): colour bars
  and a grey ramp (colour order and gamma), an "identify" pattern that numbers every tile and marks its top-left corner (for chain and
  rotation mistakes), a white-to-black brightness sweep, a border box (is every edge lit?), then a short live render of the real clock.
  The same checks run before the first start and after a config change.
- **Let the user control brightness**, day and night, with the sunset as the transition: the same model the web version now has (`js/sky/dim.js`:
  `brightnessDay`, `brightnessNight`, `brightnessTransition`), driving the panel's hardware brightness.
- **Update itself** (see "Keep itself current"): checks a release feed on a schedule at a quiet hour, downloads, **verifies a checksum and a
  signature**, swaps the program atomically, restarts, and **rolls back** if the new version fails to start. Can be turned off, and an update
  never happens in the middle of a transition or a countdown's last minute.
- **Have a command-line configuration that mirrors the web configuration**: the same setting names, values and defaults, so
  `wobbly-clock set hideSeconds on`, `wobbly-clock set clockStyle glass`, `wobbly-clock set countdown both`, `wobbly-clock get`,
  `wobbly-clock presets` / `wobbly-clock preset bedside`, a config file with the same keys, and **the shareable link accepted as a
  configuration** (`wobbly-clock apply 'https://clock.wooleys.us/?c=...'`). One **settings schema** (a single file: key, type, range or
  options, default, short description, which presets set it, and the hardware it needs) is the single source of truth that generates the
  web settings, the share-link codec table, the CLI, and the man page, so they cannot drift.
- **Be smart about the hardware.** Probe the machine at start (CPU architecture and cores, RAM, GPU and OpenGL ES version, output type, how
  fast it can render) and **disable the options it cannot handle, saying why** ("Liquid glass needs an OpenGL ES 3 GPU: not available on
  this Pi", "Rain beads are off on a Pi Zero"), in `wobbly-clock set` (refuses with the reason), in the setup questions (never offers it),
  in `--help` and in the man page. Each schema entry carries what it needs (`requires: gles3`, `cores >= 2`, `output: hdmi`). Where an option is
  merely slow rather than impossible, warn and suggest the cheaper setting.
- **Have a quality man page**: `man wobbly-clock` (usage, every setting with its default and what it needs, presets, examples, files,
  exit codes, environment, troubleshooting, "see also") and `man wobbly-clock.conf`, **generated from the settings schema** so it is always
  complete, linted in CI (`mandoc -Tlint`), with `--help` giving the same content in short form.
- **Have clear instructions for LED panels**: a guide from unboxing to a lit panel: what to buy (panels, hub75, a HAT or bonnet, a power
  supply sized for the panels, with the amperage worked out), wiring with a picture and the pin table, which Pi and which wiring mode,
  the Pi settings the library wants (isolating a core, turning off onboard sound, GPIO slowdown for faster Pis), a worked example for
  each common panel and chain, the test pattern and what each wrong result means (flicker, ghosting, wrong colours: `rgb-sequence`,
  half the panel dark: multiplexing or row address type, upside-down tiles), brightness and heat, and where to ask for help.
- **Run on boot, fully headless**: `wobbly-clock install-service` writes and enables a **systemd service** (starts after the network,
  restarts on failure, logs to the journal, a watchdog if the render loop hangs, drops privileges after opening the GPIO as the library
  allows), `wobbly-clock status`, `logs`, `restart`; configuration can come from a **file on the boot partition** (like wifi's
  `wpa_supplicant.conf`) or the share link, so a Pi can be set up without a keyboard or a screen; first boot with no config shows a
  friendly pattern on the output ("setup needed") rather than nothing.
- **Work on Raspberry Pi OS Lite** (the command-line-only image) and nothing heavier: no desktop, no X11 or Wayland, no browser. HDMI
  output goes straight to the display through the kernel's DRM/KMS (or the framebuffer), the LED output through the matrix library, setup
  is all in the terminal. Ships as a **single static binary plus a `.deb`** per architecture (ARMv6/ARMv7 `armhf`, `arm64`) from a GitHub
  release, with a short install line and a way to verify it, and works on 32-bit and 64-bit Pi OS.
- **Tests and docs for all of it** (see the CI entries): the schema round trip with the web settings; capability gating on faked
  hardware profiles; the setup questions fed scripted answers; golden frames at LED and HDMI sizes against the web renderer; the man page
  generated and linted; the install script and the service run in a container or QEMU; an update with a good build, a corrupt download and a
  build that will not start (rolls back).

### Questions to answer first, in order

1. Which panel(s) do you have or plan to buy (size, chain, hub75 type, a HAT or a bonnet), and which Pi goes with each?
2. **Measure the real limits** on your Zero, 3 and 4: can the current page run at all on each (OS, Chromium version, WebGL2 yes/no,
   frames per second, memory, temperature); this settles what the native renderer must cover.
3. A **feature table for the native renderer**: sun, moon, planets, stars, clouds and a weather tint, horizon, digits and morph,
   countdown mode and the sun countdown, night dimming, anti burn-in: yes in some form. Liquid glass, refraction, rain beads, wind
   sway, plants and the tree: probably not (or later).
4. **How do we know it matches?** Golden frames: render the same moments with the web renderer and the native one at LED sizes and at a
   few HDMI sizes and compare average colour per region within a tolerance, so the native version cannot drift from the real one.
5. **Build, install, update:** cross-compile in CI, a release file per Pi family, a systemd service, settings from a config file or the
   shareable link (see the sign-link entry), and the same "keeps itself current" behaviour as the kiosk web page.

Success looks like: the same clock on a Pi 4 over HDMI today (the web page), and on a Zero or 3 over HDMI or on an LED panel of any size
(the native renderer), set up from a link, a few watts, no keyboard.

## CI hygiene: never merge on a red CI

Added 2026-11-02, after finding CI had been red for about eight runs in a row without anyone noticing.

- **What it was:** one check in the `clock` browser suite counted 24 digit curves; adding countdown mode's hundreds-of-days digit made it 28.
  The `clock` suite's long tail only runs in the full run (CI), not in `npm test` / `npm run test:quick`, so nothing local showed it.
  Fixed in the commit that adds this note. Every red run since the countdown commit was this one check (shard 3 of 3); lint, unit tests
  and the other two shards were green throughout.
- **The lesson:** the fast local check deliberately skips the long tails, so **CI is the only thing that sees them, and it must be read.**
  Do this after every push: look at the CI result (it takes about 8 minutes) before the next change; do not merge on red.
- **Done:** (b) a CI status badge at the top of the README, and GitHub emails failed runs to whoever pushed; (c) `npm test` now prints a
  warning when a shared file (`index.html`, `styles.css`, `js/clock.js`, `js/config.js`, `sw.js`, the test harness) changed, telling you to
  run `npm run test:full` or read CI before merging.
- **Still to do:** (a) **protect `main`** so a merge needs green CI. This is a repository setting (only the owner can change it): GitHub >
  Settings > Branches > add a branch protection rule for `main` > "Require status checks to pass before merging" > pick "Lint and unit tests"
  and the three "Browser tests (share N of 3)" jobs. (d) have the impact map (`tests/impact.mjs`) say which deep suites a change can break, and
  run them in `npm test` when they are cheap enough.

## Share links and manual location: what is left

Built 2026-11-03 and 2026-11-04 (see the README, "Share links" and "Set the place myself"): the short and readable links (`js/share.js`,
frozen version-1 table, version 2 adds an optional time zone), kiosk mode, links applied but never saved, a place by coordinates, search or
the built-in city list (`js/cities.js`, works offline), a QR code (`js/qr.js`), a length limit check, paste-to-convert, friendlier names in
readable links, "Use this setup / Just look", the time at another place (`timeZone`), and kiosk updates in the quiet hour (`js/quiet.js`).
Not done:

- (Done 2026-11-04) the city index: a place from the built-in list travels as its number in a version 3 link, with its time zone.
- A QR code for links over about 210 characters (version 10 is the largest the encoder makes; use the short link).


## Native: one engine, two hosts

Decision: the web page and the Pi share ONE renderer, the JavaScript + GLSL under `js/sky/`. The browser is one host; `native/host` (Rust, QuickJS, EGL/OpenGL ES) is the other.

- [x] The host runs the unmodified `SkyEngine`; its frame matches Chromium's (`native/host/tests/`, a CI job).
- [x] 2D canvas (tiny-skia), a small DOM that runs `index.html` and the page's own scripts, the digits' layout as a tested pure function, the whole page with the glass digits matches Chromium.
- [x] Outputs: framebuffer (HDMI) and LED panels through `wobbly-matrix`; night dimming; settings file; live weather.
- [x] The Rust renderer in `native/core` is retired (matrix mapping, gamma, framebuffer bytes and the settings reader stay); packaging, update script, CLI and man pages kept and adapted (dynamic glibc build for ARMv6 and aarch64, Mesa loaded at run time).
- [x] Pi 3 / Zero (OpenGL ES 2 only): the program restarts with Mesa's software renderer (llvmpipe) and draws the same picture on the CPU (tested by simulating a GPU without ES 3).
- [ ] Only if a real Pi 3 is too slow on the CPU: an OpenGL ES 2.0 profile of the shaders (packed 8-bit textures instead of float targets; VAO, instancing and blit emulated in the host; constant loop bounds; `#if` switches in the same source files) so the Pi 3's GPU can do the work. Time it first on the real Pi 3.
- [-] Direct scan-out through KMS/GBM: not built, on purpose. A clock draws about once a second, so reading a 1080p frame back and writing it to the framebuffer costs a few milliseconds a second; scan-out would save that and nothing visible.
- [ ] Pills and the settings drawer natively (they are DOM furniture; the LED card already draws into the canvas).
- [ ] First tests on real hardware: Pi 4 (ES 3.1), Pi 3 (ES 2.0), an LED panel.
