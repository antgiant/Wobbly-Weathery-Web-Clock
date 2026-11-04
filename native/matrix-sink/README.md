# wobbly-matrix: the LED panel end

`wobbly-clock-run` does everything but talk to the panel: it renders the picture, arranges it for the chain (`matrix.cfg`), applies gamma, and
streams frames to this small C program, which drives the panels through [hzeller/rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix).
Keeping the library on the other side of a pipe means the renderer has no C dependency and the same binary runs on a Pi with no library at all
(HDMI) and on one with it.

Build (on the Pi, or any machine for a compile check):

```
git clone --depth 1 https://github.com/hzeller/rpi-rgb-led-matrix
make -C rpi-rgb-led-matrix/lib
cc -O2 -o wobbly-matrix native/matrix-sink/wobbly-matrix.c -I rpi-rgb-led-matrix/include -L rpi-rgb-led-matrix/lib -lrgbmatrix -lstdc++ -lm -lpthread
```

CI does exactly this on every change to this folder (a compile and link check against the real header and library; it cannot light a panel).

Protocol, per frame on standard input: `W H BRIGHTNESS\n`, then `W*H*3` bytes of RGB. `W x H` must be the library's canvas size
(`chain_length * panel_width` by `parallel * panel_height`); `BRIGHTNESS` is 1 to 100 and goes to the panel's PWM. The options the program takes are the
library's own `--led-*` flags, which `wobbly-clock-run` builds from the configuration.
