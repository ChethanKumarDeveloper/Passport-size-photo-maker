/* ═══════════════════════════════════════════════════════════════════════
   PhotoPass Pro — app.js
   Full PWA application: Editor · Enhance · Sheet Generator · Projects
   No external dependencies — Canvas API only
═══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────
   CONSTANTS & CONFIG
───────────────────────────────────────────────────── */
const DPI = 300;
const MM_PER_INCH = 25.4;
const mmToPx = mm => Math.round((mm / MM_PER_INCH) * DPI);

const PRESETS = {
  india_passport: { label: 'India Passport', w: 35, h: 45 },
  visa:           { label: 'Visa Photo',     w: 35, h: 35 },
  aadhaar:        { label: 'Aadhaar',        w: 35, h: 45 },
  pan:            { label: 'PAN Card',       w: 25, h: 35 },
  dl:             { label: 'Driving Licence',w: 35, h: 45 },
  us_passport:    { label: 'US Passport',    w: mmToPx(51)/DPI*25.4, h: mmToPx(51)/DPI*25.4 },
  uk_passport:    { label: 'UK Passport',    w: 35, h: 45 },
  custom:         { label: 'Custom',         w: 35, h: 45 },
};
// Fix US passport (2×2 inch = 50.8mm)
PRESETS.us_passport.w = 50.8;
PRESETS.us_passport.h = 50.8;

const SHEET_SIZES = {
  '4x6':   { wIn: 6, hIn: 4 },
  '5x7':   { wIn: 7, hIn: 5 },
  'a4':    { wIn: 8.27, hIn: 11.69 },
  'a5':    { wIn: 5.83, hIn: 8.27 },
  'letter':{ wIn: 11, hIn: 8.5 },
};

const DB_NAME = 'photopass_projects';

/* ─────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────── */
const state = {
  // Image data
  originalImage: null,         // HTMLImageElement
  originalDataURL: null,
  processedCanvas: null,       // Cropped+BG canvas
  enhancedDataURL: null,
  sheetDataURL: null,

  // Transform
  zoom: 1,
  rotation: 0,
  posX: 0,
  posY: 0,
  flipX: 1,
  flipY: 1,
  bgColor: '#FFFFFF',
  bgBlur: 0,

  // Photo dimensions (mm)
  preset: 'india_passport',
  frameW: mmToPx(35),  // px at 300DPI
  frameH: mmToPx(45),

  // Display scale (canvas display vs actual)
  displayScale: 1,

  // Canvas drag
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  dragOrigin: { x: 0, y: 0 },

  // Enhance values
  enhance: { brightness:0, contrast:0, exposure:0, saturation:0, warmth:0, vibrance:0, sharpness:0, noise:0, redEye:false, skin:false, awb:false },

  // Sheet settings
  sheet: { count:4, cols:2, rows:2, size:'4x6', borderWidth:1, gap:4, showBorder:true, showCropmarks:true, showDashed:true, showRuler:false },
  sheetCustomCols: 3,
  sheetCustomRows: 3,

  // UI state
  showGrid: false,
  showRuler: false,
  currentPanel: 'editor',
  theme: 'dark',
  history: [],
  historyIndex: -1,
  maxHistory: 20,

  // Projects (localStorage)
  projects: [],
};

/* ─────────────────────────────────────────────────────
   DEBOUNCE UTILITY  (module-level — must come before use)
───────────────────────────────────────────────────── */
const _debounceTimers = {};
function debounce(fn, delay) {
  const key = fn.name || fn.toString().slice(0, 30);
  return function(...args) {
    clearTimeout(_debounceTimers[key]);
    _debounceTimers[key] = setTimeout(() => fn.apply(this, args), delay);
  };
}
// Pre-build a stable debounced version of applyEnhance
// (cannot reference applyEnhance yet at this point — declared below)

/* ─────────────────────────────────────────────────────
   DOM HELPERS
───────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function el(sel, ctx = document) { return ctx.querySelector(sel); }

/* ─────────────────────────────────────────────────────
   TOAST NOTIFICATIONS
───────────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = $('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('hiding');
    setTimeout(() => t.remove(), 350);
  }, duration);
}

/* ─────────────────────────────────────────────────────
   LOADING MODAL
───────────────────────────────────────────────────── */
function showLoading(msg = 'Processing…', progress = null) {
  $('loadingModal').hidden = false;
  $('loadingModalText').textContent = msg;
  const bar = $('progressBar');
  if (progress !== null) {
    bar.style.width = progress + '%';
    bar.style.animation = 'none';
  } else {
    bar.style.width = '60%';
    bar.style.animation = '';
  }
}
function hideLoading() { $('loadingModal').hidden = true; }
function updateProgress(p) { $('progressBar').style.width = p + '%'; }

/* ─────────────────────────────────────────────────────
   PWA / SERVICE WORKER
───────────────────────────────────────────────────── */
let deferredInstallPrompt = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('App updated! Refresh to apply.', 'info', 6000);
        }
      });
    });
  }).catch(err => console.warn('[SW] Registration failed:', err));
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem('pwa-dismissed')) {
    $('installBanner').hidden = false;
  }
});
window.addEventListener('appinstalled', () => {
  $('installBanner').hidden = true;
  toast('PhotoPass Pro installed!', 'success');
});

$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') toast('Installing…', 'success');
  deferredInstallPrompt = null;
  $('installBanner').hidden = true;
});
$('dismissInstall').addEventListener('click', () => {
  $('installBanner').hidden = true;
  localStorage.setItem('pwa-dismissed', '1');
});

/* ─────────────────────────────────────────────────────
   PANEL NAVIGATION
───────────────────────────────────────────────────── */
$$('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

function switchPanel(name) {
  $$('.nav-item').forEach(b => b.classList.remove('active'));
  el(`.nav-item[data-panel="${name}"]`)?.classList.add('active');
  $$('.panel').forEach(p => p.classList.remove('active'));
  $(`panel-${name}`)?.classList.add('active');
  state.currentPanel = name;

  if (name === 'enhance' && state.processedCanvas) initEnhancePreviews();
  if (name === 'projects') loadProjects();
}

// Mobile nav
$('mobileNavToggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('mobile-open');
});

/* ─────────────────────────────────────────────────────
   THEME
───────────────────────────────────────────────────── */
function applyTheme(t) {
  state.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('pp-theme', t);
  const icon = $('themeIcon');
  if (t === 'dark') {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  } else {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }
}
$('themeToggle').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
applyTheme(localStorage.getItem('pp-theme') || 'dark');

/* ─────────────────────────────────────────────────────
   PRESET SELECTOR
───────────────────────────────────────────────────── */
$('presetSelect').addEventListener('change', e => {
  const key = e.target.value;
  state.preset = key;
  const p = PRESETS[key];
  const customRow = $('customSizeRow');
  if (key === 'custom') {
    customRow.hidden = false;
    state.frameW = mmToPx(parseFloat($('customW').value) || 35);
    state.frameH = mmToPx(parseFloat($('customH').value) || 45);
  } else {
    customRow.hidden = true;
    state.frameW = mmToPx(p.w);
    state.frameH = mmToPx(p.h);
  }
  updateFrameInfo();
  if (state.originalImage) redrawMainCanvas();
});

['customW','customH'].forEach(id => {
  $(id).addEventListener('input', () => {
    state.frameW = mmToPx(parseFloat($('customW').value) || 35);
    state.frameH = mmToPx(parseFloat($('customH').value) || 45);
    updateFrameInfo();
    if (state.originalImage) redrawMainCanvas();
  });
});

function updateFrameInfo() {
  const p = PRESETS[state.preset];
  const wMm = (state.frameW / DPI * MM_PER_INCH).toFixed(1);
  const hMm = (state.frameH / DPI * MM_PER_INCH).toFixed(1);
  $('infoW').textContent = `${wMm}mm`;
  $('infoH').textContent = `${hMm}mm`;
  $('infoPreset').textContent = p?.label || 'Custom';
}
updateFrameInfo();

/* ─────────────────────────────────────────────────────
   FILE UPLOAD
───────────────────────────────────────────────────── */
const uploadZone = $('uploadZone');
const fileInput  = $('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    toast('Unsupported format. Please use JPG, PNG, or WEBP.', 'error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('File too large. Max 20 MB.', 'warning');
    return;
  }
  showLoading('Loading image…');
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      state.originalImage = img;
      state.originalDataURL = e.target.result;
      state.zoom = 1;
      state.rotation = 0;
      state.posX = 0;
      state.posY = 0;
      state.flipX = 1;
      state.flipY = 1;
      state.history = [];
      state.historyIndex = -1;
      state._enhancedFullCanvas = null;
      state._enhanceDisplaySrc  = null;
      state.enhancedDataURL = null;
      hideLoading();
      showCanvasWorkspace();
      fitImageToFrame();
      redrawMainCanvas();
      pushHistory();          // push initial history state here, directly
      enableExportButtons();
      toast('Photo loaded successfully!', 'success');
    };
    img.onerror = () => { hideLoading(); toast('Failed to load image.', 'error'); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showCanvasWorkspace() {
  $('uploadZone').hidden  = true;
  $('canvasWorkspace').hidden = false;
}

/* ─────────────────────────────────────────────────────
   MAIN CANVAS — DRAW ENGINE
───────────────────────────────────────────────────── */
const mainCanvas = $('mainCanvas');
const ctx = mainCanvas.getContext('2d');

function initMainCanvas() {
  mainCanvas.width  = state.frameW;
  mainCanvas.height = state.frameH;
  computeDisplayScale();
}

function computeDisplayScale() {
  const frame = $('canvasFrame');
  const maxW = (frame.clientWidth  || 600) - 60;
  const maxH = (frame.clientHeight || 500) - 60;
  if (maxW <= 0 || maxH <= 0) { state.displayScale = 0.5; return; }
  state.displayScale = Math.min(maxW / state.frameW, maxH / state.frameH, 1);
  mainCanvas.style.width  = Math.round(state.frameW  * state.displayScale) + 'px';
  mainCanvas.style.height = Math.round(state.frameH * state.displayScale) + 'px';
}

function fitImageToFrame() {
  if (!state.originalImage) return;
  const img = state.originalImage;
  const scaleW = state.frameW  / img.width;
  const scaleH = state.frameH / img.height;
  state.zoom   = Math.max(scaleW, scaleH) * 100;
  state.posX   = 0;
  state.posY   = 0;
  state.rotation = 0;
  syncSliders();
}

function redrawMainCanvas() {
  if (!state.originalImage) return;
  initMainCanvas();
  const img = state.originalImage;
  const W = state.frameW;
  const H = state.frameH;

  // Clear with background color
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, W, H);

  // Save state
  ctx.save();
  ctx.translate(W / 2 + state.posX, H / 2 + state.posY);
  ctx.rotate(state.rotation * Math.PI / 180);
  ctx.scale(state.flipX * (state.zoom / 100), state.flipY * (state.zoom / 100));

  // Apply background blur if needed (draw blurred bg first)
  if (state.bgBlur > 0) {
    ctx.filter = `blur(${state.bgBlur}px)`;
  }

  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.filter = 'none';
  ctx.restore();

  // Grid overlay
  if (state.showGrid) drawGrid();

  // Frame border (1px)
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);

  // Guide lines (rule of thirds)
  if (state.showGrid) drawGuides();

  // Capture processed canvas
  state.processedCanvas = cloneCanvas(mainCanvas);
  $('zoomIndicator').textContent = Math.round(state.zoom) + '%';
}

function drawGrid() {
  const W = state.frameW, H = state.frameH;
  ctx.strokeStyle = 'rgba(99,102,241,0.2)';
  ctx.lineWidth = 0.5;
  const step = Math.min(W, H) / 6;
  for (let x = step; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  }
  for (let y = step; y < H; y += step) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }
}

function drawGuides() {
  const W = state.frameW, H = state.frameH;
  ctx.strokeStyle = 'rgba(255,200,0,0.3)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4,4]);
  [W/3, 2*W/3].forEach(x => { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); });
  [H/3, 2*H/3].forEach(y => { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); });
  ctx.setLineDash([]);
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/* ─────────────────────────────────────────────────────
   SLIDERS & CONTROLS — EDITOR
───────────────────────────────────────────────────── */
function syncSliders() {
  $('zoomSlider').value = state.zoom;
  $('rotSlider').value  = state.rotation;
  $('posXSlider').value = state.posX;
  $('posYSlider').value = state.posY;
  $('zoomVal').textContent = Math.round(state.zoom);
  $('rotVal').textContent  = Math.round(state.rotation);
  $('posXVal').textContent = Math.round(state.posX);
  $('posYVal').textContent = Math.round(state.posY);
}

function bindSlider(id, stateKey, valId, onUpdate) {
  $(id).addEventListener('input', function() {
    state[stateKey] = parseFloat(this.value);
    $(valId).textContent = Math.round(state[stateKey]);
    if (onUpdate) onUpdate();
  });
}

bindSlider('zoomSlider','zoom','zoomVal', redrawMainCanvas);
bindSlider('rotSlider','rotation','rotVal', redrawMainCanvas);
bindSlider('posXSlider','posX','posXVal', redrawMainCanvas);
bindSlider('posYSlider','posY','posYVal', redrawMainCanvas);

$('bgBlur').addEventListener('input', function() {
  state.bgBlur = parseInt(this.value);
  $('blurVal').textContent = state.bgBlur;
  if (state.originalImage) redrawMainCanvas();
});

/* ─────────────────────────────────────────────────────
   BACKGROUND COLOR
───────────────────────────────────────────────────── */
$$('.bg-swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    if (sw.id === 'customBgBtn') {
      $('customBgColor').click();
      return;
    }
    $$('.bg-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    state.bgColor = sw.dataset.bg;
    if (state.originalImage) redrawMainCanvas();
  });
});

$('customBgColor').addEventListener('input', e => {
  $$('.bg-swatch').forEach(s => s.classList.remove('active'));
  $('customBgBtn').classList.add('active');
  state.bgColor = e.target.value;
  if (state.originalImage) redrawMainCanvas();
});

/* ─────────────────────────────────────────────────────
   BACKGROUND REMOVAL (simple threshold-based)
───────────────────────────────────────────────────── */
$('removeBgBtn').addEventListener('click', () => {
  if (!state.originalImage) { toast('Upload an image first.', 'warning'); return; }
  showLoading('Removing background… (simple edge detection)', 20);

  setTimeout(() => {
    try {
      const img = state.originalImage;
      const W = img.width, H = img.height;
      const offscreen = document.createElement('canvas');
      offscreen.width = W; offscreen.height = H;
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(img, 0, 0);

      updateProgress(40);
      const imageData = offCtx.getImageData(0, 0, W, H);
      const data = imageData.data;

      // Sample background color from corners (top-left 5×5 average)
      let rSum=0,gSum=0,bSum=0,samples=0;
      for (let sy=0;sy<5;sy++) for (let sx=0;sx<5;sx++) {
        const i=(sy*W+sx)*4;
        rSum+=data[i]; gSum+=data[i+1]; bSum+=data[i+2]; samples++;
      }
      const bgR=rSum/samples, bgG=gSum/samples, bgB=bSum/samples;
      const threshold = 35;

      for (let i=0;i<data.length;i+=4) {
        const dr=Math.abs(data[i]-bgR), dg=Math.abs(data[i+1]-bgG), db=Math.abs(data[i+2]-bgB);
        if (dr<threshold && dg<threshold && db<threshold) {
          // Parse background color
          const parsed = hexToRgb(state.bgColor);
          data[i]   = parsed.r;
          data[i+1] = parsed.g;
          data[i+2] = parsed.b;
          data[i+3] = 255;
        }
      }
      updateProgress(80);
      offCtx.putImageData(imageData, 0, 0);

      // Replace originalImage with processed
      const newImg = new Image();
      newImg.onload = () => {
        state.originalImage = newImg;
        updateProgress(100);
        setTimeout(() => {
          hideLoading();
          redrawMainCanvas();
          toast('Background removed!', 'success');
        }, 200);
      };
      newImg.src = offscreen.toDataURL('image/png');
    } catch (err) {
      hideLoading();
      toast('Background removal failed: ' + err.message, 'error');
    }
  }, 100);
});

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)||255;
  const g = parseInt(hex.slice(3,5),16)||255;
  const b = parseInt(hex.slice(5,7),16)||255;
  return {r,g,b};
}

/* ─────────────────────────────────────────────────────
   TOOLBAR BUTTONS
───────────────────────────────────────────────────── */
$('toolZoomIn').addEventListener('click',  () => { state.zoom = Math.min(state.zoom+15, 300); syncSliders(); redrawMainCanvas(); });
$('toolZoomOut').addEventListener('click', () => { state.zoom = Math.max(state.zoom-15, 10);  syncSliders(); redrawMainCanvas(); });
$('toolFit').addEventListener('click',     () => { fitImageToFrame(); syncSliders(); redrawMainCanvas(); });
$('toolRotLeft').addEventListener('click', () => {
  state.rotation = (state.rotation - 90 + 360) % 360;
  if (state.rotation > 180) state.rotation -= 360;
  syncSliders(); redrawMainCanvas();
});
$('toolRotRight').addEventListener('click', () => {
  state.rotation = (state.rotation + 90) % 360;
  if (state.rotation > 180) state.rotation -= 360;
  syncSliders(); redrawMainCanvas();
});
$('toolFlipH').addEventListener('click', () => { state.flipX *= -1; redrawMainCanvas(); });
$('toolFlipV').addEventListener('click', () => { state.flipY *= -1; redrawMainCanvas(); });

$('toolGrid').addEventListener('click', function() {
  state.showGrid = !state.showGrid;
  this.classList.toggle('active', state.showGrid);
  redrawMainCanvas();
});

$('toolRuler').addEventListener('click', function() {
  state.showRuler = !state.showRuler;
  this.classList.toggle('active', state.showRuler);
  $('rulerRow').hidden   = !state.showRuler;
  $('rulerColWrap').hidden = !state.showRuler;
  if (state.showRuler) drawRulers();
});

$('resetPhoto').addEventListener('click', () => {
  if (!state.originalImage) return;
  fitImageToFrame();
  state.flipX = 1; state.flipY = 1;
  syncSliders();
  redrawMainCanvas();
  toast('Photo reset.', 'info');
});

$('autoAlign').addEventListener('click', () => {
  if (!state.originalImage) return;
  // Auto center: reset position, apply best fit
  fitImageToFrame();
  state.rotation = 0;
  syncSliders();
  redrawMainCanvas();
  toast('Photo auto-centered.', 'success');
});

/* ─────────────────────────────────────────────────────
   CANVAS DRAG TO PAN
───────────────────────────────────────────────────── */
const canvasFrame = $('canvasFrame');
canvasFrame.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  state.isDragging = true;
  state.dragStart  = { x: e.clientX, y: e.clientY };
  state.dragOrigin = { x: state.posX, y: state.posY };
});
window.addEventListener('mousemove', e => {
  if (!state.isDragging) return;
  const dx = (e.clientX - state.dragStart.x) / state.displayScale;
  const dy = (e.clientY - state.dragStart.y) / state.displayScale;
  state.posX = state.dragOrigin.x + dx;
  state.posY = state.dragOrigin.y + dy;
  $('posXSlider').value = state.posX;
  $('posYSlider').value = state.posY;
  $('posXVal').textContent = Math.round(state.posX);
  $('posYVal').textContent = Math.round(state.posY);
  redrawMainCanvas();
});
window.addEventListener('mouseup',   () => { state.isDragging = false; });

// Pinch-zoom / mouse wheel
canvasFrame.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -8 : 8;
  state.zoom = Math.max(10, Math.min(300, state.zoom + delta));
  $('zoomSlider').value = state.zoom;
  $('zoomVal').textContent = Math.round(state.zoom);
  redrawMainCanvas();
}, { passive: false });

/* ─────────────────────────────────────────────────────
   RULERS (canvas rulers)
───────────────────────────────────────────────────── */
function drawRulers() {
  const hCanvas = $('rulerH');
  const vCanvas = $('rulerV');
  const frameEl = $('canvasFrame');

  hCanvas.width  = frameEl.clientWidth - 20;
  hCanvas.height = 20;
  vCanvas.width  = 20;
  vCanvas.height = frameEl.clientHeight;

  const hCtx = hCanvas.getContext('2d');
  const vCtx = vCanvas.getContext('2d');
  const isDark = state.theme === 'dark';
  const textColor = isDark ? '#888' : '#666';
  const bgColor   = isDark ? '#16161f' : '#fff';
  const tickColor = isDark ? '#444' : '#ccc';

  [hCtx, vCtx].forEach(c => { c.fillStyle = bgColor; c.fillRect(0,0,c.canvas.width,c.canvas.height); });

  // Horizontal ruler (mm units)
  const pxPerMm = (state.frameW * state.displayScale) / (state.frameW / DPI * MM_PER_INCH);
  for (let mm=0; mm<=100; mm++) {
    const x = mm * pxPerMm;
    const isMajor = mm % 5 === 0;
    hCtx.fillStyle = tickColor;
    hCtx.fillRect(x, isMajor?8:12, 1, isMajor?12:8);
    if (isMajor && mm>0) {
      hCtx.fillStyle = textColor;
      hCtx.font = '9px Outfit, sans-serif';
      hCtx.fillText(mm+'mm', x+2, 10);
    }
  }

  // Vertical ruler
  const pxPerMmV = (state.frameH * state.displayScale) / (state.frameH / DPI * MM_PER_INCH);
  for (let mm=0; mm<=100; mm++) {
    const y = mm * pxPerMmV;
    const isMajor = mm % 5 === 0;
    vCtx.fillStyle = tickColor;
    vCtx.fillRect(isMajor?8:12, y, isMajor?12:8, 1);
    if (isMajor && mm>0) {
      vCtx.save();
      vCtx.fillStyle = textColor;
      vCtx.font = '9px Outfit, sans-serif';
      vCtx.translate(10, y-2);
      vCtx.rotate(-Math.PI/2);
      vCtx.fillText(mm+'mm', 0, 0);
      vCtx.restore();
    }
  }
}

/* ─────────────────────────────────────────────────────
   PANEL: ENHANCE
───────────────────────────────────────────────────── */
// Max display size for enhance canvases (avoids UI freeze on 300DPI canvas)
const ENHANCE_MAX = 600;

function getEnhanceDisplayCanvas() {
  // Return a display-resolution copy of processedCanvas (max 600px side)
  const src = state.processedCanvas;
  if (!src) return null;
  const scale = Math.min(1, ENHANCE_MAX / Math.max(src.width, src.height));
  const w = Math.round(src.width  * scale);
  const h = Math.round(src.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return c;
}

function initEnhancePreviews() {
  if (!state.processedCanvas) {
    toast('Edit a photo in the Editor first.', 'warning');
    return;
  }
  addEnhanceBadges();   // inject ORIGINAL / ENHANCED labels once

  const display = getEnhanceDisplayCanvas();
  if (!display) return;

  // Store display-res source for fast enhance previews
  state._enhanceDisplaySrc = display;

  ['Before','After'].forEach(name => {
    const c = $(`enhance${name}`);
    c.width  = display.width;
    c.height = display.height;
    c.getContext('2d').drawImage(display, 0, 0);
    c.classList.add('preview-active');
  });
  // Run enhance on display-res (fast)
  applyEnhance();
}

function applyEnhance() {
  if (!state.processedCanvas) return;

  // Use display-res source for preview (fast, no UI freeze)
  const src = state._enhanceDisplaySrc || state.processedCanvas;
  const after = $('enhanceAfter');
  const processing = $('enhanceProcessing');

  // Show processing spinner
  if (processing) processing.hidden = false;

  // Use setTimeout to let the browser paint the spinner first
  setTimeout(() => {
    try {
      after.width  = src.width;
      after.height = src.height;
      const outCtx = after.getContext('2d');
      outCtx.drawImage(src, 0, 0);

      let iData = outCtx.getImageData(0, 0, src.width, src.height);
      const e = state.enhance;

      if (e.awb) iData = autoWhiteBalance(iData);
      if (e.brightness !== 0 || e.exposure !== 0) iData = adjustBrightness(iData, e.brightness + e.exposure * 1.5);
      if (e.contrast   !== 0) iData = adjustContrast(iData, e.contrast);
      if (e.saturation !== 0) iData = adjustSaturation(iData, e.saturation);
      if (e.warmth     !== 0) iData = adjustWarmth(iData, e.warmth);
      if (e.vibrance   !== 0) iData = adjustVibrance(iData, e.vibrance);

      outCtx.putImageData(iData, 0, 0);

      if (e.sharpness > 0) unsharpMask(outCtx, src.width, src.height, e.sharpness);

      // Save preview data URL (display-res)
      state.enhancedDataURL = after.toDataURL('image/jpeg', 0.95);

      // Also apply to full-res processedCanvas for export quality (async)
      applyEnhanceFullRes();
    } catch(err) {
      console.error('Enhance error:', err);
      toast('Enhancement failed: ' + err.message, 'error');
    } finally {
      if (processing) processing.hidden = true;
    }
  }, 20);
}

function applyEnhanceFullRes() {
  // Apply enhancements to the full 300DPI canvas for actual export
  // Done asynchronously so it doesn't block UI
  if (!state.processedCanvas) return;
  const src = state.processedCanvas;
  const offscreen = document.createElement('canvas');
  offscreen.width  = src.width;
  offscreen.height = src.height;
  const oCtx = offscreen.getContext('2d');
  oCtx.drawImage(src, 0, 0);

  const e = state.enhance;
  let iData = oCtx.getImageData(0, 0, src.width, src.height);
  if (e.awb) iData = autoWhiteBalance(iData);
  if (e.brightness !== 0 || e.exposure !== 0) iData = adjustBrightness(iData, e.brightness + e.exposure * 1.5);
  if (e.contrast   !== 0) iData = adjustContrast(iData, e.contrast);
  if (e.saturation !== 0) iData = adjustSaturation(iData, e.saturation);
  if (e.warmth     !== 0) iData = adjustWarmth(iData, e.warmth);
  if (e.vibrance   !== 0) iData = adjustVibrance(iData, e.vibrance);
  oCtx.putImageData(iData, 0, 0);
  if (e.sharpness > 0) unsharpMask(oCtx, src.width, src.height, e.sharpness);

  // Store as the enhanced canvas for sheet generation & export
  state._enhancedFullCanvas = offscreen;
  state.enhancedDataURL = offscreen.toDataURL('image/jpeg', 0.95);
}

// Pixel helpers
function adjustBrightness(imgData, v) {
  const d = imgData.data; const p = v * 2.55;
  for (let i=0;i<d.length;i+=4) { d[i]=clamp(d[i]+p); d[i+1]=clamp(d[i+1]+p); d[i+2]=clamp(d[i+2]+p); }
  return imgData;
}
function adjustContrast(imgData, v) {
  const d = imgData.data;
  const f = (259*(v+255))/(255*(259-v));
  for (let i=0;i<d.length;i+=4) {
    d[i]=clamp(f*(d[i]-128)+128); d[i+1]=clamp(f*(d[i+1]-128)+128); d[i+2]=clamp(f*(d[i+2]-128)+128);
  }
  return imgData;
}
function adjustSaturation(imgData, v) {
  const d = imgData.data; const s = v/100;
  for (let i=0;i<d.length;i+=4) {
    const g = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    d[i]=clamp(g+(d[i]-g)*(1+s)); d[i+1]=clamp(g+(d[i+1]-g)*(1+s)); d[i+2]=clamp(g+(d[i+2]-g)*(1+s));
  }
  return imgData;
}
function adjustWarmth(imgData, v) {
  const d = imgData.data;
  for (let i=0;i<d.length;i+=4) {
    d[i]   = clamp(d[i]   + v * 2);
    d[i+2] = clamp(d[i+2] - v * 1.5);
  }
  return imgData;
}
function adjustVibrance(imgData, v) {
  const d = imgData.data; const a = v / 100;
  for (let i=0;i<d.length;i+=4) {
    const max = Math.max(d[i],d[i+1],d[i+2]);
    const avg = (d[i]+d[i+1]+d[i+2])/3;
    const sat = (max-avg)/255;
    const boost = a*(1-sat);
    d[i]=clamp(d[i]+boost*(d[i]-avg)); d[i+1]=clamp(d[i+1]+boost*(d[i+1]-avg)); d[i+2]=clamp(d[i+2]+boost*(d[i+2]-avg));
  }
  return imgData;
}
function autoWhiteBalance(imgData) {
  const d = imgData.data;
  let rS=0,gS=0,bS=0,n=d.length/4;
  for (let i=0;i<d.length;i+=4) { rS+=d[i]; gS+=d[i+1]; bS+=d[i+2]; }
  const rA=rS/n,gA=gS/n,bA=bS/n;
  const gray=(rA+gA+bA)/3;
  const rF=gray/rA,gF=gray/gA,bF=gray/bA;
  for (let i=0;i<d.length;i+=4) { d[i]=clamp(d[i]*rF); d[i+1]=clamp(d[i+1]*gF); d[i+2]=clamp(d[i+2]*bF); }
  return imgData;
}
function unsharpMask(ctx, W, H, amount) {
  const original = ctx.getImageData(0,0,W,H);
  const blurred  = ctx.getImageData(0,0,W,H);
  boxBlur(blurred,W,H);
  const o=original.data, b=blurred.data;
  for (let i=0;i<o.length;i+=4) {
    o[i]  =clamp(o[i]  +(o[i]  -b[i])  *amount*0.3);
    o[i+1]=clamp(o[i+1]+(o[i+1]-b[i+1])*amount*0.3);
    o[i+2]=clamp(o[i+2]+(o[i+2]-b[i+2])*amount*0.3);
  }
  ctx.putImageData(original,0,0);
}
function boxBlur(imgData,W,H) {
  const d=imgData.data.slice(),o=imgData.data;
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
    let r=0,g=0,b=0;
    for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++) {
      const i=((y+ky)*W+(x+kx))*4; r+=d[i]; g+=d[i+1]; b+=d[i+2];
    }
    const idx=(y*W+x)*4; o[idx]=r/9; o[idx+1]=g/9; o[idx+2]=b/9;
  }
}
function clamp(v) { return Math.max(0,Math.min(255,Math.round(v))); }

// Bind enhance sliders — use a stable debounced applyEnhance
const debouncedApplyEnhance = debounce(applyEnhance, 150);

[
  ['eBrightness','brightness','ebrVal'],
  ['eContrast','contrast','ecoVal'],
  ['eExposure','exposure','eexVal'],
  ['eSaturation','saturation','esaVal'],
  ['eWarmth','warmth','ewaVal'],
  ['eVibrance','vibrance','eviVal'],
  ['eSharpness','sharpness','eshVal'],
  ['eNoise','noise','enrVal'],
].forEach(([sliderId, key, valId]) => {
  $(sliderId).addEventListener('input', function() {
    state.enhance[key] = parseFloat(this.value);
    $(valId).textContent = this.value;
    debouncedApplyEnhance();  // ← use stable reference, not debounce(fn)() each time
  });
});

['redEyeToggle','skinToggle','awbToggle'].forEach(id => {
  $(id).addEventListener('change', function() {
    const map = { redEyeToggle:'redEye', skinToggle:'skin', awbToggle:'awb' };
    state.enhance[map[id]] = this.checked;
    applyEnhance();
  });
});

$('autoEnhanceAll').addEventListener('click', () => {
  const vals = { brightness:10, contrast:15, exposure:5, saturation:8, warmth:8, vibrance:10, sharpness:3, noise:0 };
  Object.entries(vals).forEach(([k,v]) => {
    state.enhance[k] = v;
    const map = { brightness:'eBrightness',contrast:'eContrast',exposure:'eExposure',saturation:'eSaturation',warmth:'eWarmth',vibrance:'eVibrance',sharpness:'eSharpness',noise:'eNoise' };
    const valMap = { brightness:'ebrVal',contrast:'ecoVal',exposure:'eexVal',saturation:'esaVal',warmth:'ewaVal',vibrance:'eviVal',sharpness:'eshVal',noise:'enrVal' };
    if (map[k]) { $(map[k]).value = v; $(valMap[k]).textContent = v; }
  });
  state.enhance.awb = true;
  $('awbToggle').checked = true;
  applyEnhance();
  toast('Auto enhancement applied!', 'success');
});

$('resetEnhance').addEventListener('click', () => {
  Object.keys(state.enhance).forEach(k => { state.enhance[k] = (typeof state.enhance[k]==='boolean') ? false : 0; });
  [['eBrightness','ebrVal'],['eContrast','ecoVal'],['eExposure','eexVal'],['eSaturation','esaVal'],['eWarmth','ewaVal'],['eVibrance','eviVal'],['eSharpness','eshVal'],['eNoise','enrVal']].forEach(([sid,vid]) => { $(sid).value=0; $(vid).textContent=0; });
  ['redEyeToggle','skinToggle','awbToggle'].forEach(id => { $(id).checked = false; });
  applyEnhance();
  toast('Enhancements reset.', 'info');
});

$('previewToggle').addEventListener('change', function() {
  $('enhanceBefore').classList.toggle('preview-active', !this.checked);
  $('enhanceAfter').classList.toggle('preview-active',  this.checked);
});

/* ─────────────────────────────────────────────────────
   SHEET GENERATOR
───────────────────────────────────────────────────── */
// Populate layout previews with grid divs
document.querySelectorAll('.layout-preview').forEach(lp => {
  const rows = parseInt(lp.style.getPropertyValue('--r')) || (lp.className.includes('rows-2')?2:lp.className.includes('rows-3')?3:lp.className.includes('rows-4')?4:2);
  const cols = parseInt(lp.style.getPropertyValue('--c')) || (lp.className.includes('cols-2')?2:lp.className.includes('cols-3')?3:lp.className.includes('cols-4')?4:2);
  if (!lp.classList.contains('custom-icon')) {
    lp.innerHTML = '';
    for (let i=0;i<rows*cols;i++) {
      const cell = document.createElement('div');
      cell.style.cssText = 'background:currentColor;opacity:.4;border-radius:1px;';
      lp.appendChild(cell);
    }
  }
});

$$('.layout-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.layout-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const count = btn.dataset.count;
    if (count === 'custom') {
      $('customLayoutRow').hidden = false;
      state.sheet.cols = parseInt($('customCols').value)||3;
      state.sheet.rows = parseInt($('customRows').value)||3;
      state.sheet.count = state.sheet.cols * state.sheet.rows;
    } else {
      $('customLayoutRow').hidden = true;
      state.sheet.count = parseInt(count);
      state.sheet.cols  = parseInt(btn.dataset.cols);
      state.sheet.rows  = Math.ceil(state.sheet.count / state.sheet.cols);
    }
  });
});

['customCols','customRows'].forEach(id => {
  $(id).addEventListener('input', () => {
    state.sheet.cols  = parseInt($('customCols').value)||3;
    state.sheet.rows  = parseInt($('customRows').value)||3;
    state.sheet.count = state.sheet.cols * state.sheet.rows;
  });
});

$('sheetSizeSelect').addEventListener('change', e => { state.sheet.size = e.target.value; });

// Cutting guide toggles
[['guidesBorder','showBorder'],['guidesCropmarks','showCropmarks'],['guidesDashed','showDashed'],['guidesRuler','showRuler']].forEach(([id,key]) => {
  $(id).addEventListener('change', function() { state.sheet[key] = this.checked; });
});

$('borderWidthSlider').addEventListener('input', function() {
  state.sheet.borderWidth = parseInt(this.value);
  $('borderWidthVal').textContent = this.value;
});
$('gapSlider').addEventListener('input', function() {
  state.sheet.gap = parseInt(this.value);
  $('gapVal').textContent = this.value;
});

$('generateSheet').addEventListener('click', () => {
  if (!state.processedCanvas && !state.originalImage) {
    toast('Please upload a photo first.', 'warning');
    return;
  }
  showLoading('Generating print sheet…', 10);
  setTimeout(() => generateSheet(), 50);
});

function generateSheet() {
  const ss    = SHEET_SIZES[state.sheet.size];
  const sheetW = Math.round(ss.wIn * DPI);
  const sheetH = Math.round(ss.hIn * DPI);
  const cols   = state.sheet.cols;
  const rows   = state.sheet.rows;

  // Photo size in px (300 DPI)
  const photoW = state.frameW;
  const photoH = state.frameH;
  const gapPx  = mmToPx(state.sheet.gap);

  // Total photo area
  const totalPW = cols * photoW + (cols - 1) * gapPx;
  const totalPH = rows * photoH + (rows - 1) * gapPx;

  // Scale down if too big
  let scale = 1;
  const marginPx = mmToPx(8); // 8mm margin
  const availW = sheetW - 2 * marginPx;
  const availH = sheetH - 2 * marginPx;
  if (totalPW > availW || totalPH > availH) {
    scale = Math.min(availW / totalPW, availH / totalPH);
  }
  const pW = Math.round(photoW * scale);
  const pH = Math.round(photoH * scale);
  const gap = Math.max(Math.round(gapPx * scale), 2);

  const actualTW = cols * pW + (cols - 1) * gap;
  const actualTH = rows * pH + (rows - 1) * gap;

  const startX = Math.round((sheetW - actualTW) / 2);
  const startY = Math.round((sheetH - actualTH) / 2);

  const sheetCanvas = $('sheetCanvas');
  sheetCanvas.width  = sheetW;
  sheetCanvas.height = sheetH;
  const sc = sheetCanvas.getContext('2d');

  // White background
  sc.fillStyle = '#FFFFFF';
  sc.fillRect(0, 0, sheetW, sheetH);

  // Get source photo — prefer full-res enhanced, then processed canvas
  const srcCanvas = state._enhancedFullCanvas || state.processedCanvas;
  if (!srcCanvas) { hideLoading(); toast('No photo to generate sheet from.', 'error'); return; }

  updateProgress(30);

  // Draw each photo with guides
  let photoNum = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (photoNum >= state.sheet.count) break;
      const x = startX + col * (pW + gap);
      const y = startY + row * (pH + gap);

      // Draw photo — always use srcCanvas (already full-res canvas)
      sc.drawImage(srcCanvas, x, y, pW, pH);

      // ── CUTTING GUIDES ──

      // 1. Thin solid border around photo
      if (state.sheet.showBorder) {
        sc.strokeStyle = '#000000';
        sc.lineWidth = state.sheet.borderWidth;
        sc.strokeRect(x, y, pW, pH);
      }

      // 2. Dashed cutting lines (slightly outside border)
      if (state.sheet.showDashed) {
        sc.strokeStyle = 'rgba(0,0,0,0.35)';
        sc.lineWidth = 0.8;
        sc.setLineDash([6, 4]);
        const pad = 3;
        sc.strokeRect(x - pad, y - pad, pW + pad * 2, pH + pad * 2);
        sc.setLineDash([]);
      }

      // 3. Corner crop marks (L-shaped, outside photo)
      if (state.sheet.showCropmarks) {
        const mk = 20; // crop mark length px
        const mg = 4;  // gap between photo and mark
        sc.strokeStyle = '#000000';
        sc.lineWidth   = 1.2;
        sc.setLineDash([]);

        const corners = [
          [x, y, -1, -1],          // top-left
          [x + pW, y, 1, -1],      // top-right
          [x, y + pH, -1, 1],      // bottom-left
          [x + pW, y + pH, 1, 1],  // bottom-right
        ];
        corners.forEach(([cx, cy, dx, dy]) => {
          // Horizontal arm
          sc.beginPath();
          sc.moveTo(cx + dx * mg, cy);
          sc.lineTo(cx + dx * (mg + mk), cy);
          sc.stroke();
          // Vertical arm
          sc.beginPath();
          sc.moveTo(cx, cy + dy * mg);
          sc.lineTo(cx, cy + dy * (mg + mk));
          sc.stroke();
        });
      }

      photoNum++;
    }
  }

  updateProgress(70);

  // Print ruler (top + left edge with mm markings)
  if (state.sheet.showRuler) {
    drawSheetRuler(sc, sheetW, sheetH, ss.wIn, ss.hIn);
  }

  // Sheet metadata (bottom right, light text)
  sc.fillStyle = 'rgba(0,0,0,0.2)';
  sc.font = `${Math.round(DPI * 0.08)}px Outfit, sans-serif`;
  sc.textAlign = 'right';
  const preset = PRESETS[state.preset];
  sc.fillText(
    `PhotoPass Pro · ${preset?.label || 'Custom'} · ${cols}×${rows} · 300 DPI`,
    sheetW - marginPx, sheetH - Math.round(marginPx * 0.4)
  );

  updateProgress(95);

  // Show preview (scaled)
  $('sheetEmptyState').hidden = true;
  sheetCanvas.hidden = false;
  $('sheetMeta').hidden = false;
  $('sheetMetaText').textContent =
    `${sheetW}×${sheetH}px · ${ss.wIn}×${ss.hIn}in · ${state.sheet.count} photos · 300 DPI`;

  state.sheetDataURL = sheetCanvas.toDataURL('image/jpeg', 0.96);

  // Enable exports
  ['sheetExportJpg','sheetExportPng','sheetExportPdf','printPreviewBtn'].forEach(id => $(id).disabled = false);

  hideLoading();
  toast('Sheet generated successfully!', 'success');
}

function drawSheetRuler(ctx, W, H, wIn, hIn) {
  const pxPerMm = W / (wIn * MM_PER_INCH);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = `${Math.round(pxPerMm*5)}px Outfit, sans-serif`;
  for (let mm=0; mm<wIn*MM_PER_INCH; mm+=5) {
    const x = mm * pxPerMm;
    ctx.fillRect(x, 0, 1, mm%10===0?16:8);
    if (mm%10===0 && mm>0) ctx.fillText(mm+'mm', x+2, 14);
  }
}

/* ─────────────────────────────────────────────────────
   EXPORT — SINGLE & SHEET
───────────────────────────────────────────────────── */
function enableExportButtons() {
  ['exportJpg','exportPng','exportPdf','saveProject'].forEach(id => { const el=$(id); if(el) el.disabled=false; });
}

function getExportCanvas() {
  // Prefer full-res enhanced canvas, then fall back to processedCanvas
  if (state._enhancedFullCanvas) return state._enhancedFullCanvas;
  return state.processedCanvas || mainCanvas;
}

$('exportJpg').addEventListener('click', () => downloadCanvas(getExportCanvas(), 'passport-photo.jpg', 'jpeg', 0.97));
$('exportPng').addEventListener('click', () => downloadCanvas(getExportCanvas(), 'passport-photo.png', 'png'));
$('exportPdf').addEventListener('click', () => exportSinglePDF());

$('sheetExportJpg').addEventListener('click', () => downloadDataURL(state.sheetDataURL, 'passport-sheet.jpg'));
$('sheetExportPng').addEventListener('click', () => {
  const c = $('sheetCanvas');
  downloadDataURL(c.toDataURL('image/png'), 'passport-sheet.png');
});
$('sheetExportPdf').addEventListener('click', exportSheetPDF);

function downloadCanvas(canvas, filename, format='jpeg', quality=0.95) {
  if (!canvas) { toast('No photo to export.', 'warning'); return; }
  showLoading('Exporting…', 80);
  setTimeout(() => {
    const url = canvas.toDataURL(`image/${format}`, quality);
    downloadDataURL(url, filename);
    hideLoading();
    toast(`Exported as ${filename}`, 'success');
  }, 50);
}

function downloadDataURL(url, filename) {
  if (!url) { toast('Nothing to download yet.', 'warning'); return; }
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

function exportSinglePDF() {
  if (!state.processedCanvas) { toast('No photo to export.', 'warning'); return; }
  showLoading('Creating PDF…', 60);
  setTimeout(() => {
    const c = getExportCanvas();
    const wIn = state.frameW / DPI;
    const hIn = state.frameH / DPI;
    const pdfW = wIn * 72; // PDF uses 72pt per inch
    const pdfH = hIn * 72;
    const dataUrl = c.toDataURL('image/jpeg', 0.97);
    const pdfDoc = buildPDF(pdfW, pdfH, dataUrl, pdfW, pdfH, 0, 0, 'portrait');
    downloadDataURL(pdfDoc, 'passport-photo.pdf');
    hideLoading();
    toast('PDF downloaded!', 'success');
  }, 100);
}

function exportSheetPDF() {
  const c = $('sheetCanvas');
  if (!c || c.hidden) { toast('Generate a sheet first.', 'warning'); return; }
  showLoading('Creating sheet PDF…', 60);
  setTimeout(() => {
    const ss = SHEET_SIZES[state.sheet.size];
    const pdfW = ss.wIn * 72;
    const pdfH = ss.hIn * 72;
    const orient = pdfW > pdfH ? 'landscape' : 'portrait';
    const dataUrl = c.toDataURL('image/jpeg', 0.96);
    const pdfDoc = buildPDF(pdfW, pdfH, dataUrl, pdfW, pdfH, 0, 0, orient);
    downloadDataURL(pdfDoc, 'passport-sheet.pdf');
    hideLoading();
    toast('Sheet PDF downloaded!', 'success');
  }, 100);
}

/**
 * Minimal PDF builder (no library needed)
 * Produces a valid PDF with one JPEG image page.
 */
function buildPDF(pageW, pageH, jpegDataURL, imgW, imgH, x, y, orientation) {
  const jpegBytes = dataURLtoBytes(jpegDataURL);
  const jpegLen   = jpegBytes.length;

  // Objects: catalog(1), pages(2), page(3), image(4), content(5)
  const offsets = [];
  let body = '';

  function obj(num, content) {
    offsets[num] = body.length;
    body += `${num} 0 obj\n${content}\nendobj\n`;
  }

  obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  obj(2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  obj(3, `<< /Type /Page /Parent 2 0 R\n  /MediaBox [0 0 ${pageW.toFixed(3)} ${pageH.toFixed(3)}]\n  /Resources << /XObject << /Im0 4 0 R >> >>\n  /Contents 5 0 R >>`);

  // Content stream: place image
  const contentStream = `q\n${imgW.toFixed(3)} 0 0 ${imgH.toFixed(3)} ${x.toFixed(3)} ${(pageH-imgH-y).toFixed(3)} cm\n/Im0 Do\nQ`;
  const csBytes = strToBytes(contentStream);
  obj(5, `<< /Length ${csBytes.length} >>\nstream\n${contentStream}\nendstream`);

  // Image XObject (deferred — we'll put binary after)
  offsets[4] = body.length;
  const imgHeader = `4 0 obj\n<< /Type /XObject /Subtype /Image\n  /Width ${Math.round(imgW/72*DPI)}\n  /Height ${Math.round(imgH/72*DPI)}\n  /ColorSpace /DeviceRGB /BitsPerComponent 8\n  /Filter /DCTDecode\n  /Length ${jpegLen} >>\nstream\n`;

  const xrefPos = body.length + imgHeader.length + jpegLen + '\nendstream\nendobj\n'.length;
  // Rebuild properly with binary
  const headerStr = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
  const fullBody  = headerStr + body + imgHeader;

  // Build xref table
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  const baseOff = headerStr.length;
  for (let i=1;i<=5;i++) {
    const off = i===4
      ? baseOff + body.length + imgHeader.length - imgHeader.length  // offset of obj 4 start
      : baseOff + offsets[i];
    // Recalc properly
    xref += `${String(i===4 ? baseOff+body.length : baseOff+offsets[i]).padStart(10,'0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${baseOff + body.length + imgHeader.length + jpegLen + 2 + 'endstream\nendobj\n'.length}\n%%EOF`;

  // Return as data URL (base64) — assemble binary
  // Use a Blob for proper binary handling
  const enc = new TextEncoder();
  const parts = [
    enc.encode(headerStr + body + imgHeader),
    jpegBytes,
    enc.encode('\nendstream\nendobj\n'),
    enc.encode(xref + trailer),
  ];
  const totalLen = parts.reduce((s,p)=>s+p.length,0);
  const buf = new Uint8Array(totalLen);
  let off2=0;
  parts.forEach(p => { buf.set(p,off2); off2+=p.length; });

  const blob = new Blob([buf], {type:'application/pdf'});
  return URL.createObjectURL(blob);
}

function dataURLtoBytes(dataURL) {
  const base64 = dataURL.split(',')[1];
  const binary  = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function strToBytes(str) { return new TextEncoder().encode(str); }

/* ─────────────────────────────────────────────────────
   PRINT PREVIEW
───────────────────────────────────────────────────── */
$('printPreviewBtn').addEventListener('click', showPrintPreview);
$('closePrintModal').addEventListener('click', () => $('printModal').hidden = true);
$('closePrintModal2').addEventListener('click', () => $('printModal').hidden = true);

function showPrintPreview() {
  if (!state.sheetDataURL) { toast('Generate a sheet first.', 'warning'); return; }
  const frame = $('printPreviewFrame');
  frame.innerHTML = '';
  const img = document.createElement('img');
  img.src = state.sheetDataURL;
  img.style.cssText = 'max-width:100%;max-height:500px;display:block;margin:auto;';
  frame.appendChild(img);
  $('printModal').hidden = false;
}

$('doPrint').addEventListener('click', () => {
  if (!state.sheetDataURL) return;
  const ss = SHEET_SIZES[state.sheet.size];
  const isLand = ss.wIn > ss.hIn;
  const printHTML = `<!DOCTYPE html><html><head><style>
    @page{size:${ss.wIn}in ${ss.hIn}in;margin:0}
    body{margin:0;width:${ss.wIn}in;height:${ss.hIn}in;overflow:hidden}
    img{width:${ss.wIn}in;height:${ss.hIn}in;display:block;object-fit:fill}
  </style></head><body><img src="${state.sheetDataURL}"/></body></html>`;
  const win = window.open('', '_blank');
  win.document.write(printHTML);
  win.document.close();
  win.addEventListener('load', () => { setTimeout(() => { win.print(); }, 400); });
  $('printModal').hidden = true;
});

/* ─────────────────────────────────────────────────────
   SAVE / LOAD PROJECTS (localStorage)
───────────────────────────────────────────────────── */
$('saveProject').addEventListener('click', saveProject);

function saveProject() {
  if (!state.processedCanvas) { toast('Nothing to save yet.', 'warning'); return; }
  showLoading('Saving project…', 70);
  setTimeout(() => {
    try {
      const thumb = mainCanvas.toDataURL('image/jpeg', 0.5);
      const project = {
        id: Date.now(),
        name: `Project ${new Date().toLocaleDateString()}`,
        date: new Date().toISOString(),
        preset: state.preset,
        frameW: state.frameW,
        frameH: state.frameH,
        bgColor: state.bgColor,
        zoom: state.zoom,
        rotation: state.rotation,
        posX: state.posX,
        posY: state.posY,
        flipX: state.flipX,
        flipY: state.flipY,
        enhance: { ...state.enhance },
        originalDataURL: state.originalDataURL,
        thumb,
      };
      const projects = JSON.parse(localStorage.getItem('pp-projects') || '[]');
      projects.unshift(project);
      // Keep only last 10 (storage limit)
      projects.splice(10);
      try {
        localStorage.setItem('pp-projects', JSON.stringify(projects));
        toast('Project saved!', 'success');
      } catch {
        // Storage full — try without original
        project.originalDataURL = null;
        projects[0] = project;
        localStorage.setItem('pp-projects', JSON.stringify(projects));
        toast('Project saved (reduced quality).', 'warning');
      }
    } catch (err) {
      toast('Failed to save project: ' + err.message, 'error');
    }
    hideLoading();
  }, 100);
}

function loadProjects() {
  const grid = $('projectsGrid');
  const projects = JSON.parse(localStorage.getItem('pp-projects') || '[]');
  if (!projects.length) {
    grid.innerHTML = '<div class="projects-empty"><svg width="64" height="64" viewBox="0 0 64 64" fill="none" opacity="0.3"><path d="M56 56H8V16l12-8h36v48z" stroke="currentColor" stroke-width="2"/><path d="M20 8v16H8" stroke="currentColor" stroke-width="2"/></svg><p>No saved projects yet.<br/>Save a project from the Editor to see it here.</p></div>';
    return;
  }
  grid.innerHTML = projects.map(p => `
    <div class="project-card" data-id="${p.id}">
      <img class="project-card-thumb" src="${p.thumb}" alt="${p.name}" loading="lazy" />
      <div class="project-card-body">
        <div class="project-card-name">${p.name}</div>
        <div class="project-card-date">${new Date(p.date).toLocaleDateString()} · ${PRESETS[p.preset]?.label||'Custom'}</div>
        <div class="project-card-actions">
          <button class="btn-primary-sm" onclick="reopenProject(${p.id})">Open</button>
          <button class="btn-outline-sm" onclick="deleteProject(${p.id})">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.reopenProject = function(id) {
  const projects = JSON.parse(localStorage.getItem('pp-projects') || '[]');
  const p = projects.find(x => x.id === id);
  if (!p) { toast('Project not found.', 'error'); return; }
  if (!p.originalDataURL) { toast('Original image not available in this save.', 'warning'); return; }
  showLoading('Loading project…');
  const img = new Image();
  img.onload = () => {
    state.originalImage = img;
    state.originalDataURL = p.originalDataURL;
    state.preset   = p.preset || 'india_passport';
    state.frameW   = p.frameW;
    state.frameH   = p.frameH;
    state.bgColor  = p.bgColor;
    state.zoom     = p.zoom;
    state.rotation = p.rotation;
    state.posX     = p.posX;
    state.posY     = p.posY;
    state.flipX    = p.flipX;
    state.flipY    = p.flipY;
    state.enhance  = { ...p.enhance };
    $('presetSelect').value = p.preset;
    syncSliders();
    hideLoading();
    showCanvasWorkspace();
    redrawMainCanvas();
    enableExportButtons();
    switchPanel('editor');
    toast('Project loaded!', 'success');
  };
  img.onerror = () => { hideLoading(); toast('Failed to load project image.', 'error'); };
  img.src = p.originalDataURL;
};

window.deleteProject = function(id) {
  let projects = JSON.parse(localStorage.getItem('pp-projects') || '[]');
  projects = projects.filter(p => p.id !== id);
  localStorage.setItem('pp-projects', JSON.stringify(projects));
  loadProjects();
  toast('Project deleted.', 'info');
};

$('clearProjects').addEventListener('click', () => {
  if (!confirm('Delete all saved projects?')) return;
  localStorage.removeItem('pp-projects');
  loadProjects();
  toast('All projects cleared.', 'info');
});

/* ─────────────────────────────────────────────────────
   SHORTCUTS MODAL
───────────────────────────────────────────────────── */
$('shortcutsBtn').addEventListener('click', () => { $('shortcutsModal').hidden = false; });
$('closeShortcuts').addEventListener('click', () => { $('shortcutsModal').hidden = true; });

/* ─────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS
───────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    $$('.modal-overlay').forEach(m => { m.hidden = true; });
    return;
  }
  if (ctrl && e.key === 's') { e.preventDefault(); saveProject(); return; }
  if (ctrl && e.key === 'e') { e.preventDefault(); if(!$('exportJpg').disabled) $('exportJpg').click(); return; }
  if (e.key === 'd') { applyTheme(state.theme==='dark'?'light':'dark'); return; }
  if (e.key === 'g' || e.key === 'G') { $('toolGrid').click(); return; }
  if (e.key === 'r' || e.key === 'R') { $('toolRuler').click(); return; }
  if (e.key === 'f' || e.key === 'F') { $('toolFit').click(); return; }
  if (e.key === 'q' || e.key === 'Q') { $('toolRotLeft').click(); return; }
  if (e.key === 'e' || e.key === 'E') { $('toolRotRight').click(); return; }
  if (e.key === '+' || e.key === '=') { $('toolZoomIn').click(); return; }
  if (e.key === '-') { $('toolZoomOut').click(); return; }
  if (e.key === '1') { switchPanel('editor'); return; }
  if (e.key === '2') { switchPanel('enhance'); return; }
  if (e.key === '3') { switchPanel('sheet'); return; }
  if (e.key === '4') { switchPanel('projects'); return; }
});

/* ─────────────────────────────────────────────────────
   RESIZE HANDLER
───────────────────────────────────────────────────── */
const resizeObserver = new ResizeObserver(() => {
  if (state.originalImage) {
    computeDisplayScale();
    if (state.showRuler) drawRulers();
  }
});
resizeObserver.observe($('canvasFrame'));

/* ─────────────────────────────────────────────────────
   (debounce is declared at top of file)
───────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────── */
(function init() {
  console.log('%cPhotoPass Pro v1.2.0 loaded ✓', 'color:#6366f1;font-weight:bold;font-size:14px');
  updateFrameInfo();

  // Fill layout-preview grids via CSS classes (already set in HTML)
  // Apply saved theme
  document.documentElement.setAttribute('data-theme', state.theme);
})();

/* ═══════════════════════════════════════════════════════════════════════
   CONTINUATION — Touch Support, Undo/Redo, Batch, PDF Fix, Polish
═══════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────
   TOUCH SUPPORT (pinch zoom + drag)
───────────────────────────────────────────────────── */
(function attachTouchHandlers() {
  let lastTouchDist = null;
  let lastTouchX = 0, lastTouchY = 0;
  let touchDragOriginX = 0, touchDragOriginY = 0;

  canvasFrame.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      touchDragOriginX = state.posX;
      touchDragOriginY = state.posY;
    }
    if (e.touches.length === 2) {
      lastTouchDist = getTouchDist(e.touches);
    }
    e.preventDefault();
  }, { passive: false });

  canvasFrame.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      const dx = (e.touches[0].clientX - lastTouchX) / state.displayScale;
      const dy = (e.touches[0].clientY - lastTouchY) / state.displayScale;
      state.posX = touchDragOriginX + dx;
      state.posY = touchDragOriginY + dy;
      $('posXSlider').value = state.posX;
      $('posYSlider').value = state.posY;
      $('posXVal').textContent = Math.round(state.posX);
      $('posYVal').textContent = Math.round(state.posY);
      redrawMainCanvas();
    }
    if (e.touches.length === 2 && lastTouchDist) {
      const dist = getTouchDist(e.touches);
      const delta = (dist - lastTouchDist) * 0.3;
      state.zoom = Math.max(10, Math.min(300, state.zoom + delta));
      $('zoomSlider').value = state.zoom;
      $('zoomVal').textContent = Math.round(state.zoom);
      lastTouchDist = dist;
      redrawMainCanvas();
    }
    e.preventDefault();
  }, { passive: false });

  canvasFrame.addEventListener('touchend', e => {
    if (e.touches.length < 2) lastTouchDist = null;
  });

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
})();

/* ─────────────────────────────────────────────────────
   UNDO / REDO HISTORY
───────────────────────────────────────────────────── */
function pushHistory() {
  if (!state.originalImage) return;
  const snap = {
    zoom: state.zoom, rotation: state.rotation,
    posX: state.posX, posY: state.posY,
    flipX: state.flipX, flipY: state.flipY,
    bgColor: state.bgColor, bgBlur: state.bgBlur,
  };
  // Trim redo stack
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snap);
  if (state.history.length > state.maxHistory) state.history.shift();
  state.historyIndex = state.history.length - 1;
}

function undo() {
  if (state.historyIndex <= 0) { toast('Nothing to undo.', 'info'); return; }
  state.historyIndex--;
  applyHistorySnap(state.history[state.historyIndex]);
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) { toast('Nothing to redo.', 'info'); return; }
  state.historyIndex++;
  applyHistorySnap(state.history[state.historyIndex]);
}

function applyHistorySnap(snap) {
  Object.assign(state, snap);
  syncSliders();
  redrawMainCanvas();
  // Sync bg swatch
  $$('.bg-swatch').forEach(s => s.classList.toggle('active', s.dataset.bg === state.bgColor));
  $('bgBlur').value = state.bgBlur;
  $('blurVal').textContent = state.bgBlur;
}

// Push history on significant transform actions
['zoomSlider','rotSlider','posXSlider','posYSlider'].forEach(id => {
  let pushed = false;
  const el = $(id);
  if (!el) return;
  el.addEventListener('mousedown', () => { pushed = false; });
  el.addEventListener('change', () => { if (!pushed) { pushHistory(); pushed = true; } });
});

['toolRotLeft','toolRotRight','toolFlipH','toolFlipV'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('click', () => setTimeout(pushHistory, 10));
});

// Ctrl+Z / Ctrl+Y
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'z') { e.preventDefault(); undo(); }
  if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
});

/* ─────────────────────────────────────────────────────
   BATCH PHOTO GENERATION
   Allows the user to generate sheets from multiple
   uploaded photos in one go (UI in sheet panel)
───────────────────────────────────────────────────── */
(function initBatch() {
  // Inject batch UI into sheet controls
  const batchSection = document.createElement('div');
  batchSection.className = 'sidebar-section';
  batchSection.innerHTML = `
    <h3 class="section-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
      </svg>
      Batch Generate
    </h3>
    <p style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px;">
      Upload multiple photos and generate a sheet for each.
    </p>
    <input type="file" id="batchInput" accept="image/jpeg,image/png,image/webp" multiple hidden />
    <button class="btn-outline-sm w-full" id="batchSelectBtn">📁 Select Photos</button>
    <div id="batchStatus" style="margin-top:8px;font-size:.75rem;color:var(--text-muted);"></div>
    <button class="btn-primary-sm w-full mt-2" id="batchRunBtn" disabled style="width:100%;justify-content:center;">
      ⚡ Generate All Sheets
    </button>
  `;

  const sheetControlsCol = document.querySelector('.sheet-controls-col');
  if (sheetControlsCol) sheetControlsCol.appendChild(batchSection);

  const batchInput  = document.getElementById('batchInput');
  const batchStatus = document.getElementById('batchStatus');
  const batchRunBtn = document.getElementById('batchRunBtn');
  const batchSelectBtn = document.getElementById('batchSelectBtn');
  if (!batchInput) return;

  let batchFiles = [];

  batchSelectBtn.addEventListener('click', () => batchInput.click());
  batchInput.addEventListener('change', e => {
    batchFiles = Array.from(e.target.files).filter(f =>
      ['image/jpeg','image/png','image/webp'].includes(f.type)
    );
    batchStatus.textContent = batchFiles.length
      ? `${batchFiles.length} photo${batchFiles.length > 1 ? 's' : ''} selected`
      : 'No valid files selected';
    batchRunBtn.disabled = batchFiles.length === 0;
  });

  batchRunBtn.addEventListener('click', async () => {
    if (!batchFiles.length) return;
    showLoading(`Generating sheets (0/${batchFiles.length})…`, 0);
    const zip = [];

    for (let i = 0; i < batchFiles.length; i++) {
      const file = batchFiles[i];
      updateProgress(Math.round((i / batchFiles.length) * 100));
      $('loadingModalText').textContent = `Processing ${i + 1}/${batchFiles.length}: ${file.name}`;

      try {
        await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e2 => {
            const img = new Image();
            img.onload = () => {
              // Temporarily set as current image
              const prevImg = state.originalImage;
              const prevURL = state.originalDataURL;
              state.originalImage   = img;
              state.originalDataURL = e2.target.result;
              state.zoom = Math.max(
                state.frameW / img.width,
                state.frameH / img.height
              ) * 100;
              state.posX = 0; state.posY = 0; state.rotation = 0;
              redrawMainCanvas();
              generateSheetSilent(i, file.name);
              state.originalImage   = prevImg;
              state.originalDataURL = prevURL;
              resolve();
            };
            img.onerror = reject;
            img.src = e2.target.result;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      } catch (err) {
        console.warn(`Batch: failed on ${file.name}`, err);
      }

      await new Promise(r => setTimeout(r, 80));
    }

    hideLoading();
    batchStatus.textContent = `✅ Generated ${batchFiles.length} sheets`;
    toast(`Batch complete — ${batchFiles.length} sheets downloaded!`, 'success');
    batchFiles = [];
    batchRunBtn.disabled = true;
    batchInput.value = '';
  });

  function generateSheetSilent(index, originalName) {
    // Reuse generateSheet but trigger auto-download instead of preview
    const ss    = SHEET_SIZES[state.sheet.size];
    const sheetW = Math.round(ss.wIn * DPI);
    const sheetH = Math.round(ss.hIn * DPI);
    const cols   = state.sheet.cols;
    const rows   = state.sheet.rows;
    const photoW = state.frameW;
    const photoH = state.frameH;
    const gapPx  = mmToPx(state.sheet.gap);
    const marginPx = mmToPx(8);
    const availW = sheetW - 2 * marginPx;
    const availH = sheetH - 2 * marginPx;
    const totalPW = cols * photoW + (cols - 1) * gapPx;
    const totalPH = rows * photoH + (rows - 1) * gapPx;
    let scale = 1;
    if (totalPW > availW || totalPH > availH) {
      scale = Math.min(availW / totalPW, availH / totalPH);
    }
    const pW  = Math.round(photoW * scale);
    const pH  = Math.round(photoH * scale);
    const gap = Math.max(Math.round(gapPx * scale), 2);
    const actualTW = cols * pW + (cols - 1) * gap;
    const actualTH = rows * pH + (rows - 1) * gap;
    const startX = Math.round((sheetW - actualTW) / 2);
    const startY = Math.round((sheetH - actualTH) / 2);

    const c   = document.createElement('canvas');
    c.width   = sheetW;
    c.height  = sheetH;
    const sc  = c.getContext('2d');
    sc.fillStyle = '#FFFFFF';
    sc.fillRect(0, 0, sheetW, sheetH);

    const src = state.processedCanvas;
    if (!src) return;

    let num = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (num >= state.sheet.count) break;
        const x = startX + col * (pW + gap);
        const y = startY + row * (pH + gap);
        sc.drawImage(src, x, y, pW, pH);

        // Border
        if (state.sheet.showBorder) {
          sc.strokeStyle = '#000'; sc.lineWidth = state.sheet.borderWidth;
          sc.strokeRect(x, y, pW, pH);
        }
        // Dashed
        if (state.sheet.showDashed) {
          sc.strokeStyle = 'rgba(0,0,0,0.3)'; sc.lineWidth = 0.8;
          sc.setLineDash([6,4]);
          const pad = 3;
          sc.strokeRect(x-pad, y-pad, pW+pad*2, pH+pad*2);
          sc.setLineDash([]);
        }
        // Crop marks
        if (state.sheet.showCropmarks) {
          const mk=20, mg=4;
          sc.strokeStyle = '#000'; sc.lineWidth = 1.2; sc.setLineDash([]);
          [[x,y,-1,-1],[x+pW,y,1,-1],[x,y+pH,-1,1],[x+pW,y+pH,1,1]].forEach(([cx,cy,dx,dy]) => {
            sc.beginPath(); sc.moveTo(cx+dx*mg,cy); sc.lineTo(cx+dx*(mg+mk),cy); sc.stroke();
            sc.beginPath(); sc.moveTo(cx,cy+dy*mg); sc.lineTo(cx,cy+dy*(mg+mk)); sc.stroke();
          });
        }
        num++;
      }
    }

    // Auto-download
    const baseName = originalName.replace(/\.[^.]+$/, '');
    const url = c.toDataURL('image/jpeg', 0.95);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sheet-${index+1}-${baseName}.jpg`;
    a.click();
  }
})();

/* ─────────────────────────────────────────────────────
   ENHANCED PDF BUILDER (fixed — proper xref offsets)
───────────────────────────────────────────────────── */
// Override the buildPDF function with a correct implementation
window.buildPDF = function(pageW, pageH, jpegDataURL) {
  const jpegBytes = (function(dataURL) {
    const b64 = dataURL.split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  })(jpegDataURL);

  const enc   = new TextEncoder();
  const parts = [];

  function addStr(s) { const b = enc.encode(s); parts.push(b); return b.length; }
  function addBytes(b) { parts.push(b); return b.length; }

  let offset = 0;
  const offsets = {};

  // Header
  offset += addStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // Obj 1: Catalog
  offsets[1] = offset;
  offset += addStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets[2] = offset;
  offset += addStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Obj 3: Page
  offsets[3] = offset;
  const pageStr = `3 0 obj\n<< /Type /Page /Parent 2 0 R\n  /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}]\n  /Resources << /XObject << /Im0 4 0 R >> >>\n  /Contents 5 0 R >>\nendobj\n`;
  offset += addStr(pageStr);

  // Obj 4: Image XObject
  offsets[4] = offset;
  const imgStream = `4 0 obj\n<< /Type /XObject /Subtype /Image\n  /Width ${Math.round(pageW/72*DPI)} /Height ${Math.round(pageH/72*DPI)}\n  /ColorSpace /DeviceRGB /BitsPerComponent 8\n  /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`;
  offset += addStr(imgStream);
  offset += addBytes(jpegBytes);
  offset += addStr('\nendstream\nendobj\n');

  // Obj 5: Content stream
  offsets[5] = offset;
  const contentStream = `q\n${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm\n/Im0 Do\nQ`;
  const contentBody   = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
  offset += addStr(contentBody);

  // xref table
  const xrefOffset = offset;
  let xrefStr = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xrefStr += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  xrefStr += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  addStr(xrefStr);

  // Assemble
  let totalLen = 0;
  parts.forEach(p => totalLen += p.length);
  const buf = new Uint8Array(totalLen);
  let pos = 0;
  parts.forEach(p => { buf.set(p, pos); pos += p.length; });

  const blob = new Blob([buf], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
};

/* ─────────────────────────────────────────────────────
   FILE DRAG-AND-DROP ANYWHERE ON PAGE
───────────────────────────────────────────────────── */
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const allowed = ['image/jpeg','image/png','image/webp'];
  if (allowed.includes(file.type)) {
    handleFile(file);
    if (state.currentPanel !== 'editor') switchPanel('editor');
  }
});

/* ─────────────────────────────────────────────────────
   CLIPBOARD PASTE SUPPORT (Ctrl+V)
───────────────────────────────────────────────────── */
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        handleFile(file);
        if (state.currentPanel !== 'editor') switchPanel('editor');
        toast('Photo pasted from clipboard!', 'success');
      }
      break;
    }
  }
});

/* ─────────────────────────────────────────────────────
   ENHANCE → APPLY BACK TO EDITOR CANVAS
   When user switches back to editor after enhancing
───────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.panel === 'editor' && state.enhancedDataURL) {
      // Optionally reload enhanced version into editor canvas
      const img = new Image();
      img.onload = () => {
        state.originalImage = img;
        redrawMainCanvas();
      };
      img.src = state.enhancedDataURL;
    }
  });
});

/* ─────────────────────────────────────────────────────
   ONLINE / OFFLINE STATUS INDICATOR
───────────────────────────────────────────────────── */
function updateOnlineStatus() {
  if (!navigator.onLine) {
    toast('You are offline. The app still works!', 'info', 4000);
  }
}
window.addEventListener('offline', updateOnlineStatus);
window.addEventListener('online',  () => toast('Back online.', 'success'));

/* ─────────────────────────────────────────────────────
   MEMORY MANAGEMENT — revoke object URLs
───────────────────────────────────────────────────── */
const _objectURLs = [];
const _origDownloadDataURL = window.downloadDataURL;
window.downloadDataURL = function(url, filename) {
  if (url && url.startsWith('blob:')) _objectURLs.push(url);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  // Revoke blob URLs after a delay
  if (url && url.startsWith('blob:')) {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
};

/* ─────────────────────────────────────────────────────
   RESPONSIVE SIDEBAR — CLOSE ON PANEL CLICK (MOBILE)
───────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('mobile-open')) {
      sidebar.classList.remove('mobile-open');
    }
  });
});

/* ─────────────────────────────────────────────────────
   PUSH INITIAL HISTORY after first image load
───────────────────────────────────────────────────── */
// History is pushed directly in handleFile after redrawMainCanvas()

/* ─────────────────────────────────────────────────────
   ENHANCE: auto-apply when toggling back from
   enhance panel ensures sheet uses latest version
───────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.panel === 'sheet' && state.currentPanel === 'enhance') {
      // Ensure processedCanvas is up to date with enhancedDataURL
      if (state.enhancedDataURL) {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          state.processedCanvas = c;
        };
        img.src = state.enhancedDataURL;
      }
    }
  });
});

/* ─────────────────────────────────────────────────────
   WATERMARK / PRINT SAFETY — ensure no clipping
───────────────────────────────────────────────────── */
function validateSheetDimensions() {
  const ss = SHEET_SIZES[state.sheet.size];
  const sheetW = Math.round(ss.wIn * DPI);
  const sheetH = Math.round(ss.hIn * DPI);
  const cols = state.sheet.cols;
  const rows = state.sheet.rows;
  const photoW = state.frameW;
  const photoH = state.frameH;
  const gapPx = mmToPx(state.sheet.gap);
  const marginPx = mmToPx(8);
  const totalPW = cols * photoW + (cols-1)*gapPx + 2*marginPx;
  const totalPH = rows * photoH + (rows-1)*gapPx + 2*marginPx;

  if (totalPW > sheetW || totalPH > sheetH) {
    toast(`⚠ Photos scaled to fit sheet. Consider larger sheet or fewer photos.`, 'warning', 5000);
  }
}

// Attach validateSheetDimensions to generate button
const genBtn = document.getElementById('generateSheet');
if (genBtn) {
  const origClick = genBtn.onclick;
  genBtn.addEventListener('click', validateSheetDimensions);
}

/* ─────────────────────────────────────────────────────
   FINAL INIT PATCH — ensure everything is ready
───────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Ensure layout preview cells are populated
  document.querySelectorAll('.layout-preview:not(.custom-icon)').forEach(lp => {
    if (lp.children.length === 0) {
      const rows = lp.className.includes('rows-4') ? 4 : lp.className.includes('rows-3') ? 3 : 2;
      const cols = lp.className.includes('cols-4') ? 4 : lp.className.includes('cols-3') ? 3 : 2;
      lp.innerHTML = '';
      for (let i = 0; i < rows * cols; i++) {
        const cell = document.createElement('div');
        cell.style.cssText = 'background:currentColor;opacity:.4;border-radius:1px;';
        lp.appendChild(cell);
      }
    }
  });
});

console.log('%c✓ PhotoPass Pro — All modules loaded', 'color:#a855f7;font-weight:bold');

/* ─────────────────────────────────────────────────────
   DRAG-OVER BODY VISUAL FEEDBACK
───────────────────────────────────────────────────── */
let bodyDragCounter = 0;
document.body.addEventListener('dragenter', () => {
  bodyDragCounter++;
  document.body.classList.add('body-drag-over');
});
document.body.addEventListener('dragleave', () => {
  bodyDragCounter--;
  if (bodyDragCounter <= 0) {
    bodyDragCounter = 0;
    document.body.classList.remove('body-drag-over');
  }
});
document.body.addEventListener('drop', () => {
  bodyDragCounter = 0;
  document.body.classList.remove('body-drag-over');
});

/* ─────────────────────────────────────────────────────
   ENHANCE PANEL badge labels — injected once on first use
───────────────────────────────────────────────────── */
let _enhanceBadgesAdded = false;
function addEnhanceBadges() {
  if (_enhanceBadgesAdded) return;
  _enhanceBadgesAdded = true;
  ['enhanceBefore','enhanceAfter'].forEach((id, i) => {
    const c = document.getElementById(id);
    if (!c || c.parentElement.classList.contains('enhance-canvas-wrap')) return;
    const w = document.createElement('div');
    w.className = 'enhance-canvas-wrap';
    w.style.position = 'relative';
    c.parentNode.insertBefore(w, c);
    w.appendChild(c);
    const badge = document.createElement('div');
    badge.className = 'ba-badge';
    badge.textContent = i === 0 ? 'ORIGINAL' : 'ENHANCED';
    w.appendChild(badge);
  });
}

/* ─────────────────────────────────────────────────────
   ZOOM INDICATOR — brief flash on change
───────────────────────────────────────────────────── */
let _zoomFlashTimer = null;
(function patchZoomIndicator() {
  const zi = document.getElementById('zoomIndicator');
  if (!zi) return;
  const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'textContent');
  // Watch zoomSlider instead
  const zs = document.getElementById('zoomSlider');
  if (zs) {
    zs.addEventListener('input', () => {
      zi.style.opacity = '1';
      clearTimeout(_zoomFlashTimer);
      _zoomFlashTimer = setTimeout(() => { zi.style.opacity = ''; }, 1200);
    });
  }
})();

/* ─────────────────────────────────────────────────────
   SHEET CANVAS — click to zoom preview
───────────────────────────────────────────────────── */
(function sheetZoom() {
  const sc = document.getElementById('sheetCanvas');
  if (!sc) return;
  let zoomed = false;
  sc.style.cursor = 'zoom-in';
  sc.addEventListener('click', () => {
    zoomed = !zoomed;
    sc.style.maxWidth  = zoomed ? 'none' : '';
    sc.style.maxHeight = zoomed ? 'none' : '';
    sc.style.cursor    = zoomed ? 'zoom-out' : 'zoom-in';
    const wrap = document.getElementById('sheetCanvasWrap');
    if (wrap) wrap.style.overflow = zoomed ? 'auto' : 'visible';
  });
})();

/* ─────────────────────────────────────────────────────
   FINAL CONSOLE SUMMARY
───────────────────────────────────────────────────── */
console.table({
  'Panels': 'Editor, Enhance, Sheet, Projects',
  'Presets': '7 built-in + custom',
  'Sheet layouts': '4/6/8/12/16/custom',
  'Export formats': 'JPG, PNG, PDF',
  'PWA': 'Service Worker + Manifest',
  'Offline': 'Full offline support',
  'Keyboard shortcuts': '14 shortcuts',
  'Batch generation': 'Multi-photo sheets',
});
