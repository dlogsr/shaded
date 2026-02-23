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

// --- SAM 3 / Roboflow integration ---

const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || '';

async function runSAM3(base64Image, prompts, options = {}) {
  if (!ROBOFLOW_API_KEY) throw new Error('ROBOFLOW_API_KEY not set');

  const body = {
    image: { type: 'base64', value: base64Image },
    prompts: prompts.map(text => ({ type: 'text', text })),
    format: 'polygon',
    output_prob_thresh: options.threshold || 0.5
  };

  const res = await fetch(
    `https://serverless.roboflow.com/sam3/concept_segment?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.detail || `Roboflow API error ${res.status}`);
  }

  return await res.json();
}

// Extract normalized (0-1) polygon coordinates from SAM 3 response
function extractPolygons(sam3Result, imageWidth, imageHeight) {
  const polygons = [];
  const results = sam3Result.prompt_results || sam3Result.results || [];

  for (const pr of results) {
    const preds = pr.predictions || [];
    for (const pred of preds) {
      const masks = pred.masks || pred.points || [];
      for (const mask of masks) {
        if (!Array.isArray(mask) || mask.length < 3) continue;
        // Normalize pixel coordinates to 0-1 range
        const normalized = mask.map(pt => [
          pt[0] / imageWidth,
          pt[1] / imageHeight
        ]);
        polygons.push(normalized);
      }
    }
  }

  return polygons;
}

// Parse image dimensions from PNG/JPEG buffer header
function getImageDimensions(buffer, mimetype) {
  if (mimetype === 'image/png') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
    let i = 2;
    while (i < buffer.length - 8) {
      if (buffer[i] === 0xFF) {
        const marker = buffer[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return {
            height: buffer.readUInt16BE(i + 5),
            width: buffer.readUInt16BE(i + 7)
          };
        }
        const segLen = buffer.readUInt16BE(i + 2);
        i += segLen + 2;
      } else {
        i++;
      }
    }
  }
  if (mimetype === 'image/webp') {
    // Simple VP8 header parse for lossy WebP
    if (buffer.toString('ascii', 12, 16) === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3FFF,
        height: buffer.readUInt16LE(28) & 0x3FFF
      };
    }
  }
  throw new Error('Could not determine image dimensions from buffer');
}


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
7. CRITICAL — GLSL ES 1.0 INTEGER RESTRICTIONS:
   - abs(), sign(), min(), max(), clamp(), mod() ONLY accept float/vec types, NEVER int.
   - If you need abs of an int: use \`int a = x >= 0 ? x : -x;\` (ternary, NOT abs()).
   - If you need min/max of ints: use \`int m = a < b ? a : b;\` (ternary, NOT min()/max()).
   - NEVER write abs(intVar), min(intA, intB), max(intA, intB), or clamp(intX, intLo, intHi).
   - For loop index math, cast to float first: \`abs(float(i - center))\`.
   - All arithmetic with these built-in functions MUST use float operands.
8. For selective/object-based effects, use image analysis techniques in the shader:
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

// --- SAM endpoints ---

// Check if SAM is available (Roboflow API key set)
app.get('/api/sam-status', (_req, res) => {
  res.json({ available: !!ROBOFLOW_API_KEY });
});

// Text-based segmentation using SAM 3 via Roboflow
app.post('/api/sam-segment', upload.single('image'), async (req, res) => {
  try {
    if (!ROBOFLOW_API_KEY) {
      return res.status(503).json({ error: 'SAM requires ROBOFLOW_API_KEY environment variable' });
    }

    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!req.file) return res.status(400).json({ error: 'Image is required' });

    const base64 = req.file.buffer.toString('base64');
    const dims = getImageDimensions(req.file.buffer, req.file.mimetype);

    const result = await runSAM3(base64, [prompt.trim()]);
    const polygons = extractPolygons(result, dims.width, dims.height);

    if (polygons.length === 0) throw new Error('No segmentation result — SAM 3 could not find the target');

    res.json({ polygons });
  } catch (err) {
    console.error('SAM segment error:', err);
    res.status(500).json({ error: 'SAM segmentation failed: ' + err.message });
  }
});

// Click-to-segment: identify object at click point via Claude, then segment with SAM 3
app.post('/api/sam-click', upload.single('image'), async (req, res) => {
  try {
    if (!ROBOFLOW_API_KEY) {
      return res.status(503).json({ error: 'SAM requires ROBOFLOW_API_KEY environment variable' });
    }
    if (!req.file) return res.status(400).json({ error: 'Image is required' });

    const { x, y } = req.body; // normalized 0-1 coordinates
    if (x == null || y == null) {
      return res.status(400).json({ error: 'Click coordinates (x, y) are required' });
    }

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;
    const dims = getImageDimensions(req.file.buffer, req.file.mimetype);

    const nx = parseFloat(x);
    const ny = parseFloat(y);

    // Step 1: Ask Claude to identify the object at the click point
    const identifyResponse = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 100,
      system: 'You identify objects in images at specific coordinates. Respond with ONLY the object name (1-3 words, lowercase). No explanation, no punctuation. Examples: "sky", "red car", "person", "tree", "grass", "building".',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `What object or region is at position (${(nx * 100).toFixed(0)}% from left, ${(ny * 100).toFixed(0)}% from top) in this image? Reply with just the object name.` }
        ]
      }]
    });

    const objectName = identifyResponse.content[0].text.trim().toLowerCase();

    // Step 2: Use SAM 3 to get a precise mask for the identified object
    const result = await runSAM3(base64, [objectName]);
    const polygons = extractPolygons(result, dims.width, dims.height);

    if (polygons.length === 0) throw new Error('No mask returned from SAM 3');

    res.json({ polygons, objectName });
  } catch (err) {
    console.error('SAM click error:', err);
    res.status(500).json({ error: 'SAM click-to-segment failed: ' + err.message });
  }
});

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

// Generate a mask by having Claude identify object regions via coordinates
app.post('/api/generate-mask', upload.single('image'), async (req, res) => {
  try {
    const { target } = req.body;
    if (!target || !target.trim()) {
      return res.status(400).json({ error: 'Target object/region is required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Image is required for mask generation' });
    }

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const maskSystemPrompt = `You are an image analysis expert. Given an image and a target object description, you identify the location of that object by outputting polygon coordinates that outline it.

You MUST respond with ONLY a valid JSON object (no markdown, no explanation, no code fences). The JSON format:

{
  "polygons": [
    [[x1, y1], [x2, y2], [x3, y3], ...],
    [[x1, y1], [x2, y2], ...]
  ],
  "confidence": 0.85
}

RULES:
1. All coordinates are NORMALIZED (0.0 to 1.0) relative to image width and height.
   - (0, 0) = top-left corner
   - (1, 1) = bottom-right corner
2. Each polygon is a list of [x, y] points forming a closed shape (the last point connects back to the first).
3. Use enough points to accurately outline the object (typically 8-30 points per polygon).
4. For complex shapes, use multiple polygons. For example, a car might need one polygon for the body.
5. For simple regions like "sky" or "background", use rectangles or simple shapes that cover the region.
6. For "sky": typically the upper portion of the image — use a polygon that follows the horizon line.
7. For "ground"/"floor": typically the lower portion.
8. Be as precise as possible — trace the actual object boundaries you see in the image.
9. confidence is a float 0-1 indicating how confident you are in the selection.
10. Output ONLY the JSON. No explanation, no markdown fences, no extra text.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: maskSystemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          },
          {
            type: 'text',
            text: `Identify and outline "${target.trim()}" in this image. Return polygon coordinates that tightly trace the boundaries of "${target.trim()}". Be precise — follow the actual edges of the object as closely as possible.`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();

    // Parse JSON — strip any accidental markdown fences
    let cleaned = text;
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch) cleaned = jsonMatch[1].trim();

    let maskData;
    try {
      maskData = JSON.parse(cleaned);
    } catch (parseErr) {
      // Try to extract JSON from the response
      const braceMatch = cleaned.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        maskData = JSON.parse(braceMatch[0]);
      } else {
        throw new Error('Could not parse mask response as JSON');
      }
    }

    if (!maskData.polygons || !Array.isArray(maskData.polygons)) {
      throw new Error('Invalid mask response: missing polygons array');
    }

    res.json({ polygons: maskData.polygons, confidence: maskData.confidence || 0 });
  } catch (err) {
    console.error('Mask generation error:', err);
    res.status(500).json({ error: 'Failed to generate mask: ' + err.message });
  }
});

// Auto-fix a shader that failed to compile
app.post('/api/fix-shader', express.json(), async (req, res) => {
  try {
    const { shader, error } = req.body;
    if (!shader || !error) {
      return res.status(400).json({ error: 'Shader code and error message are required' });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: `You are a WebGL GLSL shader expert. You fix broken fragment shaders.

CRITICAL RULES for GLSL ES 1.0:
- abs(), sign(), min(), max(), clamp(), mod() ONLY accept float/vec types, NEVER int.
- If you need abs of an int: use \`int a = x >= 0 ? x : -x;\`
- If you need min/max of ints: use ternary: \`a < b ? a : b\`
- For loop index math, cast to float first: \`abs(float(i))\`
- No WebGL 2.0 features. No integer built-in math functions.

Respond with ONLY the fixed fragment shader code in a code block. No explanations.

\`\`\`glsl
// fixed shader
\`\`\``,
      messages: [{
        role: 'user',
        content: `This GLSL ES 1.0 fragment shader fails to compile with this error:\n\n${error}\n\nFix the shader so it compiles correctly under WebGL 1.0 / GLSL ES 1.0. Here is the broken shader:\n\n\`\`\`glsl\n${shader}\n\`\`\``
      }]
    });

    const text = response.content[0].text;
    const codeMatch = text.match(/```(?:glsl)?\s*\n([\s\S]*?)```/);
    const fixedShader = codeMatch ? codeMatch[1].trim() : text.trim();

    res.json({ shader: fixedShader });
  } catch (err) {
    console.error('Shader fix error:', err);
    res.status(500).json({ error: 'Failed to fix shader: ' + err.message });
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
