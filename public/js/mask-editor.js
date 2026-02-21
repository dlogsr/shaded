// Canvas-based mask editor for selective shader application
export class MaskEditor {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.painting = false;
    this.mode = 'brush'; // 'brush' or 'eraser'
    this.brushSize = 20;
    this.softness = 0.5;
    this.active = false;

    this._bindEvents();
  }

  resize(width, height) {
    // Save current mask data
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

    // Restore if we had data (scale it)
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

  setActive(active) {
    this.active = active;
    this.canvas.classList.toggle('active', active);
  }

  setVisible(visible) {
    this.canvas.classList.toggle('visible', visible);
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
      // Soft brush using radial gradient
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
      // Hard brush
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
      this.painting = true;
      const pos = this._getPos(e);
      lastPos = pos;
      this._paint(pos.x, pos.y);
      this.onChange(this.canvas);
    };

    const paint = (e) => {
      if (!this.painting || !this.active) return;
      e.preventDefault();
      const pos = this._getPos(e);

      // Interpolate between last and current position for smooth strokes
      if (lastPos) {
        const dx = pos.x - lastPos.x;
        const dy = pos.y - lastPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = Math.max(1, this.brushSize / 4);

        if (dist > step) {
          const steps = Math.ceil(dist / step);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            this._paint(
              lastPos.x + dx * t,
              lastPos.y + dy * t
            );
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
