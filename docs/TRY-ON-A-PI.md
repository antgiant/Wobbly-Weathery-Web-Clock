# Trying the native clock on a Raspberry Pi (Pi 3, Pi Zero; Pi 4 the same way)

The native clock is the web page's own code run by a small program, `wobbly-clock-run`, with no browser. This is how to try it and what to tell me.

**What to expect.** Every Pi draws on its GPU. The Pi 4 and 5 (OpenGL ES 3) draw the page's shaders as they are; the Pi 3, Zero 2 and the Zero (OpenGL ES 2) draw the same picture
with the shaders in their ES 2 form (the program prints `no OpenGL ES 3 on this GPU ...: using its OpenGL ES 2`). A quality governor keeps the clock between 15 and 60 frames per second
by lowering the picture's size and detail as far as it must. If a Pi falls back to the CPU (`GL: ... llvmpipe`), the GPU driver is not switched on: see the GPU test below.
The first start on an ES 2 Pi takes a while (the GPU's shader compiler works through the big sky shader); after that frames are quick. Step 3 measures it.

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

### The screen mode
A screen that gives no mode list (`/sys/class/drm/card0-HDMI-A-1/edid` is 0 bytes) shows nothing, or the wrong size, until a mode is forced on the kernel command line.
Add to the one line in `/boot/firmware/cmdline.txt` (or `/boot/cmdline.txt`): `video=HDMI-A-1:1280x720@60D` (the `D` forces the connector on). Use 1280x720 on a Pi Zero: at 1920x1080
every frame is 8 MB to draw and copy, the GPU holds about 120 MB of buffers, and the clock gives up more of its detail. Also in `config.txt`: `dtoverlay=vc4-kms-v3d` and `hdmi_force_hotplug=1`.

### Removing an old kiosk
If this Pi ran a browser or Stellarium kiosk first, take it out so nothing else holds the screen or the GPU: remove `startx` from `~/.bash_profile`, delete `~/.xinitrc`
and `~/.config/lxsession`, `crontab -e` (and `sudo crontab -e`) to delete the lines that start the old program, and `sudo apt purge` the browser, `xserver-xorg*`, `lightdm`, `stellarium`.
(The `stellarium_clock` repository's `setup.sh` does all of this for the Stellarium clock.)

### What the service does for you
- At boot it waits (up to 90 s) for the framebuffer and the GPU before starting; the first start compiles the big sky shader and takes 35 to 45 s on a Zero.
- `wobbly-clock-update.timer` fetches signed updates and rolls back one that does not start: `sudo systemctl enable --now wobbly-clock-update.timer`; try it first with `sudo WOBBLY_DRY_RUN=1 wobbly-clock-update`.
- `journalctl -u wobbly-clock | grep ladder` shows each time the capability ladder moves a rung; `journalctl -u wobbly-clock | grep health` shows the hourly line (uptime, memory, canvases, free GPU memory).
- The program restarts itself if its memory grows past 350 MB, or if the GPU runs out of memory; a Pi with a kernel older than mid 2023 has crashed after hours of running (a kernel oops in the video driver): `sudo apt update && sudo apt full-upgrade`,
  and `native/scripts/collect-crash-info.sh` writes a report to send if it happens again.

## 6. An LED panel (optional)
See `docs/LED-PANELS.md`: `wobbly-clock setup` asks about your panels and writes `matrix.cfg`; set `output = matrix`. The panel program `wobbly-matrix` has to be built
from `native/matrix-sink/` against hzeller's library (instructions in that folder); this part has not been run on hardware at all.

## What to send back
For each Pi: the model and OS (`cat /proc/device-tree/model; dpkg --print-architecture`), the `GL:` line, the seconds per frame from step 3, and anything that went wrong
(the exact message), and the `governor:` lines from step 3 (they say which quality level the Pi settles at).

## The GPU test (Pi Zero, 1, 3: the OpenGL ES 2 GPUs)
`wobbly-clock-run --gpu-test` probes the Pi's GPU on the OpenGL ES 2 path and prints what it can do: the driver, its limits and extensions, which render targets work
(8-bit, half float, float), how big a shader it will compile (loops of 8 to 512 steps, 4 to 128 texture reads), how fast it draws (milliseconds per pass at two sizes),
how precisely brightness survives being packed into 8 bits, whether every one of the engine's shaders (in their ES 2 form) compiles and links on this GPU, and whether
vertex shaders can read textures. It then checks that the ES 2 helper functions (packed sky tables, the hand-made bilinear read, the ridge heights, the noise mip levels) compute on this GPU what they should (against the same numbers worked out on the CPU), and runs the engine itself for two scenes, printing the picture's average colour at each step: that is how a black screen is traced to the stage that makes it. The engine part waits while the driver compiles the big sky shader: expect a few minutes. Run it with the output kept in a file:

```
wobbly-clock-run --gpu-test 2>&1 | tee ~/gputest.txt
```

If the output starts with `!!! THIS IS THE CPU RENDERER`, the GPU driver is not in use: add `dtoverlay=vc4-kms-v3d` to `/boot/config.txt` (or `/boot/firmware/config.txt`),
reboot, check `ls -l /dev/dri`, and try again (also with `sudo`). Send back `~/gputest.txt` whole.
