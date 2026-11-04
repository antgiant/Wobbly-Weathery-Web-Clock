// When a screen nobody can touch (a kiosk link) reloads itself to pick up a new version: in the quiet hour, 3 o'clock at night by its own clock,
// not the moment the update is found. Pure, so it is tested without a page.
export const QUIET_HOUR = 3;

/** Milliseconds from `nowMs` until the reload: inside the quiet hour, the next minute turn; otherwise the start of the next quiet hour. */
export function msUntilQuiet(nowMs = Date.now(), hour = QUIET_HOUR) {
  const d = new Date(nowMs);
  if (d.getHours() === hour) return 61000 - (nowMs % 60000);
  const next = new Date(nowMs);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
  return next.getTime() - nowMs + 1000;
}
