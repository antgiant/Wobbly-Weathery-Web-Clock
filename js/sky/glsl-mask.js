// The glass mask drawn by the GPU instead of a 2D canvas.
//
// The digits' strokes are polylines (the curves, flattened by glass.js) drawn 80 path units wide with round ends and round joins. A round-ended
// stroke is the union of "capsules": one per segment, every pixel within r of the segment. So each segment is a quad, and the fragment shader
// measures its distance to the segment: coverage = how much of the pixel lies inside r. The union is the MAX of the coverages (blend equation MAX),
// which is exactly what a round-capped, round-joined stroke is. Plain triangles, no instancing, no derivatives: the same shaders work on OpenGL ES 2.
//
// The coloured-tube style paints lights into the strokes afterwards: a radial gradient per light, only where the tube is (source-atop).
//
// Coordinates are mask pixels, y down from the top row, which is the first row of the texture (as a canvas upload puts it).

export const VERT_STROKE = `#version 300 es
in vec2 aPos;            // corner of the segment's quad, in mask pixels
in vec4 aSeg;            // the segment: ax, ay, bx, by
in float aR;             // half the stroke's width, in pixels
uniform vec2 uSize;      // the mask's size
out vec2 vP; out vec4 vSeg; out float vR;
void main() {
  vP = aPos; vSeg = aSeg; vR = aR;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, aPos.y / uSize.y * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAG_STROKE = `#version 300 es
precision highp float;
in vec2 vP; in vec4 vSeg; in float vR;
uniform vec3 uCol;       // white for the glass styles, black for the tube (the lights are painted on it afterwards)
out vec4 oColor;
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  oColor = vec4(uCol, clamp(vR + 0.5 - d, 0.0, 1.0));
}`;

export const VERT_LIGHT = `#version 300 es
in vec2 aPos;            // corner of the light's quad, in mask pixels
in vec3 aLight;          // centre x, centre y, radius
in vec3 aCol;            // the light's colour, 0..1
uniform vec2 uSize;
out vec2 vP; out vec3 vLight; out vec3 vCol;
void main() {
  vP = aPos; vLight = aLight; vCol = aCol;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, aPos.y / uSize.y * 2.0 - 1.0, 0.0, 1.0);
}`;

// The gradient of glass.js's canvas version: white-hot at the centre, the colour at 22% of the radius (alpha 0.95), fading to nothing at the edge.
export const FRAG_LIGHT = `#version 300 es
precision highp float;
in vec2 vP; in vec3 vLight; in vec3 vCol;
out vec4 oColor;
void main() {
  float t = length(vP - vLight.xy) / vLight.z;
  if (t >= 1.0) discard;
  vec3 hot = vCol + (1.0 - vCol) * 0.45;
  vec3 rgb = t < 0.22 ? mix(hot, vCol, t / 0.22) : vCol;
  float a = t < 0.22 ? mix(1.0, 0.95, t / 0.22) : 0.95 * (1.0 - (t - 0.22) / 0.78);
  oColor = vec4(rgb * a, a);      // premultiplied: the blend below adds it over what is there, only where the tube's alpha is
}`;

// ---- raindrops (drawn into the picture the glass shader reads: red = a drop's dark rim, green = its glint, blue = water, all added together) ----
// The same look as drops.js's canvas drawing: a disc of water, a dark ring around it, a glint towards the light, and a thin wet trail behind a running drop.
export const VERT_DROP = `#version 300 es
in vec2 aPos;            // corner of the drop's quad, in mask pixels
in vec4 aD;              // x, y, radius, fade (1 = whole, falling away to 0)
in vec2 aL;              // the direction towards the light on screen (y up)
uniform vec2 uSize;
out vec2 vP; out vec4 vD; out vec2 vL;
void main() {
  vP = aPos; vD = aD; vL = aL;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, aPos.y / uSize.y * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAG_DROP = `#version 300 es
precision highp float;
in vec2 vP; in vec4 vD; in vec2 vL;
out vec4 oColor;
void main() {
  float r = vD.z, f = vD.w, dist = length(vP - vD.xy);
  float ice = f > 1.5 ? 1.0 : 0.0;                                     // a frozen drop (freezing rain) is sent with fade 2: whole, but ice
  if (ice > 0.5) f = 1.0;
  float water = clamp(r + 0.5 - dist, 0.0, 1.0) * f * (1.0 - 0.35 * ice);       // less like water that bends the picture behind it, more like a white bead
  float t = clamp((dist - 0.55 * r) / (0.53 * r), 0.0, 1.0);         // the ring: a gradient from 0.55 r to 1.08 r, peaking at 3/4 of the way
  float rim;
  if (t < 0.75) { float u = t / 0.75; rim = 0.9 * f * u * u; } else { float u = (t - 0.75) / 0.25; rim = 0.9 * f * (1.0 - u) * (1.0 - u); }
  if (dist > 1.1 * r) rim = 0.0;
  vec2 g = vD.xy + vec2(vL.x, -vL.y) * r * 0.42;                      // the glint sits towards the light (y is down on the mask)
  float tg = length(vP - g) / (0.5 * r);
  float glint = tg < 1.0 ? f * (1.0 - tg) * (1.0 - tg) : 0.0;
  if (ice > 0.5) {                                                     // ice: a harder edge, a stronger glint, and facets that catch the light
    float ang = atan(vP.y - vD.y, vP.x - vD.x);
    float facet = smoothstep(0.55, 0.95, abs(sin(ang * 2.5 + r * 1.7))) * smoothstep(1.0 * r, 0.25 * r, dist) * 0.55;
    rim = min(1.0, rim * 1.15); glint = min(1.0, glint * 1.8 + facet);
  }
  oColor = vec4(rim, glint, water, 0.0);
}`;

export const VERT_TRAIL = `#version 300 es
in vec2 aPos;
in vec4 aSeg;            // ax, ay, bx, by
in vec2 aW;              // half width, brightness
uniform vec2 uSize;
out vec2 vP; out vec4 vSeg; out vec2 vW;
void main() {
  vP = aPos; vSeg = aSeg; vW = aW;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, aPos.y / uSize.y * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAG_TRAIL = `#version 300 es
precision highp float;
in vec2 vP; in vec4 vSeg; in vec2 vW;
out vec4 oColor;
void main() {
  vec2 a = vSeg.xy, ba = vSeg.zw - a, pa = vP - a;
  float len = max(length(ba), 1e-4), s = dot(pa, ba) / len, d = abs(pa.x * ba.y - pa.y * ba.x) / len;
  float cov = clamp(vW.x + 0.5 - d, 0.0, 1.0) * clamp(s + 0.5, 0.0, 1.0) * clamp(len - s + 0.5, 0.0, 1.0);     // flat ends, as a canvas line has
  oColor = vec4(0.0, 0.0, vW.y * cov, 0.0);
}`;
