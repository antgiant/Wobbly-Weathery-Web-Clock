// A rough translator from the engine's GLSL ES 3.00 to GLSL ES 1.00 (OpenGL ES 2: the Raspberry Pi Zero, 1, 2 (v1.1 is ES 3), 3 GPUs), for the GPU test: it makes
// the mechanical changes and reports what it cannot change, so the work of a real port can be counted. Not a compiler.
export function translate(src, stage = 'fragment', { lodFallback = false } = {}) {
  const notes = {};
  const count = (re, name) => { const m = src.match(re); if (m) notes[name] = m.length; };
  count(/\buint\b|\buvec\d\b/g, 'unsigned integers (uint)');
  count(/\bivec\d\b/g, 'integer vectors (ivec)');
  count(/\btexelFetch\s*\(/g, 'texelFetch');
  count(/\btextureSize\s*\(/g, 'textureSize');
  count(/\bflat\b/g, 'flat');
  count(/\bswitch\b/g, 'switch');
  count(/[A-Za-z0-9_)\]]\s%\s[A-Za-z0-9_(]/g, 'modulo (%) on integers');
  count(/>>|<<|\^|\|(?!\|)|&(?!&)/g, 'bit operations');
  count(/\b(?:float|vec[234]|int)\s+\w+\s*\[[^\]]*\]\s*=/g, 'array initialisers');
  count(/\bgl_VertexID\b|\bgl_InstanceID\b/g, 'gl_VertexID / gl_InstanceID');
  count(/\btextureLod\s*\(/g, 'textureLod (needs EXT_shader_texture_lod)');
  count(/\bdFd[xy]\s*\(|\bfwidth\s*\(/g, 'derivatives (need OES_standard_derivatives)');
  let o = src.replace(/^#version 300 es\s*/m, '');
  o = o.replace(/\blayout\s*\([^)]*\)\s*/g, '');
  if (stage === 'fragment') {
    o = o.replace(/\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;/, (m, n) => `#define ${n} gl_FragColor\n`);
    o = o.replace(/^\s*(?:flat\s+)?in\s+((?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|mat[234]))\s+([\w\s,]+);/gm, 'varying $1 $2;');
  } else {
    o = o.replace(/\bin\s+((?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|mat[234]))\s+(\w+)\s*;/g, 'attribute $1 $2;');
    o = o.replace(/\bout\s+((?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|mat[234]))\s+(\w+)\s*;/g, 'varying $1 $2;');
  }
  o = o.replace(/\btextureLod\s*\(/g, 'texture2DLodEXT(').replace(/\btexture\s*\(/g, 'texture2D(');
  o = o.replace(/precision\s+(?:highp|mediump|lowp)\s+(?:int|sampler\w+)\s*;/g, '');
  const lod = lodFallback ? 'vec4 texture2DLodEXT(sampler2D s, vec2 uv, float l){ return texture2D(s, uv); }\n' : '';     // size probe only: when the driver has no EXT_shader_texture_lod the detail level is ignored
  o = '#extension GL_EXT_shader_texture_lod : enable\n#extension GL_OES_standard_derivatives : enable\n' + o.replace(/^(\s*precision\s+highp\s+float\s*;)/m, '$1\n' + lod);
  return { src: o, notes };
}
