# Running the clock on an LED panel

From a box of parts to a lit panel. The panels are the common "hub75" matrix panels, driven through
[hzeller/rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix). The same layout file (`matrix.cfg`) works with
[rpi-fb-matrix](https://github.com/antgiant/rpi-fb-matrix), so panels you already wired keep working.

> **Status:** the setup, test patterns, layout checks and configuration described here are built (`native/cli/`, `wobbly-clock setup`,
> `wobbly-clock test`). The program that draws the sky onto the panel is **not built yet**; until it is, the web page on a Pi 4 plus
> `rpi-fb-matrix` (see TODO.md, "Ways to build it") is the way to put this clock on a panel.

## 1. What to buy

- **Panels:** hub75, any of 32 x 16, 32 x 32, 64 x 32, 64 x 64 (the label on the back says; all panels in one display must be the same height).
  Pitch (P2.5, P3, P4 ...) only changes how big the pixels are.
- **A way to connect them to the Pi:** an Adafruit RGB Matrix HAT or Bonnet (easiest, one chain), or the library's wiring directly to the
  GPIO (up to three parallel chains on a Pi 2 or later).
- **A power supply for the panels, separate from the Pi's.** Each 32 x 32 panel draws up to about 4 A at 5 V at full white; a 64 x 64
  display of four panels can pull 16 A. A clock is mostly dark, and the brightness limit below keeps the draw far lower, but size the
  supply for the worst case: **panels x 4 A, then add 20 %**.
- A Pi: a Zero 2 W, 3 or 4 is comfortable; the original Zero works for the panel but has one core, so the display shimmers if anything else uses the CPU.

## 2. Wiring

1. Power the panels from the supply, not from the Pi. Join the grounds.
2. Chain the panels: the output of one goes to the input of the next with the ribbon cable (arrows on the board show the direction).
3. Connect the first panel's input to the HAT/Bonnet, or to the GPIO as the library's wiring page shows.
4. Note **where the cable from the Pi goes in** and **how the panels are chained**. `wobbly-clock setup` asks exactly those two things.

## 3. Prepare the Pi (Raspberry Pi OS Lite is enough)

The library wants the Pi to itself. As it recommends:

- turn off the onboard sound (`dtparam=audio=off` in `/boot/firmware/config.txt`), which uses the same hardware as the fast output;
- reserve one core for the panel on a Pi with several (`isolcpus=3` added to `/boot/firmware/cmdline.txt`);
- on faster Pis (3 and later) set `led-slowdown-gpio` to 1 to 4 so the panel gets clean signals (the symptom of too low is noise or flicker).

## 4. Describe the panels

```
wobbly-clock setup
```

Asks, in plain questions: HDMI or LED panel; the size of one panel; how many across and down; which corner the cable goes into; how
they are wired from there (one row, one column, snake across, snake down, every row from the same side); parallel chains if the Pi
allows. It then **draws the layout back** with each panel's chain position, rotation and an arrow along the chain, with the totals
("64 x 64 pixels, 4 panels of 32 x 32, one chain of 4"), and asks "does this match what you built?" before saving. It writes
`/etc/wobbly-clock/matrix.cfg` (the same format as `rpi-fb-matrix`'s file) and the clock settings.

Already have a `matrix.cfg`? `wobbly-clock import-matrix-cfg matrix.cfg` reads it, checks it and uses it. `wobbly-clock export-matrix-cfg` writes it back.

The checks (each says what is wrong and the likely fix): total width a multiple of the panel width; total height a multiple of the
panel height; the grid matches the display; the HAT allows one chain; the Zero has the pins for one chain; at most three parallel chains;
every chain numbered 0, 1, 2 ... with no gaps; `chain_length` is the longest chain; rotations are quarter turns.

## 5. Test it before running the clock

```
wobbly-clock test
```

Four patterns, a few seconds each (Ctrl-C ends it). What each should look like and what a wrong result means:

| Pattern | Right | Wrong |
|---|---|---|
| Colour bars and grey ramp | white, yellow, cyan, green, magenta, red, blue, black, then a smooth grey ramp | wrong colours: set `led-rgb-sequence` (try `RBG`, `BGR`); steps in the ramp: more `led-pwm-bits` |
| Identify the panels | each panel shows its chain position upright, in its own colour, with a white square in its top-left corner | upside down or sideways: that panel's `rotate` is wrong; numbers out of order: the wiring answer is wrong; a panel missing: check the ribbon cable into it |
| Brightness sweep | black rising smoothly to white | flicker or the picture collapsing at white: the power supply is too small or the cable too long |
| Border box | a one-pixel line round the whole display | a missing side: the size in `matrix.cfg` is wrong |

Other symptoms and the library's options that fix them (`led-*` in the config, or on the library's command line):

- **Flicker or ghosting:** `led-slowdown-gpio`, `led-pwm-lsb-nanoseconds`, and the sound/core steps in section 3.
- **Half the panel dark, repeated or interleaved rows:** `led-multiplexing` (0 to 17) or `led-row-addr-type` (0 to 5).
- **Panel stays dark or shows noise at start:** some panels need `led-panel-type=FM6126A` (or `FM6127`).
- **Too bright at night, or hot:** use the brightness settings below.

## 6. Brightness, day and night

The panel's brightness follows the sun, as on the web page: `brightnessDay` and `brightnessNight` (0.1 to 1), changing over
`brightnessTransition` minutes centred on sunset and sunrise.

```
wobbly-clock set brightnessNight 0.2
wobbly-clock set brightnessTransition 60
```

A bedroom clock at 20 % at night is also far easier on the power supply. LED panels are non-linear; the output applies a gamma curve so
the brightness setting looks even.

## 7. Run it on boot, with no keyboard or screen

```
sudo wobbly-clock install-service
sudo systemctl enable --now wobbly-clock
```

Or put a `wobbly-clock.conf` on the boot partition (the card's small FAT part, `/boot/firmware/`): it is read once at boot and renamed
`wobbly-clock.conf.applied`. A share link works too: `wobbly-clock apply 'https://clock.wooleys.us/?c=...'`. With no configuration at
all, the first boot shows the words SETUP NEEDED on the panel instead of nothing.

`wobbly-clock status`, `logs` and `restart` look after the service. `man wobbly-clock` and `man wobbly-clock.conf` list every command and setting.

## 8. Where to ask

Open an issue on the repository with the output of `wobbly-clock status`, your `matrix.cfg` and a photo of the identify pattern.
