// ============================================================
// YARG RECTANGULAR NOTES
// The standard (non-circular) note style: the note models, textures and
// materials of YARG's rectangular theme, drawn with a three.js port of YARG's
// note shaders.
//
// Derived from YARG (https://github.com/YARC-Official/YARG), Copyright (C) the
// YARG contributors, licensed under the GNU Lesser General Public License
// v3.0 or later. This file and js/yargnotes-data.js are a modified form of
// that work and are distributed under the same license. Their readable source,
// the original YARG files they were made from, and the license text are
// published in the ChartForge YARG assets repository.
//
//   Models and textures   js/yargnotes-data.js (generated from YARG's FBX and
//                         PNG files by convert_yarg_notes.py)
//   Middle shader         port of Assets/Art/Shaders/Gameplay/Notes/
//                         RectangularNote.shadergraph
//   Metal / glow / tap    port of Assets/Art/Shaders/Gameplay/YargLit.shadergraph
//   Material settings     the values of the .mat files in Assets/Art/Materials/
//                         Gameplay/Notes (named beside each one below)
//
//   Lighting              YARG's gameplay scene (Assets/Scenes/Gameplay.unity,
//                         its LightingData.asset and PostProcessProfile) with
//                         URP's Lit shading, see _YARG_LIGHTING
// ============================================================

// Set per frame in renderNotes(): the instrument draws YARG notes (5-fret and
// drums when the circular style is off), and whether it is a drum kit (wide
// notes are kicks there, open notes elsewhere).
let _yargStyle = false;
let _yargDrums = false;
// Width of one lane in scene units, also set per frame. Everything is sized
// from it so notes match the strikeline frets: YARG's lanes are 0.4 wide on
// 5-lane tracks and 0.5 on 4-lane drums (where its theme scales the pad notes
// by 1.25 x 1.15 x 1.315 but not the cymbals, and stretches the frets across
// the lane only), and its track is 2 wide.
let _yargLaneW = 1;

// One clock for every YARG note material, including clones (see _yargBind)
const _yargTime = { value: 0 };

// The frets' point lights (see _yargFretAnimate), shared by every YARG note
// and fret material so they light whatever is near the strikeline, as in
// YARG. Two per lane, hit and sustain. Position: xyz in the scene, w the
// scene-to-YARG scale (1 / k). Color: rgb linear color * intensity, a 1 / range^2
// in YARG units. Off when the color is black.
const _YARG_PL_MAX = 16;
const _yargPLPos = { value: Array.from({ length: _YARG_PL_MAX }, () => new THREE.Vector4()) };
const _yargPLCol = { value: Array.from({ length: _YARG_PL_MAX }, () => new THREE.Vector4()) };
const _YARG_PL_UNIFORMS = { uYargPLPos: _yargPLPos, uYargPLCol: _yargPLCol };

const _yargTexCache = {};
function _yargTex(name) {
  if (_yargTexCache[name]) return _yargTexCache[name];
  const tex = new THREE.TextureLoader().load(YARG_NOTE_TEX[name], () => { _renderDirty = true; });
  if (name === 'noise') { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  _yargTexCache[name] = tex;
  return tex;
}

const _yargGeoCache = {};
function _yargGeo(model, partIndex) {
  const key = model + ':' + partIndex;
  if (_yargGeoCache[key]) return _yargGeoCache[key];
  const src = YARG_NOTE_MODEL[model].parts[partIndex];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(src.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(src.n), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.uv), 2));
  g.setIndex(src.ix);
  g._cached = true;
  _yargGeoCache[key] = g;
  return g;
}

const _YARG_VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vSeed;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    // Stands in for YARG's per-note _RandomFloat: steady per lane, so the
    // noise does not jump as the note travels
    vSeed = fract(sin(modelMatrix[3].x * 12.9898) * 43758.5453);
    gl_Position = projectionMatrix * mvPosition;
  }`;

// The lighting of YARG's gameplay scene (Assets/Scenes/Gameplay.unity) and
// URP's Lit BRDF, shared by the note and fret shaders. YARG works in linear
// color: textures and colors are decoded from sRGB, lit, tonemapped with ACES
// (its PostProcessProfile) and encoded again. The scene has one directional
// light (intensity 2 at 7000 K, from above and behind the camera), ambient
// from its baked sky probe (LightingData.asset), and no reflection probe:
// its default reflection is "Custom" with no cubemap, so surfaces mirror
// nothing. The metal's look is its painted texture, the light's highlight and
// the falloff of the light across faces turned away from it.
// Axes: Unity's z runs away from the camera, the scene's toward it.
const _YARG_LIGHTING = `
  #define YARG_PL_MAX ${_YARG_PL_MAX}
  uniform vec4 uYargPLPos[YARG_PL_MAX];
  uniform vec4 uYargPLCol[YARG_PL_MAX];
  varying vec3 vWorldPos;
  vec3 yargLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 yargSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  // ACES tonemapping (Stephen Hill's fit of the RRT and sRGB ODT)
  vec3 yargACES(vec3 c) {
    const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    c = inM * c;
    c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
    return clamp(outM * c, 0.0, 1.0);
  }
  // The scene's ambient probe, evaluated as URP's SampleSH does. n is a world
  // direction in Unity's axes.
  vec3 yargAmbient(vec3 n) {
    vec3 l00 = vec3(0.1813, 0.2269, 0.3074);
    vec3 l1y = vec3(-0.0056, 0.0412, 0.1266);
    vec3 l1z = vec3(-0.0147, -0.0231, -0.0398);
    vec3 l2yz = vec3(-0.0116, -0.0185, -0.0331);
    vec3 l20 = vec3(0.0126, 0.0177, 0.0225);
    vec3 l22 = vec3(0.0240, 0.0329, 0.0382);
    return max(l00 - l20 + l1y * n.y + l1z * n.z + l2yz * n.y * n.z
      + 3.0 * l20 * n.z * n.z + l22 * (n.x * n.x - n.y * n.y), 0.0);
  }
  // URP's GGX highlight for light direction L
  float yargSpecTerm(vec3 N, vec3 L, vec3 V, float rough, float r2) {
    vec3 H = normalize(L + V);
    float NoH = clamp(dot(N, H), 0.0, 1.0);
    float LoH = clamp(dot(L, H), 0.0, 1.0);
    float d = NoH * NoH * (r2 - 1.0) + 1.00001;
    return r2 / (d * d * max(0.1, LoH * LoH) * (rough * 4.0 + 2.0));
  }
  // URP Lit, metallic workflow. specZero: a specular-workflow material with
  // specular color 0 (RectangularNote): all diffuse, no highlight.
  // N, V in view space; albedo and emission linear; returns display color.
  vec3 yargShade(vec3 albedo, vec3 emission, float metallic, float smoothness, bool specZero, vec3 N, vec3 V) {
    vec3 L = normalize((viewMatrix * vec4(-0.18726, 0.71939, 0.66889, 0.0)).xyz);
    vec3 sun = vec3(0.95, 0.95, 1.0) * 2.0;
    float omr = specZero ? 1.0 : 0.96 * (1.0 - metallic);
    vec3 diffuse = albedo * omr;
    vec3 specular = specZero ? vec3(0.0) : mix(vec3(0.04), albedo, metallic);
    float pr = 1.0 - smoothness;
    float rough = max(pr * pr, 0.0078125);
    float r2 = rough * rough;
    float NoL = clamp(dot(N, L), 0.0, 1.0);
    vec3 Nw = (vec4(N, 0.0) * viewMatrix).xyz;
    vec3 col = yargAmbient(vec3(Nw.x, Nw.y, -Nw.z)) * diffuse
      + (diffuse + specular * yargSpecTerm(N, L, V, rough, r2)) * sun * NoL + emission;
    // Point lights, with URP's falloff: inverse square, eased to 0 at range
    for (int i = 0; i < YARG_PL_MAX; i++) {
      vec4 lc = uYargPLCol[i];
      if (lc.r + lc.g + lc.b <= 0.0) continue;
      vec3 dl = uYargPLPos[i].xyz - vWorldPos;
      float d2 = dot(dl, dl) * uYargPLPos[i].w * uYargPLPos[i].w;
      float f = clamp(1.0 - (d2 * lc.a) * (d2 * lc.a), 0.0, 1.0);
      float atten = f * f / max(d2, 0.0001);
      vec3 Lp = normalize((viewMatrix * vec4(dl, 0.0)).xyz);
      float NoLp = clamp(dot(N, Lp), 0.0, 1.0);
      col += (diffuse + specular * yargSpecTerm(N, Lp, V, rough, r2)) * lc.rgb * (atten * NoLp);
    }
    return yargSRGB(yargACES(col));
  }`;

// uNoisy > 0.5: RectangularNote.shadergraph (the colored middle).
// otherwise:    YargLit.shadergraph (base map * color, optional shine/emission).
const _YARG_FRAG = _YARG_LIGHTING + `
  uniform sampler2D uMap;
  uniform sampler2D uShineMap;
  uniform sampler2D uNoiseTex;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uUseMap;
  uniform float uNoisy;
  uniform float uShineAmount;
  uniform float uMinDarkness;
  uniform float uNoiseScale;
  uniform float uNoiseSpeed;
  uniform float uNoiseStrength;
  uniform vec2 uNoiseTiling;
  uniform float uEmission;
  uniform float uEmissionMap;
  uniform float uSmoothness;
  uniform float uMetallic;
  uniform float uTime;
  uniform float opacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vSeed;

  // Shader Graph "Gradient Noise" node
  vec2 gradDir(vec2 p) {
    p = mod(p, 289.0);
    float x = mod((34.0 * p.x + 1.0) * p.x, 289.0) + p.y;
    x = mod((34.0 * x + 1.0) * x, 289.0);
    x = fract(x / 41.0) * 2.0 - 1.0;
    return normalize(vec2(x - floor(x + 0.5), abs(x) - 0.5));
  }
  float gradientNoise(vec2 uv, float scale) {
    vec2 p = uv * scale;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float d00 = dot(gradDir(ip), fp);
    float d01 = dot(gradDir(ip + vec2(0.0, 1.0)), fp - vec2(0.0, 1.0));
    float d10 = dot(gradDir(ip + vec2(1.0, 0.0)), fp - vec2(1.0, 0.0));
    float d11 = dot(gradDir(ip + vec2(1.0, 1.0)), fp - vec2(1.0, 1.0));
    fp = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
    return mix(mix(d00, d01, fp.y), mix(d10, d11, fp.y), fp.x) + 0.5;
  }
  // Shader Graph "Radial Shear" node
  vec2 radialShear(vec2 uv, vec2 center, vec2 strength, vec2 offset) {
    vec2 delta = uv - center;
    float d2 = dot(delta, delta);
    return uv + vec2(delta.y, -delta.x) * d2 * strength + offset;
  }
  // Shader Graph "Blend" node, Overlay mode
  vec3 blendOverlay(vec3 base, vec3 blend) {
    vec3 r1 = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
    vec3 r2 = 2.0 * base * blend;
    vec3 z = step(base, vec3(0.5));
    return r2 * z + (1.0 - z) * r1;
  }

  void main() {
    vec3 base = yargLinear(mix(vec3(1.0), texture2D(uMap, vUv).rgb, uUseMap));
    vec3 color = yargLinear(uColor);
    vec3 albedo;
    vec3 emission = uEmissive;

    if (uNoisy > 0.5) {
      // Scrolling, sheared noise picks a brightness out of the noise ramp
      // texture, which is overlaid on the base map before the note color
      vec2 shearC = vec2(0.25, -0.06);
      vec2 sheared = radialShear(vUv * uNoiseTiling, shearC, shearC, vec2(0.0, 0.52));
      float warp = gradientNoise(sheared, uNoiseScale);
      warp = 0.43 + (warp - 6.47) * ((-2.82 - 0.43) / (10.94 - 6.47));
      vec2 nuv = sheared + warp * uNoiseStrength;
      // Time + Time * remap(_RandomFloat, [-3.18, 13.24] -> [1.01, -1.11])
      float rate = 1.0 + (1.01 + (vSeed + 3.18) * ((-1.11 - 1.01) / (13.24 + 3.18)));
      nuv += uTime * rate * uNoiseSpeed;
      float n = gradientNoise(nuv, -1.11);
      vec3 ramp = max(yargLinear(texture2D(uNoiseTex, vec2(n)).rgb), vec3(uMinDarkness));
      albedo = blendOverlay(base, ramp) * color;
      // Emission: the ramp through a gradient that is black up to 0.28 and
      // rises to white at 1, times the color and _Emission
      emission += color * clamp((ramp.r - 0.2794) / 0.7206, 0.0, 1.0) * uEmission;
    } else {
      albedo = base * color;
      emission += base * color * uEmissionMap;
    }

    // Shine map painted over the result ("Overwrite" blend)
    vec4 shine = texture2D(uShineMap, vUv);
    albedo = mix(albedo, yargLinear(shine.rgb), clamp(uShineAmount * shine.a, 0.0, 1.0));

    // RectangularNote (the middle) is specular-workflow with specular 0;
    // YargLit is metallic-workflow
    vec3 col = yargShade(albedo, emission, uMetallic, uSmoothness, uNoisy > 0.5,
      normalize(vNormal), normalize(vViewDir));
    gl_FragColor = vec4(col, opacity);
  }`;

// Shared uniform objects survive cloning: ShaderMaterial.clone() deep-copies
// uniforms, which would leave a clone with its own stopped clock and with
// texture copies that are never uploaded.
const _YARG_SHARED_UNIFORMS = ['uMap', 'uShineMap', 'uNoiseTex', 'uTime', 'uYargPLPos', 'uYargPLCol'];
function _yargBind(m) {
  Object.defineProperty(m, 'opacity', {
    get() { return m.uniforms.opacity.value; },
    set(v) { if (m.uniforms && m.uniforms.opacity) m.uniforms.opacity.value = v; },
    configurable: true,
  });
  m.clone = function () {
    const c = THREE.ShaderMaterial.prototype.clone.call(this);
    for (const k of _YARG_SHARED_UNIFORMS) c.uniforms[k] = this.uniforms[k];
    _yargBind(c);
    return c;
  };
}

// p: { map, shineMap, color, noisy, shineAmount, minDarkness,
//      noiseScale, noiseSpeed, noiseTiling:[x,y], emission, emissionMap,
//      smoothness, metallic, glow }
// glow: a white emission in linear HDR units (Unity's _EmissionColor)
function _yargMat(key, p) {
  key = 'yarg_' + key;
  if (_matCache[key]) return _matCache[key];
  const mat = new THREE.ShaderMaterial({
    transparent: true, // opaque in practice; lets the far-edge fade dim it
    uniforms: {
      uMap: { value: p.map ? _yargTex(p.map) : null },
      uShineMap: { value: p.shineMap ? _yargTex(p.shineMap) : null },
      uNoiseTex: { value: p.noisy ? _yargTex('noise') : null },
      uColor: { value: new THREE.Color(p.color !== undefined ? p.color : 0xffffff) },
      uEmissive: { value: new THREE.Color().setScalar(p.glow || 0) },
      uUseMap: { value: p.map ? 1 : 0 },
      uNoisy: { value: p.noisy ? 1 : 0 },
      uShineAmount: { value: p.shineMap ? (p.shineAmount || 0) : 0 },
      uMinDarkness: { value: p.minDarkness || 0 },
      uNoiseScale: { value: p.noiseScale || 0 },
      uNoiseSpeed: { value: p.noiseSpeed || 0 },
      uNoiseStrength: { value: -1.06 },
      uNoiseTiling: { value: new THREE.Vector2(...(p.noiseTiling || [1, 1])) },
      uEmission: { value: p.emission || 0 },
      uEmissionMap: { value: p.emissionMap || 0 },
      uSmoothness: { value: p.smoothness || 0 },
      uMetallic: { value: p.metallic || 0 },
      uTime: _yargTime,
      ..._YARG_PL_UNIFORMS,
      opacity: { value: 1.0 },
    },
    vertexShader: _YARG_VERT,
    fragmentShader: _YARG_FRAG,
  });
  _yargBind(mat);
  mat._pooled = true;
  _matCache[key] = mat;
  return mat;
}

// The material for one part of a model. `role` is the slot's material in
// YARG's RectangularTheme prefab; `color` is the note color.
function _yargPartMat(model, role, color) {
  if (model === 'cymbal' || model === 'cymbalAccent' || model === 'cymbalGhost') {
    if (role === 'hopo') { // NoteHOPOGlow.mat (the accent cymbal's white ring)
      return _yargMat('hopoGlow', { color: 0xffffff, smoothness: 0.5, glow: 1.4142 });
    }
    if (role === 'ghostCenter') {
      // CymbalGhostCenter.mat: the cymbal map under a color at half the
      // brightness of the middle's (its _Color is half of CymbalMiddle's)
      const c = new THREE.Color(color).multiplyScalar(0.5);
      return _yargMat('cymGhostCenter_' + color, { map: 'cymbal', shineMap: 'cymbalShine', shineAmount: 0.07, color: c.getHex() });
    }
    if (role === 'middle') { // CymbalMiddle.mat
      return _yargMat('cymMid_' + color, {
        map: 'cymbal', shineMap: 'cymbalShine', shineAmount: 0.1, color, noisy: true,
        minDarkness: 0.4, noiseScale: -1.02, noiseSpeed: 0.25, noiseTiling: [0.75, 0.75], emission: 0.1,
      });
    }
    // CymbalMetal.mat / CymbalGlow.mat
    return _yargMat('cym_' + role, { map: 'cymbal', smoothness: role === 'glow' ? 0.5 : 0 });
  }
  if (model === 'kick') {
    if (role === 'middle') { // KickNoteMiddle.mat (emission from its own map)
      return _yargMat('kickMid_' + color, { map: 'kick', color, emissionMap: 0.9 });
    }
    return _yargMat('kickMetal', { map: 'kick' }); // KickNoteMetal.mat
  }
  if (model === 'open' || model === 'openHopo') {
    // OpenMiddle.mat / OpenMetal.mat, or for an open HOPO OpenHopoMiddle.mat /
    // OpenHopoMetal.mat: the same model with the lighter Note_Full_HOPO map
    const map = model === 'openHopo' ? 'openHopo' : 'open';
    if (role === 'middle') {
      return _yargMat(map + 'Mid_' + color, { map, color, emissionMap: 0.9 });
    }
    return _yargMat(map + 'Metal', { map, smoothness: 0.245, metallic: 1 });
  }
  switch (role) {
    case 'middle': // NoteMiddle.mat
      return _yargMat('mid_' + color, {
        map: 'normal', shineMap: 'normalShine', shineAmount: 0.1, color, noisy: true,
        minDarkness: 0.15, noiseScale: -2.8, noiseSpeed: 0.4, noiseTiling: [1.1, 1.3], emission: 0.1,
      });
    case 'hopo': // NoteHOPOGlow.mat: untextured, white, emissive
      return _yargMat('hopoGlow', { color: 0xffffff, smoothness: 0.5, glow: 1.4142 });
    case 'tap': // NoteTapCenter.mat
      return _yargMat('tap_' + color, { map: 'normal', shineMap: 'normalShine', shineAmount: 0.2, color });
    default: // NoteMetal.mat / NoteGlow.mat
      return _yargMat('metal', { map: 'normal', smoothness: 0.5 });
  }
}

// Height of each model's origin above the track in YARG's theme prefab (its
// local position y; the cymbals' is their ScaleContainer's). With the model's
// own y0 this gives where its lowest point sits: lane notes rest on the
// track, the kick bar a hair into it, and the open note bar is sunk in so
// only about two thirds of it shows.
const _YARG_NOTE_Y = {
  normal: 0.077, hopo: 0.073, tap: 0.073, accent: 0.079, ghost: 0.064,
  open: 0.032, kick: 0.03, cymbal: 0.1, cymbalAccent: 0.1, cymbalGhost: 0.1,
};
const _YARG_TRACK_Y = 0.005; // the highway surface, as used for the frets
function _yargBottomY(model, ky) {
  return _YARG_TRACK_Y + (_YARG_NOTE_Y[model] + YARG_NOTE_MODEL[model].y0) * ky;
}

// Build one note from a YARG model. `k` scales YARG track units to scene
// units; the model rests on bottomY. Parts carry _gemNote so the pill-note
// pulse in animateNoteTextures() leaves their scale alone.
function _yargBuild(model, x, bottomY, z, k, color, userData, ky, kz, skin) {
  if (ky === undefined) { ky = k; kz = k; }
  const src = YARG_NOTE_MODEL[model];
  skin = skin || model; // same geometry, another set of materials
  const parts = { _gem: true };
  for (let i = 0; i < src.parts.length; i++) {
    const role = src.parts[i].role;
    const m = _acquireMesh(_yargGeo(model, i), _yargPartMat(skin, role, color));
    m.scale.set(k, ky, kz);
    m.position.set(x, bottomY, z);
    m.userData = { ...userData, _gemNote: true };
    if (role === 'middle') { m.userData._isNoteBody = true; parts.bodyMesh = m; }
    else m.userData._isEndCap = true;
    parts['p' + i] = m;
  }
  if (parts.bodyMesh) delete parts['p' + src.parts.findIndex(p => p.role === 'middle')];
  return parts;
}

// Lane note. kind: 'strum' | 'hopo' | 'tap', or on drums 'accent' | 'ghost'
// (YARG's accent and ghost pad models). Sized from the lane, at YARG's own
// proportion to its fret (noteW, the pill note's width, is not used); the
// other models are smaller or larger by YARG's proportions.
function _createYargNote(x, y, z, noteW, nH, color, userData, kind) {
  const model = (kind === 'hopo' || kind === 'tap' || kind === 'accent' || kind === 'ghost') ? kind : 'normal';
  const U = HIGHWAY_WIDTH / 2;
  // 4-lane drums: YARG's theme scales the pad notes by (1.25, 1.15, 1.315)
  if (_yargDrums && _yargLaneW / 0.4 > U * 1.01) {
    return _yargBuild(model, x, _yargBottomY(model, U * 1.15), z, U * 1.25, color, userData, U * 1.15, U * 1.315);
  }
  const k = _yargLaneW / 0.4;
  return _yargBuild(model, x, _yargBottomY(model, k), z, k, color, userData);
}

// The color of an open HOPO's bar. YARG gives that note the open color and its
// model adds 1 to every channel ("EmissionAddition: 1" on the theme's Open
// HOPO Note), which in HDR is the open color washed most of the way to white.
// The same sum scaled back to full brightness keeps that tint: the default
// purple becomes a pale lilac.
function _yargOpenHopoColor(hex) {
  const r = ((hex >> 16) & 0xff) / 255 + 1, g = ((hex >> 8) & 0xff) / 255 + 1, b = (hex & 0xff) / 255 + 1;
  const m = Math.max(r, g, b);
  return (Math.round(r / m * 255) << 16) | (Math.round(g / m * 255) << 8) | Math.round(b / m * 255);
}

// Full-width note: the kick bar on drums, the open note bar elsewhere.
// hopo: YARG's open HOPO note (lighter end pieces), also used for open taps.
function _createYargWide(x, y, z, noteW, nH, color, userData, hopo) {
  const model = _yargDrums ? 'kick' : 'open';
  const U = HIGHWAY_WIDTH / 2;
  return _yargBuild(model, x, _yargBottomY(model, U), z, U, color, userData, U, U,
    (hopo && model === 'open') ? 'openHopo' : model);
}

// Cymbal: returns the mesh list createCymbalMesh() callers expect. Accent
// and ghost cymbals are YARG's own models (the ghost one is modeled smaller).
function _createYargCymbal(x, y, z, size, color, userData, isAccent, isGhost) {
  const model = isAccent ? 'cymbalAccent' : isGhost ? 'cymbalGhost' : 'cymbal';
  const k = _yargLaneW / 0.5;
  const parts = _yargBuild(model, x, _yargBottomY(model, k), z, k, color, userData);
  const out = [];
  for (const key in parts) if (parts[key] && parts[key].isObject3D) out.push(parts[key]);
  return out;
}

// ============================================================
// YARG RECTANGULAR FRETS (the strikeline)
// The strikeline of the standard style: YARG's rectangular fret, one per
// lane, in place of the metallic bar and box receptors.
//   Model      RectangularFret.fbx as placed by RectangularFret.prefab
//   Metal      FretMetal.mat (YargLit.shadergraph)
//   Outer      FretOuter.mat, port of RectangularFretOuter.shadergraph
//   Inner      FretInner.mat, port of RectangularFretInner.shadergraph
// They are stored in the same record ChartForge's built-in receptors use
// (rebuildStrikeLine() in ui.js, the fret update in render.js), so materials
// expose color / emissive / emissiveIntensity for that code to write, and the
// model's size is baked into the geometry because that code owns each mesh's
// scale. What is drawn follows YARG instead: _yargFretAnimate() poses the
// fret and lights the inner pad, and the frame does not change on a hit.
// ============================================================

// uKind: 0 metal, 1 outer frame, 2 inner pad, 3 kick fret
const _YARG_FRET_FRAG = _YARG_LIGHTING + `
  uniform sampler2D uMap;
  uniform sampler2D uShineMap;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uEmissiveIntensity;
  uniform float uKind;
  uniform float uFade;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  // Shader Graph "Hue" node (degrees), as a rotation about the grey axis
  vec3 hueShift(vec3 c, float deg) {
    float a = radians(deg);
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  }

  void main() {
    vec3 tex = yargLinear(texture2D(uMap, vUv).rgb);
    vec3 color = yargLinear(uColor);
    vec3 albedo = tex;
    vec3 emission = vec3(0.0);
    if (uKind > 2.5) {
      // Kick fret (KickFret.mat, YargLit): base map * color
      albedo = tex * color;
    } else if (uKind > 1.5) {
      // Inner: base = lerp(texture, color, Fade), emission = lerp(black,
      // color, Fade) * 5. Fade is 1 while the fret is "pressed", else 0.
      albedo = mix(tex, color, uFade);
      emission = color * 5.0 * uFade;
    } else if (uKind > 0.5) {
      // Outer: color * texture, with the hue-shifted shine painted over it
      albedo = color * tex;
      vec4 shine = texture2D(uShineMap, vUv);
      vec3 shineCol = mix(hueShift(color, 20.0), vec3(1.0), 0.1) * yargLinear(shine.rgb);
      albedo = mix(albedo, shineCol, clamp(shine.a, 0.0, 1.0));
      // (no emission: the frame itself does not change on a hit in YARG)
    }
    // All four are metallic 0 and smoothness 0 (FretMetal.mat, KickFret.mat,
    // and the outer and inner graphs)
    vec3 col = yargShade(albedo, emission, 0.0, 0.0, false, normalize(vNormal), normalize(vViewDir));
    gl_FragColor = vec4(col, 1.0);
  }`;

function _yargFretMat(kind, colorHex) {
  const mat = new THREE.ShaderMaterial({
    side: kind === 3 ? THREE.DoubleSide : THREE.FrontSide, // the right kick fret is mirrored
    uniforms: {
      uMap: { value: _yargTex(kind === 3 ? 'kickFret' : 'fret') },
      uShineMap: { value: kind === 1 ? _yargTex('fretShine') : null },
      uColor: { value: new THREE.Color(colorHex) },
      uEmissive: { value: new THREE.Color(0x000000) },
      uEmissiveIntensity: { value: 0.3 },
      uKind: { value: kind },
      uFade: { value: 0 },
      ..._YARG_PL_UNIFORMS,
    },
    vertexShader: _YARG_VERT,
    fragmentShader: _YARG_FRET_FRAG,
  });
  // The fields the fret animation writes on a MeshPhongMaterial
  mat.color = mat.uniforms.uColor.value;
  mat.emissive = mat.uniforms.uEmissive.value;
  Object.defineProperty(mat, 'emissiveIntensity', {
    get() { return mat.uniforms.uEmissiveIntensity.value; },
    set(v) { mat.uniforms.uEmissiveIntensity.value = v; },
  });
  return mat;
}

// Part geometry scaled by k (kx across the lane) and shifted by dy, built per
// strikeline rebuild (lane widths differ between instruments)
function _yargFretGeo(partIndex, k, dy, kx) {
  const src = YARG_NOTE_MODEL.fret.parts[partIndex];
  const pos = new Float32Array(src.p.length);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = src.p[i] * kx;
    pos[i + 1] = src.p[i + 1] * k + dy;
    pos[i + 2] = src.p[i + 2] * k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(src.n), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.uv), 2));
  g.setIndex(src.ix);
  return g;
}

// One fret at lane x. Returns the record rebuildStrikeLine() stores in
// fretLaneMeshes; its meshes still have to be added to the scene.
// floorY is the highway surface the fret's metal base rests on.
function _yargBuildFret(lx, laneW, laneColor, z, floorY) {
  const model = YARG_NOTE_MODEL.fret;
  // YARG's track is 2 wide and its fret is modeled for a 0.4 lane. On wider
  // lanes (4-lane drums) YARG stretches the fret across the lane only
  // (FretArray scales x), keeping its height and depth, so k stays the track
  // scale and only x follows the lane.
  const k = HIGHWAY_WIDTH / 2;
  const kx = laneW / 0.4;
  const idx = (role) => model.parts.findIndex(p => p.role === role);
  const metalIdx = idx('fretMetal');
  // The fret's origin sits on the track surface and most of the model is
  // below it: y0 is where its lowest point is in the prefab, and the "Model"
  // object adds -0.006. Only the top ~0.057 stands above the track, so the
  // kick frets beside it are taller, as in YARG.
  const baseY = floorY + (model.y0 - 0.006) * k;

  _yargTex('fretFlash'); // start loading the hit flash sheet before the first hit
  const borderMat = _yargFretMat(1, laneColor);
  const innerMat = _yargFretMat(2, laneColor);
  // The inner pad is lit by _yargFretAnimate() (YARG's Fade), not by the
  // fill colors ChartForge's own fret animation writes
  innerMat.color = new THREE.Color(0x000000);
  innerMat.emissive = new THREE.Color(0x000000);
  const metalMat = _yargFretMat(0, 0xffffff);
  // The animation recolors the bottom border per lane; YARG's base is plain
  // metal, so those writes land on colors the shader does not read
  metalMat.color = new THREE.Color(0xffffff);
  metalMat.emissive = new THREE.Color(0x000000);

  const outerMesh = new THREE.Mesh(_yargFretGeo(idx('fretOuter'), k, 0, kx), borderMat);
  const innerMesh = new THREE.Mesh(_yargFretGeo(idx('fretInner'), k, 0, kx), innerMat);
  // The animation keeps this part 0.02 below the outer mesh
  const bottomBorder = new THREE.Mesh(_yargFretGeo(metalIdx, k, 0.02, kx), metalMat);
  const lineMesh = new THREE.Mesh(new THREE.BoxGeometry(0.0001, 0.0001, 0.0001), borderMat);
  outerMesh.position.set(lx, baseY, z);
  innerMesh.position.set(lx, baseY, z);
  bottomBorder.position.set(lx, baseY - 0.02, z);
  lineMesh.position.set(lx, baseY, z);

  return {
    _yarg: true, k, floorY, z, // for _yargFretAnimate()
    outerMesh, innerMesh, lineMesh, bottomBorder,
    borderMat, innerMat, bottomBorderMat: metalMat,
    laneColor, darkColor: 0x000000, darkerBorderColor: 0x000000, innerBase: 0x000000,
    baseY,
    rimMesh: null, slopeMesh: null, slopeMat: null, flameMesh: null, flameMat: null,
    innerYOff: 0, rimYOff: 0,
    glowMesh: null, glowMat: null,
  };
}

// ============================================================
// YARG KICK FRETS AND KICK FLASH (drums)
// A kick fret stands at each end of the strikeline (the right one is the left
// one mirrored, as in YARG's FretArray). On a kick its inner block slides
// toward the track and eases back (KickFretHit.anim), and a flash plays
// across the strikeline (KickFretFlash: six frames at 50 a second).
//   Model      RectangularKickFret.fbx as placed in RectangularTheme.prefab
//   Material   KickFret.mat (YargLit); the sliding block is tinted with the
//              kick color, the housing is left untinted
//   Flash      KickFlash1-6.png on the quad BaseVisual.prefab places in front
//              of the strikeline, port of KickFlash.shadergraph
// ============================================================
let _yargKick = null; // { frets: [{ body, slide, x, y, dir }], flash, mats, U }

const _YARG_KICK_FLASH_FRAG = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    // Shader Graph "Blend" node, Linear Light at 0.7, over the flash color
    vec3 lit = uColor + 2.0 * tex.rgb - 1.0;
    gl_FragColor = vec4(mix(uColor, lit, 0.7), tex.a);
  }`;

function _yargKickGeo(partIndex, U) {
  const src = YARG_NOTE_MODEL.kickFret.parts[partIndex];
  const pos = new Float32Array(src.p.length);
  for (let i = 0; i < pos.length; i++) pos[i] = src.p[i] * U;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(src.n), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.uv), 2));
  g.setIndex(src.ix);
  return g;
}

// Builds both kick frets and the flash at strikeline z. Returns the meshes for
// rebuildStrikeLine() to add to the scene; state is kept in _yargKick.
function _yargBuildKick(z, floorY, kickColor) {
  const U = HIGHWAY_WIDTH / 2; // YARG's track is 2 wide
  const model = YARG_NOTE_MODEL.kickFret;
  // Only the sliding block takes the kick color (the theme's ThemeKickFret
  // lists that one renderer as colored); the housing stays plain metal
  const mat = _yargFretMat(3, kickColor);
  const bodyMat = _yargFretMat(3, 0xffffff);
  const meshes = [];
  const frets = [];
  for (const dir of [1, -1]) { // left fret as modeled, right fret mirrored
    const x = -1.015 * U * dir;
    const rec = { x, y: floorY, dir };
    model.parts.forEach((part, i) => {
      const m = new THREE.Mesh(_yargKickGeo(i, U), part.role === 'kickSlide' ? mat : bodyMat);
      m.scale.x = dir;
      m.position.set(x, floorY, z);
      meshes.push(m);
      if (part.role === 'kickSlide') rec.slide = m; else rec.body = m;
    });
    frets.push(rec);
  }
  // Flash quad: 2.609 x 0.881, 0.086 up and 0.134 toward the player, leaning
  // back 44 degrees (BaseVisual.prefab, Effects/KickFlash)
  const flashMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uMap: { value: null }, uColor: { value: new THREE.Color(kickColor) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: _YARG_KICK_FLASH_FRAG,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(2.609 * U, 0.881 * U), flashMat);
  flash.position.set(0, floorY + 0.086 * U, z + 0.134 * U);
  flash.rotation.x = -2 * Math.asin(0.375);
  flash.renderOrder = 9;
  flash.visible = false;
  meshes.push(flash);
  const frames = [];
  for (let i = 1; i <= 6; i++) {
    const t = _yargTex('kickFlash' + i);
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    frames.push(t);
  }
  _yargKick = { frets, flash, flashMat, frames, mat, U };
  return meshes;
}

// Per frame (and per split panel). visible: the view is a drum kit.
// t: the kick hit state, 1 at the hit and decaying to 0 at 8 per second.
function _yargUpdateKick(visible, t, kickColor) {
  const kf = _yargKick;
  if (!kf) return;
  if (kickColor !== undefined) {
    kf.mat.uniforms.uColor.value.set(kickColor);
    kf.flashMat.uniforms.uColor.value.set(kickColor);
  }
  const hit = YARG_NOTE_MODEL.kickFret.hit;
  for (const f of kf.frets) {
    f.body.visible = visible;
    f.slide.visible = visible;
    f.slide.position.x = f.x + hit[0] * kf.U * t * f.dir;
    f.slide.position.y = f.y + hit[1] * kf.U * t;
  }
  // Seconds since the hit, from the decaying state; 50 frames a second
  const frame = Math.floor(((1 - t) / 8) * 50);
  const show = visible && t > 0 && frame < kf.frames.length;
  kf.flash.visible = show;
  if (show) kf.flashMat.uniforms.uMap.value = kf.frames[frame];
}

// ============================================================
// YARG FRET ANIMATIONS AND HIT / SUSTAIN EFFECTS
// The motion of YARG's fret animation clips and the particle systems of
// RectangularFret.prefab, driven by ChartForge's hit detection.
//   FretHit.anim          the colored part pops up and settles in 2/15 s
//   FretSustained.anim    a small looping version while a sustain is held
//   FretCymbalHit.anim    the whole fret rocks (pro drums cymbal hits)
//   Hit Effects           Flash (sprite sheet), Smoke, White Smoke, Ring,
//                         Sparkles, Shards
//   Sustain Effects       rising particles while a sustain is held
// Unity's animator and particle systems are replaced by the small systems
// below, using the clips' key values and the particle systems' settings
// (counts, lifetimes, speeds, sizes, colors, simulation speed). Positions are
// in YARG track units times the fret's scale k. YARG's point lights are real
// lights here too (_yargFretLights), and its miss effects are not reproduced
// (the editor has no misses).
// ============================================================
// Peak height of the colored part: its local z offset in the clips, times the
// fret's z scale (8.02) and the Model object's y scale (1.29), in metres
const _YARG_FRET_POP = (0.00682 - 0.0030232) * 8.02 * 1.29;
const _YARG_FRET_SUSTAIN_POP = (0.00362 - 0.0030232) * 8.02 * 1.29;
const _YARG_FRET_CLIP = 2 / 15;
// FretCymbalHit.anim: x rotation in degrees, relative to the rest pose
const _YARG_CYMBAL_ROCK = [[0, 0], [1 / 15, -17], [7 / 60, 10], [1 / 6, -14], [7 / 30, 0]];
const _YARG_OPEN_FX_COLOR = 0xC800FF;

// Set by updateFretHits(): the lane's latest hit was a cymbal
const _yargCymHit = new Uint8Array(8);
// Notes that have crossed the strikeline in the main view, counted per lane,
// and open notes / kicks counted once. Every note bumps a count, so each one
// triggers its own animation however close together they are (the decaying
// hit state alone cannot tell fast notes apart). Split panels keep the same
// counts on their own hit state.
const _yargHitCount = new Uint32Array(8);
const _yargOpenCount = { n: 0 };
// Per view ("inst:diff"): what each lane was doing last frame
const _yargFretStates = {};

function _yargRock(e) {
  const k = _YARG_CYMBAL_ROCK;
  for (let i = 1; i < k.length; i++) {
    if (e <= k[i][0]) {
      let u = (e - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      u = u * u * (3 - 2 * u);
      return (k[i - 1][1] + (k[i][1] - k[i - 1][1]) * u) * Math.PI / 180;
    }
  }
  return 0;
}

// Pose one YARG fret and fire its effects. Called from the fret update in
// render.js after its own pose code, for frets built by _yargBuildFret().
//   key        view the fret state belongs to ("inst:diff")
//   hits       count of notes hit on the lane so far
//   sustained  a sustain is being held on the lane
//   opens      count of open notes hit in the view so far (0 on drums)
//   fx         spawn particles (false for a split panel that mirrors the
//              main view, which spawns its own)
function _yargFretAnimate(fret, key, lane, hits, sustained, opens, now, dt, scaleX, x, color, fx) {
  let st = _yargFretStates[key];
  if (!st) st = _yargFretStates[key] = { prev: [], oprev: [], hitAt: [], hitColor: [], cymAt: [], emit: [] };
  const k = fret.k;
  const floorY = fret.floorY, z = fret.z;
  // Effects are tagged with the plain view name, which is what the per-panel
  // filter (_yargFxWrite) matches; "panel:" only keeps a panel's pose state
  // apart from the main view's
  const fxKey = key.startsWith('panel:') ? key.slice(6) : key;

  // One trigger per note. The first frame of a view only records the counts.
  if (st.prev[lane] !== undefined && hits !== st.prev[lane]) {
    st.hitAt[lane] = now;
    st.hitColor[lane] = color;
    if (_yargCymHit[lane] && fx) st.cymAt[lane] = now;
    if (fx) _yargFxHit(fxKey, x, floorY, z, k, color);
  }
  st.prev[lane] = hits;
  // An open note pops every fret, with the open note's color
  if (st.oprev[lane] !== undefined && opens !== st.oprev[lane]) {
    st.hitAt[lane] = now;
    st.hitColor[lane] = _YARG_OPEN_FX_COLOR;
    if (fx) _yargFxHit(fxKey, x, floorY, z, k, _YARG_OPEN_FX_COLOR, true);
  }
  st.oprev[lane] = opens;

  let pop = 0;
  const e = now - (st.hitAt[lane] !== undefined ? st.hitAt[lane] : -10);
  if (e < _YARG_FRET_CLIP) pop = Math.sin(Math.PI * e / _YARG_FRET_CLIP) * _YARG_FRET_POP;
  else if (sustained) pop = Math.sin(Math.PI * ((now % _YARG_FRET_CLIP) / _YARG_FRET_CLIP)) * _YARG_FRET_SUSTAIN_POP;
  const ce = now - (st.cymAt[lane] !== undefined ? st.cymAt[lane] : -10);
  const rock = ce < 7 / 30 ? -_yargRock(ce) : 0;

  const y = fret.baseY + pop * k;
  fret.outerMesh.position.y = y;
  fret.innerMesh.position.y = y;
  fret.lineMesh.position.y = y;
  fret.bottomBorder.position.y = fret.baseY - 0.02;
  for (const m of [fret.outerMesh, fret.innerMesh, fret.bottomBorder]) {
    m.scale.set(scaleX, 1, 1);
    m.rotation.x = rock;
  }

  // Inner pad: YARG sets Fade to 1 while the fret is pressed and back to 0 on
  // release, with nothing in between. Here "pressed" is the moment of a hit
  // (about 0.1 s) and the length of a sustain.
  const pressed = sustained || e < 0.1;
  const iu = fret.innerMat.uniforms;
  iu.uFade.value = pressed ? 1 : 0;
  iu.uColor.value.set(color);
  _yargFretLights(lane, x, floorY, z, k, e < 0.1 ? st.hitColor[lane] : null,
    sustained ? 3 + Math.sin(now * 30) * 0.075 + Math.sin(now * 40) * 0.075 : 0, color);

  // Sustain Effects: 25 particles a second at simulation speed 1.5
  if (sustained && fx) {

    st.emit[lane] = (st.emit[lane] || 0) + dt * 25 * 1.5;
    while (st.emit[lane] >= 1) {
      st.emit[lane] -= 1;
      _yargFxPoint(fxKey, {
        x: x + (Math.random() - 0.5) * 0.24 * k, y: floorY + (0.114 + Math.random() * 0.06) * k,
        z: z + (0.08 + (Math.random() - 0.5) * 0.04) * k,
        vx: 0, vy: 0.9 * k, vz: 0, life: (0.25 + Math.random() * 0.2) / 1.5,
        size: (0.025 + Math.random() * 0.01) * k, color, alpha: 1, shrink: 0.5,
      });
    }
  } else if (!sustained) {
    st.emit[lane] = 0;
  }
}

// The point lights of RectangularFret.prefab, two slots per lane. Each view
// poses its frets from lane 0 up just before it is drawn, so lane 0 clears
// what the previous view left.
//   Hit Effects / Open Hit Effects light   intensity 4, range 0.3, 0.147 up
//       and 0.0156 toward the player; on for 0.1 s ("Normal" mode, its
//       _fadeOutRate of 100 is a duration in ms), in the hit's color
//   Sustain Effects light   intensity 3, range 0.24, 0.11 up and 0.043 away
//       from the player; flickers on two sines while a sustain is held
// hitColor: null when the hit light is off; sustain: the sustain intensity.
const _yargPLTmp = new THREE.Color();
function _yargFretLights(lane, x, floorY, z, k, hitColor, sustain, color) {
  if (lane === 0) for (const c of _yargPLCol.value) c.set(0, 0, 0, 0);
  const i = lane * 2;
  if (i + 1 >= _YARG_PL_MAX) return;
  const set = (slot, hex, intensity, range, up, toward) => {
    _yargPLTmp.set(hex);
    // the light's color is sRGB; lighting is linear
    const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    _yargPLCol.value[slot].set(lin(_yargPLTmp.r) * intensity, lin(_yargPLTmp.g) * intensity,
      lin(_yargPLTmp.b) * intensity, 1 / (range * range));
    _yargPLPos.value[slot].set(x, floorY + up * k, z + toward * k, 1 / k);
  };
  if (hitColor !== null && hitColor !== undefined) set(i, hitColor, 4, 0.3, 0.147, 0.0156);
  if (sustain > 0) set(i + 1, color, sustain, 0.24, 0.11, -0.043);
}

const _YARG_FX_MAX = 2400;
let _yargFx = null;

function _yargFxInit() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(_YARG_FX_MAX * 3);
  const col = new Float32Array(_YARG_FX_MAX * 4);
  const size = new Float32Array(_YARG_FX_MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('rgba', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 400 } },
    vertexShader: `
      attribute float size;
      attribute vec4 rgba;
      uniform float uPx;
      varying vec4 vRgba;
      void main() {
        vRgba = rgba;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(size * uPx / -mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec4 vRgba;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (d > 1.0) discard;
        float a = (1.0 - d * d) * vRgba.a;
        gl_FragColor = vec4(vRgba.rgb * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 11;
  scene.add(points);
  // Soft round blob standing in for Unity's built-in default particle texture
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _yargFx = { points, geo, mat, pos, col, size, pool: [], sprites: [], blob: new THREE.CanvasTexture(c) };
}

function _yargFxPoint(key, p) {
  if (!_yargFx) _yargFxInit();
  if (_yargFx.pool.length >= _YARG_FX_MAX) return;
  p.key = key;
  p.age = -(p.delay || 0);
  p.r = ((p.color >> 16) & 0xff) / 255;
  p.g = ((p.color >> 8) & 0xff) / 255;
  p.b = (p.color & 0xff) / 255;
  _yargFx.pool.push(p);
}

// kind: 'flash' (FretHit_Flash sheet, 2 x 10 frames) | 'blob'
function _yargFxSprite(key, kind, o) {
  if (!_yargFx) _yargFxInit();
  let s = _yargFx.sprites.find(q => !q.live && q.kind === kind);
  if (!s) {
    let map;
    if (kind === 'flash') {
      // Its own texture object, so each sprite can show its own frame
      const base = _yargTex('fretFlash');
      map = base.clone();
      map.repeat.set(0.5, 0.1);
      map.minFilter = THREE.LinearFilter;
      map.generateMipmaps = false;
      // The image may still be loading: a clone made now has to be told
      if (base.image) map.needsUpdate = true;
      else _yargFx.pendingFlash = (_yargFx.pendingFlash || []).concat(map);
    } else {
      map = _yargFx.blob;
    }
    const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 10;
    scene.add(sprite);
    s = { kind, sprite, mat, map };
    _yargFx.sprites.push(s);
  }
  Object.assign(s, o, { live: true, key, age: -(o.delay || 0) });
  s.sprite.position.set(o.x, o.y, o.z);
  s.mat.color.set(o.color);
  s.sprite.visible = false;
}

// Hit Effects of one fret (x, floorY, z = the fret's position; k = its scale).
// open: an open note's hit, which plays on every fret without the shards.
// (YARG's prefab lists Shards under "Open Hit Effects" too, but in the game
// they are not seen flying out on open notes, and the game is what is matched.)
function _yargFxHit(key, x, floorY, z, k, color, open) {
  const oy = floorY + 0.073 * k, oz = z - 0.011 * k; // "Hit Effects" object

  // Flash: one sprite, size 0.7, lifetime 0.3-0.4 at simulation speed 2,
  // alpha 0.71 -> 0 at 66%. The sheet is 10 rows of 2 frames (the flash, then
  // its afterglow); each flash plays one row picked at random.
  _yargFxSprite(key, 'flash', {
    x: x + 0.001 * k, y: oy + 0.249 * k, z: oz + 0.077 * k, delay: 0.01,
    life: (0.3 + Math.random() * 0.1) / 2, w: 0.7 * k, h: 0.7 * k, grow: 1,
    color, a0: 0.71, aEnd: 0.66, frames: 2, row: Math.floor(Math.random() * 10),
  });

  // Smoke: size 0.5 (object scale 0.585 x 1.556) growing 0.68 -> 1,
  // alpha 0.69 -> 0 at 39% of a 0.15 lifetime at speed 2
  _yargFxSprite(key, 'blob', {
    x: x - 0.012 * k, y: oy + (0.353 - 0.17 * 1.556) * k, z: oz - 0.02 * k, delay: 0.05,
    life: 0.075, w: 0.5 * 0.585 * k, h: 0.5 * 1.556 * k, grow: 0.68,
    color, a0: 0.69, aEnd: 0.39,
  });
  // White Smoke: size 0.5 (scale 0.55 x 1.09), alpha 0.19 -> 0, never colored
  _yargFxSprite(key, 'blob', {
    x: x - 0.009 * k, y: oy + (0.283 - 0.17 * 1.09) * k, z: oz - 0.015 * k, delay: 0.025,
    life: 0.15, w: 0.5 * 0.55 * k, h: 0.5 * 1.09 * k, grow: 1,
    color: 0xffffff, a0: 0.19, aEnd: 1,
  });

  // Ring: a burst thrown out over the upper half sphere at speed 4, squashed
  // by the object's scale (0.242, 0.242, 0.131); size 0.05 growing from 0,
  // alpha 0.29 fading out over 0.5 s. YARG emits 200; 90 reads the same here.
  for (let i = 0; i < 90; i++) {
    const az = Math.random() * Math.PI * 2, el = Math.acos(Math.random());
    const s = Math.sin(el);
    _yargFxPoint(key, {
      x, y: oy + (-0.031 + 0.03 * 0.242) * k, z: oz,
      vx: Math.cos(az) * s * 4 * 0.242 * k, vy: Math.cos(el) * 4 * 0.242 * k, vz: Math.sin(az) * s * 4 * 0.131 * k,
      life: 0.5, size: 0.05 * 0.242 * k * 2, color, alpha: 0.29, growIn: true, fade: true,
    });
  }
  // Sparkles: 228 a second for 0.3 s at simulation speed 2 (about 34), white,
  // along the fret, thrown up and away (local z up to 1.5 on an object
  // tilted 56.6 degrees), size up to 0.025, lifetime 0.3 at speed 2
  for (let i = 0; i < 34; i++) {
    const v = Math.random() * 1.5 * 2, vy = Math.random() * 0.1 * 2;
    _yargFxPoint(key, {
      x: x + (Math.random() - 0.5) * 0.6 * 0.437 * k, y: floorY + (0.03 + Math.random() * 0.03) * k, z: oz - 0.022 * k,
      vx: 0, vy: (v * 0.835 + vy * 0.55) * k, vz: -(v * 0.55 - vy * 0.835) * k,
      delay: Math.random() * 0.15, life: 0.15, size: Math.random() * 0.025 * k * 2,
      color: 0xffffff, alpha: 1, shrink: 0.5, fade: true,
    });
  }
  // Shards: 4-6 after 0.05 s, lifetime 0.25-0.35, size 0.03-0.05, simulation
  // speed 1.5; velocity over lifetime rises (2 -> 0 by half life) and then
  // comes at the player (0 -> 4 by half life); gravity -0.3 lifts them
  const n = open ? 0 : 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const az = Math.random() * Math.PI * 2;
    _yargFxPoint(key, {
      x: x + Math.cos(az) * 0.06 * k, y: oy + 0.02 * k, z: oz + (0.112 + Math.sin(az) * 0.06) * k,
      vx: Math.cos(az) * 0.2 * 1.5 * k, vy: 0, vz: 0, shard: 1.5 * k,
      delay: 0.05 / 1.5, life: (0.25 + Math.random() * 0.1) / 1.5, size: (0.03 + Math.random() * 0.02) * k * 1.5,
      color, alpha: 1, bright: 0.6, shrink: 0.69,
    });
  }
}

// Advance every effect. Called once a frame from updateSparks().
function _yargFxUpdate(dt) {
  const fx = _yargFx;
  if (!fx) return;
  if (fx.pendingFlash && _yargTex('fretFlash').image) {
    for (const m of fx.pendingFlash) { m.image = _yargTex('fretFlash').image; m.needsUpdate = true; }
    fx.pendingFlash = null;
  }
  for (let i = fx.pool.length - 1; i >= 0; i--) {
    const p = fx.pool[i];
    p.age += dt;
    if (p.age < 0) continue;
    if (p.age >= p.life) { fx.pool.splice(i, 1); continue; }
    if (p.shard) {
      const u = p.age / p.life;
      p.vy = 2 * Math.max(0, 1 - 2 * u) * p.shard + 0.3 * 9.81 * p.age * p.shard;
      p.vz = 4 * Math.min(1, 2 * u) * p.shard;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
  for (const s of fx.sprites) {
    if (!s.live) continue;
    s.age += dt;
    if (s.age >= s.life) { s.live = false; s.sprite.visible = false; }
  }
  if (typeof renderer !== 'undefined' && renderer && typeof activeCamera !== 'undefined' && activeCamera) {
    fx.mat.uniforms.uPx.value = renderer.domElement.height * 0.5 * activeCamera.projectionMatrix.elements[5];
  }
  _yargFxWrite(null);
}

// Fill the point buffers and show the sprites of one view (null = all).
// Split view calls this per panel, like _writeSparkBuffers().
function _yargFxWrite(filterKey) {
  const fx = _yargFx;
  if (!fx) return;
  let n = 0;
  for (const p of fx.pool) {
    if (p.age < 0 || (filterKey && p.key !== filterKey)) continue;
    const u = p.age / p.life;
    let size = p.size, a = p.alpha;
    if (p.growIn) size *= u;
    if (p.shrink !== undefined && u > p.shrink) size *= 1 - (u - p.shrink) / (1 - p.shrink);
    if (p.fade) a *= 1 - u;
    const b = p.bright || 0;
    fx.pos[n * 3] = p.x; fx.pos[n * 3 + 1] = p.y; fx.pos[n * 3 + 2] = p.z;
    fx.col[n * 4] = p.r + (1 - p.r) * b; fx.col[n * 4 + 1] = p.g + (1 - p.g) * b; fx.col[n * 4 + 2] = p.b + (1 - p.b) * b;
    fx.col[n * 4 + 3] = a;
    fx.size[n] = size;
    n++;
  }
  fx.geo.setDrawRange(0, n);
  fx.geo.attributes.position.needsUpdate = true;
  fx.geo.attributes.rgba.needsUpdate = true;
  fx.geo.attributes.size.needsUpdate = true;
  for (const s of fx.sprites) {
    const show = s.live && s.age >= 0 && (!filterKey || s.key === filterKey);
    s.sprite.visible = show;
    if (!show) continue;
    const u = s.age / s.life;
    const g = s.grow + (1 - s.grow) * u;
    s.sprite.scale.set(s.w * g, s.h * g, 1);
    s.mat.opacity = s.a0 * Math.max(0, 1 - u / s.aEnd);
    if (s.frames) {
      // One row of the sheet, left to right; rows count from the top
      const f = Math.min(s.frames - 1, Math.floor(u * s.frames));
      s.map.offset.set(f * 0.5, 1 - (s.row + 1) * 0.1);
    }
  }
}

// True while any YARG fret effect or fret motion is still playing, so views
// that only redraw while something animates (split view) keep drawing.
function _yargFxBusy() {
  if (_yargFx && (_yargFx.pool.length > 0 || _yargFx.sprites.some(s => s.live))) return true;
  const now = animClock.getElapsedTime();
  for (const key in _yargFretStates) {
    const st = _yargFretStates[key];
    for (const t of st.hitAt) if (t !== undefined && now - t < 0.25) return true;
    for (const t of st.cymAt) if (t !== undefined && now - t < 0.25) return true;
  }
  return false;
}
