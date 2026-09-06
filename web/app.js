const $ = (selector) => document.querySelector(selector);
const canvas = $('#fractal');
const context = canvas.getContext('2d', { alpha: false });
const controls = { play: $('#play'), start: $('#start'), reset: $('#reset'), wander: $('#wander') };
const state = {
  ready: false, busy: false, running: false, dirty: true, transitioning: false,
  mx: 0.45, my: 0.45, speed: 0.25, version: 0, recycle: null,
  budget: matchMedia('(max-width: 700px)').matches ? 115000 : 185000,
  quality: 'auto', lastRequest: 0, lastAdapt: 0, averageMs: 25, frames: 0,
  started: false, hiddenAt: 0,
  drag: null, panX: 0, panY: 0, navigating: false, direction: 1, velocity: 0,
};
let worker;

function dimensions() {
  if (state.drag?.renderSize) return state.drag.renderSize;
  const aspect = innerWidth / innerHeight;
  const budget = state.quality === 'sharp' ? 360000 : state.quality === 'light' ? 80000
    : !state.running && !state.transitioning && !state.drag ? Math.max(state.budget, 340000) : state.budget;
  let width = Math.sqrt(budget * aspect), height = width / aspect;
  const scale = Math.min(1, 960 / width, 720 / height);
  return { width: Math.max(32, Math.floor(width * scale / 8) * 8), height: Math.max(24, Math.floor(height * scale / 8) * 8) };
}

function updateControls() {
  document.body.classList.toggle('running', state.running);
  const label = state.running ? 'Pause zooming' : 'Start zooming';
  controls.play.setAttribute('aria-label', label);
  controls.play.title = `${label} (Space)`;
  $('#play-icon').innerHTML = state.running
    ? '<path d="M8 5v14M16 5v14" stroke-width="3"/>'
    : '<path d="m9 5 11 7-11 7Z"/>';
  $('#status').textContent = state.drag?.moved ? 'Finding your way' : state.navigating ? 'Heading there'
    : state.transitioning ? 'New detail unfolding' : state.running ? state.direction < 0 ? 'Zooming out · Space to stop' : 'Zooming in · Space to stop' : state.started ? 'Taking a breath' : 'Ready when you are';
}

function setRunning(value) {
  if (!state.ready) return;
  state.running = value;
  if (!value) { state.velocity = 0; worker.postMessage({ type: 'cancel-goto' }); state.navigating = false; }
  if (value) {
    state.started = true;
    document.body.classList.add('exploring');
  }
  state.lastRequest = performance.now(); state.dirty = true;
  updateControls();
}

function reset() {
  if (!state.ready) return;
  state.version++; state.running = false; state.started = false; state.transitioning = false;
  const drag = state.drag; state.drag = null;
  if (drag && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
  state.panX = 0; state.panY = 0; state.navigating = false; state.direction = 1; state.velocity = 0;
  state.mx = 0.45; state.my = 0.45;
  worker.postMessage({ type: 'reset' });
  state.dirty = true;
  document.body.classList.remove('exploring', 'refreshing', 'dragging');
  $('#depth').textContent = '0.00';
  updateControls();
}

function fail(message) {
  state.ready = false; state.running = false; state.busy = false;
  worker?.terminate();
  Object.values(controls).forEach((button) => button.disabled = true);
  document.body.classList.remove('exploring', 'running');
  $('#start-label').textContent = 'Unable to start';
  $('#load-status').textContent = message;
  $('#status').textContent = 'Renderer unavailable';
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!state.ready || state.busy || document.hidden) return;
  if (!state.running && !state.dirty && !state.transitioning && !state.navigating) return;
  if (now - state.lastRequest < 1000 / 30 && !state.dirty) return;
  const dt = Math.min(0.1, Math.max(0.001, (now - state.lastRequest) / 1000));
  state.lastRequest = now;
  state.busy = true; state.dirty = false;
  state.velocity += ((state.running ? state.speed * state.direction : 0) - state.velocity) * (1 - Math.exp(-8 * dt));
  const data = { type: 'frame', ...dimensions(), dt,
    mx: state.mx, my: state.my, speed: state.velocity,
    running: state.running && !state.drag, panX: state.panX, panY: state.panY,
    version: state.version, recycle: state.recycle };
  state.panX = 0; state.panY = 0;
  worker.postMessage(data, state.recycle ? [state.recycle] : []);
  state.recycle = null;
}

function onFrame(data) {
  state.busy = false;
  if (data.version !== state.version) { state.recycle = data.buffer; state.dirty = true; return; }
  if (canvas.width !== data.width || canvas.height !== data.height) { canvas.width = data.width; canvas.height = data.height; }
  context.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height), 0, 0);
  state.recycle = data.buffer;
  if (data.depth === 0 && state.direction < 0 && state.running) setRunning(false);
  state.transitioning = data.transitioning;
  state.navigating = data.navigating;
  state.frames++;
  state.averageMs = state.averageMs * 0.9 + data.ms * 0.1;
  $('#depth').textContent = data.depth < 10000 ? data.depth.toFixed(2) : data.depth.toExponential(2);
  document.body.classList.add('ready');
  document.body.classList.toggle('refreshing', data.transitioning);
  updateControls();
  // A read-only diagnostic surface for reproducible browser checks.
  window.driftStats = Object.freeze({ ...data, buffer: undefined, frames: state.frames,
    running: state.running, direction: state.direction, velocity: state.velocity, dragging: !!state.drag?.moved,
    target: [state.mx, state.my], budget: state.budget });
  const now = performance.now();
  if (state.quality === 'auto' && now - state.lastAdapt > 2500 && !data.transitioning && state.frames > 10) {
    state.lastAdapt = now;
    if (state.averageMs > 32) { state.budget = Math.max(65000, state.budget * 0.82); state.dirty = true; }
    else if (state.averageMs < 15) { state.budget = Math.min(260000, state.budget * 1.12); state.dirty = true; }
  }
}

controls.start.addEventListener('click', () => { state.direction = 1; setRunning(true); });
controls.play.addEventListener('click', () => setRunning(!state.running));
controls.reset.addEventListener('click', reset);
controls.wander.addEventListener('click', () => {
  if (!state.ready) return;
  state.started = true; document.body.classList.add('exploring');
  worker.postMessage({ type: 'renew' }); state.dirty = true;
});

function steer(event) {
  state.mx = Math.min(1, Math.max(0, event.clientX / innerWidth));
  state.my = Math.min(1, Math.max(0, event.clientY / innerHeight));
  $('#reticle').style.left = `${event.clientX}px`;
  $('#reticle').style.top = `${event.clientY}px`;
  document.body.classList.add('pointer-active');
}
function goTo(event) {
  if (!state.ready) return;
  steer(event);
  worker.postMessage({ type: 'goto', mx: state.mx, my: state.my });
  // The selected point becomes the center. Hovering again resumes live steering.
  state.mx = 0.5; state.my = 0.5;
  state.navigating = true; state.direction = 1;
  setRunning(true);
}
// A wheel gesture starts continuous travel; opposite scrolling reverses it.
// Ease velocity through zero to avoid a sudden camera reversal.
canvas.addEventListener('wheel', (event) => {
  if (!state.ready || state.drag || event.deltaY === 0) return;
  event.preventDefault();
  steer(event);
  state.direction = event.deltaY < 0 ? 1 : -1;
  worker.postMessage({ type: 'cancel-goto' }); state.navigating = false;
  if (!state.running) setRunning(true);
  state.dirty = true;
}, { passive: false });
canvas.addEventListener('pointermove', (event) => {
  const drag = state.drag;
  if (!drag) { steer(event); return; }
  if (event.pointerId !== drag.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved && distance < 4) return;
  drag.moved = true;
  state.panX += (event.clientX - drag.lastX) / innerWidth;
  state.panY += (event.clientY - drag.lastY) / innerHeight;
  drag.lastX = event.clientX; drag.lastY = event.clientY;
  state.started = true; state.dirty = true;
  document.body.classList.add('exploring', 'dragging');
  steer(event);
});
canvas.addEventListener('pointerdown', (event) => {
  if (!state.ready || state.drag || event.button !== 0) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  steer(event);
  state.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    lastX: event.clientX, lastY: event.clientY, moved: false,
    renderSize: { width: canvas.width, height: canvas.height } };
  worker.postMessage({ type: 'cancel-goto' }); state.navigating = false;
  canvas.setPointerCapture(event.pointerId);
  state.dirty = true;
});
function finishPointer(event, cancelled = false) {
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  state.drag = null;
  document.body.classList.remove('dragging');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  state.lastRequest = performance.now(); state.dirty = true;
  if (!cancelled && !drag.moved) goTo(event);
  updateControls();
}
canvas.addEventListener('pointerup', event => finishPointer(event));
canvas.addEventListener('pointercancel', event => finishPointer(event, true));
canvas.addEventListener('lostpointercapture', event => finishPointer(event, true));
canvas.addEventListener('pointerleave', () => document.body.classList.remove('pointer-active'));
$('#speed').addEventListener('input', (event) => {
  state.speed = Number(event.target.value);
  $('#speed-label').textContent = state.speed.toFixed(2);
});
$('#quality').addEventListener('change', (event) => { state.quality = event.target.value; state.dirty = true; });
document.querySelectorAll('[data-palette]').forEach((button) => button.addEventListener('click', () => {
  if (!state.ready) return;
  document.querySelectorAll('[data-palette]').forEach((other) => {
    other.classList.toggle('active', other === button);
    other.setAttribute('aria-pressed', String(other === button));
  });
  worker.postMessage({ type: 'palette', id: Number(button.dataset.palette) }); state.dirty = true;
}));
window.addEventListener('keydown', (event) => {
  if (event.repeat || $('#about').open || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); setRunning(!state.running); }
  if (event.key.toLowerCase() === 'r') reset();
});
window.addEventListener('resize', () => { state.dirty = true; });
document.addEventListener('visibilitychange', () => { state.lastRequest = performance.now(); });
let resumeAfterAbout = false;
$('#about-button').addEventListener('click', () => {
  resumeAfterAbout = state.running;
  if (state.running) setRunning(false);
  $('#about').showModal();
});
$('#close-about').addEventListener('click', () => $('#about').close());
$('#about').addEventListener('click', (event) => { if (event.target === $('#about')) {
  const r = event.target.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close();
} });
$('#about').addEventListener('close', () => { if (resumeAfterAbout) setRunning(true); });

if (location.protocol === 'file:') {
  fail('Serve this folder over HTTP to load WebAssembly. From the project, run: python3 scripts/serve.py');
} else if (!context || !window.WebAssembly || !window.Worker) {
  fail('This experience needs a browser with WebAssembly, Canvas, and Web Workers.');
} else {
  worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      state.ready = true;
      Object.values(controls).forEach((button) => button.disabled = false);
      $('#start-label').textContent = 'Start exploring';
      $('#load-status').textContent = 'Scroll to zoom in/out · Space to stop · Drag to move';
      state.dirty = true;
    } else if (data.type === 'frame') onFrame(data);
    else if (data.type === 'error') fail(data.message);
  };
  worker.onerror = (event) => fail(event.message || 'The rendering worker could not start.');
  worker.postMessage({ type: 'init', ...dimensions(), forceScalar: new URLSearchParams(location.search).get('renderer') === 'scalar' });
  requestAnimationFrame(frame);
}
