# Trying the native clock on a Raspberry Pi (Pi 3, Pi Zero; Pi 4 the same way)

The native clock is the web page's own code run by a small program, `wobbly-clock-run`, with no browser. This is how to try it and what to tell me.

**Measured: the original Pi Zero is too slow.** Three 320x180 frames took 28 minutes on a Pi Zero (one 700 MHz ARMv6 core, drawing in software), so the Zero and Zero W / Pi 1 are not supported by this approach. Test on a Pi 3 (or Zero 2 W, Pi 4, 5).

**What to expect.** Pi 4 and 5 draw on the GPU. Pi 3, Zero 2 and Zero have a GPU too old for the page's shaders (they need OpenGL ES 3), so the program
says `no OpenGL ES 3 on this GPU ... drawing on the CPU instead` and draws in software: the same picture, slower. The Pi 3 should manage a frame every few
seconds at a small size; the original Zero (ARMv6, one slow core) may need a minute per frame, which is why step 3 measures before you put it on a screen.
Nothing here has run on a real Pi yet; the timing is the main thing to learn.

## 1. Get the package
On GitHub open the **Actions** tab, the newest green **Native** run on branch `claude/wobbly-clock-sky-simulator-njbc4r` (or `main`), and download the
artifact **wobbly-clock-debs** (a zip with two files). Which one:

| Your Pi and its OS | File |
|---|---|
| Pi Zero, Zero W, Pi 1, or any Pi running **32-bit** Raspberry Pi OS (check: `dpkg --print-architecture` says `armhf`) | `wobbly-clock_*_armhf.deb` |
| Pi 3, Zero 2 W, 4, 5 running **64-bit** Raspberry Pi OS (`arm64`) | `wobbly-clock_*_arm64.deb` |

Use Raspberry Pi OS **Lite**; no desktop is needed. Copy the file over: `scp wobbly-clock_*_armhf.deb pi@raspberrypi.local:`

## 2. Install
```
sudo apt update
sudo apt install ./wobbly-clock_*.deb        # also installs Mesa (the GPU/CPU drawing library) and curl
```

## 3. Measure first, with no screen involved
Make a settings file (your place and zone; `weatherMode = clear` avoids the network while testing):
```
cat > ~/test.conf <<'CONF'
location_latitude = 40.7
location_longitude = -74
timeZone = America/New_York
weatherMode = clear
plants = off
CONF
```
Draw three small pictures and time them:
```
time wobbly-clock-run --config ~/test.conf --sink ppm:$HOME/frames --size 320x180 --frames 3
```
It prints what it is drawing with (`GL: ...`; `llvmpipe` means the CPU). Copy `~/frames/frame-0002.ppm` to your computer and open it (any image viewer
that reads PPM, or `convert frame-0002.ppm frame.png`). **Tell me:** the `real` time, the `GL:` line, the Pi model, and whether the picture looks right.
If it takes more than ~30 seconds per frame, stop here and tell me; that Pi needs a different approach.

## 4. Put it on the HDMI screen
Run on the Pi's own console (not over ssh while a desktop runs). From Raspberry Pi OS Lite, log in at the keyboard and:
```
sudo wobbly-clock-run --config ~/test.conf --sink fb:/dev/fb0
```
It draws at the screen's own resolution; on a Pi 3 or Zero on a 1080p screen that may be slow, so try a smaller mode (`hdmi_group=1 hdmi_mode=4`, 720p,
in `/boot/firmware/config.txt`) if frames are late. Stop it with Ctrl-C.

## 5. Make it a service (optional)
```
sudo nano /etc/wobbly-clock/wobbly-clock.conf     # your place, zone ... (names are the web page's setting names)
sudo systemctl enable --now wobbly-clock
journalctl -u wobbly-clock -f                      # what it says
```

## 6. An LED panel (optional)
See `docs/LED-PANELS.md`: `wobbly-clock setup` asks about your panels and writes `matrix.cfg`; set `output = matrix`. The panel program `wobbly-matrix` has to be built
from `native/matrix-sink/` against hzeller's library (instructions in that folder); this part has not been run on hardware at all.

## What to send back
For each Pi: the model and OS (`cat /proc/device-tree/model; dpkg --print-architecture`), the `GL:` line, the seconds per frame from step 3, and anything that went wrong
(the exact message). That tells me whether the CPU path is good enough or the GPU (OpenGL ES 2) version of the shaders is worth writing.
