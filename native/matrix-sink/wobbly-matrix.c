/* wobbly-matrix: the LED panel end of wobbly-clock-run. It drives the panels through hzeller/rpi-rgb-led-matrix's C API and reads frames from
 * standard input, so the renderer (Rust, no C dependencies) never links the library and runs without it everywhere else.
 *
 *   wobbly-matrix [--led-* options of the library]      each frame on stdin:  "W H BRIGHTNESS\n" then W*H*3 bytes of RGB
 *
 * The frame is the canvas already arranged for the chain (wobbly-clock-run does the panel layout), gamma-corrected; BRIGHTNESS is 1..100 and goes to
 * the panel's own PWM. W and H must be the library's canvas size, or the frame is refused. Build: see native/matrix-sink/README.md.
 * It needs root on a Pi (the library opens the GPIO) and drops privileges after that, as the library does by default. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "led-matrix-c.h"

static int read_exact(unsigned char *buf, size_t n) {
  size_t got = 0;
  while (got < n) {
    size_t r = fread(buf + got, 1, n - got, stdin);
    if (r == 0) return 0;
    got += r;
  }
  return 1;
}

int main(int argc, char **argv) {
  struct RGBLedMatrixOptions options;
  memset(&options, 0, sizeof(options));
  struct RGBLedMatrix *matrix = led_matrix_create_from_options(&options, &argc, &argv);   /* parses the --led-* flags */
  if (matrix == NULL) { fprintf(stderr, "wobbly-matrix: could not start the panel (are you root? is the layout right?)\n"); return 2; }
  struct LedCanvas *canvas = led_matrix_create_offscreen_canvas(matrix);
  int cw = 0, ch = 0;
  led_canvas_get_size(canvas, &cw, &ch);
  fprintf(stderr, "wobbly-matrix: canvas %d x %d\n", cw, ch);
  unsigned char *rgb = malloc((size_t)cw * ch * 3);
  if (rgb == NULL) { led_matrix_delete(matrix); return 2; }
  int status = 0;
  for (;;) {
    int w, h, b;
    if (scanf("%d %d %d%*c", &w, &h, &b) != 3) break;               /* the end of the stream: the clock stopped */
    if (w != cw || h != ch) { fprintf(stderr, "wobbly-matrix: frame is %d x %d, the panels are %d x %d\n", w, h, cw, ch); status = 3; break; }
    if (!read_exact(rgb, (size_t)cw * ch * 3)) break;
    if (b < 1) b = 1;
    if (b > 100) b = 100;
    led_matrix_set_brightness(matrix, (uint8_t)b);
    for (int y = 0; y < ch; y++)
      for (int x = 0; x < cw; x++) {
        const unsigned char *p = rgb + ((size_t)y * cw + x) * 3;
        led_canvas_set_pixel(canvas, x, y, p[0], p[1], p[2]);
      }
    canvas = led_matrix_swap_on_vsync(matrix, canvas);
  }
  free(rgb);
  led_matrix_delete(matrix);                                          /* the panel goes dark */
  return status;
}
