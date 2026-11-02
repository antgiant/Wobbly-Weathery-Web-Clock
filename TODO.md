# To do

Things we know we want, not yet done. Newest first. (Added 2026-11-02, not started: the three items directly below.)

## CI performance breakdown: what is tested and how long each part takes

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

## LED look: make the background of the pixel-art umbrella (and countdown card) transparent, not black

On the LED panel the rain alert's umbrella (and the sunrise / sunset countdown card) is drawn on a solid black plate (`drawLedCard()` in
`js/sky/ledcard.js` fills a black rectangle behind the icon and the pixel text). Make that plate **transparent** so the sky shows
through, as the rest of the LED picture does.

- Readability must not drop: replace the plate with a **one-LED dark outline** around every lit pixel (the same idea as the thin outline
  round the digits), so the icon and the text stay legible on a bright or a dark sky, and for colour-blind readers (luminance, not hue).
- The clock still makes room for the card (`--led-top`), so nothing covers the time; only the background changes.
- Tests: the card's overlay has transparent pixels outside the glyphs (alpha 0) and a dark outline pixel next to each lit one; the existing
  "nothing covers the time" checks in `tests/browser/alerts.test.mjs` stay green; a bright-sky and a dark-sky pixel-contrast check on the icon.
- Check both the tuned layouts (pixel card) and the other sizes (full-size pills drawn through the LEDs).

## Brightness: a day level and a night level, with sunset and sunrise as the transition (web and native)

Added 2026-11-02. Today "Dim the screen" is a black veil with three modes (Never, At night, Always) and one "how dark" slider
(`js/sky/dim.js`), which only ever darkens, and only around dusk. Replace it, on the **web version too**, with a clearer model that the
native version (below) also needs, because an LED panel's brightness is a real hardware setting:

- **Two levels:** a **day brightness** and a **night brightness** (percent), each settable on its own (a bright day, a dim day for a bedroom,
  a very dim night).
- **The transition follows the sun:** brightness eases from the day level to the night level around **sunset**, and back around
  **sunrise**, over a set time (default about 45 minutes, centred on the sunset or sunrise, or defined by the sun's altitude, civil
  twilight to full dark, as the veil does now), on a smooth curve so nothing steps.
- Replaces "Dim the screen" and "How dark": old settings migrate (Never = both levels 100%; At night = day 100%, night = 1 minus the old level;
  Always = both at the old dim level). Presets (Bedside, Battery saver, LED panel, Everyday) set sensible pairs.
- **Web:** applied as the veil/opacity as now, so it costs nothing extra; keep the dimming **time-travel aware** (follows the simulated sun).
- **Native:** the same numbers drive the panel's hardware brightness (`--led-brightness`) or the output's scaling, with a gamma curve so 20% looks
  like 20%; with the manual-brightness and a "never below" floor so a sign cannot go black by mistake.
- Tests: the level at noon, midnight, and at sunset +/- the transition half-width (monotone, smooth, no jump); migration of old settings;
  the polar day / polar night cases (no sunset: use the day or the night level by the sun's altitude); time travel.

## Raspberry Pi targets: a range of Pis, full-resolution HDMI and LED panels of any size

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
- **For an LED panel, ask for the panel configuration in a friendly way**, modelled on the configuration of
  [rpi-fb-matrix](https://github.com/antgiant/rpi-fb-matrix) (your fork): panel width and height, how many panels are chained and
  stacked in parallel, how they are laid out as tiles and which way up, with named presets for common panels (32 x 16, 32 x 32, 64 x 32, 64 x 64,
  and chains of them), wiring (regular GPIO, Adafruit HAT / bonnet), and a **small picture in the terminal of the layout it understood**
  so a mistake is visible before anything is lit. (I have not read your fork's current config: model the questions and the file format on it.)
- **Have a test option**: `wobbly-clock test` lights the output with patterns and stops (a few seconds each, Ctrl-C to quit): colour bars
  and a grey ramp (colour order and gamma), an "identify" pattern that numbers every tile and marks its top-left corner (for chain and
  rotation mistakes), a white-to-black brightness sweep, a border box (is every edge lit?), then a short live render of the real clock.
  The same checks run before the first start and after a config change.
- **Let the user control brightness**, day and night, with the sunset as the transition: the model in the brightness entry above,
  shared with the web version.
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
- **To do:** (a) protect `main` so a merge needs green CI (branch protection with the three browser shares and "Lint and unit tests" as
  required checks); (b) make CI failures arrive somewhere visible (GitHub's email, or a README badge for the CI status);
  (c) run `npm run test:full` before a merge that touches shared markup (`index.html`, `styles.css`, `js/clock.js`), which is
  exactly where the quick tier is blind; (d) have the impact map (`tests/impact.mjs`) say which deep suites a change can break, and run
  them in `npm test` when they are cheap enough.

## A link to the current setup, for a digital sign

Added 2026-11-02. **Goal:** "Share this setup" produces a link that, opened on a screen nobody can touch (a digital sign, a kiosk
browser, a wall display), shows the clock exactly as configured. **The link must be as short as possible**: signage players
often cap URLs (255 characters is common, 2,000 a comfortable limit, some hand the URL to a QR code or a text field).

### What the link must do

- **Apply the whole setup without any interaction**, and **not save it** on that device: it is an override for this load only
  (like the test deep links `?t=`, `?weather=`, `?lat=` are today), so a shared link never overwrites someone's own settings.
  Opening it on a normal phone can offer "Use this setup" / "Just look".
- **A link that sets a location never shows the first-run location question** ("real location or estimated?"), whatever form the link
  uses (a place by name, coordinates, a city index, or "estimate from the time zone"), and it never asks for geolocation. Today
  only `?lat=&lon=` skips the question; the new link forms must too, and so must a link that carries no place at all when it is
  a kiosk link (the sign then estimates from the time zone rather than asking).
- **Kiosk behaviour** (a flag in the link, or implied by it): nothing that needs a finger. Hide the settings, VR and
  return-to-default buttons; skip the first-run location question (the link carries a place, or says "estimate from the time
  zone"); no "Tap to keep the screen on" banner, install prompt, toasts or "new version" banner; never ask for permissions.
- **Keep itself current without anyone tapping**: when the service worker sees a newer version, a kiosk page reloads by itself,
  at a quiet moment (say 03:00 local, or when the minute digit has just changed), instead of showing the banner.
- **Work offline** as now (the saved copy), and survive a reload or a power cut by being the URL it starts from.

### Making it short

Query-per-setting (`?hideSeconds=1&glassFrost=0.55&...`) and JSON in base64 are both long (hundreds of characters). Better:

1. **Send only what differs from a base, never the whole config.** Closest preset plus changes is right, and defaults are just
   the preset "Standard", so one mechanism covers both. The encoder tries every preset (and Standard), picks the one with the
   fewest differences, and writes that preset's id plus the differences.
2. **A fixed table of settings, not names.** Every setting gets a permanent index, a type and a size: a switch is 1 bit, a
   choice is 2 to 4 bits (an index into its options), a slider is 4 to 7 bits (quantised to the step the control already has).
   A change is "setting number (6 bits) + value (1 to 7 bits)", about 12 bits, so **two URL characters per change** in
   base64url (6 bits a character). Rough size: header (version, flags, base preset) 2 characters, plus 2 per change. A preset
   alone is about 3 characters; a typical share of a preset and five changes is about 12.
3. **Pack bits, then base64url.** No compression library: at this size it can only make things longer. The whole link is
   `https://clock.wooleys.us/?c=` and 10 to 25 characters, well under 60 in total.
4. **Special values cost a little more, still tiny:** a place is two numbers rounded to 0.1 degree (about 4 characters), or one
   bit for "estimate from the time zone" (which also avoids putting coordinates in a link); a countdown date is minutes since
   2020 (about 4 characters); the countdown's name is the only free text, sent as plain URL-encoded text (the sign never needs it unless
   it is a countdown).
5. **A query parameter, not a `#fragment`.** Fragments are never sent to a server, which is nice, but several signage players,
   QR scanners and redirect services strip or mangle them. `?c=` is the most widely tolerated.
6. **Ruled out or later:** a URL shortener (an outside service, and it must stay up for as long as the sign does); named sign
   files in the repository (`?sign=lobby`, a JSON file committed to the site: shortest of all, but needs a deploy per change; a
   good extra for fixed installations, not the main route).

### Two kinds of link: short and readable

- **Short** (`?c=...`, the bit-packed form above): for signs with tight limits and for QR codes. Not meant to be read.
- **Readable** (longer, human friendly): for when length is not the problem and you want to see, edit and explain it:
  `?preset=bedside&seconds=off&style=glass&place=Chicago&kiosk=1`. Real names for the settings, the presets and their values
  (`on`/`off`, option names, plain numbers), and a place by name or as `place=41.9,-87.6`. Anyone can change one word by hand,
  paste it into a ticket, or keep it in a notes file. Rules: the key names are stable and never reused (a renamed setting keeps its
  old name as an alias), unknown keys are ignored, and values are clamped as for the short form. It decodes to exactly the same
  setup, and the Share box can convert either to the other.
- The Share box shows both, with their lengths, and **a one-line description in words** under them ("Bedside preset, seconds hidden,
  Chicago, kiosk mode"), so you can check a link says what you meant before it goes to a sign.
- The readable form has no frozen preset table to keep (it names the preset and lists every difference from the preset
  *as it was*), but then a changed preset would change an old link: write the **full** setup into a readable link by default
  (the preset name is then only a label), and treat "preset plus changes" as the short form's job.

### A way to set the location by hand

A sign has no GPS, nobody to approve a permission, and a time zone that may be wrong (a server in another place), so the link
has to carry a place, and the app needs a **manual location** option to match (and it is useful on its own, for a clock that shows
another city's sky):

- **Settings → Place**: a third way beside "Use my real location" and "Estimate from the time zone": **"Set it myself"**, with
  latitude and longitude boxes (decimal degrees, with a hint on the format and a check that they are in range) and a name to show.
- **Search by name** (a text box with suggestions): offline from a built-in list of cities (the time-zone centroids data is a
  start; a list of about 25,000 larger places is a few hundred KB, to be weighed against the page size budget in
  `tests/unit/weight.test.mjs`), or the free Open-Meteo geocoding service when online. A built-in list keeps a kiosk working
  offline and keeps the link short (a city is an index, about 2 characters, not 4 coordinates).
- Sunrise, the sky, the weather and the time zone all follow the chosen place. The time shown is by default still **the device's
  own clock**; add "Show the time at that place" (the place's time zone) for a sign in one city showing another.
- It is stored like the other location choices (privacy as now: weather lookups use the position rounded to 0.1 degree) and is part of
  the link in both forms: `place=Chicago` or `place=41.9,-87.6` (readable), a city index or two rounded numbers (short).
- A link that carries a place, in either form, skips the first-run question (add to `tests/browser/startup.test.mjs` next to the
  existing `?lat=&lon=` check: short link, readable link by name, readable link by coordinates, and "estimate"), and the question
  does not appear later in the session either.
- Tests: a typed place moves the sun to the right azimuth at a known time; out-of-range and empty values are rejected; the link
  round trip keeps it; manual overrides estimated and real, and a link never asks for geolocation.

### The trap: presets change, links must not

A link that says "preset 3 plus changes" means something different if preset 3 is edited next month. So the **codec is
versioned and frozen**: the link carries a version, and each version keeps its own copy of the base presets and the settings table
(new settings are only ever appended; a base preset is never edited, a changed preset gets a new id). Old links keep decoding to
the setup they were made with. Settings added later fall back to their default in an old link. Unknown newer versions decode
what they can and ignore the rest.

### Where it lives

- **Settings → Presets → Share this setup**: shows the link, a Copy button, its length (with a note when it is over 255 / 2,000
  characters), a QR code, and a "Kiosk mode" switch (hides the controls, as above). A "Preview" opens it as the sign will see it.
- New module `js/share.js` (pure, no DOM: `encode(conf) -> string`, `decode(string) -> conf patch`), read by `app.js` at start.

### Safety

The link only ever sets known settings, each clamped to its own range or option list; it cannot run anything. Text is
length-limited and always set as text.

### Tests to write

- **Round trip over many random setups** (`decode(encode(x))` gives `x`, for every setting type and every preset as base).
- **Length**: every preset alone is at most 4 characters; a preset plus five changes at most 16; print the length of every
  preset so a growth in the table shows up.
- **Frozen links**: a list of example links with the setups they must always decode to (added to, never edited), so a change that
  breaks old links fails the build.
- **Kiosk**: the controls and banners are not on the page; nothing was saved to storage; no question, no permission prompt;
  a newer version reloads at the quiet moment.
- **Hostile input**: truncated, over-long, wrong-version, out-of-range and non-base64 links are ignored safely.

## Raindrops on the digits look wrong

Reported on a real phone (2026-11-02). What is wrong:

1. **Drops fade out instead of running off.** A bead appears and disappears on a timer (`rainBeads()` in `js/sky/glsl-scene.js`, the `life` fade) rather than growing, running down and leaving the digit.
2. **They do not slide down properly.** The "slide" is a fixed hop along a screen column, with a faint trail; there is no gravity, no speeding up, no pause-and-jump like a real drop, and drops do not merge.
3. **Changing the number has no effect on them.** The beads are a pure function of the screen position and the time (a stateless shader), so when a digit morphs into the next one the drops stay put, even where the glass has moved away from under them. Drops on a digit should move with it, and be wiped or shed when the stroke under them goes away.

Why it is hard: the effect has no memory. Doing this properly needs state: a small drop simulation (positions, sizes, speeds) that lives with the digits.

Ideas, roughly in order of effort:

- **Particles on the CPU** (a few dozen drops per digit): each has a position in the digit's own coordinates (so it follows the morph), a size, and a state (sitting, running). Sitting drops grow slowly while it rains; past a size they run down with gravity, in jerky bursts, leaving a trail and swallowing smaller drops; they are shed when the stroke under them thins out or ends. Drawn into the glass mask's spare channels, or as a small instanced layer over the glass.
- **A drop texture on the GPU** (ping-pong, like a height field): simulate in a fragment shader with the mask as the surface. More realistic, much harder to tune, and costs power every frame (not while saving power).
- Keep it **cheap and optional**: it is already switchable (Settings → Weather → Rain & snow → Rain and snow on the digits); in power saving it should be still beads or off, as now.

Things to keep: edge-thin and readable (the outline still frames every digit), works in the glass, tube and LED styles, follows the weather being drawn, and the test that the effect shows up (`tests/browser/digitweather.test.mjs`). New tests needed: a drop moves down, not sideways; drops stay on the ink; after a digit change no drop is left where there is no ink.

The same stateless-shader limit applies to **snow caps** (they are drawn from the mask each frame, so they do follow a morphing digit, which is fine), and to the **splashes**.
