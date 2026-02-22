import { ShaderRenderer } from './renderer.js';
import { MaskEditor } from './mask-editor.js';

// DOM Elements
const dropZone = document.getElementById('dropZone');
const imageInput = document.getElementById('imageInput');
const browseBtn = document.getElementById('browseBtn');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const effectDescription = document.getElementById('effectDescription');
const selectionTarget = document.getElementById('selectionTarget');
const generateBtn = document.getElementById('generateBtn');
const generateStatus = document.getElementById('generateStatus');
const intensitySlider = document.getElementById('intensitySlider');
const intensityValue = document.getElementById('intensityValue');
const animateToggle = document.getElementById('animateToggle');
const brushTool = document.getElementById('brushTool');
const eraserTool = document.getElementById('eraserTool');
const quickSelectTool = document.getElementById('quickSelectTool');
const fillMaskBtn = document.getElementById('fillMaskBtn');
const clearMaskBtn = document.getElementById('clearMaskBtn');
const invertMaskBtn = document.getElementById('invertMaskBtn');
const brushSize = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const brushSoftness = document.getElementById('brushSoftness');
const brushSoftnessValue = document.getElementById('brushSoftnessValue');
const brushControls = document.getElementById('brushControls');
const quickSelectControls = document.getElementById('quickSelectControls');
const qsTolerance = document.getElementById('qsTolerance');
const qsToleranceValue = document.getElementById('qsToleranceValue');
const qsGrow = document.getElementById('qsGrow');
const qsGrowValue = document.getElementById('qsGrowValue');
const showMaskToggle = document.getElementById('showMaskToggle');
const aiMaskTarget = document.getElementById('aiMaskTarget');
const aiMaskBtn = document.getElementById('aiMaskBtn');
const aiMaskStatus = document.getElementById('aiMaskStatus');
const saveShaderBtn = document.getElementById('saveShaderBtn');
const downloadBtn = document.getElementById('downloadBtn');
const glCanvas = document.getElementById('glCanvas');
const maskCanvas = document.getElementById('maskCanvas');
const canvasPlaceholder = document.getElementById('canvasPlaceholder');
const canvasWrapper = document.getElementById('canvasWrapper');
const shaderInfo = document.getElementById('shaderInfo');
const currentShaderName = document.getElementById('currentShaderName');
const currentShaderDesc = document.getElementById('currentShaderDesc');
const libraryList = document.getElementById('libraryList');
const saveDialog = document.getElementById('saveDialog');
const saveShaderName = document.getElementById('saveShaderName');
const saveDialogCancel = document.getElementById('saveDialogCancel');
const saveDialogConfirm = document.getElementById('saveDialogConfirm');
const renameDialog = document.getElementById('renameDialog');
const renameInput = document.getElementById('renameInput');
const renameCancel = document.getElementById('renameCancel');
const renameConfirm = document.getElementById('renameConfirm');

// State
let renderer;
let maskEditor;
let loadedImage = null;
let loadedImageFile = null;
let currentShader = null;
let shaderLibrary = [];
let renamingId = null;

// Initialize
function init() {
  renderer = new ShaderRenderer(glCanvas);
  maskEditor = new MaskEditor(maskCanvas, (canvas) => {
    renderer.updateMask(canvas);
  });

  loadLibrary();
  setupEventListeners();
}

// --- Event Listeners ---

function setupEventListeners() {
  // Image upload
  browseBtn.addEventListener('click', () => imageInput.click());
  dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) imageInput.click();
  });

  imageInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleImageFile(file);
  });

  removeImageBtn.addEventListener('click', removeImage);

  // Generate
  generateBtn.addEventListener('click', generateShader);
  effectDescription.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generateShader();
  });
  selectionTarget.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generateShader();
  });

  // Controls
  intensitySlider.addEventListener('input', () => {
    const v = intensitySlider.value / 100;
    intensityValue.textContent = `${intensitySlider.value}%`;
    renderer.setIntensity(v);
  });

  animateToggle.addEventListener('change', () => {
    renderer.setAnimating(animateToggle.checked);
  });

  // Mask tools
  function setMaskTool(mode) {
    maskEditor.setMode(mode);
    brushTool.classList.toggle('active', mode === 'brush');
    eraserTool.classList.toggle('active', mode === 'eraser');
    quickSelectTool.classList.toggle('active', mode === 'quickselect');
    brushControls.hidden = (mode === 'quickselect');
    quickSelectControls.hidden = (mode !== 'quickselect');
  }

  brushTool.addEventListener('click', () => setMaskTool('brush'));
  eraserTool.addEventListener('click', () => setMaskTool('eraser'));
  quickSelectTool.addEventListener('click', () => setMaskTool('quickselect'));

  fillMaskBtn.addEventListener('click', () => maskEditor.fill());
  clearMaskBtn.addEventListener('click', () => maskEditor.clear());
  invertMaskBtn.addEventListener('click', () => maskEditor.invert());

  brushSize.addEventListener('input', () => {
    brushSizeValue.textContent = `${brushSize.value}px`;
    maskEditor.setBrushSize(parseInt(brushSize.value));
  });

  brushSoftness.addEventListener('input', () => {
    brushSoftnessValue.textContent = `${brushSoftness.value}%`;
    maskEditor.setSoftness(parseInt(brushSoftness.value) / 100);
  });

  qsTolerance.addEventListener('input', () => {
    qsToleranceValue.textContent = qsTolerance.value;
    maskEditor.setTolerance(parseInt(qsTolerance.value));
  });

  qsGrow.addEventListener('input', () => {
    qsGrowValue.textContent = `${qsGrow.value}px`;
    maskEditor.setGrowRadius(parseInt(qsGrow.value));
  });

  showMaskToggle.addEventListener('change', () => {
    maskEditor.setVisible(showMaskToggle.checked);
  });

  // AI Mask generation
  aiMaskBtn.addEventListener('click', generateAIMask);
  aiMaskTarget.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      generateAIMask();
    }
  });

  // Save/Download
  saveShaderBtn.addEventListener('click', openSaveDialog);
  downloadBtn.addEventListener('click', downloadResult);

  // Save dialog
  saveDialogCancel.addEventListener('click', () => saveDialog.close());
  saveDialogConfirm.addEventListener('click', confirmSave);
  saveDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmSave();
    }
  });

  // Rename dialog
  renameCancel.addEventListener('click', () => renameDialog.close());
  renameConfirm.addEventListener('click', confirmRename);
  renameDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRename();
    }
  });
}

// --- Image Handling ---

function handleImageFile(file) {
  loadedImageFile = file;
  const url = URL.createObjectURL(file);

  const img = new Image();
  img.onload = () => {
    loadedImage = img;

    // Limit canvas size for performance
    const maxDim = 2048;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    glCanvas.width = w;
    glCanvas.height = h;
    renderer.setImage(img);
    renderer.renderPassthrough();

    maskEditor.resize(w, h);
    maskEditor.setSourceImage(img);
    maskEditor.setActive(true);

    // Show preview
    imagePreview.src = url;
    imagePreviewContainer.hidden = false;
    dropZone.hidden = true;
    canvasPlaceholder.hidden = true;
    glCanvas.style.display = 'block';

    updateActionButtons();
  };
  img.src = url;
}

function removeImage() {
  loadedImage = null;
  loadedImageFile = null;
  imagePreviewContainer.hidden = true;
  dropZone.hidden = false;
  canvasPlaceholder.hidden = false;
  glCanvas.style.display = 'none';
  maskEditor.setActive(false);
  maskEditor.setVisible(false);
  showMaskToggle.checked = false;
  currentShader = null;
  shaderInfo.hidden = true;
  updateActionButtons();
  imageInput.value = '';
}

// --- Shader Generation ---

async function generateShader() {
  const description = effectDescription.value.trim();
  if (!description) {
    showStatus('Please describe the effect you want.', 'error');
    return;
  }

  if (!loadedImage) {
    showStatus('Please upload an image first.', 'error');
    return;
  }

  generateBtn.disabled = true;
  showStatus('<span class="spinner"></span>Generating shader...', 'loading');

  try {
    const formData = new FormData();
    formData.append('description', description);
    const target = selectionTarget.value.trim();
    if (target) {
      formData.append('target', target);
    }
    if (loadedImageFile) {
      formData.append('image', loadedImageFile);
    }

    const res = await fetch('/api/generate-shader', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Generation failed');
    }

    const data = await res.json();

    // Try to compile and apply the shader, auto-fix on failure
    let shaderCode = data.shader;
    try {
      renderer.setShader(shaderCode);
    } catch (compileErr) {
      // Auto-retry: send the broken shader + error to Claude for fixing
      showStatus('<span class="spinner"></span>Shader had a compile error, auto-fixing...', 'loading');
      try {
        const fixRes = await fetch('/api/fix-shader', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shader: shaderCode, error: compileErr.message })
        });
        if (!fixRes.ok) throw new Error('Fix request failed');
        const fixData = await fixRes.json();
        shaderCode = fixData.shader;
        renderer.setShader(shaderCode);
      } catch (retryErr) {
        throw new Error(`Shader compilation failed: ${compileErr.message}`);
      }
    }

    currentShader = {
      code: shaderCode,
      name: data.name,
      description: data.description
    };

    // Update UI
    shaderInfo.hidden = false;
    currentShaderName.textContent = currentShader.name;
    currentShaderDesc.textContent = currentShader.description;

    showStatus('Shader generated and applied!', 'success');
    updateActionButtons();

    // Auto-hide status after a moment
    setTimeout(() => { generateStatus.hidden = true; }, 3000);

  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  } finally {
    generateBtn.disabled = false;
  }
}

function showStatus(msg, type) {
  generateStatus.innerHTML = msg;
  generateStatus.className = `status ${type}`;
  generateStatus.hidden = false;
}

function showMaskStatus(msg, type) {
  aiMaskStatus.innerHTML = msg;
  aiMaskStatus.className = `status ${type}`;
  aiMaskStatus.hidden = false;
}

// --- AI Mask Generation ---

async function generateAIMask() {
  const target = aiMaskTarget.value.trim();
  if (!target) {
    showMaskStatus('Type an object or region to select.', 'error');
    return;
  }
  if (!loadedImage || !loadedImageFile) {
    showMaskStatus('Upload an image first.', 'error');
    return;
  }

  aiMaskBtn.disabled = true;
  showMaskStatus('<span class="spinner"></span>Generating mask...', 'loading');

  try {
    const formData = new FormData();
    formData.append('target', target);
    formData.append('image', loadedImageFile);

    const res = await fetch('/api/generate-mask', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Mask generation failed');
    }

    const data = await res.json();

    // Render the mask shader through WebGL to get pixel data, auto-fix on failure
    let maskShaderCode = data.maskShader;
    let maskResult;
    try {
      maskResult = renderer.renderMaskShader(maskShaderCode);
    } catch (compileErr) {
      showMaskStatus('<span class="spinner"></span>Mask shader had a compile error, auto-fixing...', 'loading');
      try {
        const fixRes = await fetch('/api/fix-shader', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shader: maskShaderCode, error: compileErr.message })
        });
        if (!fixRes.ok) throw new Error('Fix request failed');
        const fixData = await fixRes.json();
        maskShaderCode = fixData.shader;
        maskResult = renderer.renderMaskShader(maskShaderCode);
      } catch (retryErr) {
        throw new Error(`Mask shader failed to compile: ${compileErr.message}`);
      }
    }

    // Write the GL pixels to the mask canvas
    maskEditor.setFromGLPixels(maskResult.pixels, maskResult.width, maskResult.height);

    // Show the mask overlay so the user can see the result
    showMaskToggle.checked = true;
    maskEditor.setVisible(true);

    showMaskStatus(`Selected: "${target}"`, 'success');
    setTimeout(() => { aiMaskStatus.hidden = true; }, 3000);

  } catch (err) {
    showMaskStatus(`Error: ${err.message}`, 'error');
  } finally {
    aiMaskBtn.disabled = false;
  }
}

// --- Shader Library ---

async function loadLibrary() {
  try {
    const res = await fetch('/api/shaders');
    shaderLibrary = await res.json();
    renderLibrary();
  } catch (e) {
    console.error('Failed to load library:', e);
  }
}

function renderLibrary() {
  if (shaderLibrary.length === 0) {
    libraryList.innerHTML = '<p class="empty-state">No saved shaders yet. Generate one and save it to build your library.</p>';
    return;
  }

  libraryList.innerHTML = shaderLibrary.map(shader => `
    <div class="shader-card ${currentShader && currentShader.id === shader.id ? 'active' : ''}" data-id="${shader.id}">
      ${shader.thumbnail
        ? `<img class="shader-card-thumb" src="${shader.thumbnail}" alt="${shader.name}">`
        : '<div class="shader-card-thumb"></div>'
      }
      <div class="shader-card-body">
        <div class="shader-card-name" title="${shader.name}">${shader.name}</div>
        <div class="shader-card-desc" title="${shader.description || ''}">${shader.description || 'Custom shader'}</div>
        <div class="shader-card-actions">
          <button data-action="apply" data-id="${shader.id}">Apply</button>
          <button data-action="rename" data-id="${shader.id}">Rename</button>
          <button data-action="delete" data-id="${shader.id}" class="danger">Delete</button>
        </div>
      </div>
    </div>
  `).join('');

  // Bind library actions
  libraryList.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'apply') applyLibraryShader(id);
      else if (action === 'rename') openRenameDialog(id);
      else if (action === 'delete') deleteShader(id);
    });
  });
}

function applyLibraryShader(id) {
  const shader = shaderLibrary.find(s => s.id === id);
  if (!shader) return;

  if (!loadedImage) {
    showStatus('Upload an image first, then apply a shader from the library.', 'error');
    return;
  }

  try {
    renderer.setShader(shader.code);
    currentShader = { ...shader };

    shaderInfo.hidden = false;
    currentShaderName.textContent = shader.name;
    currentShaderDesc.textContent = shader.description || '';

    updateActionButtons();
    renderLibrary();
  } catch (err) {
    showStatus(`Failed to apply shader: ${err.message}`, 'error');
  }
}

function openSaveDialog() {
  if (!currentShader) return;
  saveShaderName.value = currentShader.name || '';
  saveDialog.showModal();
  saveShaderName.focus();
  saveShaderName.select();
}

async function confirmSave() {
  const name = saveShaderName.value.trim();
  if (!name) return;

  saveDialog.close();

  const thumbnail = renderer.getThumbnailDataURL();

  try {
    const res = await fetch('/api/shaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        code: currentShader.code,
        description: currentShader.description || '',
        thumbnail
      })
    });

    const saved = await res.json();
    currentShader.id = saved.id;
    currentShader.name = saved.name;
    await loadLibrary();
    showStatus('Shader saved to library!', 'success');
    setTimeout(() => { generateStatus.hidden = true; }, 3000);
  } catch (err) {
    showStatus(`Failed to save: ${err.message}`, 'error');
  }
}

function openRenameDialog(id) {
  const shader = shaderLibrary.find(s => s.id === id);
  if (!shader) return;
  renamingId = id;
  renameInput.value = shader.name;
  renameDialog.showModal();
  renameInput.focus();
  renameInput.select();
}

async function confirmRename() {
  const name = renameInput.value.trim();
  if (!name || !renamingId) return;

  renameDialog.close();

  try {
    await fetch(`/api/shaders/${renamingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    await loadLibrary();
  } catch (err) {
    showStatus(`Failed to rename: ${err.message}`, 'error');
  }

  renamingId = null;
}

async function deleteShader(id) {
  if (!confirm('Delete this shader?')) return;

  try {
    await fetch(`/api/shaders/${id}`, { method: 'DELETE' });
    if (currentShader && currentShader.id === id) {
      currentShader = null;
      shaderInfo.hidden = true;
      if (loadedImage) renderer.renderPassthrough();
      updateActionButtons();
    }
    await loadLibrary();
  } catch (err) {
    showStatus(`Failed to delete: ${err.message}`, 'error');
  }
}

// --- Download ---

function downloadResult() {
  if (!renderer || !loadedImage) return;

  const dataUrl = renderer.getCanvasDataURL();
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `shaded-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// --- UI Helpers ---

function updateActionButtons() {
  const hasShader = currentShader && currentShader.code;
  saveShaderBtn.disabled = !hasShader;
  downloadBtn.disabled = !hasShader || !loadedImage;
}

// Start
init();
