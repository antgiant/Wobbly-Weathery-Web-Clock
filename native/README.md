# The native version (Raspberry Pi): the command line is built, the renderer is not

This folder is where the native version of the clock will live, in the same repository as the web page so the two stay tightly in step.
The plan, requirements and open questions are in [`../TODO.md`](../TODO.md) ("Raspberry Pi targets"). This file is the contract between the
two halves.

## What is shared (the sync contract)

| Shared thing | Where | How the native version uses it |
|---|---|---|
| **The settings** (keys, types, defaults, options, ranges, which tab, Simple/Advanced, which ones presets set) | [`../schema/settings.js`](../schema/settings.js), generated as [`../schema/settings.json`](../schema/settings.json) | the command line (`wobbly-clock set hideSeconds on`), the config file, the setup questions, the man page and `--help` are all generated from it |
| **The presets** | [`../schema/presets.js`](../schema/presets.js) (also in the JSON) | `wobbly-clock preset bedside` |
| **Share links** (short `?c=...` and readable) | [`../js/share.js`](../js/share.js): a frozen version-1 table and presets, golden links in [`../tests/unit/share.test.mjs`](../tests/unit/share.test.mjs) | `wobbly-clock apply '<link>'` decodes the same links; its tests must decode the same golden links to the same setups |
| **Brightness model** (day, night, sunset transition) | [`../js/sky/dim.js`](../js/sky/dim.js) | the same maths drives the panel brightness; its unit tests become the reference values |
| **Countdown digits** | [`../js/countdown.js`](../js/countdown.js) | same rules (6 / 4 digit caps), same test cases |
| **Pictures to match** | the web renderer, via golden frames | the native output at LED sizes and a few HDMI sizes is compared with the web page's picture (average colour per region within a tolerance) |

**Rule: a change to a shared thing changes both halves in the same commit** (or the commit says which half is still to do, and `TODO.md`
says so too). Nothing here may be copied by hand: generate from the schema, or import the same data.

## What exists today (2026-11-04)

`native/cli/` is a zero-dependency Node program (`node native/cli/main.mjs ...`) that is the whole **control layer**, tested without a Pi:

| File | What it does |
|---|---|
| `config.mjs` | the web page's setting names, values and defaults; a `key = value` file; presets; share links as a configuration |
| `hardware.mjs` | machine profiles (Zero, Zero 2, 3, 4, 5, probed from the board), the `requires` rules from the schema, gating with reasons and fallbacks |
| `panel.mjs` | `matrix.cfg` (rpi-fb-matrix's format) in and out, plain answers to panel grid, checks in words, drawing |
| `patterns.mjs` | the test patterns (bars and ramp, identify, brightness sweep, border) as RGB frames |
| `service.mjs`, `update.mjs` | the systemd unit, boot-partition config, signed and checksummed updates with rollback (logic; the network and file calls are injected) |
| `manpage.mjs` | `man wobbly-clock(1)` and `wobbly-clock.conf(5)` generated from the schema into `native/man/` |
| `main.mjs` | the commands: `setup test get set presets preset apply import-matrix-cfg export-matrix-cfg install-service capabilities man` |

**`native/core/`** is the start of the compiled side: a Rust crate (no dependencies, no I/O) with the **brightness model** (`dim.rs`, from `js/sky/dim.js`) and the **countdown digits** (`countdown.rs`, from `js/countdown.js`). Its tests read `core/tests/golden.tsv`, 2,295 vectors generated from the web code by `tools/native-golden.mjs`, and assert the same answers, so the two cannot drift (a JS unit test fails if the file is stale; `native.yml` runs `cargo test` and builds the crate for the original Pi Zero, `arm-unknown-linux-gnueabihf`, and for `aarch64`). It also has the **ten digit shapes** (`digits.rs`, generated from `dd` in `js/config.js` by `tools/native-digits.mjs`), the page's **morph** (`morph.rs`: `easeInOutBack` and the blend of two digits, checked against the web code's numbers) and a small **software rasteriser** (`raster.rs`: the four curves flattened and stroked 80 wide with soft edges, as coverage 0..1; this is what the HDMI and LED outputs will colour with the sky behind). `frame.rs` lays the time out ("12:34:56", colons as two round dots), centres and fits it to any size, and composes a frame (a gradient background for now, the time in the ink colour, a brightness factor) as RGB bytes; `cargo run --release --example frame -- 64 32 12:34 out.ppm` writes a picture. It reads well down to a 64 x 32 panel. Language decision: **Rust**.

Not built: the **renderer** (the sky, digits and landscape drawn to HDMI or the matrix) and the release/packaging pipeline (static binary, `.deb`,
download, install). `wobbly-clock run` does not exist yet; the service unit already points at it. The LED guide is [`../docs/LED-PANELS.md`](../docs/LED-PANELS.md).
The command line is written in JavaScript so the settings, share links and brightness maths are the web page's own code; the renderer's
language (Rust or C) is still to be decided, and the command line may move into it once it exists.

## Layout (core exists; the rest is planned)

```
native/
  README.md        this file
  Cargo.toml       (or CMakeLists.txt) the workspace
  core/            astronomy, the sky model, the digit morph and countdown, the brightness model; no I/O
  output-hdmi/     full resolution over HDMI: DRM/KMS or framebuffer (OpenGL ES 2 where there is a GPU)
  output-matrix/   LED panels, through rpi-rgb-led-matrix
  cli/             wobbly-clock: setup, test, set/get, preset, apply, install-service, update, status
  man/             generated from ../schema/settings.json
  tests/           unit tests, golden frames, fake hardware profiles
```

## Builds, releases and CI

- Releases are **tagged `native-vX.Y.Z`** and attach a static binary plus a `.deb` per architecture (ARMv6/ARMv7 `armhf`, `arm64`);
  the web page is deployed continuously from `main` and is not affected by these tags.
- CI for this folder is **its own workflow** (`.github/workflows/native.yml`, to be added with the first code) that runs only when
  `native/` or `schema/` changes; the web CI (`ci.yml`) is unchanged by native-only changes. The web version stamp (`js/version.js`) only
  hashes the web files, so a native-only change never bumps the web version.
- GitHub Pages serves the repository root, so this folder is published with the site; harmless, but a small deploy workflow that publishes
  only the web files is a later tidy-up.
- The web linter and test runner ignore `native/`.

## Before writing code

1. Answer the questions in `TODO.md` ("Questions to answer first"): which panels, and which Pi goes with each.
2. Measure the current page on your Zero, 3 and 4 (WebGL2 yes/no, frames per second, memory, temperature).
3. Decide the language for `core/` (Rust or C), then add the workspace, a CI workflow, and a first golden-frame test that renders one
   fixed moment at 64 x 32 and compares it with the web page's picture.
