// ============================================================
// Canvas Management, Drawing, and Pointer Events
// ============================================================

import type { Point, Stroke, TemplateCandidate } from '../types';

/** Canvas state shared across this module. */
export interface CanvasState {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  mainCtx: CanvasRenderingContext2D;
  overlayCtx: CanvasRenderingContext2D;
  containerEl: HTMLElement;
  width: number;
  height: number;
  showGrid: boolean;
  showOverlay: boolean;
  strokes: Stroke[];
  undoStack: Stroke[][];
  redoStack: Stroke[][];
  currentStroke: Stroke | null;
  isDrawing: boolean;
  overlayPoints: Point[] | null;
  customPoints: Point[] | null;
  traceTarget: Point[] | null;
  traceType: string | null;
  traceLabel: string | null;
  best: TemplateCandidate | null;
  /** Graph zoom: 1 = default, >1 = zoom in */
  zoom: number;
  /** Graph pan: model-x offset at zoom=1 */
  panX: number;
  /** Graph pan: model-y offset at zoom=1 */
  panY: number;
}

let state: CanvasState | null = null;

/**
 * Initialize the canvas system.
 */
export function initCanvas(): CanvasState {
  const canvas = document.getElementById('dc') as HTMLCanvasElement;
  const overlay = document.getElementById('ac') as HTMLCanvasElement;
  const containerEl = document.getElementById('cw') as HTMLElement;

  const mainCtx = canvas.getContext('2d')!;
  const overlayCtx = overlay.getContext('2d')!;

  state = {
    canvas,
    overlay,
    mainCtx,
    overlayCtx,
    containerEl,
    width: 0,
    height: 0,
    showGrid: true,
    showOverlay: true,
    strokes: [],
    undoStack: [],
    redoStack: [],
    currentStroke: null,
    isDrawing: false,
    overlayPoints: null,
    customPoints: null,
    traceTarget: null,
    traceType: null,
    traceLabel: null,
    best: null,
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  setupResize();
  setupPointerEvents();
  resize();

  return state;
}

/**
 * Get the current canvas state.
 */
export function getState(): CanvasState {
  if (!state) throw new Error('Canvas not initialized');
  return state;
}

function setupResize(): void {
  window.addEventListener('resize', resize);
}

export function resize(): void {
  if (!state) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = state.containerEl.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;

  for (const c of [state.canvas, state.overlay]) {
    c.width = state.width * dpr;
    c.height = state.height * dpr;
    c.style.width = state.width + 'px';
    c.style.height = state.height + 'px';
    c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawAxes();
  redraw();
}

/** Inverse: canvas px to model x */
function canvasToModelX(cx: number): number {
  if (!state) return cx;
  return cx / (state.zoom * state.width) + state.panX;
}

/** Inverse: canvas py to model y */
function canvasToModelY(cy: number): number {
  if (!state) return cy;
  const h = state.height;
  const plotTop = 30;
  const plotBottom = h - 30;
  const plotH = plotBottom - plotTop;
  return (plotBottom - cy) / (state.zoom * (plotH / 2)) + state.panY - 1;
}

/** Pan drag state */
let isPanDragging = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

function setupPointerEvents(): void {
  if (!state) return;
  const { canvas } = state;

  // Wheel: zoom centered on cursor
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!state) return;
      const cx = e.clientX - canvas.getBoundingClientRect().left;
      const cy = e.clientY - canvas.getBoundingClientRect().top;
      const oldZoom = state.zoom;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      state.zoom = Math.max(0.25, Math.min(20, state.zoom * factor));
      if (state.zoom === oldZoom) return;
      // Keep the point under the cursor fixed
      const modelX = canvasToModelX(cx);
      const modelY = canvasToModelY(cy);
      state.panX -= (modelX - 0.5) * (1 - 1 / state.zoom);
      state.panY -= (modelY - 0) * (1 - 1 / state.zoom);
      drawAxes();
      redraw();
    },
    { passive: false },
  );

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen' && e.button === 5) return;
    // Right-click = pan
    if (e.button === 2) {
      e.preventDefault();
      isPanDragging = true;
      panStartX = e.clientX - canvas.getBoundingClientRect().left;
      panStartY = e.clientY - canvas.getBoundingClientRect().top;
      panStartPanX = state!.panX;
      panStartPanY = state!.panY;
      return;
    }
    // Left-click = draw
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may lack active pointerId */
    }
    state!.isDrawing = true;
    state!.undoStack.push(JSON.parse(JSON.stringify(state!.strokes)) as Stroke[]);
    state!.redoStack = [];
    if (state!.undoStack.length > 100) state!.undoStack.shift();
    state!.currentStroke = {
      points: [getPointerPos(e)],
      color: '#58a6ff',
      width: 2.5,
    };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (isPanDragging && state) {
      const cx = e.clientX - canvas.getBoundingClientRect().left;
      const cy = e.clientY - canvas.getBoundingClientRect().top;
      const dx = (cx - panStartX) / (state.zoom * state.width);
      const dy = (cy - panStartY) / ((state.zoom * (state.height - 60)) / 2);
      state.panX = panStartPanX - dx;
      state.panY = panStartPanY + dy;
      drawAxes();
      redraw();
      return;
    }
    if (!state || !state.isDrawing || !state.currentStroke) return;
    e.preventDefault();
    state.currentStroke.points.push(getPointerPos(e));
    redraw();
    drawStroke(state.mainCtx, state.currentStroke);
  });

  canvas.addEventListener('pointerup', (_e) => {
    if (isPanDragging) {
      isPanDragging = false;
      return;
    }
    if (!state || !state.isDrawing || !state.currentStroke) return;
    state.isDrawing = false;
    state.strokes.push(state.currentStroke);
    state.currentStroke = null;
    redraw();
    // Trigger recognition callback if set
    if (onStrokeComplete) onStrokeComplete();
  });

  canvas.addEventListener('pointercancel', () => {
    if (!state) return;
    state.isDrawing = false;
    state.currentStroke = null;
  });

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
    },
    { passive: false },
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
    },
    { passive: false },
  );
}

function getPointerPos(e: PointerEvent): Point {
  if (!state) return { x: 0, y: 0, pressure: 0.5 };
  const rect = state.canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: e.pressure || 0.5,
  };
}

/** Coordinate conversion: model x to canvas px (with zoom/pan) */
function nx(x: number): number {
  if (!state) return x;
  return (x - state.panX) * state.zoom * state.width;
}

/** Coordinate conversion: model y to canvas py (with zoom/pan) */
function ny(y: number): number {
  if (!state) return y;
  const h = state.height;
  const plotTop = 30;
  const plotBottom = h - 30;
  const plotH = plotBottom - plotTop;
  // y in [-1,1] model → canvas py with zoom/pan
  return plotBottom - (y - state.panY + 1) * state.zoom * (plotH / 2);
}

function drawAxes(): void {
  if (!state) return;
  const { overlayCtx: ax, width: W, height: H, showGrid } = state;
  ax.clearRect(0, 0, W, H);
  if (!showGrid) return;

  const plotTop = 30;
  const plotBottom = H - 30;
  const zoom = state.zoom;
  const panX = state.panX;
  const panY = state.panY;

  // Compute visible model range at current zoom/pan
  const modelX0 = -panX / zoom;
  const modelX1 = modelX0 + 1 / zoom;
  const modelY0 = -1 / zoom - panY;
  const modelY1 = 1 / zoom - panY;

  // Canvas px positions of x=0 and y=0
  const px0 = nx(0);
  const py0 = ny(0);

  ax.strokeStyle = '#30363d';
  ax.lineWidth = 1;
  ax.fillStyle = '#6e7681';
  ax.font = '9px monospace';

  // ── Pixel-based grid (always fixed 50px on screen, dense zoom handled) ───────
  // At high zoom, increase grid step to avoid visual noise
  let gridStep = 50;
  if (zoom > 10) gridStep = 200;
  else if (zoom > 4) gridStep = 100;

  // Vertical grid lines at fixed canvas x positions
  const xFirst = Math.ceil(0 / gridStep) * gridStep;
  for (let px = xFirst; px < W; px += gridStep) {
    const mx = canvasToModelX(px);
    if (mx < modelX0 || mx > modelX1) continue;
    ax.beginPath();
    ax.moveTo(px, Math.max(0, plotTop));
    ax.lineTo(px, Math.min(H, plotBottom));
    ax.stroke();
  }

  // Horizontal grid lines at fixed canvas y positions
  const yFirst = Math.ceil(plotTop / gridStep) * gridStep;
  for (let py = yFirst; py < plotBottom; py += gridStep) {
    const my = canvasToModelY(py);
    if (my < modelY0 || my > modelY1) continue;
    ax.beginPath();
    ax.moveTo(0, py);
    ax.lineTo(W, py);
    ax.stroke();
  }

  // ── Axes ────────────────────────────────────────────────────────────────────
  ax.strokeStyle = '#484f58';
  ax.lineWidth = 1.5;
  if (py0 >= plotTop && py0 <= plotBottom) {
    ax.beginPath();
    ax.moveTo(0, py0);
    ax.lineTo(W, py0);
    ax.stroke();
  }
  if (px0 >= 0 && px0 <= W) {
    ax.beginPath();
    ax.moveTo(px0, plotTop);
    ax.lineTo(px0, plotBottom);
    ax.stroke();
  }

  // ── Axis labels ─────────────────────────────────────────────────────────────
  // "x" → right side, below the x-axis
  const xLabelY = Math.min(py0 + 14, H - 4);
  ax.fillText('x', W - 14, xLabelY);
  // "y" → top side, right of the y-axis
  const yLabelX = Math.min(Math.max(px0 + 8, 14), W - 10);
  ax.fillText('y', yLabelX, 14);

  // ── X tick labels (model coords at each grid line) ──────────────────────────
  const xGridFirst = Math.ceil(0 / gridStep) * gridStep;
  for (let px = xGridFirst; px < W; px += gridStep) {
    const mx = canvasToModelX(px);
    if (Math.abs(mx) < 1e-9) continue;
    if (px < 8 || px > W - 8) continue;
    const label = Math.abs(mx) >= 1 ? mx.toFixed(1) : mx.toFixed(2);
    ax.fillText(label, px - (label.length > 4 ? 10 : 3), py0 + 12);
  }

  // ── Y tick labels (model coords at each grid line) ─────────────────────────
  for (let py = yFirst; py < plotBottom; py += gridStep) {
    const my = canvasToModelY(py);
    if (Math.abs(my) < 1e-9) continue;
    if (py < plotTop + 6 || py > plotBottom - 6) continue;
    const label = Math.abs(my) >= 1 ? my.toFixed(1) : my.toFixed(2);
    ax.fillText(label, Math.min(px0 + 5, W - 30), py + 3);
  }

  // ── Viewport range indicator ────────────────────────────────────────────────
  const xMin = modelX0;
  const xMax = modelX1;
  const yMin = modelY0;
  const yMax = modelY1;
  ax.font = '8px monospace';
  ax.fillStyle = 'rgba(88,166,255,0.6)';
  ax.fillText(
    `x:[${xMin.toFixed(2)},${xMax.toFixed(2)}]  y:[${yMin.toFixed(2)},${yMax.toFixed(2)}]${zoom !== 1 ? `  ${zoom.toFixed(1)}×` : ''}`,
    4,
    12,
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (s.points.length < 2) return;
  ctx.strokeStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.points[0]!.x, s.points[0]!.y);
  for (let i = 1; i < s.points.length; i++) {
    const p = s.points[i]!;
    ctx.lineWidth =
      p.pressure !== undefined ? Math.max(1, s.width * (0.3 + 0.7 * p.pressure)) : s.width;
    if (i < s.points.length - 1) {
      const n = s.points[i + 1]!;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
}

function drawTraceTarget(points: Point[]): void {
  if (!state || points.length < 2) return;
  const { mainCtx: ctx } = state;
  ctx.strokeStyle = 'rgba(88,166,255,0.35)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(nx(points[0]!.x), ny(points[0]!.y));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(nx(points[i]!.x), ny(points[i]!.y));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawOverlayPath(points: Point[], color: string): void {
  if (!state || points.length < 2) return;
  const { mainCtx: ctx } = state;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(nx(points[0]!.x), ny(points[0]!.y));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(nx(points[i]!.x), ny(points[i]!.y));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Redraw all strokes and overlays.
 */
export function redraw(): void {
  if (!state) return;
  const { mainCtx: ctx } = state;
  ctx.clearRect(0, 0, state.width, state.height);
  state.strokes.forEach((s) => {
    drawStroke(ctx, s);
  });
  if (state.currentStroke) drawStroke(ctx, state.currentStroke);
  // Trace target (light blue dashed reference)
  if (state.traceTarget) drawTraceTarget(state.traceTarget);
  if (state.showOverlay) {
    if (state.overlayPoints) drawOverlayPath(state.overlayPoints, '#f0883e');
    if (state.customPoints) drawOverlayPath(state.customPoints, '#da3688');
  }
}

// Stroke complete callback
let onStrokeComplete: (() => void) | null = null;

/**
 * Register a callback that fires when a stroke is completed.
 */
export function setStrokeCompleteCallback(cb: () => void): void {
  onStrokeComplete = cb;
}

/**
 * Get all points from all strokes (flattened).
 */
export function getAllPoints(): Point[] {
  if (!state) return [];
  const all: Point[] = [];
  state.strokes.forEach((s) => {
    all.push(...s.points.map((p) => ({ x: p.x, y: p.y })));
  });
  return all;
}

/**
 * Undo the last stroke.
 */
export function undo(): void {
  if (!state || !state.undoStack.length) return;
  state.redoStack.push(JSON.parse(JSON.stringify(state.strokes)) as Stroke[]);
  state.strokes = state.undoStack.pop()!;
  state.overlayPoints = null;
  state.customPoints = null;
  state.best = null;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  drawAxes();
  redraw();
}

/**
 * Redo the last undone stroke.
 */
export function redo(): void {
  if (!state || !state.redoStack.length) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.strokes)) as Stroke[]);
  state.strokes = state.redoStack.pop()!;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  drawAxes();
  redraw();
}

/**
 * Toggle grid visibility.
 */
export function toggleGrid(): void {
  if (!state) return;
  state.showGrid = !state.showGrid;
  drawAxes();
  redraw();
}

/**
 * Toggle overlay visibility.
 */
export function toggleOverlay(): void {
  if (!state) return;
  state.showOverlay = !state.showOverlay;
  redraw();
}

/**
 * Clear all strokes and reset state.
 */
export function clearAll(): void {
  if (!state) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.strokes)) as Stroke[]);
  state.strokes = [];
  state.overlayPoints = null;
  state.customPoints = null;
  state.best = null;
  state.redoStack = [];
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  redraw();
}

/** Zoom in */
export function zoomIn(): void {
  if (!state) return;
  state.zoom = Math.min(20, state.zoom * 1.3);
  drawAxes();
  redraw();
}

/** Zoom out */
export function zoomOut(): void {
  if (!state) return;
  state.zoom = Math.max(0.25, state.zoom / 1.3);
  drawAxes();
  redraw();
}

/** Reset zoom and pan to default */
export function resetView(): void {
  if (!state) return;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  drawAxes();
  redraw();
}
