// WebGL Shader Renderer for image processing
export class ShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!this.gl) throw new Error('WebGL not supported');

    this.program = null;
    this.imageTexture = null;
    this.maskTexture = null;
    this.animating = false;
    this.startTime = 0;
    this.intensity = 1.0;
    this.frameId = null;
    this.currentShaderCode = null;
    this.imageLoaded = false;

    this._initBuffers();
  }

  _initBuffers() {
    const gl = this.gl;

    // Full-screen quad vertices: position (x, y), texCoord (s, t)
    const vertices = new Float32Array([
      -1, -1,   0, 1,
       1, -1,   1, 1,
      -1,  1,   0, 0,
       1,  1,   1, 0,
    ]);

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Create default white mask texture
    this.maskTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    const white = new Uint8Array([255, 255, 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  _compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${error}`);
    }
    return shader;
  }

  _createProgram(vertexSrc, fragmentSrc) {
    const gl = this.gl;
    const vs = this._compileShader(gl.VERTEX_SHADER, vertexSrc);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, fragmentSrc);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error(`Program link error: ${error}`);
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  setImage(image) {
    const gl = this.gl;

    this.canvas.width = image.naturalWidth || image.width;
    this.canvas.height = image.naturalHeight || image.height;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.imageTexture) gl.deleteTexture(this.imageTexture);

    this.imageTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.imageLoaded = true;

    // If we have a shader loaded, re-render
    if (this.program) this.render();
  }

  updateMask(maskCanvas) {
    const gl = this.gl;

    if (this.maskTexture) gl.deleteTexture(this.maskTexture);

    this.maskTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    if (this.program && this.imageLoaded) this.render();
  }

  // Preprocess shader to fix common GLSL ES 1.0 issues
  _sanitizeShader(source) {
    // Fix common patterns: abs/sign called with int-typed loop variables
    // Wrap int arguments in float() casts: abs(i - center) → abs(float(i - center))
    source = source.replace(
      /\b(abs|sign)\s*\(\s*(\w+\s*-\s*\w+)\s*\)/g,
      (match, fn, args) => `${fn}(float(${args}))`
    );

    // Fix min/max with int arguments: min(a, b) where a,b look like int vars
    // Pattern: min/max(intExpr, intExpr) in loop contexts
    source = source.replace(
      /\b(min|max)\s*\(\s*(\w+\s*[+\-*/]\s*\w+)\s*,\s*(\w+)\s*\)/g,
      (match, fn, arg1, arg2) => `${fn}(float(${arg1}), float(${arg2}))`
    );

    return source;
  }

  setShader(fragmentSource) {
    const gl = this.gl;

    const vertexSrc = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // Sanitize the shader to fix common GLSL ES 1.0 issues
    fragmentSource = this._sanitizeShader(fragmentSource);

    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }

    this.program = this._createProgram(vertexSrc, fragmentSource);
    this.currentShaderCode = fragmentSource;

    // Set up attributes
    gl.useProgram(this.program);

    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    }
    if (texLoc >= 0) {
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
    }

    if (this.imageLoaded) this.render();
  }

  setIntensity(value) {
    this.intensity = value;
    if (this.program && this.imageLoaded) this.render();
  }

  setAnimating(on) {
    this.animating = on;
    if (on) {
      this.startTime = performance.now() / 1000;
      this._animate();
    } else if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  _animate() {
    if (!this.animating) return;
    this.render();
    this.frameId = requestAnimationFrame(() => this._animate());
  }

  render() {
    const gl = this.gl;
    if (!this.program || !this.imageLoaded) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    // Bind image texture
    const imgLoc = gl.getUniformLocation(this.program, 'u_image');
    if (imgLoc) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
      gl.uniform1i(imgLoc, 0);
    }

    // Bind mask texture
    const maskLoc = gl.getUniformLocation(this.program, 'u_mask');
    if (maskLoc) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
      gl.uniform1i(maskLoc, 1);
    }

    // Set uniforms
    const resLoc = gl.getUniformLocation(this.program, 'u_resolution');
    if (resLoc) gl.uniform2f(resLoc, this.canvas.width, this.canvas.height);

    const timeLoc = gl.getUniformLocation(this.program, 'u_time');
    if (timeLoc) gl.uniform1f(timeLoc, this.animating ? (performance.now() / 1000 - this.startTime) : 0.0);

    const intLoc = gl.getUniformLocation(this.program, 'u_intensity');
    if (intLoc) gl.uniform1f(intLoc, this.intensity);

    // Set up attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');

    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    }
    if (texLoc >= 0) {
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Render the current image without any shader (passthrough)
  renderPassthrough() {
    const passthroughShader = `
      precision mediump float;
      uniform sampler2D u_image;
      varying vec2 v_texCoord;
      void main() {
        gl_FragColor = texture2D(u_image, v_texCoord);
      }
    `;
    this.setShader(passthroughShader);
    this.currentShaderCode = null; // Don't count passthrough as a "real" shader
  }

  // Render a mask shader and return the pixel data
  renderMaskShader(fragmentSource) {
    const gl = this.gl;
    const savedShaderCode = this.currentShaderCode;

    // Compile and render the mask shader
    this.setShader(fragmentSource);
    this.render();

    // Read pixels (WebGL gives bottom-to-top)
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Restore previous shader
    if (savedShaderCode) {
      this.setShader(savedShaderCode);
    } else {
      this.renderPassthrough();
    }

    return { pixels, width: w, height: h };
  }

  getCanvasDataURL() {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  getThumbnailDataURL(size = 200) {
    this.render();
    const tmpCanvas = document.createElement('canvas');
    const aspect = this.canvas.width / this.canvas.height;
    if (aspect > 1) {
      tmpCanvas.width = size;
      tmpCanvas.height = Math.round(size / aspect);
    } else {
      tmpCanvas.height = size;
      tmpCanvas.width = Math.round(size * aspect);
    }
    const ctx = tmpCanvas.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0, tmpCanvas.width, tmpCanvas.height);
    return tmpCanvas.toDataURL('image/jpeg', 0.7);
  }
}
