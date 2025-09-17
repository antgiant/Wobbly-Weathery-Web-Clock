function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function dot(v1, v2) {
  return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
}

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function norm(v) {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function add(v1, v2) {
  return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function exp(v) {
  return [Math.exp(v[0]), Math.exp(v[1]), Math.exp(v[2])];
}

export { clamp, dot, len, norm, add, scale, exp };