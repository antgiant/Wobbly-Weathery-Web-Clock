# The native version (Raspberry Pi): not started

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

## Layout (planned)

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
