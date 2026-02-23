// Built-in preset shaders for Shaded
// Each preset follows WebGL 1.0 / GLSL ES 1.0 rules and uses the standard uniforms:
//   u_image, u_mask, u_resolution, u_time, u_intensity, u_param0-u_param3

export const PRESETS = [

  // ─── 1. Extreme Glowing Edges with Lens Flare ─────────────────────────
  {
    id: 'glow-edges',
    name: 'Glowing Edges',
    description: 'Extreme glowing edges with lens flare',
    params: [
      { label: 'Edge Strength', default: 0.5 },
      { label: 'Glow Spread', default: 0.5 },
      { label: 'Flare', default: 0.5 },
    ],
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_param0; // Edge Strength
uniform float u_param1; // Glow Spread
uniform float u_param2; // Flare
varying vec2 v_texCoord;

void main() {
  vec2 px = 1.0 / u_resolution;
  vec4 original = texture2D(u_image, v_texCoord);
  float mask = texture2D(u_mask, v_texCoord).r;

  float edgeMul = 1.0 + u_param0 * 4.0; // 1x to 5x
  float glowMul = 2.0 + u_param1 * 8.0; // 2x to 10x
  float flareMul = 0.2 + u_param2 * 1.0; // 0.2 to 1.2

  // Sobel edge detection
  float tl = dot(texture2D(u_image, v_texCoord + vec2(-px.x, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t  = dot(texture2D(u_image, v_texCoord + vec2( 0.0,  -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float tr = dot(texture2D(u_image, v_texCoord + vec2( px.x, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float l  = dot(texture2D(u_image, v_texCoord + vec2(-px.x,  0.0)).rgb,  vec3(0.299, 0.587, 0.114));
  float r  = dot(texture2D(u_image, v_texCoord + vec2( px.x,  0.0)).rgb,  vec3(0.299, 0.587, 0.114));
  float bl = dot(texture2D(u_image, v_texCoord + vec2(-px.x,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float b  = dot(texture2D(u_image, v_texCoord + vec2( 0.0,   px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float br = dot(texture2D(u_image, v_texCoord + vec2( px.x,  px.y)).rgb, vec3(0.299, 0.587, 0.114));

  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = sqrt(gx*gx + gy*gy);

  // Boost edges with param-driven strength
  edge = pow(clamp(edge * edgeMul, 0.0, 1.0), 0.6);

  // Color the edges based on angle
  float angle = atan(gy, gx);
  vec3 edgeColor = 0.5 + 0.5 * cos(angle + vec3(0.0, 2.094, 4.189));
  edgeColor = mix(vec3(0.3, 0.7, 1.0), edgeColor, 0.6);

  // Glow: multi-sample blur of edges
  float glow = 0.0;
  for (int i = -3; i <= 3; i++) {
    for (int j = -3; j <= 3; j++) {
      vec2 off = vec2(float(i), float(j)) * px * 3.0;
      vec4 s = texture2D(u_image, v_texCoord + off);
      float sl = dot(s.rgb, vec3(0.299, 0.587, 0.114));
      vec4 s2 = texture2D(u_image, v_texCoord + off + px);
      float sl2 = dot(s2.rgb, vec3(0.299, 0.587, 0.114));
      glow += abs(sl - sl2);
    }
  }
  glow = glow / 49.0 * glowMul;
  glow = pow(clamp(glow, 0.0, 1.0), 0.5);

  // Lens flare from image center
  vec2 center = vec2(0.5);
  vec2 toCenter = v_texCoord - center;
  float dist = length(toCenter);
  float flare = 0.0;
  for (int i = 1; i <= 8; i++) {
    vec2 samplePos = v_texCoord - toCenter * float(i) * 0.04;
    float s = dot(texture2D(u_image, samplePos).rgb, vec3(0.299, 0.587, 0.114));
    flare += max(s - 0.7, 0.0);
  }
  flare = flare / 8.0 * 2.5;
  vec3 flareColor = vec3(1.0, 0.8, 0.5) * flare * (1.0 - dist);

  // Combine
  vec3 effected = edge * edgeColor * 2.5 + glow * edgeColor * 0.8 + flareColor * flareMul;
  effected = clamp(effected, 0.0, 1.0);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

  // ─── 2. Comic Book ─────────────────────────────────────────────────────
  {
    id: 'comic-book',
    name: 'Comic Book',
    description: 'Halftone dots, outlines, boosted saturation',
    params: [
      { label: 'Dot Size', default: 0.4 },
      { label: 'Outline', default: 0.5 },
      { label: 'Saturation', default: 0.5 },
    ],
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_param0; // Dot Size
uniform float u_param1; // Outline
uniform float u_param2; // Saturation
varying vec2 v_texCoord;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 original = texture2D(u_image, v_texCoord);
  float mask = texture2D(u_mask, v_texCoord).r;
  vec2 px = 1.0 / u_resolution;

  float cellSize = 4.0 + u_param0 * 20.0; // 4 to 24
  float outlineStr = u_param1; // 0 to 1
  float satBoost = 1.0 + u_param2 * 1.0; // 1x to 2x

  // --- Halftone dots ---
  vec2 pixelCoord = v_texCoord * u_resolution;
  vec2 cellCenter = (floor(pixelCoord / cellSize) + 0.5) * cellSize;
  vec2 cellUV = cellCenter / u_resolution;

  vec3 cellColor = texture2D(u_image, cellUV).rgb;
  float lum = dot(cellColor, vec3(0.299, 0.587, 0.114));
  float dotRadius = (1.0 - lum) * cellSize * 0.42;
  float d = length(pixelCoord - cellCenter);
  float inDot = step(d, dotRadius);

  // Boost saturation and brightness
  vec3 hsv = rgb2hsv(cellColor);
  hsv.y = min(hsv.y * satBoost, 1.0);
  hsv.z = min(hsv.z * 1.15 + 0.08, 1.0);
  vec3 boostedColor = hsv2rgb(hsv);

  vec3 halftone = mix(vec3(1.0), boostedColor * 0.3, inDot);

  // --- Edge outlines ---
  float tl = dot(texture2D(u_image, v_texCoord + vec2(-px.x, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float t  = dot(texture2D(u_image, v_texCoord + vec2( 0.0,  -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float tr = dot(texture2D(u_image, v_texCoord + vec2( px.x, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float l  = dot(texture2D(u_image, v_texCoord + vec2(-px.x,  0.0)).rgb,  vec3(0.299, 0.587, 0.114));
  float r  = dot(texture2D(u_image, v_texCoord + vec2( px.x,  0.0)).rgb,  vec3(0.299, 0.587, 0.114));
  float bl = dot(texture2D(u_image, v_texCoord + vec2(-px.x,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float b  = dot(texture2D(u_image, v_texCoord + vec2( 0.0,   px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float br = dot(texture2D(u_image, v_texCoord + vec2( px.x,  px.y)).rgb, vec3(0.299, 0.587, 0.114));

  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = sqrt(gx*gx + gy*gy);
  float outline = smoothstep(0.15, 0.4, edge);

  vec3 effected = halftone * (1.0 - outline * outlineStr);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

  // ─── 3. Retro Pixelate ──────────────────────────────────────────────────
  {
    id: 'retro-pixelate',
    name: 'Retro Pixelate',
    description: 'Pixelated retro palette with outlined edges',
    params: [
      { label: 'Pixel Size', default: 0.3 },
      { label: 'Rainbow', default: 0.0 },
      { label: 'Color Levels', default: 0.4 },
    ],
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_param0; // Pixel Size
uniform float u_param1; // Rainbow
uniform float u_param2; // Color Levels
varying vec2 v_texCoord;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 original = texture2D(u_image, v_texCoord);
  float mask = texture2D(u_mask, v_texCoord).r;

  float pixelSize = 4.0 + u_param0 * 20.0; // 4 to 24
  float levels = 2.0 + u_param2 * 6.0; // 2 to 8

  // Pixelation
  vec2 pixelCoord = floor(v_texCoord * u_resolution / pixelSize) * pixelSize;
  vec2 pixelUV = (pixelCoord + pixelSize * 0.5) / u_resolution;
  vec3 color = texture2D(u_image, pixelUV).rgb;

  // Quantize to retro palette
  vec3 quantized = floor(color * levels + 0.5) / levels;

  // Rainbow coloration via u_param1 (0 = none, 1 = full)
  vec3 hsv = rgb2hsv(quantized);
  hsv.x = fract(hsv.x + u_param1 * 0.3 * (v_texCoord.x + v_texCoord.y));
  hsv.y = min(hsv.y + u_param1 * 0.5, 1.0);
  hsv.z = min(hsv.z + u_param1 * 0.08, 1.0);
  vec3 rainbowed = hsv2rgb(hsv);
  quantized = mix(quantized, rainbowed, u_param1);

  // Edge detection for outlines
  vec2 px = 1.0 / u_resolution;
  float c0 = dot(texture2D(u_image, pixelUV).rgb, vec3(0.299, 0.587, 0.114));
  float cR = dot(texture2D(u_image, pixelUV + vec2(pixelSize * px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float cD = dot(texture2D(u_image, pixelUV + vec2(0.0, pixelSize * px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float edge = abs(c0 - cR) + abs(c0 - cD);
  float outline = smoothstep(0.08, 0.2, edge);

  vec3 effected = quantized * (1.0 - outline * 0.8);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

  // ─── 4. Vintage 1950s ──────────────────────────────────────────────────
  {
    id: 'vintage-1950s',
    name: 'Vintage 1950s',
    description: 'Film grain with faded 1950s colors',
    params: [
      { label: 'Grain', default: 0.5 },
      { label: 'Fade', default: 0.5 },
      { label: 'Vignette', default: 0.5 },
    ],
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_param0; // Grain
uniform float u_param1; // Fade
uniform float u_param2; // Vignette
varying vec2 v_texCoord;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 original = texture2D(u_image, v_texCoord);
  float mask = texture2D(u_mask, v_texCoord).r;
  vec3 color = original.rgb;

  float grainAmt = u_param0 * 0.2; // 0 to 0.2
  float fadeAmt = u_param1; // 0 to 1
  float vigAmt = u_param2; // 0 to 1

  // Desaturate toward warm sepia
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 sepia = vec3(lum * 1.05, lum * 0.92, lum * 0.7);
  color = mix(color, sepia, 0.65);

  // Fade blacks — lift shadows (param-driven)
  float lift = fadeAmt * 0.25;
  color = color * (1.0 - lift) + vec3(lift * 0.9, lift * 0.8, lift * 0.6);

  // Slight warm color cast
  color.r = min(color.r * 1.05, 1.0);
  color.b = color.b * 0.9;

  // Reduce contrast (more with more fade)
  float contrast = 0.95 - fadeAmt * 0.2;
  color = mix(vec3(0.5), color, contrast);

  // Film grain (param-driven)
  float grain = rand(v_texCoord * u_resolution + u_time * 100.0) * grainAmt * 2.0 - grainAmt;
  color += grain;

  // Vignette (param-driven)
  vec2 vigUV = v_texCoord * (1.0 - v_texCoord);
  float vig = vigUV.x * vigUV.y * 16.0;
  vig = pow(clamp(vig, 0.0, 1.0), 0.3);
  color *= mix(1.0 - vigAmt * 0.5, 1.0, vig);

  vec3 effected = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

];
