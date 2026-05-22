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
  best: TemplateCandidate | null;
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
    best: null,
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

function setupPointerEvents(): void {
  if (!state) return;
  const { canvas } = state;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen' && e.button === 5) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
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
    if (!state || !state.isDrawing || !state.currentStroke) return;
    e.preventDefault();
    state.currentStroke.points.push(getPointerPos(e));
    redraw();
    drawStroke(state.mainCtx, state.currentStroke);
  });

  canvas.addEventListener('pointerup', () => {
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

/** Coordinate conversion: model x to canvas px */
function nx(x: number): number {
  return x * (state?.width ?? 0);
}

/** Coordinate conversion: model y to canvas py */
function ny(y: number): number {
  const h = state?.height ?? 0;
  return h / 2 - y * (h / 2 - 30);
}

function drawAxes(): void {
  if (!state) return;
  const { overlayCtx: ax, width: W, height: H, showGrid } = state;
  ax.clearRect(0, 0, W, H);
  if (!showGrid) return;

  ax.strokeStyle = '#30363d';
  ax.lineWidth = 1;

  // Vertical grid lines
  for (let s = 50; s < W; s += 50) {
    ax.beginPath();
    ax.moveTo(s, 0);
    ax.lineTo(s, H);
    ax.stroke();
  }

  // Horizontal grid lines
  for (let s = 50; s < H; s += 50) {
    ax.beginPath();
    ax.moveTo(0, s);
    ax.lineTo(W, s);
    ax.stroke();
  }

  // Axes
  ax.strokeStyle = '#484f58';
  ax.lineWidth = 1.5;
  ax.beginPath();
  ax.moveTo(0, H / 2);
  ax.lineTo(W, H / 2);
  ax.stroke();
  ax.beginPath();
  ax.moveTo(W / 2, 0);
  ax.lineTo(W / 2, H);
  ax.stroke();

  // Labels
  ax.fillStyle = '#6e7681';
  ax.font = '9px monospace';
  ax.fillText('x', W - 12, H / 2 - 6);
  ax.fillText('y', W / 2 + 6, 12);

  // Tick labels
  for (let i = -Math.floor(W / 100); i <= Math.floor(W / 100); i++) {
    if (!i) continue;
    ax.fillText('' + i, W / 2 + i * 50 - 3, H / 2 + 12);
  }
  for (let i = -Math.floor(H / 100); i <= Math.floor(H / 100); i++) {
    if (!i) continue;
    ax.fillText('' + i, W / 2 + 5, H / 2 - i * 50 + 3);
  }
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
  redraw();
}

/**
 * Redo the last undone stroke.
 */
export function redo(): void {
  if (!state || !state.redoStack.length) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.strokes)) as Stroke[]);
  state.strokes = state.redoStack.pop()!;
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
  redraw();
}
