# To do

Things we know we want, not yet done. Newest first.

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
