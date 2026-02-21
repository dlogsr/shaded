import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const client = new Anthropic();

const DATA_DIR = join(__dirname, 'data');
const SHADERS_FILE = join(DATA_DIR, 'shaders.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadShaders() {
  if (!existsSync(SHADERS_FILE)) return [];
  return JSON.parse(readFileSync(SHADERS_FILE, 'utf-8'));
}

function saveShaders(shaders) {
  writeFileSync(SHADERS_FILE, JSON.stringify(shaders, null, 2));
}

const SHADER_SYSTEM_PROMPT = `You are a WebGL GLSL shader expert. You generate fragment shaders for image processing effects.

Given an image and a text description of a desired visual effect, generate a WebGL 1.0 compatible fragment shader.

RULES:
1. Use \`precision mediump float;\`
2. Accept these uniforms:
   - \`sampler2D u_image\` — the source image texture
   - \`sampler2D u_mask\` — mask texture (white = apply effect, black = keep original)
   - \`vec2 u_resolution\` — canvas dimensions in pixels
   - \`float u_time\` — elapsed time in seconds (for animations)
   - \`float u_intensity\` — effect strength from 0.0 to 1.0
3. Use \`varying vec2 v_texCoord\` for texture coordinates (0.0 to 1.0)
4. Always sample the mask: \`float mask = texture2D(u_mask, v_texCoord).r;\`
5. Always blend between original and effected color using the mask:
   \`gl_FragColor = vec4(mix(original.rgb, effected.rgb, mask * u_intensity), original.a);\`
6. The shader must compile under WebGL 1.0 (GLSL ES 1.0). No WebGL 2.0 features.
7. For selective/object-based effects, use image analysis techniques in the shader:
   - Color range detection (hue/saturation/brightness thresholds)
   - Position-based selection (e.g., upper region for sky)
   - Luminance-based selection
   - Edge detection (Sobel operator)
   Combine these with the mask for precise targeting.

SELECTION TARGETS:
When a "target" is specified (e.g., "sky", "person", "background", "shadows"), you MUST generate
a selection mask INSIDE the shader that isolates that region. Techniques to use:
- **Sky**: Detect blue hues (hue ~0.55-0.7) in the upper portion of the image. Combine with a vertical gradient.
- **Skin/person/face**: Detect skin-tone hue ranges (~0.0-0.1 in normalized HSV) with moderate saturation.
- **Background**: Use edge detection (Sobel) to find foreground objects, then invert to get background.
- **Shadows/darks**: Select pixels with low luminance (< 0.3).
- **Highlights/bright areas**: Select pixels with high luminance (> 0.7).
- **Midtones**: Select pixels with medium luminance (0.3-0.7).
- **Foliage/grass/trees**: Detect green hues (~0.2-0.45) with moderate saturation.
- **Water**: Detect blue/cyan hues with moderate-high saturation in lower image regions.
- **Warm colors**: Select pixels in the red-yellow hue range.
- **Cool colors**: Select pixels in the blue-cyan hue range.
- **Edges**: Use Sobel operator to detect edges.
- **Any other object**: Analyze the provided image and use the best combination of color, position, and luminance heuristics.

Multiply the computed selection mask with the u_mask uniform to combine AI selection with the user's painted mask:
\`float finalMask = selectionMask * mask * u_intensity;\`
Then blend: \`gl_FragColor = vec4(mix(original.rgb, effected.rgb, finalMask), original.a);\`

When NO target is specified, apply the effect everywhere (controlled only by u_mask and u_intensity as normal).

RESPONSE FORMAT:
Respond with ONLY the fragment shader code wrapped in a code block. No explanations, no vertex shader, just the fragment shader.

\`\`\`glsl
precision mediump float;
// ... your shader code ...
\`\`\``;

// Generate shader from image + description
app.post('/api/generate-shader', upload.single('image'), async (req, res) => {
  try {
    const { description, target } = req.body;
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const messages = [];
    const content = [];

    if (req.file) {
      const base64 = req.file.buffer.toString('base64');
      const mediaType = req.file.mimetype;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 }
      });
    }

    let prompt = `Generate a GLSL fragment shader for this effect: "${description}"`;

    if (target && target.trim()) {
      prompt += `\n\nSELECTION TARGET: "${target.trim()}"\nThe effect must ONLY apply to the specified target. Generate a selection mask inside the shader that isolates "${target.trim()}" using color, position, luminance, and edge detection heuristics. Look at the provided image carefully to determine the best detection strategy for this specific target.`;
    }

    if (req.file) {
      prompt += '\n\nAnalyze the uploaded image to understand its content and tailor the shader accordingly.';
    }

    content.push({ type: 'text', text: prompt });

    messages.push({ role: 'user', content });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: SHADER_SYSTEM_PROMPT,
      messages
    });

    const text = response.content[0].text;

    // Extract shader code from markdown code block
    const codeMatch = text.match(/```(?:glsl)?\s*\n([\s\S]*?)```/);
    const shaderCode = codeMatch ? codeMatch[1].trim() : text.trim();

    // Generate a suggested name from the description
    const suggestedName = description.length > 40
      ? description.substring(0, 40) + '...'
      : description;

    res.json({
      shader: shaderCode,
      name: suggestedName,
      description
    });
  } catch (err) {
    console.error('Shader generation error:', err);
    res.status(500).json({ error: 'Failed to generate shader: ' + err.message });
  }
});

// List all saved shaders
app.get('/api/shaders', (req, res) => {
  res.json(loadShaders());
});

// Save a new shader
app.post('/api/shaders', (req, res) => {
  const { name, code, description, thumbnail } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Name and code are required' });
  }

  const shaders = loadShaders();
  const shader = {
    id: crypto.randomUUID(),
    name,
    code,
    description: description || '',
    thumbnail: thumbnail || null,
    createdAt: new Date().toISOString()
  };
  shaders.push(shader);
  saveShaders(shaders);
  res.json(shader);
});

// Rename a shader
app.put('/api/shaders/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const shaders = loadShaders();
  const shader = shaders.find(s => s.id === req.params.id);
  if (!shader) return res.status(404).json({ error: 'Shader not found' });

  shader.name = name;
  saveShaders(shaders);
  res.json(shader);
});

// Delete a shader
app.delete('/api/shaders/:id', (req, res) => {
  let shaders = loadShaders();
  const idx = shaders.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Shader not found' });

  shaders.splice(idx, 1);
  saveShaders(shaders);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Shaded running at http://localhost:${PORT}`);
});
