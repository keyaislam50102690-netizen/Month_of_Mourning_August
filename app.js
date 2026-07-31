
(() => {
  'use strict';

  const CANVAS_SIZE = 1200;
  const CIRCLE_CX  = 600;
  const CIRCLE_CY  = 599;
  const CIRCLE_R   = 534;

  const canvas      = document.getElementById('canvas');
  const ctx         = canvas.getContext('2d');
  const fileInput   = document.getElementById('fileInput');
  const resetBtn    = document.getElementById('resetBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const zoomValue   = document.getElementById('zoomValue');
  const zoomOutBtn  = document.getElementById('zoomOutBtn');
  const zoomInBtn   = document.getElementById('zoomInBtn');
  const emptyHint   = document.getElementById('emptyHint');
  const colorBtn    = document.getElementById('colorBtn');
  const bwBtn       = document.getElementById('bwBtn');
  const downloadCountSpan = document.getElementById('downloadCount');

  let dlCount = parseInt(localStorage.getItem('downloadCount') || '0', 10);
  if (downloadCountSpan) downloadCountSpan.textContent = dlCount;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ─── State ───────────────────────────────────────────────────────────────────
  const state = {
    frame: null,
    user:  null,
    isBw:  false,

    baseScale: 1,
    scale: 1,
    tx: CIRCLE_CX,
    ty: CIRCLE_CY,

    dragging:  false,
    hasDragged: false,   // ← prevents click opening file picker after a drag
    lastX: 0,
    lastY: 0,

    // Pinch-to-zoom
    pinchActive:    false,
    pinchStartDist:  0,
    pinchStartScale: 1,
    pinchStartMidX:  0,
    pinchStartMidY:  0,
    pinchStartTx:    0,
    pinchStartTy:    0,
  };

  // ─── Load frame overlay ───────────────────────────────────────────────────────
  const frameImg = new Image();
  frameImg.crossOrigin = 'anonymous';
  frameImg.src = 'frame.png';
  frameImg.onload  = () => { state.frame = frameImg; render(); };
  frameImg.onerror = () => toast('Could not load frame.png');

  // ─── Render ───────────────────────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (state.user) {
      if (state.isBw) ctx.filter = 'grayscale(100%)';
      const s  = state.baseScale * state.scale;
      const dw = state.user.width  * s;
      const dh = state.user.height * s;
      ctx.drawImage(state.user, state.tx - dw / 2, state.ty - dh / 2, dw, dh);
      ctx.filter = 'none';
    } else {
      // placeholder disc so the frame cutout is visible before upload
      ctx.fillStyle = '#2a2e2c';
      ctx.beginPath();
      ctx.arc(CIRCLE_CX, CIRCLE_CY, CIRCLE_R, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.frame) {
      ctx.drawImage(state.frame, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
  }

  // ─── Load user photo ──────────────────────────────────────────────────────────
  async function loadUserPhoto(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('Please pick an image file');
      return;
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) {
      bitmap = await loadAsImage(file);
    }

    state.user = bitmap;
    const minSide    = Math.min(bitmap.width, bitmap.height);
    state.baseScale  = (CIRCLE_R * 2) / minSide;
    state.scale      = 1;
    state.tx         = CIRCLE_CX;
    state.ty         = CIRCLE_CY;

    zoomValue.textContent = '100%';
    zoomOutBtn.disabled = false;
    zoomInBtn.disabled  = false;
    resetBtn.disabled   = false;
    downloadBtn.disabled = false;
    emptyHint.classList.add('hidden');
    canvas.classList.remove('empty');
    render();
  }

  function loadAsImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // ─── Coordinate helper ────────────────────────────────────────────────────────
  function clientToCanvas(clientX, clientY) {
    const rect  = canvas.getBoundingClientRect();
    const ratio = CANVAS_SIZE / rect.width;
    return {
      x: (clientX - rect.left) * ratio,
      y: (clientY - rect.top)  * ratio,
    };
  }

  // ─── Touch events ─────────────────────────────────────────────────────────────
  // FIX: must be { passive: false } so touchmove can call e.preventDefault()
  // and stop the page from scrolling while the user pans/pinches the canvas.
  canvas.addEventListener('touchstart', (e) => {
    if (!state.user) return;   // let the tap fall through to the label/button

    if (e.touches.length === 1) {
      e.preventDefault();
      state.dragging  = true;
      state.hasDragged = false;
      state.pinchActive = false;
      canvas.classList.add('dragging');
      state.lastX = e.touches[0].clientX;
      state.lastY = e.touches[0].clientY;

    } else if (e.touches.length === 2) {
      e.preventDefault();
      state.dragging    = false;
      state.pinchActive = true;

      const t1 = e.touches[0], t2 = e.touches[1];
      state.pinchStartDist  = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      state.pinchStartScale = state.scale;

      const mid = clientToCanvas(
        (t1.clientX + t2.clientX) / 2,
        (t1.clientY + t2.clientY) / 2,
      );
      state.pinchStartMidX = mid.x;
      state.pinchStartMidY = mid.y;
      state.pinchStartTx   = state.tx;
      state.pinchStartTy   = state.ty;
    }
  }, { passive: false });   // ← FIX: was passive:true — broke all touch interaction

  canvas.addEventListener('touchmove', (e) => {
    if (!state.user) return;

    if (state.pinchActive && e.touches.length === 2) {
      e.preventDefault();

      const t1 = e.touches[0], t2 = e.touches[1];
      const dist    = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const factor   = dist / (state.pinchStartDist || 1);
      const newScale = clamp(state.pinchStartScale * factor, 0.2, 3.0);

      const scaleRatio = newScale / state.pinchStartScale;
      state.tx = state.pinchStartMidX + (state.pinchStartTx - state.pinchStartMidX) * scaleRatio;
      state.ty = state.pinchStartMidY + (state.pinchStartTy - state.pinchStartMidY) * scaleRatio;

      setScale(newScale);

    } else if (state.dragging && e.touches.length === 1) {
      e.preventDefault();

      const p   = e.touches[0];
      const cur  = clientToCanvas(p.clientX, p.clientY);
      const last = clientToCanvas(state.lastX, state.lastY);
      state.tx += cur.x - last.x;
      state.ty += cur.y - last.y;
      state.lastX = p.clientX;
      state.lastY = p.clientY;
      state.hasDragged = true;
      render();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      state.dragging    = false;
      state.pinchActive = false;
      canvas.classList.remove('dragging');
    } else if (e.touches.length === 1 && state.pinchActive) {
      // finger lifted during pinch — switch back to single-finger drag
      state.pinchActive = false;
      state.dragging    = true;
      state.lastX = e.touches[0].clientX;
      state.lastY = e.touches[0].clientY;
    }
  });

  canvas.addEventListener('touchcancel', () => {
    state.dragging    = false;
    state.pinchActive = false;
    canvas.classList.remove('dragging');
  });

  // ─── Mouse events ─────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    if (!state.user) { fileInput.click(); return; }
    state.dragging   = true;
    state.hasDragged = false;
    canvas.classList.add('dragging');
    state.lastX = e.clientX;
    state.lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.dragging || !state.user) return;
    const cur  = clientToCanvas(e.clientX, e.clientY);
    const last = clientToCanvas(state.lastX, state.lastY);
    state.tx += cur.x - last.x;
    state.ty += cur.y - last.y;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    state.hasDragged = true;
    render();
  });

  window.addEventListener('mouseup', () => {
    state.dragging = false;
    canvas.classList.remove('dragging');
  });

  // FIX: only open file picker on click if the user did NOT drag the photo.
  // Previously, finishing a drag would also trigger click → file picker opened.
  canvas.addEventListener('click', () => {
    if (!state.user && !state.hasDragged) fileInput.click();
    state.hasDragged = false;
  });

  canvas.classList.add('empty');

  // ─── Scroll / wheel zoom ──────────────────────────────────────────────────────
  canvas.addEventListener('wheel', (e) => {
    if (!state.user) return;
    e.preventDefault();
    setScale(state.scale * (1 + (-e.deltaY * 0.0015)));
  }, { passive: false });

  // ─── File input ───────────────────────────────────────────────────────────────
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadUserPhoto(f);
    // Reset so same file can be re-selected
    e.target.value = '';
  });

  // ─── Drag-and-drop ────────────────────────────────────────────────────────────
  ['dragenter', 'dragover'].forEach(ev => {
    canvas.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      canvas.parentElement.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend'].forEach(ev => {
    canvas.addEventListener(ev, () => {
      canvas.parentElement.classList.remove('dragover');
    });
  });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas.parentElement.classList.remove('dragover');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadUserPhoto(f);
  });


  // ─── Zoom buttons ─────────────────────────────────────────────────────────────
  zoomOutBtn.addEventListener('click', () => {
    if (!state.user) return;
    setScale(state.scale - 0.01);
  });
  zoomInBtn.addEventListener('click', () => {
    if (!state.user) return;
    setScale(state.scale + 0.01);
  });

  // ─── Filter buttons ───────────────────────────────────────────────────────────
  colorBtn.addEventListener('click', () => {
    state.isBw = false;
    colorBtn.classList.add('active');
    bwBtn.classList.remove('active');
    render();
  });
  bwBtn.addEventListener('click', () => {
    state.isBw = true;
    bwBtn.classList.add('active');
    colorBtn.classList.remove('active');
    render();
  });

  // ─── Reset button ─────────────────────────────────────────────────────────────
  resetBtn.addEventListener('click', () => {
    if (!state.user) return;
    state.scale = 1;
    state.tx    = CIRCLE_CX;
    state.ty    = CIRCLE_CY;
    zoomValue.textContent = '100%';
    render();
  });

  // ─── Download button ─────────────────────────────────────────────────────────
  downloadBtn.addEventListener('click', () => {
    if (!state.user) return;
    canvas.toBlob((blob) => {
      if (!blob) { toast('Export failed'); return; }
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'Month_of_Mourning_August.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Downloaded ✓');
      
      dlCount++;
      localStorage.setItem('downloadCount', dlCount);
      if (downloadCountSpan) downloadCountSpan.textContent = dlCount;
    }, 'image/png');
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function setScale(newScale) {
    state.scale = clamp(newScale, 0.2, 3.0);
    const pct = Math.round(state.scale * 100);
    zoomValue.textContent = pct + '%';
    render();
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ─── Toast notification ───────────────────────────────────────────────────────
  let toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // Prevent accidental double-tap zoom on the whole page
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

  // ─── Initial render ───────────────────────────────────────────────────────────
  render();
})();
