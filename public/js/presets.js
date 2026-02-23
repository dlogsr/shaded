// Built-in preset shaders for Shaded
// Each preset follows WebGL 1.0 / GLSL ES 1.0 rules and uses the standard uniforms:
//   u_image, u_mask, u_resolution, u_time, u_intensity, u_param

export const PRESETS = [

  // ─── 1. Extreme Glowing Edges with Lens Flare ─────────────────────────
  {
    id: 'glow-edges',
    name: 'Glowing Edges',
    description: 'Extreme glowing edges with lens flare',
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
varying vec2 v_texCoord;

void main() {
  vec2 px = 1.0 / u_resolution;
  vec4 original = texture2D(u_image, v_texCoord);
  float mask = texture2D(u_mask, v_texCoord).r;

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

  // Boost edges for extreme glow
  edge = pow(clamp(edge * 3.0, 0.0, 1.0), 0.6);

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
      // Quick edge approx for blur samples
      vec4 s2 = texture2D(u_image, v_texCoord + off + px);
      float sl2 = dot(s2.rgb, vec3(0.299, 0.587, 0.114));
      glow += abs(sl - sl2);
    }
  }
  glow = glow / 49.0 * 6.0;
  glow = pow(clamp(glow, 0.0, 1.0), 0.5);

  // Lens flare from image center
  vec2 center = vec2(0.5);
  vec2 toCenter = v_texCoord - center;
  float dist = length(toCenter);
  float flare = 0.0;
  // Radial streak
  for (int i = 1; i <= 8; i++) {
    vec2 samplePos = v_texCoord - toCenter * float(i) * 0.04;
    float s = dot(texture2D(u_image, samplePos).rgb, vec3(0.299, 0.587, 0.114));
    flare += max(s - 0.7, 0.0);
  }
  flare = flare / 8.0 * 2.5;
  vec3 flareColor = vec3(1.0, 0.8, 0.5) * flare * (1.0 - dist);

  // Combine
  vec3 effected = edge * edgeColor * 2.5 + glow * edgeColor * 0.8 + flareColor * 0.6;
  effected = clamp(effected, 0.0, 1.0);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

  // ─── 2. Comic Book ─────────────────────────────────────────────────────
  {
    id: 'comic-book',
    name: 'Comic Book',
    description: 'Halftone dots, outlines, boosted saturation',
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
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

  // --- Halftone dots ---
  float cellSize = 12.0; // Large spacing between dots
  vec2 pixelCoord = v_texCoord * u_resolution;
  vec2 cellCenter = (floor(pixelCoord / cellSize) + 0.5) * cellSize;
  vec2 cellUV = cellCenter / u_resolution;

  // Sample color at cell center
  vec3 cellColor = texture2D(u_image, cellUV).rgb;

  // Luminance determines dot size — darker = bigger dot
  float lum = dot(cellColor, vec3(0.299, 0.587, 0.114));
  // Invert: dark areas get big dots, light areas get small/no dots
  float dotRadius = (1.0 - lum) * cellSize * 0.42;

  // Distance from pixel to cell center
  float d = length(pixelCoord - cellCenter);

  // Sharp circle: inside dot = dark shading, outside = white paper
  float inDot = step(d, dotRadius);

  // Boost saturation and brightness of the cell color
  vec3 hsv = rgb2hsv(cellColor);
  hsv.y = min(hsv.y * 1.6, 1.0);  // Boost saturation
  hsv.z = min(hsv.z * 1.15 + 0.08, 1.0); // Brighter overall
  vec3 boostedColor = hsv2rgb(hsv);

  // Paper white background with colored dots
  vec3 halftone = mix(vec3(1.0), boostedColor * 0.3, inDot);

  // --- Subtle edge outlines ---
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

  // Combine: halftone with subtle dark outlines
  vec3 effected = halftone * (1.0 - outline * 0.7);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

  // ─── 3. Retro Pixelate ──────────────────────────────────────────────────
  {
    id: 'retro-pixelate',
    name: 'Retro Pixelate',
    description: 'Pixelated retro palette with outlined edges',
    paramLabel: 'Rainbow',
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_param;
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

  // Pixelation
  float pixelSize = 8.0;
  vec2 pixelCoord = floor(v_texCoord * u_resolution / pixelSize) * pixelSize;
  vec2 pixelUV = (pixelCoord + pixelSize * 0.5) / u_resolution;
  vec3 color = texture2D(u_image, pixelUV).rgb;

  // Quantize to retro palette (4 levels per channel)
  vec3 quantized = floor(color * 4.0 + 0.5) / 4.0;

  // Rainbow coloration via u_param (0 = none, 1 = full)
  vec3 hsv = rgb2hsv(quantized);
  // Shift hue based on position and boost saturation
  hsv.x = fract(hsv.x + u_param * 0.3 * (v_texCoord.x + v_texCoord.y));
  hsv.y = min(hsv.y + u_param * 0.5, 1.0);
  hsv.z = min(hsv.z + u_param * 0.08, 1.0);
  vec3 rainbowed = hsv2rgb(hsv);
  quantized = mix(quantized, rainbowed, u_param);

  // Edge detection for outlines
  vec2 px = 1.0 / u_resolution;
  float c0 = dot(texture2D(u_image, pixelUV).rgb, vec3(0.299, 0.587, 0.114));
  float cR = dot(texture2D(u_image, pixelUV + vec2(pixelSize * px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float cD = dot(texture2D(u_image, pixelUV + vec2(0.0, pixelSize * px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float edge = abs(c0 - cR) + abs(c0 - cD);
  float outline = smoothstep(0.08, 0.2, edge);

  // Dark outlines on pixel boundaries
  vec3 effected = quantized * (1.0 - outline * 0.8);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

  // ─── 4. Vintage 1950s ──────────────────────────────────────────────────
  {
    id: 'vintage-1950s',
    name: 'Vintage 1950s',
    description: 'Film grain with faded 1950s colors',
    code: `precision mediump float;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
varying vec2 v_texCoord;

// Pseudo-random noise
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 original = texture2D(u_image, v_texCoord);
  float mask = texture2D(u_mask, v_texCoord).r;
  vec3 color = original.rgb;

  // Desaturate toward warm sepia
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 sepia = vec3(lum * 1.05, lum * 0.92, lum * 0.7);
  color = mix(color, sepia, 0.65);

  // Fade blacks — lift shadows (as if the print has faded)
  color = color * 0.8 + vec3(0.12, 0.10, 0.08);

  // Slight warm color cast
  color.r = min(color.r * 1.05, 1.0);
  color.b = color.b * 0.9;

  // Reduce contrast
  color = mix(vec3(0.5), color, 0.85);

  // Film grain
  float grain = rand(v_texCoord * u_resolution + u_time * 100.0) * 0.12 - 0.06;
  color += grain;

  // Vignette
  vec2 vigUV = v_texCoord * (1.0 - v_texCoord);
  float vig = vigUV.x * vigUV.y * 16.0;
  vig = pow(clamp(vig, 0.0, 1.0), 0.3);
  color *= mix(0.6, 1.0, vig);

  vec3 effected = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(mix(original.rgb, effected, mask * u_intensity), original.a);
}`
  },

];
