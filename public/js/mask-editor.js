// Canvas-based mask editor for selective shader application
export class MaskEditor {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.painting = false;
    this.mode = 'brush'; // 'brush', 'eraser', 'quickselect', or 'sam'
    this.brushSize = 20;
    this.softness = 0.5;
    this.active = false;

    // Quick-select state
    this.tolerance = 32;
    this.growRadius = 2;
    this.sourceImageData = null;
    this.sourceWidth = 0;
    this.sourceHeight = 0;

    // SAM click callback (set by app.js)
    this.onSamClick = null;

    this._bindEvents();
  }

  resize(width, height) {
    let imageData = null;
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      try {
        imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      } catch (e) { /* empty canvas */ }
    }

    this.canvas.width = width;
    this.canvas.height = height;

    // Fill with white (full effect by default)
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, width, height);

    if (imageData) {
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = imageData.width;
      tmpCanvas.height = imageData.height;
      tmpCanvas.getContext('2d').putImageData(imageData, 0, 0);
      this.ctx.drawImage(tmpCanvas, 0, 0, width, height);
    }
  }

  setMode(mode) {
    this.mode = mode;
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  setSoftness(softness) {
    this.softness = softness;
  }

  setTolerance(val) {
    this.tolerance = val;
  }

  setGrowRadius(val) {
    this.growRadius = val;
  }

  setActive(active) {
    this.active = active;
    this.canvas.classList.toggle('active', active);
  }

  setVisible(visible) {
    this.canvas.classList.toggle('visible', visible);
  }

  // Cache the source image pixel data for quick-select
  setSourceImage(imageElement) {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = this.canvas.width;
    tmpCanvas.height = this.canvas.height;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(imageElement, 0, 0, tmpCanvas.width, tmpCanvas.height);
    this.sourceImageData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
    this.sourceWidth = tmpCanvas.width;
    this.sourceHeight = tmpCanvas.height;
  }

  fill() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.onChange(this.canvas);
  }

  clear() {
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.onChange(this.canvas);
  }

  invert() {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
    this.ctx.putImageData(imageData, 0, 0);
    this.onChange(this.canvas);
  }

  // Render normalized polygons onto the mask canvas as white-on-black
  setFromPolygons(polygons) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    // Start with black (nothing selected)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Draw each polygon as white
    ctx.fillStyle = '#ffffff';
    for (const poly of polygons) {
      if (!poly || poly.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0][0] * w, poly[0][1] * h);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0] * w, poly[i][1] * h);
      }
      ctx.closePath();
      ctx.fill();
    }

    this.onChange(this.canvas);
  }

  // Apply a mask from a data URI image (used by SAM integration)
  setFromImage(dataUri, additive = false) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Draw the incoming mask onto a temp canvas at our dimensions
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.drawImage(img, 0, 0, w, h);
        const incoming = tmpCtx.getImageData(0, 0, w, h);

        if (additive) {
          // Merge: OR the incoming mask with the current mask
          const current = this.ctx.getImageData(0, 0, w, h);
          for (let i = 0; i < current.data.length; i += 4) {
            if (incoming.data[i] > 127) {
              current.data[i] = 255;
              current.data[i + 1] = 255;
              current.data[i + 2] = 255;
            }
          }
          this.ctx.putImageData(current, 0, 0);
        } else {
          // Replace: clear to black then draw the incoming mask
          this.ctx.fillStyle = '#000000';
          this.ctx.fillRect(0, 0, w, h);
          this.ctx.drawImage(img, 0, 0, w, h);
        }

        this.onChange(this.canvas);
        resolve();
      };
      img.onerror = () => reject(new Error('Failed to load mask image'));
      img.src = dataUri;
    });
  }

  // --- Quick Select (flood-fill based) ---

  _quickSelect(x, y, addMode) {
    if (!this.sourceImageData) return;

    const w = this.sourceWidth;
    const h = this.sourceHeight;
    const src = this.sourceImageData.data;
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;

    // Sample the seed color
    const seedIdx = (iy * w + ix) * 4;
    const seedR = src[seedIdx];
    const seedG = src[seedIdx + 1];
    const seedB = src[seedIdx + 2];

    const tol = this.tolerance * this.tolerance * 3; // squared tolerance in RGB space
    const visited = new Uint8Array(w * h);
    const selected = new Uint8Array(w * h);
    const queue = [ix + iy * w];
    visited[ix + iy * w] = 1;

    // BFS flood fill
    while (queue.length > 0) {
      const pos = queue.pop(); // use as stack for DFS (faster)
      const px = pos % w;
      const py = (pos - px) / w;

      const idx = pos * 4;
      const dr = src[idx] - seedR;
      const dg = src[idx + 1] - seedG;
      const db = src[idx + 2] - seedB;
      const distSq = dr * dr + dg * dg + db * db;

      if (distSq <= tol) {
        selected[pos] = 1;

        // Check 4 neighbors
        const neighbors = [];
        if (px > 0) neighbors.push(pos - 1);
        if (px < w - 1) neighbors.push(pos + 1);
        if (py > 0) neighbors.push(pos - w);
        if (py < h - 1) neighbors.push(pos + w);

        for (const npos of neighbors) {
          if (!visited[npos]) {
            visited[npos] = 1;
            queue.push(npos);
          }
        }
      }
    }

    // Grow the selection
    if (this.growRadius > 0) {
      const grown = new Uint8Array(selected);
      const r = this.growRadius;
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          if (selected[gy * w + gx]) {
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy <= r * r) {
                  const nx = gx + dx;
                  const ny = gy + dy;
                  if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    grown[ny * w + nx] = 1;
                  }
                }
              }
            }
          }
        }
      }
      selected.set(grown);
    }

    // Apply to mask canvas
    const maskData = this.ctx.getImageData(0, 0, w, h);
    const md = maskData.data;
    for (let i = 0; i < w * h; i++) {
      if (selected[i]) {
        const mi = i * 4;
        if (addMode) {
          md[mi] = 255;
          md[mi + 1] = 255;
          md[mi + 2] = 255;
        } else {
          md[mi] = 0;
          md[mi + 1] = 0;
          md[mi + 2] = 0;
        }
      }
    }
    this.ctx.putImageData(maskData, 0, 0);
    this.onChange(this.canvas);
  }

  // --- Paint ---

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  _paint(x, y) {
    const ctx = this.ctx;
    const radius = this.brushSize;

    if (this.softness > 0.01) {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const color = this.mode === 'brush' ? '255,255,255' : '0,0,0';
      const innerRadius = 1 - this.softness;
      gradient.addColorStop(0, `rgba(${color},1)`);
      gradient.addColorStop(Math.max(0, innerRadius), `rgba(${color},1)`);
      gradient.addColorStop(1, `rgba(${color},0)`);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = this.mode === 'brush' ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _bindEvents() {
    let lastPos = null;

    const startPaint = (e) => {
      if (!this.active) return;
      e.preventDefault();

      if (this.mode === 'sam') {
        if (this.onSamClick) {
          const pos = this._getPos(e);
          const additive = e.shiftKey;
          // Normalize coordinates to 0-1
          const nx = pos.x / this.canvas.width;
          const ny = pos.y / this.canvas.height;
          this.onSamClick(nx, ny, additive);
        }
        return;
      }

      if (this.mode === 'quickselect') {
        const pos = this._getPos(e);
        const subtract = e.altKey;
        this._quickSelect(pos.x, pos.y, !subtract);
        return;
      }

      this.painting = true;
      const pos = this._getPos(e);
      lastPos = pos;
      this._paint(pos.x, pos.y);
      this.onChange(this.canvas);
    };

    const paint = (e) => {
      if (!this.active) return;
      e.preventDefault();

      if (this.mode === 'quickselect') {
        // Quick-select on drag: sample new seed points as you drag
        if (e.buttons === 1 || (e.touches && e.touches.length > 0)) {
          const pos = this._getPos(e);
          const subtract = e.altKey;
          this._quickSelect(pos.x, pos.y, !subtract);
        }
        return;
      }

      if (!this.painting) return;
      const pos = this._getPos(e);

      if (lastPos) {
        const dx = pos.x - lastPos.x;
        const dy = pos.y - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = Math.max(1, this.brushSize / 4);

        if (dist > step) {
          const steps = Math.ceil(dist / step);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            this._paint(lastPos.x + dx * t, lastPos.y + dy * t);
          }
        }
      }

      this._paint(pos.x, pos.y);
      lastPos = pos;
      this.onChange(this.canvas);
    };

    const stopPaint = () => {
      this.painting = false;
      lastPos = null;
    };

    this.canvas.addEventListener('mousedown', startPaint);
    this.canvas.addEventListener('mousemove', paint);
    window.addEventListener('mouseup', stopPaint);

    this.canvas.addEventListener('touchstart', startPaint, { passive: false });
    this.canvas.addEventListener('touchmove', paint, { passive: false });
    window.addEventListener('touchend', stopPaint);
  }
}
