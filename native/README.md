# The native version (Raspberry Pi): the web page's own code, run without a browser

**One engine, two ways to show it.** The sky, the weather, the plants and the Liquid Glass digits are drawn by the web page's JavaScript and
GLSL (`../js/`, `../index.html`). In a browser the page does it; on a Pi, `wobbly-clock-run` does it: a small program that runs the *same
files* in an embedded JavaScript engine (QuickJS), draws with the Pi's GPU through EGL and OpenGL ES, and sends the frames straight to an HDMI
screen or an LED panel. There is no browser, no desktop and no second implementation to keep in step: a change to the page is a change to the
Pi, because it is the same code. (An earlier version of this folder re-implemented the renderer in Rust; it was retired for exactly that
reason.)

```
 web page (js/, GLSL, index.html)  ──►  browser                     the page, as ever
                                   └─►  wobbly-clock-run  ──►  framebuffer (HDMI)
                                         QuickJS + EGL/GLES      LED panel (via wobbly-matrix)
                                         tiny DOM, 2D canvas     picture files (tests)
```

## What is shared, and how it is kept honest

| Shared thing | Where | How the Pi uses it |
|---|---|---|
| **Everything the page draws** | `../js/`, `../index.html`, `../data/` | embedded in the program and run unmodified (`wobbly-clock-run --web DIR` runs a folder instead, for working on the page) |
| **Settings** (names, types, defaults) | `../schema/settings.js` | the settings file (`key = value`) becomes the page's saved settings; the command line, man pages and `--help` are generated from the same schema |
| **Presets and share links** | `../schema/presets.js`, `../js/share.js` | `wobbly-clock preset bedside`, `wobbly-clock apply '<link>'` |
| **The digits' layout** | `../js/clocklayout.js` | the page lays its digits out with CSS; the Pi has no CSS engine, so this pure function does the same sums. `tests/browser/clocklayout.test.mjs` compares it with the real page for eight window sizes and settings, so the two cannot drift apart unnoticed |

**What proves the Pi draws what the browser draws** (`.github/workflows/native.yml`, job "The native host draws what the browser draws"): the same
moment is rendered by the program and by Chromium and the two pictures are compared (`native/host/tests/`): the sky alone (mean difference
0.5 of 255), a 2D-canvas drawing in the style of the glass mask (0.13 of 255), and the whole page with the glass digits (sky, ground and digits
in the same places; the small remaining difference is the edge of the glass).
Mesa's fast software renderer (llvmpipe) gets some of the engine's integer noise arithmetic wrong in some versions, so the comparison uses
its exact but slow one (softpipe); the Pi's own drivers (v3d, vc4) are separate, and are checked on a Pi.

## What is in this folder

| Where | What |
|---|---|
| `host/` | **`wobbly-clock-run`**, the program. Rust: `src/main.rs` (QuickJS, module loader, the page's files inside the program, timers), `src/egl.rs` (a GPU context with no window), `src/gl.rs` (the ~56 OpenGL ES calls the engine makes), `src/canvas2d.rs` (the 2D canvas, drawn by tiny-skia), `src/out.rs` (where frames go). `js/` is its JavaScript: `host.js` (WebGL objects, canvas), `dom.js` (a small DOM: the page's `index.html` is parsed into it, with a selector engine and events), `polyfills.js` (what QuickJS lacks: URL, Intl time zones, TextEncoder ...), `boot.js` (loads the settings, runs the page, hands frames to the output) |
| `core/` | small and tested: the settings file reader (`config.rs`), the LED panel mapping (`matrix.rs`: rpi-fb-matrix's `matrix.cfg`, every rotation and chain), gamma and framebuffer bytes (`output.rs`), the pipe to the panel program (`sink.rs`) |
| `cli/` | `wobbly-clock`, the command line (Node, zero dependencies): `setup test get set presets preset apply run status logs restart update install-service import-matrix-cfg export-matrix-cfg capabilities man` |
| `matrix-sink/` | `wobbly-matrix`, a small C program that drives hub75 panels through hzeller's library |
| `scripts/` | `make-deb.sh`, `cross-check.sh`, the update script and its timer, the signing-key helper |
| `man/` | `man wobbly-clock(1)` and `wobbly-clock.conf(5)`, generated from the schema |

## Running it

```
wobbly-clock-run --config /etc/wobbly-clock/wobbly-clock.conf          # what the service runs: HDMI, or the LED panel if output = matrix
wobbly-clock-run --config my.conf --sink ppm:/tmp/frames --size 960x540 --frames 3 --at 1782061200000     # pictures, for looking and for tests
```

* **HDMI**: frames are read back from the GPU and written to the kernel framebuffer (`/dev/fb0`, 32, 24 or 16 bits). The page's own
  night dimming is applied to the pixels. (A clock draws about once a second, so copying a 1080p frame, 8 MB, costs a few milliseconds
  a second; scanning out directly through KMS/GBM would save that and nothing visible, so it is not built.)
* **LED panel**: the page's LED look is rendered at four pixels per LED, the middle of each cell is read back, mapped onto the chain by
  `matrix.cfg`, gamma-corrected and streamed to `wobbly-matrix`; the brightness goes to the panel's own PWM.
* **Live weather** and the other network lookups are the page's own, through `curl`.

**Limits today:** the pills (sunrise countdown, rain alert, countdown name) and the settings drawer are page furniture made of DOM elements
and are not drawn natively; the LED card's bitmap font is (it is drawn into the canvas). **Which Pis:** every one with a GPU driver. The Pi 4 and 5 have OpenGL ES 3 and draw the page's shaders as they are. The Pi Zero (all models), Zero 2 and Pi 3 have OpenGL ES 2 only
(VideoCore IV: no float render targets, no choice of mip level in a shader, no instancing, no integers in shaders), and there the program draws on the GPU too, with the same files:
the shaders are translated to GLSL ES 1.00 when they are loaded, and the places where the two kinds of GPU differ go through a few helper functions (`../js/sky/portable.js`):
the sky tables are packed into 8-bit textures (12 bits of log brightness and two colour ratios) and read with a hand-made bilinear blend; the noise's mip levels live in one texture
(`data/noise.bin` is the noise, made by `tools/make-noise.mjs`, because the GPU cannot make it); the glass's frosting reads the scene's mip levels from separate textures; the plants are
drawn as six vertices each instead of instances. The program tries ES 3, then ES 2, and only with no GPU context at all does it restart with Mesa's software renderer
(llvmpipe, on the CPU; `--software` forces it); `--es2` takes the ES 2 path on any GPU, which is how CI checks that it draws what the ES 3 path draws (mean difference under 1 of 255).
The quality governor (`../js/sky/governor.js`) lowers the picture's size and detail until frames come at 15 per second or better. **Not verified on a real Pi:** speed, the drivers, the framebuffer, a real panel.

## How the shaders are organised (where to change the sky, the weather, the ground, the glass)

A small GPU has to hold a whole shader at once, and the Pi Zero's cannot hold one with all of the sky, the ground and the weather in it (it runs out of registers and draws
nothing). So the picture is made by several small programs, each with only what it needs (`../js/sky/glsl-*.js`):

| Program | Draws | Change this to change |
|---|---|---|
| `FRAG_SCENE_SKY` | every pixel that is not wholly ground: sky colour, sun, moon, Milky Way, the three cloud layers, fog, the falling rain or snow | `SCENE_SKY` (clouds, sun, moon), `finish()` (rain and snow streaks, tonemap) |
| `FRAG_SCENE_TERRAIN` | the ground, water and city layers, blended over the sky by how much of each pixel is ground | `SCENE_TERRAIN` (ground, sea, ridges, city lights) |
| both | what they share: direction, exposure, skyline, light reaching the ground | `SCENE_HEAD`, `SCENE_SETUP` |
| stars, plants | point sprites and billboards, in their own programs | `glsl-scene.js` (stars), `glsl-plants.js` |
| `fragBlit('off' / 'ink' / 'glass')` | the final pass: a plain copy, the LED panel's flat ink, or the Liquid Glass digits (with snow, rain drops and the readability outline) | `bodyGlass()`, `bodyInk()` |
| `glsl-mask.js` | the digits' strokes, lights and raindrops, into the glass mask | |

Anything that a program needs that an OpenGL ES 2 GPU does not have goes through a helper in `../js/sky/portable.js` (packed tables, mip levels, ridge heights); the
shaders are written once, in GLSL ES 3, and translated to GLSL ES 1.00 when they are loaded. If a Pi Zero's driver ever again prints that it could not fit a shader into
its registers, the shader that was drawn when it happened is too big: split it the same way, or move work that is the same for every pixel out of it.

## Builds, releases and CI

* `cargo test` in `native/` runs the settings, panel-mapping and gamma tests. The program builds for the Pi Zero/1 (ARMv6, `arm-unknown-linux-gnueabihf`,
  which runs on every 32-bit Pi) and for 64-bit Pis (`aarch64-unknown-linux-gnu`) with the cross compilers `gcc-arm-linux-gnueabihf` and
  `gcc-aarch64-linux-gnu`; `scripts/cross-check.sh` builds both and starts each under QEMU. The GPU driver (Mesa) is loaded at run time, so no
  graphics libraries are needed to build.
* `scripts/make-deb.sh` makes a `.deb` per architecture (the program, the systemd unit, the man pages, the command line and the update script);
  `.github/workflows/native-release.yml` publishes them, with checksums and signatures, when a tag `native-vX.Y.Z` is pushed. The web page is
  deployed from `main` and is not affected by these tags.
* The update script (`wobbly-clock-update`, with a systemd timer) replaces the one program file: it checks the SHA-256 and the ed25519 signature,
  keeps the old program, swaps the new one in atomically and puts the old one back if the service does not start. `tests/unit/native-update-script.test.mjs`
  runs it for real. To turn signing on, run `scripts/make-signing-key.sh` once.
* `native.yml` runs only when `native/`, the page's drawing code or the schema change; the web CI is unchanged by native-only changes.
