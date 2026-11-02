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

## What would an original Raspberry Pi Zero need?

Working out what it takes to run this clock on an **original Pi Zero** (BCM2835, one ARM1176 core at 1 GHz, ARMv6, 512 MB, VideoCore IV),
which is a natural driver for an LED panel (the 64 x 32 matrix is the case that matters most). The web page cannot do it as it is:
it needs **WebGL2** with float render targets and a heavy physically based sky, and the Pi Zero's GPU driver offers only OpenGL ES 2.0
and the last Chromium that runs on ARMv6 is old. Questions to answer, in order:

1. **What is the display?** A hub75 LED matrix driven from the GPIO pins (the usual `rpi-rgb-led-matrix` library), or a small HDMI screen?
   For a matrix the picture is only 64 x 32 (or 128 x 64) pixels, a few thousand pixels, which changes everything below.
2. **Measure first.** Can the current page run at all on a Zero (a legacy 32-bit OS with Chromium, a very low quality setting, WebGL2
   availability, frames per second, memory)? Probably not usefully, but it settles the baseline and the "do nothing" option.
3. **A compiled, much smaller renderer.** For a few thousand pixels the sky does not need a GPU. Options, from least to most work:
   - **Node.js (ARMv6 build) + a CPU port of the sky.** Reuse the JavaScript that matters (the vendored astronomy library, the weather and
     countdown logic, the clock digit shapes) and render the sky in plain typed-array maths into a 64 x 32 buffer; the atmosphere from
     precomputed lookup tables (the page's LUTs, baked once on a desktop and shipped as data) or a closed-form sky model instead of ray
     marching. Drive the panel with a Node binding.
   - **A compiled program (Rust or C, target `arm-unknown-linux-gnueabihf` for ARMv6)** doing the same: astronomy (a port or a crate), a
     simplified analytic sky, the digit morph drawn with a tiny 2D rasteriser (the digits are four Bezier curves each), the landscape as a
     skyline strip, and the weather over HTTP. Fastest and smallest; most work, and a second implementation to keep in step with the web one.
   - **WebAssembly** for the hot loops (shared between the browser and a small host on the Pi), if one code base for both is worth the build step.
   - **Pre-baked frames:** the sky changes slowly. Render a day's worth of 64 x 32 base frames (one a minute is about 6 KB each, under
     9 MB a day per place) on a desktop and play them back, compositing only the digits live. Weather would mean re-baking, so this is
     the fallback, not the plan.
4. **Decide what is kept.** A feature table for the Pi build: sun, moon, planets, stars, clouds and weather tint, the horizon, the digits and
   their morph, countdown mode and the sun countdown, night dimming and anti burn-in: yes in some form; liquid glass, refraction, rain beads,
   wind sway, plants and the Christmas tree: probably not.
5. **How do we know it matches?** Golden frames: render the same moments with the web renderer and the Pi renderer at 64 x 32 and compare
   (average colour per region within a tolerance), so the compiled version cannot drift from the real one. Reuse the LED averaging of the
   normal picture as the reference ("exactly what the normal screen would be, made of LEDs").
6. **Build, install, update:** a cross-compile in CI, a release file for the Zero, a systemd service, settings from a config file or the
   same shareable link (see the sign-link entry below) so it can be set up without a keyboard, and the same "keeps itself current" behaviour.

Success looks like: a Pi Zero driving a 64 x 32 panel with a live sky and the time, over a few watts, with settings from a link.

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
