# Wobbly-Weathery-Web-Clock

A wobbly morphing clock in front of a **physically based, real-time sky**: correct sunrises and
sunsets, twilight, stars, the Milky Way, the moon with its real phase, planets, real weather
and a landscape. Static files only, so it hosts on GitHub Pages as is. It is built to run
on a phone, and has a **VR look-around mode** where you move the phone to look around the sky.

With thanks to
[Bézier Clock](http://jackf.net/bezier-clock/) in [VanillaJS](http://vanilla-js.com) with some [easing options](http://www.robertpenner.com/easing/)

## What you get

| | |
|---|---|
| **Atmosphere** | Rayleigh + Mie + ozone scattering with multiple scattering and the planet's shadow, so the orange glow, the rising Earth shadow, the purple afterglow and dusk all come from physics, not from shifting the time. |
| **Night** | 25 k stars (to magnitude 7.5) with colour, atmospheric extinction and a limiting-magnitude model, so stars fade in brightest first as the sky darkens; Milky Way; airglow; light pollution (Bortle scale, estimated from your time zone or set by hand); moonlight scattering. |
| **Sun, moon, planets** | [astronomy-engine](https://github.com/cosinekitty/astronomy) positions for your location and time. Moon texture, phase, libration and earthshine. Sun and moon are drawn a little enlarged by default (a real 0.5° disc is tiny on a phone); there is a "Realistic" setting. |
| **Weather** | Live from [Open-Meteo](https://open-meteo.com/): per-layer cloud cover, rain/snow, fog and visibility, wind (clouds drift at the real speed), aerosols (haze and smoke whiten the sky). Clouds are lit by the actual sunset colour. Or pick a preset (clear, partly, overcast, rain, storm, snow, fog, smoky haze). |
| **Landscape** | "Real terrain around my location" samples a public elevation model in 32 directions out to 40 km and builds your actual skyline, so the sun really does set behind the hills to your west. Or choose flat, hills, mountains, desert, ocean (with sun glitter) or a city with lit windows. |
| **Ocean waves** | Two wave trains (wind sea and swell), each five components from the peak wavelength down to chop, with real deep-water dispersion. Height, period and direction come from Open-Meteo's marine forecast where it covers your spot (a live status line shows e.g. "2.6 m waves every 10 s"), otherwise the sea grows from the live wind speed. The glitter path widens as the sea roughens, whitecaps and wind-blown foam streaks appear from about a fresh breeze, rain dimples the surface with rings, and far swell lifts and drops the horizon. Calm weather gives glass. |
| **Plants & ground** | Grass, wildflowers, shrubs, broadleaf and conifer trees, palms, cacti, acacia and rocks, chosen to suit the place. One satellite tile around your location (Sentinel-2) is classified into forest / grassland / steppe / desert / tundra / urban / snow / water, then region rules pick species (cacti only in the Americas, acacia in Africa and Australia, palms in the tropics) and the date picks the season (spring green, autumn orange, bare winter). Wind sways them at the real wind speed, rain darkens and bows them, wets the ground with puddle sheen and ripples, and snow settles on them. Falls back to latitude rules offline; Settings → Weather & landscape turns it off. |
| **Settings** | A side drawer on wide screens (the sky stays visible beside it) and a bottom sheet on phones with the tabs along the thumb edge. Five tabs (Clock, Scene, View, Display, Place & time). A **Simple / Advanced** switch at the top: Simple shows the common settings; Advanced adds the rest, drawn in amber with an "Advanced" tag so it is obvious which is which. While you drag a slider on a phone the sheet fades so you can see the effect. Dark glass by default, light when the device asks for it. |
| **VR look-around** | Tap the goggles button on a phone/tablet: the sky follows the device's orientation sensors. Drag to fine-tune the compass direction, pinch to zoom. "Look around" mode (drag and pinch, no sensors) works on desktop. Optional labels for the sun, moon and planets with arrows to find them. |
| **Framing** | By default the camera tilts so the horizon sits exactly on the bottom of the clock digits, on any screen size, so the ground always shows beneath them. Untick it in Settings → View to set the tilt yourself. |
| **Keep screen on** | Settings → Display uses the Screen Wake Lock API so the phone doesn't dim or lock while the page is open (bedside / travel clock). It is released when the page is hidden and re-acquired when it returns. iOS only allows it after a touch, so a "Tap to keep the screen on" banner appears until you tap. Two mechanisms run: the Wake Lock API and a hidden silent video (a real 256x144 clip behind the sky; Chrome ignores tiny ones). On iPhones both run together because Safari can grant a lock and still sleep. Settings shows which is active. |
| **Time travel** | Settings → Time travel: jump to any date/time or run at up to 1 hour per second. |
| **Clock** | The same wobbly morphing digits, in three styles: **Liquid glass** (default: bevelled glass that refracts the real sky behind it, catches the actual sun or moon as glints and a bright rim, and casts a soft shadow), **Stained glass** (jewel-coloured leaded panes lit by the sky behind them) and the classic **solid ink**, which flips between light and dark so it stays readable. A **Frosting** slider takes the glass from perfectly clear to fully etched, and **Light from inside** makes the glass glow (a lamp in the thick middle of each stroke, a halo on the sky, in warm / white / cool or the colour of the sun or moon). **Stained glass** is the same liquid glass with colour in it: each pane tints what you see through it and glows in its own jewel tone, split by thin lead lines. |
| **Sunrise & sunset countdown** | Settings → Display. Starting 10 to 30 minutes (20 by default) before the sun reaches the horizon, a pill counts down to it ("Sunset in 04:09"), then says "Sunset" for a minute. Sunrise, sunset or both. Times are the almanac ones (upper limb, standard refraction) so real hills hide the sun slightly earlier. Follows time travel. |
| **Follow the sun** | Settings → View (clock view only). Only the compass direction moves, never the tilt, so the sun stays at one height while it crosses the screen from the right quarter at sunrise to the left quarter at sunset, in either hemisphere, like east to west on a map. The position comes from the sun's real azimuth, so the seasons show: in June the sun rises further round to the north and starts nearer the right edge, in December nearer the middle. Overnight the view turns back, slowly, to the next sunrise. |
| **LED panel** | Settings → Display. The whole picture becomes a 64 × 32 LED matrix: square pixels with black lines between them, the clock as lit pixels. It turns itself to 32 × 64 when the screen is upright, and the digits stack two to a row. The panel is letter-boxed so the pixels stay square. |

## Why it is fast

The previous version ran a nested raymarch (about 2000 exponentials) for every pixel on every
frame, and ignored the planet's shadow and the sun's azimuth, which is why sunsets failed and
had to be faked by shifting the time. It now follows
[Hillaire 2020](https://sebh.github.io/publications/egsr2020.pdf):

1. **Look-up tables** for transmittance, multiple scattering and the sky dome are computed on the
   GPU only when the sun or moon has actually moved (about every 10 s at sunset).
2. A **frame** is then one texture lookup per pixel for the sky, plus the sun, moon, stars, clouds
   and terrain.
3. **Throttled drawing**: a still sky redraws about once a second, an animated one (moving clouds,
   water) about 15 fps (8 on Low quality), and look-around modes run at the display rate. Hidden
   tabs do no work, and `prefers-reduced-motion` stops the animation.
4. **Dynamic resolution** ("Automatic" quality) lowers the render scale if frames run long.
5. The clock no longer re-measures the layout on every animation frame (a `MutationObserver` on the
   digits' `d` attribute was doing exactly that).

Measured in a headless browser on a CPU rasterizer (same machine, same 1280×720 canvas; a phone
GPU is orders of magnitude faster, so read the ratio, not the milliseconds): the old shader took
about **9,950 ms per frame**, the new sky **about 500 ms at full resolution and 290 ms at 0.75
scale** with clouds, terrain and stars, and the old shader had to do that every frame.

## Running it

No build step. Serve the folder with any static server (ES modules and `fetch` need http, not
`file://`):

    python3 -m http.server 8000

Everything is static; deploy by pushing to GitHub Pages.

Requirements: WebGL2 with floating-point render targets (all current phones and desktops). Without
it you get a plain sky-coloured gradient and a note in Settings.

### If VR look-around is off on an iPhone or iPad

iOS reports the compass differently from Android, and what it does once the device is held upright in landscape is not
documented. The code estimates the compass offset from the raw sensor angles (it used to feed its own correction back in,
which made the view spin), tracks both plausible readings of the heading and uses portrait / landscape to pick when
turning alone cannot tell them apart. If the sky is still 90° out, Settings → View → Advanced → Motion sensor fixes lets
you choose the compass reference or ignore the screen rotation, and "Show sensor readout" prints the raw numbers.

### Developer deep links

These are not saved to your settings:

    ?t=2026-06-21T20:30:00Z          pin the date/time (UTC)
    &speed=60                        ...and run at 60x
    &lat=40.7&lon=-74                location
    &az=280&pitch=10                 view direction
    &weather=storm                   clear|partly|cloudy|overcast|rain|storm|snow|fog|haze|live
    &landscape=ocean                 auto|flat|hills|mountains|desert|ocean|city
    &lp=1                            light pollution: off, or Bortle 1-9
    &waves=2.5x9                     force the sea state: wave height m x period s (ocean landscape)
    &biome=conifer                   force land cover: grass|forest|conifer|tropical|steppe|desert|tundra|urban|snow

`window.__sky` exposes the engine in the console.

## Layout

    index.html, styles.css            page, settings, VR button
    js/clock.js, easing.js            the wobbly clock (unchanged look)
    js/sky/engine.js                  GL pipeline, scheduler, adaptive resolution
    js/sky/glsl-atmosphere.js         transmittance / multiple scattering / sky-view LUTs
    js/sky/glsl-scene.js              composite, stars, clouds, terrain, tone mapping, glass / stained glass
    js/sky/astro.js                   sun / moon / planets / sky rotation (astronomy-engine)
    js/sky/weather.js                 Open-Meteo + presets
    js/sky/landscape.js               procedural skylines + real-terrain skyline
    js/sky/biome.js, plants.js        land cover from a satellite tile, season, palette; plant placement
    js/sky/glsl-plants.js             instanced plant sprites with wind
    js/sky/glass.js                   rasterises the digits for the glass styles; light direction from sun/moon
    js/sky/controls.js                drag / pinch / VR sensors
    js/sky/orientation.js             device orientation maths and the iOS compass calibration (testable in node)
    js/sky/sunpath.js                 sunrise / sunset times, the countdown, the follow-the-sun camera
    js/sky/app.js                     settings, live data, HUD, clock colour
    data/                             star catalogue, Milky Way, moon map (built by tools/build-data.py)
    tools/                            data builder; tests: node tools/test-orientation.mjs, node tools/test-sunpath.mjs

## What is and is not verified

Built and checked in a headless Chromium (software GL): the atmosphere through a full sunset and
night, stars, Milky Way, moon phases, every landscape and weather preset, desktop and phone-sized
layouts, the no-WebGL fallback, time-lapse, drag / zoom, and the VR sensor code path using
synthetic orientation events (plus a unit test of the orientation math against known phone poses).

**Not verified:** behaviour on real phones and tablets (the iPad VR fix described above was reasoned out and unit-tested, not tried on an iPad) (frame rate, motion-sensor feel, iOS compass
calibration, which uses `webkitCompassHeading`), and the live Open-Meteo calls (the build sandbox could not
reach the service; the code was exercised against mocked responses in Open-Meteo's documented
format). If a live call fails, the page quietly keeps clear-sky defaults.

Known limits: the sea is shaded, not modelled geometry, so waves never hide the horizon or tilt the view; marine data covers open water only; plants are procedural sprites (they do not parallax if you move, only if you turn), species choice is a heuristic from one satellite tile plus geography rather than a botanical survey, one cloud layer set per altitude (no volumetric clouds), no lightning, the
sun and moon are slightly enlarged by default, planets Uranus/Neptune and satellites are not drawn,
real-terrain mode samples 3 distances so very distant mountains beyond 40 km are not included.

## Privacy

Live weather and terrain send your (time-zone estimated or GPS) coordinates to Open-Meteo. Results
are cached in your browser. Choose a manual weather/landscape preset to make no requests.

## Credits

- Atmosphere model: Sébastien Hillaire, *A Scalable and Production Ready Sky and Atmosphere
  Rendering Technique* (EGSR 2020), building on Bruneton & Neyret. Coefficients as published.
  The sky code this project started from was [Horizon](https://github.com/dnlzro/horizon) by
  Daniel Lazaro (MIT, `js/sky/LICENSE-horizon.txt`), itself derived from Andrew Helmer's
  "Production Sky Rendering" (MIT); the medium coefficients and phase functions still follow them.
- [astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT), vendored in `js/vendor`.
- Star catalogue and Milky Way outlines via [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD-3, see `data/LICENSE-d3-celestial.txt`).
- Moon map: NASA Scientific Visualization Studio, *CGI Moon Kit* (LRO). Please check NASA's media usage guidelines for your use.
- Land-cover tiles: [Sentinel-2 cloudless](https://s2maps.eu) by EOX IT Services GmbH (contains modified Copernicus Sentinel data), CC BY-NC-SA 4.0, so personal / non-commercial use; check the terms before anything else.
- Weather, aerosol and elevation data: [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0 data; their free API is for non-commercial use, check their terms).
- Time-zone locations and light pollution estimates: [Virgo](https://github.com/mcteamster/virgo).
- [Stellarium Web Engine](https://github.com/Stellarium/stellarium-web-engine) was evaluated and not used as the renderer: it is AGPL-3.0, needs an Emscripten toolchain and streams its star data from remote servers.
- [Hacker News](https://news.ycombinator.com/item?id=44846281) for a great collection of related resources.
