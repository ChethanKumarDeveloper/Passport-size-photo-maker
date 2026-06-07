/**
 * PassportMaker — script.js
 * Full workflow: Upload → Crop → Enhance → Generate Sheet → Download/Print
 * Dependencies: Cropper.js, jsPDF (loaded via CDN in index.html)
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════════ */
const state = {
  currentStep: 1,
  originalFile: null,
  originalDataURL: null,
  croppedDataURL: null,
  enhancedDataURL: null,
  sheetDataURL: null,
  cropper: null,
  flipX: 1,
  flipY: 1,
  rotAngle: 0,
  enhance: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0, warmth: 0 },
  preset: { w: 35, h: 45, label: '35×45mm' },   // mm
};

/* ═══════════════════════════════════════════════════════════════════
   DOM REFS
═══════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const dom = {
  fileInput:        $('fileInput'),
  uploadZone:       $('uploadZone'),
  uploadPreview:    $('uploadPreview'),
  previewImg:       $('previewImg'),
  fileMeta:         $('fileMeta'),
  proceedToCrop:    $('proceedToCrop'),
  cropImage:        $('cropImage'),
  zoomRange:        $('zoomRange'),
  rotRange:         $('rotRange'),
  rotLeft:          $('rotLeft'),
  rotRight:         $('rotRight'),
  flipH:            $('flipH'),
  flipV:            $('flipV'),
  resetCrop:        $('resetCrop'),
  cropAndContinue:  $('cropAndContinue'),
  beforeCanvas:     $('beforeCanvas'),
  afterCanvas:      $('afterCanvas'),
  autoEnhanceBtn:   $('autoEnhanceBtn'),
  resetEnhance:     $('resetEnhance'),
  backToUpload:     $('backToUpload'),
  generateSheet:    $('generateSheet'),
  sheetCanvas:      $('sheetCanvas'),
  backToEnhance:    $('backToEnhance'),
  proceedToDownload:$('proceedToDownload'),
  finalCanvas:      $('finalCanvas'),
  downloadJpg:      $('downloadJpg'),
  downloadPdf:      $('downloadPdf'),
  printSheet:       $('printSheet'),
  startOver:        $('startOver'),
  backToSheet:      $('backToSheet'),
  loadingOverlay:   $('loadingOverlay'),
  loadingText:      $('loadingText'),
  darkModeToggle:   $('darkModeToggle'),
  sunIcon:          $('sunIcon'),
  moonIcon:         $('moonIcon'),
  stepper:          $('stepper'),
};

const enhanceSliders = {
  brightness: $('brightnessSlider'),
  contrast:   $('contrastSlider'),
  saturation: $('saturationSlider'),
  sharpness:  $('sharpnessSlider'),
  warmth:     $('warmthSlider'),
};
const enhanceVals = {
  brightness: $('brightnessVal'),
  contrast:   $('contrastVal'),
  saturation: $('saturationVal'),
  sharpness:  $('sharpnessVal'),
  warmth:     $('warmthVal'),
};

/* ═══════════════════════════════════════════════════════════════════
   LOADING HELPERS
═══════════════════════════════════════════════════════════════════ */
function showLoading(msg = 'Processing…') {
  dom.loadingText.textContent = msg;
  dom.loadingOverlay.hidden = false;
}
function hideLoading() {
  dom.loadingOverlay.hidden = true;
}

/* ═══════════════════════════════════════════════════════════════════
   STEP NAVIGATION
═══════════════════════════════════════════════════════════════════ */
function goToStep(n) {
  // Hide current panel
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${n}`).classList.add('active');
  state.currentStep = n;
  updateStepper(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepper(current) {
  const steps = dom.stepper.querySelectorAll('.step');
  const lines  = dom.stepper.querySelectorAll('.step-line');
  steps.forEach((s, i) => {
    const num = i + 1;
    s.classList.remove('active', 'done');
    if (num < current) s.classList.add('done');
    else if (num === current) s.classList.add('active');
  });
  lines.forEach((l, i) => {
    l.classList.toggle('done', i + 1 < current);
  });
  // Replace number with checkmark for done steps
  steps.forEach((s, i) => {
    const bubble = s.querySelector('.step-bubble');
    if (s.classList.contains('done')) {
      bubble.textContent = '✓';
    } else {
      bubble.textContent = i + 1;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   DARK MODE
═══════════════════════════════════════════════════════════════════ */
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  dom.sunIcon.style.display  = isDark ? '' : 'none';
  dom.moonIcon.style.display = isDark ? 'none' : '';
  localStorage.setItem('pm-theme', isDark ? 'light' : 'dark');
}
// Restore saved theme
(function () {
  const saved = localStorage.getItem('pm-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    dom.sunIcon.style.display  = 'none';
    dom.moonIcon.style.display = '';
  }
})();
dom.darkModeToggle.addEventListener('click', toggleDarkMode);

/* ═══════════════════════════════════════════════════════════════════
   PRESET BUTTONS
═══════════════════════════════════════════════════════════════════ */
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.preset.w = parseFloat(btn.dataset.w);
    state.preset.h = parseFloat(btn.dataset.h);
    // Re-init cropper if on step 2
    if (state.currentStep === 2 && state.cropper) {
      state.cropper.setAspectRatio(state.preset.w / state.preset.h);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
   STEP 1 — UPLOAD
═══════════════════════════════════════════════════════════════════ */
function handleFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
    alert('Please upload a JPG or PNG image.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    alert('File size must be under 20 MB.');
    return;
  }
  state.originalFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    state.originalDataURL = e.target.result;
    dom.previewImg.src = e.target.result;
    dom.previewImg.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = dom.previewImg;
      dom.fileMeta.textContent = `${file.name} · ${w} × ${h}px · ${(file.size / 1024).toFixed(0)} KB`;
      dom.uploadZone.hidden = true;
      dom.uploadPreview.hidden = false;
    };
  };
  reader.readAsDataURL(file);
}

// Click to upload
dom.uploadZone.addEventListener('click', () => dom.fileInput.click());
dom.fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

// Drag-and-drop
dom.uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  dom.uploadZone.classList.add('drag-over');
});
dom.uploadZone.addEventListener('dragleave', () => dom.uploadZone.classList.remove('drag-over'));
dom.uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  dom.uploadZone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

// Proceed to crop
dom.proceedToCrop.addEventListener('click', () => {
  goToStep(2);
  initCropper();
});

/* ═══════════════════════════════════════════════════════════════════
   STEP 2 — CROP
═══════════════════════════════════════════════════════════════════ */
function initCropper() {
  if (state.cropper) {
    state.cropper.destroy();
    state.cropper = null;
  }
  dom.cropImage.src = state.originalDataURL;
  state.flipX = 1;
  state.flipY = 1;
  state.rotAngle = 0;
  dom.zoomRange.value = 0;
  dom.rotRange.value  = 0;

  dom.cropImage.onload = () => {
    state.cropper = new Cropper(dom.cropImage, {
      aspectRatio: state.preset.w / state.preset.h,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.85,
      restore: false,
      guides: true,
      center: true,
      highlight: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      minContainerHeight: 320,
      ready() {
        // Initial canvas scale
        this.cropper.scale(state.flipX, state.flipY);
      },
    });
  };
}

// Zoom slider
dom.zoomRange.addEventListener('input', () => {
  if (state.cropper) state.cropper.zoomTo(1 + parseFloat(dom.zoomRange.value));
});

// Rotate slider
dom.rotRange.addEventListener('input', () => {
  if (!state.cropper) return;
  const val = parseFloat(dom.rotRange.value);
  state.rotAngle = val;
  state.cropper.rotateTo(val);
});

// Rotate buttons (90°)
dom.rotLeft.addEventListener('click', () => {
  if (!state.cropper) return;
  state.rotAngle = (state.rotAngle - 90 + 360) % 360;
  state.cropper.rotate(-90);
  dom.rotRange.value = state.rotAngle > 180 ? state.rotAngle - 360 : state.rotAngle;
});
dom.rotRight.addEventListener('click', () => {
  if (!state.cropper) return;
  state.rotAngle = (state.rotAngle + 90) % 360;
  state.cropper.rotate(90);
  dom.rotRange.value = state.rotAngle > 180 ? state.rotAngle - 360 : state.rotAngle;
});

// Flip
dom.flipH.addEventListener('click', () => {
  state.flipX *= -1;
  if (state.cropper) state.cropper.scale(state.flipX, state.flipY);
});
dom.flipV.addEventListener('click', () => {
  state.flipY *= -1;
  if (state.cropper) state.cropper.scale(state.flipX, state.flipY);
});

// Reset crop
dom.resetCrop.addEventListener('click', () => {
  if (!state.cropper) return;
  state.flipX = 1; state.flipY = 1; state.rotAngle = 0;
  dom.zoomRange.value = 0; dom.rotRange.value = 0;
  state.cropper.reset();
  state.cropper.scale(1, 1);
});

// Crop & Continue
dom.cropAndContinue.addEventListener('click', () => {
  if (!state.cropper) return;
  showLoading('Cropping image…');
  setTimeout(() => {
    try {
      // Passport dimensions in pixels at 300 DPI
      const DPI = 300;
      const MM_PER_INCH = 25.4;
      const pw = Math.round((state.preset.w / MM_PER_INCH) * DPI);  // e.g. 413px for 35mm
      const ph = Math.round((state.preset.h / MM_PER_INCH) * DPI);  // e.g. 531px for 45mm

      const canvas = state.cropper.getCroppedCanvas({
        width: pw,
        height: ph,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillColor: '#ffffff',
      });

      state.croppedDataURL = canvas.toDataURL('image/jpeg', 0.97);
      state.enhancedDataURL = state.croppedDataURL; // default
      hideLoading();
      goToStep(3);
      initEnhance();
    } catch (err) {
      hideLoading();
      alert('Crop failed. Please try again.');
      console.error(err);
    }
  }, 50);
});

/* ═══════════════════════════════════════════════════════════════════
   STEP 3 — ENHANCE
═══════════════════════════════════════════════════════════════════ */
function initEnhance() {
  // Reset sliders
  Object.keys(enhanceSliders).forEach(k => {
    enhanceSliders[k].value = 0;
    enhanceVals[k].textContent = 0;
    state.enhance[k] = 0;
  });
  const img = new Image();
  img.onload = () => {
    // Size canvases
    const W = img.width, H = img.height;
    [dom.beforeCanvas, dom.afterCanvas].forEach(c => {
      c.width = W; c.height = H;
    });
    // Draw original
    dom.beforeCanvas.getContext('2d').drawImage(img, 0, 0);
    // Draw initial "enhanced" (same as original)
    dom.afterCanvas.getContext('2d').drawImage(img, 0, 0);
  };
  img.src = state.croppedDataURL;
}

// Listen to all enhance sliders
Object.keys(enhanceSliders).forEach(key => {
  enhanceSliders[key].addEventListener('input', () => {
    state.enhance[key] = parseFloat(enhanceSliders[key].value);
    enhanceVals[key].textContent = state.enhance[key];
    applyEnhance();
  });
});

// Auto enhance — safe, portrait-friendly defaults
dom.autoEnhanceBtn.addEventListener('click', () => {
  showLoading('Auto enhancing…');
  setTimeout(() => {
    const vals = { brightness: 8, contrast: 12, saturation: 5, sharpness: 2, warmth: 6 };
    Object.keys(vals).forEach(k => {
      state.enhance[k] = vals[k];
      enhanceSliders[k].value = vals[k];
      enhanceVals[k].textContent = vals[k];
    });
    applyEnhance();
    hideLoading();
  }, 200);
});

// Reset enhance
dom.resetEnhance.addEventListener('click', () => {
  Object.keys(enhanceSliders).forEach(k => {
    state.enhance[k] = 0;
    enhanceSliders[k].value = 0;
    enhanceVals[k].textContent = 0;
  });
  applyEnhance();
});

function applyEnhance() {
  const img = new Image();
  img.onload = () => {
    const W = img.width, H = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let imageData = ctx.getImageData(0, 0, W, H);
    imageData = adjustBrightness(imageData, state.enhance.brightness);
    imageData = adjustContrast(imageData, state.enhance.contrast);
    imageData = adjustSaturation(imageData, state.enhance.saturation);
    imageData = adjustWarmth(imageData, state.enhance.warmth);
    ctx.putImageData(imageData, 0, 0);

    // Sharpness via unsharp mask
    if (state.enhance.sharpness > 0) {
      applyUnsharpMask(ctx, W, H, state.enhance.sharpness);
    }

    // Draw to afterCanvas
    const afterCtx = dom.afterCanvas.getContext('2d');
    dom.afterCanvas.width = W; dom.afterCanvas.height = H;
    afterCtx.drawImage(canvas, 0, 0);

    state.enhancedDataURL = canvas.toDataURL('image/jpeg', 0.97);
  };
  img.src = state.croppedDataURL;
}

/* ── Pixel manipulation helpers ── */

function adjustBrightness(imgData, value) {
  const d = imgData.data;
  const v = value * 2.55; // -100..100 → -255..255
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = clamp(d[i]   + v);
    d[i+1] = clamp(d[i+1] + v);
    d[i+2] = clamp(d[i+2] + v);
  }
  return imgData;
}

function adjustContrast(imgData, value) {
  const d = imgData.data;
  const factor = (259 * (value + 255)) / (255 * (259 - value));
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = clamp(factor * (d[i]   - 128) + 128);
    d[i+1] = clamp(factor * (d[i+1] - 128) + 128);
    d[i+2] = clamp(factor * (d[i+2] - 128) + 128);
  }
  return imgData;
}

function adjustSaturation(imgData, value) {
  const d = imgData.data;
  const s = value / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i]   = clamp(gray + (r - gray) * (1 + s));
    d[i+1] = clamp(gray + (g - gray) * (1 + s));
    d[i+2] = clamp(gray + (b - gray) * (1 + s));
  }
  return imgData;
}

function adjustWarmth(imgData, value) {
  // Positive = warmer (add red, subtract blue), negative = cooler
  const d = imgData.data;
  const r = value > 0 ? value * 1.5 : 0;
  const b = value < 0 ? -value * 1.5 : 0;
  const g = Math.abs(value) * 0.2;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = clamp(d[i]   + r);
    d[i+1] = clamp(d[i+1] + (value > 0 ? g * 0.3 : -g * 0.3));
    d[i+2] = clamp(d[i+2] - b + (value < 0 ? g : 0));
  }
  return imgData;
}

function applyUnsharpMask(ctx, W, H, amount) {
  // Simple unsharp mask: original - blurred * amount
  const original = ctx.getImageData(0, 0, W, H);
  const blurred  = ctx.getImageData(0, 0, W, H);

  // 3×3 Gaussian-like blur
  gaussianBlur(blurred, W, H);

  const o = original.data, b = blurred.data;
  for (let i = 0; i < o.length; i += 4) {
    o[i]   = clamp(o[i]   + (o[i]   - b[i])   * amount * 0.25);
    o[i+1] = clamp(o[i+1] + (o[i+1] - b[i+1]) * amount * 0.25);
    o[i+2] = clamp(o[i+2] + (o[i+2] - b[i+2]) * amount * 0.25);
  }
  ctx.putImageData(original, 0, 0);
}

function gaussianBlur(imgData, W, H) {
  // Simple box blur approximation
  const kernel = [1/9,1/9,1/9, 1/9,1/9,1/9, 1/9,1/9,1/9];
  const d = imgData.data.slice();
  const out = imgData.data;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let r=0,g=0,b=0,k=0;
      for (let ky=-1; ky<=1; ky++) {
        for (let kx=-1; kx<=1; kx++) {
          const idx = ((y+ky)*W + (x+kx)) * 4;
          r += d[idx]   * kernel[k];
          g += d[idx+1] * kernel[k];
          b += d[idx+2] * kernel[k];
          k++;
        }
      }
      const idx = (y*W+x)*4;
      out[idx]   = clamp(r);
      out[idx+1] = clamp(g);
      out[idx+2] = clamp(b);
    }
  }
}

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

// Back button from enhance
dom.backToUpload.addEventListener('click', () => goToStep(1));

// Proceed to generate
dom.generateSheet.addEventListener('click', () => {
  showLoading('Generating print sheet…');
  // Small timeout to let UI update
  setTimeout(() => {
    generatePassportSheet();
    hideLoading();
    goToStep(4);
  }, 100);
});

/* ═══════════════════════════════════════════════════════════════════
   STEP 4 — GENERATE SHEET
   Canvas: 1800 × 1200 px (6×4 in @ 300 DPI)
   Layout: 8 photos, 4 per row, 2 rows
═══════════════════════════════════════════════════════════════════ */
function generatePassportSheet() {
  const SHEET_W = 1800;
  const SHEET_H = 1200;
  const COLS = 4;
  const ROWS = 2;
  const DPI  = 300;
  const MM_PER_INCH = 25.4;

  // Passport photo pixel size at 300 DPI
  const photoW = Math.round((state.preset.w / MM_PER_INCH) * DPI);
  const photoH = Math.round((state.preset.h / MM_PER_INCH) * DPI);

  // Calculate spacing so photos fit perfectly
  // Total photo width = COLS * photoW, remaining = SHEET_W - totalPhotoW
  // Distribute as margins: left/right margin + gap between photos
  // Use: left margin = right margin = gap (equal spacing)
  // SHEET_W = leftMargin + COLS*photoW + (COLS-1)*gap + rightMargin
  // With leftMargin = rightMargin = gap → SHEET_W = (COLS+1)*gap + COLS*photoW
  // But cap photo size to ensure fit

  // Scale photo down if it doesn't fit
  let scaledW = photoW, scaledH = photoH;
  const maxPhotoW = Math.floor((SHEET_W - 60) / COLS); // minimum 15px margins+gaps
  const maxPhotoH = Math.floor((SHEET_H - 60) / ROWS);
  if (scaledW > maxPhotoW || scaledH > maxPhotoH) {
    const scale = Math.min(maxPhotoW / scaledW, maxPhotoH / scaledH);
    scaledW = Math.floor(scaledW * scale);
    scaledH = Math.floor(scaledH * scale);
  }

  // Compute gaps and margins (equal distribution)
  const totalPhotoW = COLS * scaledW;
  const totalPhotoH = ROWS * scaledH;
  const hSpace = SHEET_W - totalPhotoW;
  const vSpace = SHEET_H - totalPhotoH;
  const hGap = Math.floor(hSpace / (COLS + 1));
  const vGap = Math.floor(vSpace / (ROWS + 1));
  // Adjust margins to perfectly center if rounding
  const hMargin = Math.floor((SHEET_W - totalPhotoW - (COLS - 1) * hGap) / 2);
  const vMargin = Math.floor((SHEET_H - totalPhotoH - (ROWS - 1) * vGap) / 2);

  const canvas = dom.sheetCanvas;
  canvas.width  = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);

  // Draw cut guide lines (very faint)
  ctx.strokeStyle = 'rgba(150,150,150,0.3)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;

  const img = new Image();
  img.onload = () => {
    let drawn = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = hMargin + col * (scaledW + hGap);
        const y = vMargin + row * (scaledH + vGap);

        // Draw photo with a thin white border
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, y - 1, scaledW + 2, scaledH + 2);

        ctx.drawImage(img, x, y, scaledW, scaledH);

        // Cut guide lines around each photo
        ctx.beginPath();
        // Top
        ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 10);
        ctx.moveTo(x + scaledW, y - 4); ctx.lineTo(x + scaledW, y - 10);
        // Bottom
        ctx.moveTo(x, y + scaledH + 4); ctx.lineTo(x, y + scaledH + 10);
        ctx.moveTo(x + scaledW, y + scaledH + 4); ctx.lineTo(x + scaledW, y + scaledH + 10);
        // Left
        ctx.moveTo(x - 4, y); ctx.lineTo(x - 10, y);
        ctx.moveTo(x - 4, y + scaledH); ctx.lineTo(x - 10, y + scaledH);
        // Right
        ctx.moveTo(x + scaledW + 4, y); ctx.lineTo(x + scaledW + 10, y);
        ctx.moveTo(x + scaledW + 4, y + scaledH); ctx.lineTo(x + scaledW + 10, y + scaledH);
        ctx.stroke();

        drawn++;
      }
    }

    // Sheet metadata text (bottom right, tiny)
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(150,150,150,0.6)';
    ctx.font = '22px DM Sans, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`PassportMaker · ${state.preset.w}×${state.preset.h}mm · 300 DPI`, SHEET_W - 20, SHEET_H - 14);

    state.sheetDataURL = canvas.toDataURL('image/jpeg', 0.97);
  };
  img.src = state.enhancedDataURL || state.croppedDataURL;
}

dom.backToEnhance.addEventListener('click', () => goToStep(3));
dom.proceedToDownload.addEventListener('click', () => {
  // Mirror sheet canvas to final canvas
  const fc = dom.finalCanvas;
  const sc = dom.sheetCanvas;
  fc.width  = sc.width;
  fc.height = sc.height;
  fc.getContext('2d').drawImage(sc, 0, 0);
  goToStep(5);
});

/* ═══════════════════════════════════════════════════════════════════
   STEP 5 — DOWNLOAD & PRINT
═══════════════════════════════════════════════════════════════════ */

// Download JPG
dom.downloadJpg.addEventListener('click', () => {
  if (!state.sheetDataURL) return;
  showLoading('Preparing JPG…');
  setTimeout(() => {
    const a = document.createElement('a');
    a.href = state.sheetDataURL;
    a.download = 'passport-photo-sheet.jpg';
    a.click();
    hideLoading();
  }, 100);
});

// Download PDF (6×4 landscape, no margins, 300 DPI equivalent)
dom.downloadPdf.addEventListener('click', async () => {
  if (!state.sheetDataURL) return;
  showLoading('Generating PDF…');
  try {
    // Wait for jsPDF to be ready
    await waitForjsPDF();
    const { jsPDF } = window.jspdf;
    // 6×4 in landscape = 152.4mm × 101.6mm
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'in',
      format: [6, 4],
    });
    pdf.addImage(state.sheetDataURL, 'JPEG', 0, 0, 6, 4, undefined, 'FAST');
    pdf.save('passport-photo-sheet.pdf');
  } catch (err) {
    alert('PDF generation failed. Please try downloading as JPG instead.');
    console.error(err);
  } finally {
    hideLoading();
  }
});

function waitForjsPDF(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (window.jspdf?.jsPDF) return resolve();
    const start = Date.now();
    const check = setInterval(() => {
      if (window.jspdf?.jsPDF) { clearInterval(check); resolve(); }
      if (Date.now() - start > timeout) { clearInterval(check); reject(new Error('jsPDF not loaded')); }
    }, 100);
  });
}

// Print
dom.printSheet.addEventListener('click', () => {
  if (!state.sheetDataURL) return;
  showLoading('Preparing print…');

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @page {
    size: 6in 4in landscape;
    margin: 0;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width: 6in; height: 4in;
    overflow: hidden;
    background: #fff;
  }
  img {
    display: block;
    width: 6in; height: 4in;
    object-fit: fill;
  }
</style>
</head>
<body>
  <img src="${state.sheetDataURL}" />
</body>
</html>`;

  const frame = $('printFrame');
  frame.style.display = 'none';
  frame.srcdoc = html;
  frame.onload = () => {
    hideLoading();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }, 300);
  };
});

// Navigation
dom.backToSheet.addEventListener('click', () => goToStep(4));
dom.startOver.addEventListener('click', () => {
  // Reset all state
  state.originalFile = null;
  state.originalDataURL = null;
  state.croppedDataURL = null;
  state.enhancedDataURL = null;
  state.sheetDataURL = null;
  if (state.cropper) { state.cropper.destroy(); state.cropper = null; }

  dom.uploadZone.hidden    = false;
  dom.uploadPreview.hidden = true;
  dom.previewImg.src = '';
  dom.fileInput.value = '';

  goToStep(1);
});

/* ═══════════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideLoading();
  // D = toggle dark mode
  if (e.key === 'd' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
    toggleDarkMode();
  }
});

/* ═══════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════ */
console.log('%cPassportMaker loaded ✓', 'color:#2563eb;font-weight:bold;font-size:14px');
