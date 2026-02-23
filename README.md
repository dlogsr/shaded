# Shaded

AI-powered image shader editor. Describe a visual effect in plain English and Shaded generates a real-time WebGL fragment shader for it. Combine with AI object segmentation to apply effects selectively to specific regions of your image.

Built using Claude Code by Ryan Dumlao

## Features

- **Text-to-shader generation** — Describe any effect ("vintage sepia with film grain", "cyberpunk neon glow on edges", "tilt-shift blur") and Claude generates a working GLSL fragment shader
- **Selective masking with SAM 3** — Type an object name ("sky", "person", "car") and Segment Anything 3 isolates it so the effect only applies there
- **Click-to-segment** — Click any object in the image and SAM 3 segments it automatically (Claude identifies what you clicked, SAM 3 creates the mask)
- **Manual mask tools** — Brush, eraser, quick select (flood-fill), fill, clear, invert
- **Real-time preview** — Shaders run live in WebGL with adjustable intensity and animation support
- **Shader library** — Save, rename, and reuse your favorite effects
- **Auto-fix** — If a generated shader fails to compile, Claude automatically fixes it

## How It Works

1. Upload an image (PNG, JPG, WebP)
2. Describe the effect you want
3. Optionally specify a target region (e.g. "sky") or use the mask tools to paint one
4. Click **Generate Shader** — Claude analyzes your image and writes a custom GLSL fragment shader
5. Adjust intensity, toggle animation, save to your library

Shaders run entirely client-side in WebGL. The server handles AI calls (Claude for generation, Roboflow SAM 3 for segmentation) and shader library persistence.

## Setup

```bash
git clone <repo-url> && cd shaded
npm install
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for shader generation and object identification |
| `ROBOFLOW_API_KEY` | No | Enables SAM 3 segmentation ([get a free key](https://app.roboflow.com/settings/api)). Without it, masking falls back to Claude polygon estimation. |

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export ROBOFLOW_API_KEY="rf_..."
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set ROBOFLOW_API_KEY=rf_...
railway up
```

## Tech Stack

- **Frontend:** Vanilla JS, WebGL 1.0 (GLSL ES 1.0), Canvas 2D for mask editing
- **Backend:** Node.js, Express
- **AI:** Claude (shader generation, object identification, mask fallback), Roboflow SAM 3 (segmentation)
