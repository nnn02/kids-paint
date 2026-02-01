// ============================================================
// Service Worker Registration
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ============================================================
// Color palette
// ============================================================
const COLORS = [
  '#000000','#444444','#9e9e9e','#ffffff',
  '#ff0000','#f44336','#e91e63','#ff69b4',
  '#ff9800','#ffeb3b','#fff176',
  '#4caf50','#8bc34a','#00e676',
  '#00bcd4','#2196f3','#3f51b5',
  '#9c27b0','#ce93d8','#795548',
];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const trainLayer = document.getElementById('train-layer');
const trainCtx = trainLayer.getContext('2d');
const paletteEl = document.getElementById('color-palette');

let tool = 'pen'; // pen | eraser | fill | track
let currentColor = '#000000';
let strokeWidth = 5;
let drawing = false;
let lastX, lastY;

// History for undo/redo (avoid shadowing window.history)
let undoHistory = [];
let redoStack = [];
const MAX_HISTORY = 50;

// Track (rail) data: array of strokes, each stroke is [{x,y}, ...]
let trackStrokes = [];
let currentTrackStroke = [];
let trackRedoStack = [];
// actionLog tracks whether each undo state was a 'draw' or 'track'
let actionLog = [];
let actionRedoLog = [];

// Train animation
let trainAnimId = null;
let trainType = null;
let trainSpeed = 2;

// ============================================================
// Canvas resize
// ============================================================
function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  // Save current drawing as image to preserve on resize
  const tmpC = document.createElement('canvas');
  tmpC.width = canvas.width; tmpC.height = canvas.height;
  tmpC.getContext('2d').drawImage(canvas, 0, 0);
  canvas.width = w; canvas.height = h;
  trainLayer.width = w; trainLayer.height = h;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(tmpC, 0, 0);
}

function saveState(actionType) {
  if (undoHistory.length >= MAX_HISTORY) {
    undoHistory.shift();
    actionLog.shift();
  }
  undoHistory.push(canvas.toDataURL());
  actionLog.push(actionType || 'draw');
  redoStack = [];
  actionRedoLog = [];
  trackRedoStack = [];
  updateButtons();
}

function updateButtons() {
  document.getElementById('undoBtn').disabled = undoHistory.length <= 0;
  document.getElementById('redoBtn').disabled = redoStack.length <= 0;
}

function restoreState(dataUrl) {
  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
}

function initCanvas() {
  resizeCanvas();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveState();
}

// ============================================================
// Palette
// ============================================================
COLORS.forEach(c => {
  const btn = document.createElement('div');
  btn.className = 'color-btn' + (c === currentColor ? ' selected' : '');
  btn.style.background = c;
  btn.dataset.color = c;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentColor = c;
  });
  paletteEl.appendChild(btn);
});

// ============================================================
// Tool selection
// ============================================================
function setTool(t) {
  tool = t;
  document.getElementById('penBtn').className = 'tool-btn' + (t === 'pen' ? ' active-pen' : '');
  document.getElementById('eraserBtn').className = 'tool-btn' + (t === 'eraser' ? ' active-eraser' : '');
  document.getElementById('fillBtn').className = 'tool-btn' + (t === 'fill' ? ' active-fill' : '');
  document.getElementById('trackBtn').className = 'tool-btn' + (t === 'track' ? ' active-track' : '');
  canvas.style.cursor = t === 'fill' ? 'cell' : 'crosshair';
  document.getElementById('train-bar').classList.toggle('show', t === 'track');
}
document.getElementById('penBtn').addEventListener('click', () => setTool('pen'));
document.getElementById('eraserBtn').addEventListener('click', () => setTool('eraser'));
document.getElementById('fillBtn').addEventListener('click', () => setTool('fill'));
document.getElementById('trackBtn').addEventListener('click', () => setTool('track'));

document.getElementById('stroke-slider').addEventListener('input', e => {
  strokeWidth = parseInt(e.target.value);
});
document.getElementById('speed-slider').addEventListener('input', e => {
  trainSpeed = parseInt(e.target.value);
});

// ============================================================
// Drawing helpers
// ============================================================
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

// ============================================================
// Track drawing (rails)
// ============================================================
function drawRailSegment(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 1) return;
  const nx = -dy / len * 5;
  const ny = dx / len * 5;

  ctx.strokeStyle = '#795548';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1 + nx, y1 + ny);
  ctx.lineTo(x2 + nx, y2 + ny);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1 - nx, y1 - ny);
  ctx.lineTo(x2 - nx, y2 - ny);
  ctx.stroke();

  ctx.strokeStyle = '#8d6e63';
  ctx.lineWidth = 2;
}

function drawSleepers(stroke) {
  let distAccum = 0;
  const sleeperInterval = 14;
  for (let i = 1; i < stroke.length; i++) {
    const dx = stroke[i].x - stroke[i-1].x;
    const dy = stroke[i].y - stroke[i-1].y;
    const segLen = Math.sqrt(dx*dx + dy*dy);
    if (segLen < 1) continue;
    const nx = -dy / segLen;
    const ny = dx / segLen;

    distAccum += segLen;
    while (distAccum >= sleeperInterval) {
      distAccum -= sleeperInterval;
      const t = 1 - distAccum / segLen;
      const sx = stroke[i-1].x + dx * t;
      const sy = stroke[i-1].y + dy * t;
      ctx.beginPath();
      ctx.moveTo(sx + nx * 8, sy + ny * 8);
      ctx.lineTo(sx - nx * 8, sy - ny * 8);
      ctx.strokeStyle = '#8d6e63';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

// ============================================================
// Main drawing events
// ============================================================
function startDraw(e) {
  if (tool === 'fill') {
    const pos = getPos(e);
    floodFill(Math.round(pos.x), Math.round(pos.y), currentColor);
    saveState();
    return;
  }
  if (tool === 'track') {
    drawing = true;
    const pos = getPos(e);
    currentTrackStroke = [{ x: pos.x, y: pos.y }];
    lastX = pos.x; lastY = pos.y;
    return;
  }
  drawing = true;
  const pos = getPos(e);
  lastX = pos.x; lastY = pos.y;
  ctx.beginPath();
  ctx.arc(lastX, lastY, strokeWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = tool === 'eraser' ? '#ffffff' : currentColor;
  ctx.fill();
}

function draw(e) {
  if (!drawing) return;
  e.preventDefault();
  const pos = getPos(e);

  if (tool === 'track') {
    drawRailSegment(lastX, lastY, pos.x, pos.y);
    currentTrackStroke.push({ x: pos.x, y: pos.y });
    lastX = pos.x; lastY = pos.y;
    return;
  }

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(pos.x, pos.y);
  ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : currentColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  lastX = pos.x; lastY = pos.y;
}

function endDraw() {
  if (!drawing) return;
  drawing = false;

  if (tool === 'track' && currentTrackStroke.length > 1) {
    drawSleepers(currentTrackStroke);
    const simplified = simplifyPath(currentTrackStroke, 3);
    trackStrokes.push(simplified);
    currentTrackStroke = [];
    saveState('track');
    return;
  }

  saveState('draw');
}

function simplifyPath(pts, step) {
  if (pts.length <= 2) return pts.slice();
  const result = [pts[0]];
  for (let i = step; i < pts.length - 1; i += step) {
    result.push(pts[i]);
  }
  result.push(pts[pts.length - 1]);
  return result;
}

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener('touchmove', e => { e.preventDefault(); draw(e); }, { passive: false });
canvas.addEventListener('touchend', e => { e.preventDefault(); endDraw(); }, { passive: false });

// ============================================================
// Flood fill
// ============================================================
function floodFill(startX, startY, fillColor) {
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
  const idx = (startY * w + startX) * 4;
  const tR = data[idx], tG = data[idx+1], tB = data[idx+2], tA = data[idx+3];
  const tmp = document.createElement('canvas').getContext('2d');
  tmp.fillStyle = fillColor; tmp.fillRect(0,0,1,1);
  const fc = tmp.getImageData(0,0,1,1).data;
  const fR = fc[0], fG = fc[1], fB = fc[2], fA = fc[3];
  if (tR === fR && tG === fG && tB === fB && tA === fA) return;
  const match = (i) =>
    Math.abs(data[i]-tR)<=10 && Math.abs(data[i+1]-tG)<=10 &&
    Math.abs(data[i+2]-tB)<=10 && Math.abs(data[i+3]-tA)<=10;
  const stack = [startX, startY];
  const visited = new Uint8Array(w * h);
  while (stack.length > 0) {
    const sy = stack.pop(), sx = stack.pop();
    const si = sy * w + sx;
    if (visited[si]) continue;
    visited[si] = 1;
    const pi = si * 4;
    if (!match(pi)) continue;
    data[pi]=fR; data[pi+1]=fG; data[pi+2]=fB; data[pi+3]=fA;
    if (sx>0) stack.push(sx-1,sy);
    if (sx<w-1) stack.push(sx+1,sy);
    if (sy>0) stack.push(sx,sy-1);
    if (sy<h-1) stack.push(sx,sy+1);
  }
  ctx.putImageData(imageData, 0, 0);
}

// ============================================================
// Undo / Redo
// ============================================================
document.getElementById('undoBtn').addEventListener('click', () => {
  if (undoHistory.length <= 1) return;
  redoStack.push(undoHistory.pop());
  const act = actionLog.pop();
  actionRedoLog.push(act);
  if (act === 'track' && trackStrokes.length > 0) {
    trackRedoStack.push(trackStrokes.pop());
  }
  restoreState(undoHistory[undoHistory.length - 1]);
  updateButtons();
});
document.getElementById('redoBtn').addEventListener('click', () => {
  if (redoStack.length === 0) return;
  const state = redoStack.pop();
  undoHistory.push(state);
  const act = actionRedoLog.pop();
  actionLog.push(act);
  if (act === 'track' && trackRedoStack.length > 0) {
    trackStrokes.push(trackRedoStack.pop());
  }
  restoreState(state);
  updateButtons();
});

// ============================================================
// Clear
// ============================================================
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('overlay').classList.add('show');
});
document.getElementById('dialogCancel').addEventListener('click', () => {
  document.getElementById('overlay').classList.remove('show');
});
document.getElementById('dialogConfirm').addEventListener('click', () => {
  document.getElementById('overlay').classList.remove('show');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  undoHistory = []; redoStack = [];
  trackStrokes = []; trackRedoStack = [];
  actionLog = []; actionRedoLog = [];
  stopTrain();
  saveState();
});

// ============================================================
// Save
// ============================================================
document.getElementById('saveBtn').addEventListener('click', async () => {
  const tmpC = document.createElement('canvas');
  tmpC.width = canvas.width; tmpC.height = canvas.height;
  const tmpCtx = tmpC.getContext('2d');
  tmpCtx.drawImage(canvas, 0, 0);
  tmpCtx.drawImage(trainLayer, 0, 0);

  // Try Web Share API first (works well on iOS PWA)
  if (navigator.canShare) {
    try {
      const blob = await new Promise(r => tmpC.toBlob(r, 'image/png'));
      const file = new File([blob], 'oekaki_' + Date.now() + '.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'おえかき' });
        showSnackbar('共有しました！', '#4caf50');
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
    }
  }

  // Fallback: download link
  const link = document.createElement('a');
  link.download = 'oekaki_' + Date.now() + '.png';
  link.href = tmpC.toDataURL('image/png');
  link.click();
  showSnackbar('保存しました！', '#4caf50');
});

function showSnackbar(msg, color) {
  const el = document.getElementById('snackbar');
  el.textContent = msg;
  el.style.background = color;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ============================================================
// Train definitions
// ============================================================
const TRAINS = {
  steam: {
    cars: [
      { w: 40, h: 22, draw: drawSteamLoco },
      { w: 30, h: 18, draw: drawCoalCar },
      { w: 30, h: 18, draw: drawPassengerCar },
    ]
  },
  commuter: {
    cars: [
      { w: 38, h: 18, draw: drawCommuterCar, head: true },
      { w: 38, h: 18, draw: drawCommuterCar },
      { w: 38, h: 18, draw: drawCommuterCar },
      { w: 38, h: 18, draw: drawCommuterCar, tail: true },
    ]
  },
  shinkansen: {
    cars: [
      { w: 44, h: 16, draw: drawShinkansenHead },
      { w: 36, h: 16, draw: drawShinkansenCar },
      { w: 36, h: 16, draw: drawShinkansenCar },
      { w: 44, h: 16, draw: drawShinkansenTail },
    ]
  },
  monorail: {
    cars: [
      { w: 36, h: 20, draw: drawMonorailCar, head: true },
      { w: 36, h: 20, draw: drawMonorailCar },
      { w: 36, h: 20, draw: drawMonorailCar, tail: true },
    ]
  }
};

let trainColor = '#43a047';

function drawSteamLoco(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor; c.fillRect(-w/2, -h/2, w, h);
  c.fillStyle = trainColor;
  c.beginPath(); c.arc(w/4, 0, h/2-2, 0, Math.PI*2); c.fill();
  c.fillStyle = '#222';
  c.fillRect(w/4-3, -h/2-8, 6, 10);
  c.fillStyle = 'rgba(200,200,200,0.6)';
  const t = Date.now() / 300;
  for (let i = 0; i < 3; i++) {
    const sy = -h/2 - 12 - i*8 - (t % 5)*2;
    const sx = w/4 + Math.sin(t + i) * 4;
    c.beginPath(); c.arc(sx, sy, 4 + i*2, 0, Math.PI*2); c.fill();
  }
  c.fillStyle = '#777';
  [-w/4, 0, w/4].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-2, 4, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawCoalCar(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor; c.fillRect(-w/2, -h/2, w, h);
  c.fillStyle = '#222';
  c.beginPath();
  c.moveTo(-w/2+3, -h/2+2); c.lineTo(w/2-3, -h/2+2);
  c.lineTo(w/2-5, -h/2-4); c.lineTo(-w/2+5, -h/2-4);
  c.closePath(); c.fill();
  c.fillStyle = '#777';
  [-w/4, w/4].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-2, 3, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawPassengerCar(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor;
  c.beginPath(); c.roundRect(-w/2, -h/2, w, h, 3); c.fill();
  c.fillStyle = '#bbdefb';
  for (let i = -1; i <= 1; i++) {
    c.fillRect(i*9 - 3, -h/2+3, 6, 6);
  }
  c.fillStyle = '#555';
  [-w/4, w/4].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-2, 3, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawCommuterCar(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor;
  c.beginPath(); c.roundRect(-w/2, -h/2, w, h, 4); c.fill();
  c.fillStyle = '#fff';
  c.fillRect(-w/2, -2, w, 4);
  c.fillStyle = '#e3f2fd';
  for (let i = -2; i <= 2; i++) {
    c.fillRect(i*8 - 3, -h/2+3, 5, 5);
  }
  c.fillStyle = '#444';
  [-w/3, w/3].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-1, 3, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawShinkansenHead(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor;
  c.beginPath();
  c.moveTo(-w/2, -h/2); c.lineTo(w/2 + 8, -h/4);
  c.lineTo(w/2 + 8, h/4); c.lineTo(-w/2, h/2);
  c.closePath(); c.fill();
  c.fillStyle = '#1565c0';
  c.fillRect(-w/2, -2, w+4, 4);
  c.fillStyle = '#263238';
  c.beginPath();
  c.moveTo(w/4, -h/3); c.lineTo(w/2+4, -h/6);
  c.lineTo(w/2+4, h/6); c.lineTo(w/4, h/3);
  c.closePath(); c.fill();
  c.fillStyle = '#444';
  [-w/4, w/6].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-1, 2, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawShinkansenCar(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor;
  c.beginPath(); c.roundRect(-w/2, -h/2, w, h, 2); c.fill();
  c.fillStyle = '#1565c0';
  c.fillRect(-w/2, -2, w, 4);
  c.fillStyle = '#e3f2fd';
  for (let i = -2; i <= 2; i++) {
    c.fillRect(i*8 - 2, -h/2+3, 4, 5);
  }
  c.fillStyle = '#444';
  [-w/4, w/4].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-1, 2, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawShinkansenTail(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle + Math.PI);
  c.fillStyle = trainColor;
  c.beginPath();
  c.moveTo(-w/2, -h/2); c.lineTo(w/2 + 8, -h/4);
  c.lineTo(w/2 + 8, h/4); c.lineTo(-w/2, h/2);
  c.closePath(); c.fill();
  c.fillStyle = '#1565c0';
  c.fillRect(-w/2, -2, w+4, 4);
  c.fillStyle = '#263238';
  c.beginPath();
  c.moveTo(w/4, -h/3); c.lineTo(w/2+4, -h/6);
  c.lineTo(w/2+4, h/6); c.lineTo(w/4, h/3);
  c.closePath(); c.fill();
  c.fillStyle = '#444';
  [-w/4, w/6].forEach(wx => {
    c.beginPath(); c.arc(wx, h/2-1, 2, 0, Math.PI*2); c.fill();
  });
  c.restore();
}

function drawMonorailCar(c, x, y, w, h, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.fillStyle = trainColor;
  c.beginPath(); c.roundRect(-w/2, -h/2, w, h, 6); c.fill();
  c.fillStyle = '#e3f2fd';
  for (let i = -1; i <= 1; i++) {
    c.beginPath(); c.roundRect(i*10 - 4, -h/2+4, 8, 7, 2); c.fill();
  }
  c.fillStyle = '#555';
  c.fillRect(-4, h/2-2, 8, 4);
  c.restore();
}

// ============================================================
// Path helpers
// ============================================================
function getPositionOnPath(path, dist) {
  if (path.length < 2) return null;
  let remaining = dist;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i-1].x;
    const dy = path[i].y - path[i-1].y;
    const segLen = Math.sqrt(dx*dx + dy*dy);
    if (segLen < 0.5) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return {
        x: path[i-1].x + dx * t,
        y: path[i-1].y + dy * t,
        angle: Math.atan2(dy, dx)
      };
    }
    remaining -= segLen;
  }
  return null;
}

function getPathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i-1].x;
    const dy = path[i].y - path[i-1].y;
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len;
}

// ============================================================
// Train color picker
// ============================================================
const TRAIN_COLORS = [
  '#f44336','#e91e63','#ff9800','#ffeb3b','#4caf50',
  '#43a047','#00bcd4','#2196f3','#3f51b5','#9c27b0',
  '#795548','#e53935','#1e88e5','#8bc34a','#ff5722',
  '#333333','#666666','#e0e0e0','#fff176','#ce93d8',
  '#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc',
];

(function buildTrainColorGrid() {
  const currentBtn = document.getElementById('train-color-current');
  const popup = document.getElementById('train-color-popup');
  const grid = document.getElementById('train-color-grid');
  currentBtn.style.background = trainColor;

  currentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popup.classList.contains('show')) {
      popup.classList.remove('show');
      return;
    }
    const rect = currentBtn.getBoundingClientRect();
    popup.classList.add('show');
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    let left = rect.left + rect.width / 2 - pw / 2;
    let top = rect.top - ph - 8;
    if (left < 4) left = 4;
    if (left + pw > window.innerWidth - 4) left = window.innerWidth - pw - 4;
    if (top < 4) top = rect.bottom + 8;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  });
  document.addEventListener('click', () => popup.classList.remove('show'));
  popup.addEventListener('click', (e) => e.stopPropagation());

  TRAIN_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'tc-swatch' + (c === trainColor ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      grid.querySelectorAll('.tc-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      trainColor = c;
      currentBtn.style.background = c;
      popup.classList.remove('show');
    });
    grid.appendChild(sw);
  });
})();

// ============================================================
// Train animation
// ============================================================
let perTrackDist = [];

function startTrain(type) {
  if (trackStrokes.length === 0) {
    showSnackbar('まず せんろを かいてね！', '#ff9800');
    return;
  }

  stopTrain();
  trainType = type;

  const def = TRAINS[type];
  const gap = 4;
  let totalTrainLen = 0;
  for (const car of def.cars) totalTrainLen += car.w + gap;

  perTrackDist = trackStrokes.map(() => 0);

  document.querySelectorAll('.train-btn').forEach(b => b.classList.remove('running'));
  document.getElementById({
    steam: 'trainSteam', commuter: 'trainCommuter',
    shinkansen: 'trainShinkansen', monorail: 'trainMonorail'
  }[type]).classList.add('running');

  function drawTrainOnPath(path, dist) {
    let carDist = dist;
    for (let ci = 0; ci < def.cars.length; ci++) {
      const car = def.cars[ci];
      const d = carDist - car.w / 2;
      const pos = getPositionOnPath(path, d);
      if (pos) {
        car.draw(trainCtx, pos.x, pos.y, car.w, car.h, pos.angle);
      }
      carDist -= car.w + gap;
    }
  }

  function animate() {
    trainCtx.clearRect(0, 0, trainLayer.width, trainLayer.height);
    const speedPx = trainSpeed * 2;

    for (let si = 0; si < trackStrokes.length; si++) {
      const path = trackStrokes[si];
      if (path.length < 2) continue;
      const pathLen = getPathLength(path);
      if (pathLen < 10) continue;

      perTrackDist[si] += speedPx;
      if (perTrackDist[si] > pathLen + totalTrainLen) {
        perTrackDist[si] = 0;
      }
      drawTrainOnPath(path, perTrackDist[si]);
    }

    trainAnimId = requestAnimationFrame(animate);
  }

  trainAnimId = requestAnimationFrame(animate);
  showSnackbar('しゅっぱつ しんこう！', '#4caf50');
}

function stopTrain() {
  if (trainAnimId) {
    cancelAnimationFrame(trainAnimId);
    trainAnimId = null;
  }
  trainCtx.clearRect(0, 0, trainLayer.width, trainLayer.height);
  document.querySelectorAll('.train-btn').forEach(b => b.classList.remove('running'));
}

document.getElementById('trainSteam').addEventListener('click', () => startTrain('steam'));
document.getElementById('trainCommuter').addEventListener('click', () => startTrain('commuter'));
document.getElementById('trainShinkansen').addEventListener('click', () => startTrain('shinkansen'));
document.getElementById('trainMonorail').addEventListener('click', () => startTrain('monorail'));
document.getElementById('trainStop').addEventListener('click', stopTrain);

// ============================================================
// Resize & Init
// ============================================================
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', initCanvas);
