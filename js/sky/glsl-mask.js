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
