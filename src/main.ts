// ============================================================
// Sketch-CAS: Application Entry Point
// Wires together all extracted TypeScript modules with the
// existing HTML UI (training, CAS input, audio, export).
// ============================================================

import {
  initCanvas,
  setStrokeCompleteCallback,
  getState,
  clearAll,
  undo,
  redo,
  toggleGrid,
  toggleOverlay,
  getAllPoints,
  redraw,
} from './modules/canvas';
import { normalizeAndResample, getFeatures } from './modules/recognition';
import { generateTemplates } from './modules/templates';
import { evalTemplate } from './modules/numeric';
import { toast, copyToClipboard, updateScore, emptyState, renderKaTeX } from './modules/ui';
import { exprToLatex } from './modules/latex';
import { runCas, hasAlgebrite, hasNerdamer, hasXcas, setupGiacAutoload } from './modules/cas';
import { drawBode } from './modules/bode';
import type { TemplateCandidate, CasOperation } from './types';

// ---- App State (mirrors what was in the inline script) ----
let best: TemplateCandidate | null = null;
let ovlP: { x: number; y: number }[] | null = null;
let custP: { x: number; y: number }[] | null = null;

const hist = JSON.parse(localStorage.getItem('scH5') || '[]') as {
  label: string;
  latex: string;
  time: string;
}[];

// ---- Recognition ----
function scheduleR(): void {
  setTimeout(recognize, 350);
}

function recognize(): void {
  const state = getState();
  const strokes = state.strokes;
  if (strokes.length === 0) return;

  const pts = normalizeAndResample(strokes);
  if (!pts) return;

  const f = getFeatures(pts);
  const cands = generateTemplates(pts, f);
  if (!cands.length) return;

  best = cands[0]!;

  const xs = pts.map((p) => p.x);
  ovlP = xs.map((x) => ({ x, y: evalTemplate(x, best!) }));
  custP = null;

  const tp = strokes.reduce((s, st) => s + st.points.length, 0);
  const pct = Math.max(0, Math.min(100, 100 * (1 - best.err))).toFixed(1);
  updateScore('' + tp, best.label, pct + '%');

  renderRes(cands);
  renderCAS(best);
  drawBode(best);
  addH(best);
}

function renderRes(cands: TemplateCandidate[]): void {
  const el = document.getElementById('tRes');
  if (!el) return;

  const mx = Math.max(...cands.map((c) => c.err));
  const mn = cands[0]!.err;

  let h = '';
  cands.slice(0, 6).forEach((c, i) => {
    const pct = Math.max(0, Math.min(100, 100 * (1 - (c.err - mn) / (mx - mn + 0.001))));
    const cls = i === 0 ? 'best' : '';
    const badge = i === 0 ? '<span class="badge">Best</span>' : '';
    const bgColor = i === 0 ? '#238636' : '#58a6ff';

    h += `<div class="card ${cls}" onclick="window._casTab()">`;
    h += `<div class="cr"><span>${c.label}</span>${badge}</div>`;
    h += `<div class="cf" data-latex="${esc(c.latex)}"></div>`;
    h += `<div class="mb"><div class="mf" style="width:${pct}%;background:${bgColor}"></div></div>`;
    h += `<div class="cm"><span>Fit: ${(100 - c.err * 100).toFixed(1)}%</span></div>`;
    h += `<div class="cl" onclick="event.stopPropagation();window.cpT(this)">${esc(c.latex)}</div>`;
    h += '</div>';
  });

  el.innerHTML = h;
  renderKaTeX(el);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCAS(c: TemplateCandidate): void {
  const el = document.getElementById('tCas');
  if (!el) return;

  const symExpr = getSymExpr(c);
  if (!symExpr) {
    el.innerHTML = emptyState('⚡', 'CAS nicht verfügbar', 'Für diesen Typ.');
    return;
  }

  let h = `<div class="card best"><div class="cr"><span>${c.label}</span><span class="badge">Erkannt</span></div><div class="cf" data-latex="${esc(c.latex)}"></div></div>`;

  const ops: CasOperation[] = ['simplify', 'diff', 'integrate', 'taylor', 'laplace'];
  const opLabels: Record<CasOperation, string> = {
    simplify: 'Vereinfacht',
    diff: "Ableitung f'(x)",
    integrate: 'Stammfunktion',
    taylor: 'Taylor (n=5)',
    laplace: 'Laplace',
    solve: 'Lösen',
    plot: 'Plot',
  };

  ops.forEach((op) => {
    const results = runCas(symExpr, op, 'all');
    if (results.length === 0) return;

    h += `<div style="margin-top:8px"><div style="font-size:10px;font-weight:600;color:#c9d1d9;margin-bottom:4px">${opLabels[op]}</div>`;

    results.forEach((r) => {
      if (r.error) {
        h += `<div class="ci"><div class="cil gen">${r.engine}</div><div style="color:#f85149;font-size:10px">${esc(r.error)}</div></div>`;
      } else if (r.result) {
        const cls = r.tag === 'alg' ? 'alg' : r.tag === 'ner' ? 'ner' : 'xca';
        h += `<div class="ci"><div class="cil ${cls}">${r.engine}</div><div class="civ" data-latex="${esc(r.result.latex)}"></div></div>`;
      }
    });

    h += '</div>';
  });

  el.innerHTML = h;
  renderKaTeX(el);
}

function getSymExpr(c: { params: Record<string, number | string> }): string | null {
  const p = c.params;
  const t = p['type'] as string;
  const a = (p['amp'] as number) || 0;
  const f = (p['freq'] as number) || 1;
  const o = (p['offset'] as number) || 0;
  const ph = (p['phase'] as number) || 0;

  const fmt = (n: number, dp?: number): string => {
    if (Math.abs(n) < 0.001) return '0';
    if (dp === undefined && Math.abs(n - Math.round(n)) < 0.01) return '' + Math.round(n);
    return n
      .toFixed(dp || 2)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
  };

  switch (t) {
    case 'sin':
      return (
        fmt(a, 4) +
        '*sin(' +
        fmt(2 * Math.PI * f, 4) +
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + fmt(ph, 4) : '') +
        ')' +
        (Math.abs(o) > 0.05 ? '+' + fmt(o, 4) : '')
      );
    case 'cos':
      return (
        fmt(a, 4) +
        '*cos(' +
        fmt(2 * Math.PI * f, 4) +
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + fmt(ph, 4) : '') +
        ')' +
        (Math.abs(o) > 0.05 ? '+' + fmt(o, 4) : '')
      );
    case 'linear':
      return fmt(a * 2, 4) + '*x+' + fmt(o, 4);
    case 'exponential':
      return (
        fmt(a, 4) +
        '*exp(' +
        fmt((p['fB'] as number) || 1, 4) +
        '*x)' +
        (Math.abs(o) > 0.05 ? '+' + fmt(o, 4) : '')
      );
    case 'abs_sin':
      return (
        fmt(a, 4) +
        '*abs(sin(' +
        fmt(2 * Math.PI * f, 4) +
        '*x))' +
        (Math.abs(o) > 0.05 ? '+' + fmt(o, 4) : '')
      );
    case 'damped':
      return fmt(a, 4) + '*exp(-' + fmt(f * 2, 4) + '*x)*sin(' + fmt(2 * Math.PI * f, 4) + '*x)';
    case 'heaviside':
      return fmt(a, 4) + '*(x>0?1:0)' + (Math.abs(o) > 0.05 ? '+' + fmt(o, 4) : '');
    default:
      return null;
  }
}

function addH(c: TemplateCandidate): void {
  const now = new Date();
  const time = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  hist.unshift({ label: c.label, latex: c.latex, time });
  if (hist.length > 50) hist.splice(50);
  localStorage.setItem('scH5', JSON.stringify(hist));
  renderH();
}

function renderH(): void {
  const el = document.getElementById('tHist');
  if (!el) return;

  if (!hist.length) {
    el.innerHTML = emptyState('🕐', 'Leerer Verlauf', 'Erkennungen werden gespeichert.');
    return;
  }

  let h = '';
  hist.forEach((x) => {
    h += `<div class="card" style="cursor:pointer"><div style="display:flex;justify-content:space-between"><span style="font-size:11px">${esc(x.label)}</span><span style="font-size:9px;color:#8b949e">${esc(x.time)}</span></div></div>`;
  });
  el.innerHTML = h;
}

// ---- CAS Input Tab ----
function evalPlot(expr: string): void {
  try {
    const fn = makeNumFn(expr);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 400; i++) {
      const x = (i / 399) * 10 - 5;
      const y = fn(x);
      pts.push({ x: i / 399, y: isFinite(y) ? Math.max(-1.2, Math.min(1.2, y / 3)) : 0 });
    }
    custP = pts;
    const state = getState();
    state.customPoints = pts;
    redraw();
    toast('Geplottet!');
  } catch (e) {
    toast('Plot-Fehler: ' + (e as Error).message);
  }
}

function makeNumFn(expr: string): (x: number) => number {
  const prepared = expr.replace(/\^/g, '**');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    'x',
    'return ' +
      prepared
        .replace(/\b(sin|cos|tan|abs|sqrt|exp|log|asin|acos|atan|sinh|cosh|tanh)\b/g, 'Math.$1')
        .replace(/\bpi\b/g, 'Math.PI')
        .replace(/\be\b/g, 'Math.E'),
  ) as (x: number) => number;
  fn(0);
  fn(1);
  return fn;
}

function renderCasResult(op: CasOperation, raw: string): void {
  const el = document.getElementById('casResult');
  if (!el) return;

  const fill = document.getElementById('casFill');
  if (fill) {
    fill.style.width = '20%';
    fill.className = 'fill';
  }

  if (op === 'plot') {
    evalPlot(raw);
    if (fill) fill.style.width = '100%';
    return;
  }

  const eq = op === 'solve' && !raw.includes('=') ? raw + '=0' : raw;
  const results = runCas(eq, op, getSelectedEngine());

  let h = '';
  if (results.length === 0) {
    h = emptyState('⚡', 'Kein CAS aktiv', 'Wähle einen Engine unten.');
  } else {
    results.forEach((r) => {
      if (r.error) {
        const errClass = (r as { loading?: boolean }).loading ? 'card xcas' : 'card';
        h += `<div class="${errClass}"><div class="cr"><span>${r.engine}</span><span class="badge red">Fehler</span></div><div style="color:#f85149;font-size:11px">${esc(r.error)}</div></div>`;
      } else if (r.result) {
        const bc = r.tag === 'alg' ? '#f0883e' : r.tag === 'ner' ? '#1f6feb' : '#da3688';
        const badge = r.tag === 'alg' ? 'orange' : r.tag === 'ner' ? 'blue' : 'pink';
        h += `<div class="card" style="border-color:${bc}"><div class="cr"><span>${r.engine}</span><span class="badge ${badge}">${op.toUpperCase()}</span></div>`;
        h += `<div class="civ" data-latex="${esc(r.result.latex)}"></div>`;
        h += `<div class="cl" onclick="event.stopPropagation();window.cpT(this)">${esc(r.result.raw || r.result.latex)}</div></div>`;
      }
    });
  }

  el.innerHTML = h;
  if (fill) {
    fill.style.width = '100%';
    setTimeout(() => {
      fill.style.width = '0';
    }, 1000);
  }
  renderKaTeX(el);
}

function multiSolveEq(): void {
  const raw = (document.getElementById('eqIn') as HTMLInputElement)?.value.trim();
  if (!raw) {
    toast('Gleichung eingeben!');
    return;
  }
  const el = document.getElementById('eqResult');
  if (!el) return;

  const expr = raw.includes('=') ? raw.split('=').join('-(') + ')' : raw;
  let h = '';

  if (hasAlgebrite()) {
    try {
      const r = (
        window as unknown as { Algebrite: { roots: (e: string) => { toString: () => string } } }
      ).Algebrite.roots(expr).toString();
      h += `<div class="card" style="border-color:#f0883e"><div class="cr"><span>Algebrite</span><span class="badge orange">Roots</span></div><div class="civ" data-latex="x=${esc(exprToLatex(r))}"></div><div class="cl" onclick="window.cpT(this)">${esc(r)}</div></div>`;
    } catch (e) {
      h += `<div class="card" style="border-color:#f85149"><div class="cr"><span>Algebrite</span><span class="badge red">Fehler</span></div><div style="color:#f85149;font-size:11px">${esc((e as Error).message)}</div></div>`;
    }
  }

  if (hasNerdamer()) {
    try {
      const sol = (
        window as unknown as {
          nerdamer: { solveEquations: (e: string) => Array<{ toString: () => string }> };
        }
      ).nerdamer.solveEquations(expr);
      const lt = 'x \\in \\{' + sol.map((v) => exprToLatex(v.toString())).join(',\\;') + '\\}';
      h += `<div class="card" style="border-color:#1f6feb"><div class="cr"><span>Nerdamer</span><span class="badge blue">Solve</span></div><div class="civ" data-latex="${esc(lt)}"></div><div class="cl" onclick="window.cpT(this)">${esc(sol.toString())}</div></div>`;
    } catch (e) {
      h += `<div class="card" style="border-color:#f85149"><div class="cr"><span>Nerdamer</span><span class="badge red">Fehler</span></div><div style="color:#f85149;font-size:11px">${esc((e as Error).message)}</div></div>`;
    }
  }

  if (hasXcas()) {
    const casState = (
      window as unknown as {
        Module?: { cwrap: (name: string, ret: string, args: string[]) => (s: string) => string };
      }
    ).Module;
    const casevalFn = casState?.cwrap('caseval', 'string', ['string']);
    if (casevalFn) {
      try {
        const sol = casevalFn('solve(' + expr + ',x)').toString();
        h += `<div class="card" style="border-color:#da3688"><div class="cr"><span>Xcas(Giac)</span><span class="badge pink">Solve</span></div><div class="civ" data-latex="x=${esc(exprToLatex(sol))}"></div><div class="cl" onclick="window.cpT(this)">${esc(sol)}</div></div>`;
      } catch (e) {
        h += `<div class="card" style="border-color:#f85149"><div class="cr"><span>Xcas(Giac)</span><span class="badge red">Fehler</span></div><div style="color:#f85149;font-size:11px">${esc((e as Error).message)}</div></div>`;
      }
    }
  }

  if (!h) h = emptyState('⚡', 'Kein CAS aktiv', '');
  el.innerHTML = h;
  renderKaTeX(el);
}

let selectedEngine = 'all';

function getSelectedEngine(): string {
  return selectedEngine;
}

// ---- Training System ----
interface TrainTarget {
  id: string;
  timestamp: number;
  label: string;
  strokes: {
    points: { x: number; y: number; pressure?: number; color?: string; width?: number }[];
    color?: string;
    width?: number;
  }[];
  normalizedPoints: { x: number; y: number }[];
  difficulty: string;
}

interface TrainAttempt {
  timestamp: number;
  targetId: string;
  score: number;
  strokes: { points: { x: number; y: number }[]; color?: string; width?: number }[];
}

interface TrainData {
  targets: TrainTarget[];
  attempts: TrainAttempt[];
}

let trainData: TrainData = { targets: [], attempts: [] };
let trainCurrentMode: 'record' | 'practice' | 'stats' = 'record';
let practiceActive = false;
let activeTargetId: string | null = null;

function loadTrainData(): void {
  try {
    const raw = localStorage.getItem('scTrainV6');
    if (raw) trainData = JSON.parse(raw) as TrainData;
  } catch {
    /* ignore */
  }
  if (!trainData) trainData = { targets: [], attempts: [] };
  if (!trainData.targets) trainData.targets = [];
  if (!trainData.attempts) trainData.attempts = [];
}

function saveTrainData(): void {
  try {
    localStorage.setItem('scTrainV6', JSON.stringify(trainData));
  } catch {
    toast('Speicherfehler!');
  }
}

function genId(): string {
  return 't_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

function normPts(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (!pts || pts.length < 2) return pts;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xMn = Math.min(...xs);
  const xMx = Math.max(...xs);
  const yMn = Math.min(...ys);
  const yMx = Math.max(...ys);
  const xR = xMx - xMn || 1;
  const yR = yMx - yMn || 1;
  return pts.map((p) => ({ x: (p.x - xMn) / xR, y: -(((p.y - yMn) / yR) * 2 - 1) }));
}

function resampleX(pts: { x: number; y: number }[], N: number): { x: number; y: number }[] {
  if (!pts || pts.length < 2) return pts;
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const res: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const tx = i / (N - 1);
    let idx = 0;
    while (idx < sorted.length - 1 && sorted[idx + 1]!.x < tx) idx++;
    if (idx >= sorted.length - 1) {
      res.push({ x: tx, y: sorted[sorted.length - 1]!.y });
    } else {
      const dx = sorted[idx + 1]!.x - sorted[idx]!.x;
      const dt = dx > 1e-6 ? (tx - sorted[idx]!.x) / dx : 0;
      res.push({ x: tx, y: sorted[idx]!.y + dt * (sorted[idx + 1]!.y - sorted[idx]!.y) });
    }
  }
  return res;
}

function comparePaths(ref: { x: number; y: number }[], att: { x: number; y: number }[]): number {
  const N = 200;
  const rn = resampleX(ref, N);
  const an = resampleX(normPts(att), N);
  if (!rn || !an || rn.length < 2 || an.length < 2) return 1;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const dx = rn[i]!.x - an[i]!.x;
    const dy = rn[i]!.y - an[i]!.y;
    s += dx * dx + dy * dy;
  }
  return Math.sqrt(s / N);
}

function calcDifficulty(pts: { x: number; y: number }[]): string {
  if (!pts || pts.length < 10) return 'Einfach';
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xMn = Math.min(...xs);
  const xMx = Math.max(...xs);
  const yMn = Math.min(...ys);
  const yMx = Math.max(...ys);
  const ranges = xMx - xMn + yMx - yMn;
  let crossings = 0;
  const midY = (yMx + yMn) / 2;
  for (let i = 1; i < ys.length; i++) {
    if ((ys[i - 1]! < midY && ys[i]! >= midY) || (ys[i - 1]! >= midY && ys[i]! < midY)) crossings++;
  }
  let score = 0;
  if (pts.length > 500) score += 2;
  else if (pts.length > 200) score += 1;
  if (crossings > 8) score += 2;
  else if (crossings > 4) score += 1;
  if (ranges > 400) score += 1;
  if (score >= 4) return 'Schwer';
  if (score >= 2) return 'Mittel';
  return 'Einfach';
}

function saveTrainingTarget(): void {
  const allPts = getAllPoints();
  if (allPts.length < 10) {
    toast('Mindestens 10 Punkte zeichnen!');
    return;
  }
  const labelEl = document.getElementById('trLabel') as HTMLInputElement;
  const label = labelEl?.value.trim() || '';
  if (!label) {
    toast('Bezeichnung eingeben!');
    return;
  }

  const target: TrainTarget = {
    id: genId(),
    timestamp: Date.now(),
    label,
    strokes: structuredClone(getState().strokes),
    normalizedPoints: normPts(allPts),
    difficulty: calcDifficulty(allPts),
  };

  trainData.targets.push(target);
  saveTrainData();
  if (labelEl) labelEl.value = '';
  toast('Ziel gespeichert: ' + label);
  renderTrainingList();
}

function deleteTarget(id: string): void {
  trainData.targets = trainData.targets.filter((t) => t.id !== id);
  trainData.attempts = trainData.attempts.filter((a) => a.targetId !== id);
  saveTrainData();
  renderTrainingList();
  toast('Ziel gelöscht');
}

function startPractice(id: string): void {
  const target = trainData.targets.find((t) => t.id === id);
  if (!target) {
    toast('Ziel nicht gefunden!');
    return;
  }
  if (!target.normalizedPoints || target.normalizedPoints.length < 2) {
    toast('Keine Referenzdaten!');
    return;
  }

  activeTargetId = id;
  practiceActive = true;
  const state = getState();
  state.strokes = [];
  state.overlayPoints = target.normalizedPoints;
  state.customPoints = null;
  best = null;
  updateScore('0', '—', '—');
  redraw();

  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.classList.remove('active');
  });
  const tabs = document.querySelectorAll<HTMLElement>('.tab');
  tabs[0]?.classList.add('active');
  ['tRes', 'tCas', 'tInp', 'tBode', 'tHist', 'tTrain'].forEach((id) =>
    document.getElementById(id)?.classList.remove('on'),
  );
  document.getElementById('tRes')?.classList.add('on');
  const resEl = document.getElementById('tRes');
  if (resEl) {
    resEl.innerHTML =
      emptyState(
        '🎯',
        'Übung: ' + esc(target.label),
        'Zeichne die Formel nach! Ghost-Overlay zeigt das Referenzbild.',
      ) +
      '<div style="text-align:center;margin-top:8px"><button class="b grn" id="btnFertig">✅ Fertig — Bewerten</button></div>';
    document.getElementById('btnFertig')?.addEventListener('click', endPractice);
  }
  toast('Übung gestartet: ' + target.label);
}

function endPractice(): void {
  if (!practiceActive || !activeTargetId) return;
  practiceActive = false;

  const target = trainData.targets.find((t) => t.id === activeTargetId);
  if (!target) {
    activeTargetId = null;
    const state = getState();
    state.overlayPoints = null;
    state.customPoints = null;
    redraw();
    return;
  }

  const attPts = getAllPoints();
  if (attPts.length < 10) {
    toast('Mindestens 10 Punkte zum Vergleichen!');
    activeTargetId = null;
    return;
  }

  const err = comparePaths(target.normalizedPoints, attPts);
  const score = Math.max(0, Math.min(100, Math.round((1 - err) * 100)));

  trainData.attempts.push({
    timestamp: Date.now(),
    targetId: activeTargetId,
    score,
    strokes: structuredClone(getState().strokes),
  });
  saveTrainData();

  activeTargetId = null;
  const state = getState();
  state.overlayPoints = null;
  state.customPoints = null;
  best = null;
  updateScore('0', '—', '—');

  const resEl = document.getElementById('tRes');
  if (resEl)
    resEl.innerHTML = emptyState(
      '📈',
      'Zeichne eine Funktion',
      'Stift oder Finger. Erkennung + multi-CAS automatisch.',
    );

  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.classList.remove('active');
  });
  const tabs = document.querySelectorAll<HTMLElement>('.tab');
  tabs[5]?.classList.add('active');
  ['tRes', 'tCas', 'tInp', 'tBode', 'tHist', 'tTrain'].forEach((id) =>
    document.getElementById(id)?.classList.remove('on'),
  );
  document.getElementById('tTrain')?.classList.add('on');

  renderTrainingList();
  const resultEl = document.getElementById('trResult');
  if (resultEl) {
    const scoreClass = score >= 80 ? '#238636' : score >= 50 ? '#f0883e' : '#f85149';
    const scoreLabel = score >= 80 ? 'Sehr gut!' : score >= 50 ? 'Gut!' : 'Weiter üben!';
    resultEl.innerHTML = `<div class="card" style="border-color:${scoreClass}"><div class="tr-score" style="color:${scoreClass}">${score}%</div><div style="text-align:center;font-size:12px;color:${scoreClass};margin-bottom:6px">${scoreLabel}</div><div class="card" style="margin:0"><div class="cr"><span>Vergleich mit: ${esc(target.label)}</span><span class="badge">Referenz</span></div><div style="font-size:10px;color:#8b949e">RMSE-Fehler: ${err.toFixed(4)}</div></div></div>`;
  }

  toast(
    'Ergebnis: ' +
      score +
      '% — ' +
      (score >= 80 ? 'Sehr gut!' : score >= 50 ? 'Gut!' : 'Weiter üben!'),
  );
}

function renderTrainingList(): void {
  trainMode(trainCurrentMode);
}

function trainMode(mode: 'record' | 'practice' | 'stats'): void {
  const el = document.getElementById('tTrain');
  if (!el) return;
  trainCurrentMode = mode;

  const modeBtns = [
    { m: 'record', l: '📝 Aufzeichnen' },
    { m: 'practice', l: '🎯 Üben' },
    { m: 'stats', l: '📊 Statistik' },
  ];

  let h = '<div class="tr-mode">';
  modeBtns.forEach((mb) => {
    h += `<button class="b${mb.m === mode ? ' on' : ''}" data-tr-mode="${mb.m}">${mb.l}</button>`;
  });
  h += '</div>';
  h += '<div id="trResult"></div>';

  if (mode === 'record') {
    h += `<div class="card"><div class="cr"><span>Ziel speichern</span><span class="badge orange">Record</span></div>`;
    h += `<div class="cas-input"><input id="trLabel" placeholder="Bezeichnung (z.B. sin(x))"></div>`;
    h += `<button class="b grn" id="btnSaveTarget">💾 Speichern</button></div>`;
    h += `<div class="card"><div class="cr"><span>Gespeicherte Ziele</span><span class="badge blue">${trainData.targets.length}</span></div>`;
    if (trainData.targets.length === 0) {
      h +=
        '<div style="text-align:center;padding:12px;color:#484f58;font-size:11px">Noch keine Ziele gespeichert.</div>';
    } else {
      h += '<div style="max-height:250px;overflow-y:auto">';
      trainData.targets.forEach((t) => {
        const count = trainData.attempts.filter((a) => a.targetId === t.id).length;
        h += `<div class="tr-target"><div><div class="lbl">${esc(t.label)}</div><div class="sub">${t.difficulty} · ${count} Versuche</div></div>`;
        h += `<div style="display:flex;gap:3px"><button class="b btn-start-practice" data-id="${t.id}">▶</button><button class="b red btn-delete-target" data-id="${t.id}">✕</button></div></div>`;
      });
      h += '</div>';
    }
    h += '</div>';
  } else if (mode === 'practice') {
    h += `<div class="card"><div class="cr"><span>Zum Üben auswählen</span><span class="badge">Practice</span></div>`;
    if (trainData.targets.length === 0) {
      h +=
        '<div style="text-align:center;padding:12px;color:#484f58;font-size:11px">Keine Ziele vorhanden. Erst welche aufzeichnen!</div>';
    } else {
      h += '<div style="max-height:400px;overflow-y:auto">';
      trainData.targets.forEach((t) => {
        const atts = trainData.attempts.filter((a) => a.targetId === t.id);
        const avgScore =
          atts.length > 0 ? Math.round(atts.reduce((s, a) => s + a.score, 0) / atts.length) : 0;
        h += `<div class="tr-target"><div><div class="lbl">${esc(t.label)}</div><div class="sub">${t.difficulty} · Ø ${avgScore}% · ${atts.length} Versuche</div></div>`;
        h += `<button class="b grn btn-start-practice" data-id="${t.id}">▶ Üben</button></div>`;
      });
      h += '</div>';
    }
    h += '</div>';
  } else if (mode === 'stats') {
    const totalTargets = trainData.targets.length;
    const totalAttempts = trainData.attempts.length;
    const avgScore =
      totalAttempts > 0
        ? Math.round(trainData.attempts.reduce((s, a) => s + a.score, 0) / totalAttempts)
        : 0;
    const bestScore = totalAttempts > 0 ? Math.max(...trainData.attempts.map((a) => a.score)) : 0;

    const perTarget: Record<string, { scores: number[]; count: number }> = {};
    trainData.attempts.forEach((a) => {
      if (!perTarget[a.targetId]) perTarget[a.targetId] = { scores: [], count: 0 };
      perTarget[a.targetId]!.scores.push(a.score);
      perTarget[a.targetId]!.count++;
    });

    h += '<div class="tr-stat">';
    h += `<div class="card"><div style="font-size:9px;color:#8b949e">Ziele</div><div class="sv2">${totalTargets}</div></div>`;
    h += `<div class="card"><div style="font-size:9px;color:#8b949e">Versuche</div><div class="sv2">${totalAttempts}</div></div>`;
    h += `<div class="card"><div style="font-size:9px;color:#8b949e">Ø Score</div><div class="sv2">${avgScore}%</div></div>`;
    h += '</div><div class="tr-stat">';
    h += `<div class="card"><div style="font-size:9px;color:#8b949e">Bestes Ergebnis</div><div class="sv2" style="color:#238636">${bestScore}%</div></div>`;
    h += `<div class="card"><div style="font-size:9px;color:#8b949e">Fortschritt</div><div class="sv2" style="font-size:11px">${totalAttempts > 0 ? avgScore + '% Ø' : '—'}</div></div>`;
    h += '</div>';

    if (totalTargets > 0) {
      h += '<div class="card"><div class="cr"><span>Pro Ziel</span></div>';
      trainData.targets.forEach((t) => {
        const ta = perTarget[t.id];
        const cnt = ta ? ta.count : 0;
        const avg = ta ? Math.round(ta.scores.reduce((s, v) => s + v, 0) / cnt) : 0;
        const bst = ta ? Math.max(...ta.scores) : 0;
        h += `<div class="tr-target"><div><div class="lbl">${esc(t.label)}</div><div class="sub">Ø ${avg}% · Best: ${bst}% · ${cnt} Versuche</div></div></div>`;
      });
      h += '</div>';
    }

    h += `<div style="margin-top:8px"><button class="b grn" id="btnExportTrain">📥 Export JSON</button>`;
    h += `<button class="b red" id="btnClearTrain">🗑 Alles löschen</button></div>`;
  }

  el.innerHTML = h;

  // Attach event listeners
  el.querySelectorAll<HTMLElement>('[data-tr-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      trainMode(btn.dataset['trMode'] as 'record' | 'practice' | 'stats');
    });
  });

  el.querySelectorAll<HTMLElement>('.btn-start-practice').forEach((btn) => {
    btn.addEventListener('click', () => {
      startPractice(btn.dataset['id']!);
    });
  });

  el.querySelectorAll<HTMLElement>('.btn-delete-target').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteTarget(btn.dataset['id']!);
    });
  });

  document.getElementById('btnSaveTarget')?.addEventListener('click', saveTrainingTarget);
  document.getElementById('btnExportTrain')?.addEventListener('click', exportTrainingData);
  document.getElementById('btnClearTrain')?.addEventListener('click', () => {
    if (confirm('Alle Trainingsdaten löschen?')) {
      trainData = { targets: [], attempts: [] };
      saveTrainData();
      trainMode('stats');
      toast('Gelöscht!');
    }
  });
}

function exportTrainingData(): void {
  const json = JSON.stringify(trainData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sketch-cas-training.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Training-Data exported!');
}

// ---- Audio ----
let audioCtx: AudioContext | null = null;

function playAudio(): void {
  if (!best) {
    toast('Erst Funktion erkennen!');
    return;
  }
  try {
    if (!audioCtx)
      audioCtx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
    const sr = audioCtx.sampleRate;
    const dur = 2;
    const buf = audioCtx.createBuffer(1, sr * dur, sr);
    const d = buf.getChannelData(0);
    const p = best.params;
    const amp = (p['amp'] as number) || 1;
    const freq = (p['freq'] as number) || 1;
    const off = (p['offset'] as number) || 0;
    const ph = (p['phase'] as number) || 0;
    const om = 2 * Math.PI * freq;
    const t = p['type'] as string;

    for (let i = 0; i < d.length; i++) {
      const x = i / sr;
      let y = 0;
      switch (t) {
        case 'sin':
          y = amp * Math.sin(om * x + ph) + off;
          break;
        case 'cos':
          y = amp * Math.cos(om * x + ph) + off;
          break;
        case 'abs_sin':
          y = amp * Math.abs(Math.sin(om * x + ph)) + off;
          break;
        case 'square':
          y = amp * Math.sign(Math.sin(om * x + ph)) + off;
          break;
        case 'damped':
          y = amp * Math.exp(-freq * x) * Math.sin(om * x + ph) + off;
          break;
        case 'exponential':
          y = amp * Math.exp(((p['fB'] as number) || 1) * x) + off;
          break;
        case 'heaviside':
          y = amp * Math.sign(x - 0.5) + off;
          break;
        default:
          y = amp * Math.sin(om * x + ph) + off;
      }
      d[i] = Math.max(-1, Math.min(1, y * 0.3));
    }

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const fade = audioCtx.createGain();
    src.connect(fade);
    fade.connect(audioCtx.destination);
    fade.gain.setValueAtTime(0, audioCtx.currentTime);
    fade.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);
    fade.gain.setValueAtTime(1, audioCtx.currentTime + dur - 0.1);
    fade.gain.linearRampToValueAtTime(0, audioCtx.currentTime + dur);
    src.start();
    src.stop(audioCtx.currentTime + dur);
    toast('Spiele: ' + best.label);
  } catch (e) {
    toast('Audio: ' + (e as Error).message);
  }
}

// ---- PNG Export ----
function exportPNG(): void {
  const canvas = document.getElementById('dc') as HTMLCanvasElement;
  const ac = document.getElementById('ac') as HTMLCanvasElement;
  if (!canvas || !ac) return;

  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tc = tmp.getContext('2d')!;
  tc.fillStyle = '#0d1117';
  tc.fillRect(0, 0, tmp.width, tmp.height);
  tc.drawImage(ac, 0, 0);
  tc.drawImage(canvas, 0, 0);
  tmp.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sketch-cas.png';
    a.click();
    URL.revokeObjectURL(url);
    toast('PNG exportiert!');
  });
}

// ---- Setup UI Event Handlers ----
function setupUIHandlers(): void {
  // Top buttons
  document.getElementById('bUndo')?.addEventListener('click', undo);
  document.getElementById('bRedo')?.addEventListener('click', redo);
  document.getElementById('bGrid')?.addEventListener('click', (e) => {
    toggleGrid();
    (e.currentTarget as HTMLElement).classList.toggle('on');
  });
  document.getElementById('bOvl')?.addEventListener('click', (e) => {
    toggleOverlay();
    (e.currentTarget as HTMLElement).classList.toggle('on');
  });
  document.getElementById('bClear')?.addEventListener('click', () => {
    clearAll();
    best = null;
    updateScore('0', '—', '—');
    const resEl = document.getElementById('tRes');
    const casEl = document.getElementById('tCas');
    const bodeEl = document.getElementById('tBode');
    if (resEl) resEl.innerHTML = emptyState('📈', 'Zeichne eine Funktion', 'Stift oder Finger.');
    if (casEl)
      casEl.innerHTML = emptyState(
        '⚡',
        'Wähle eine Funktion',
        'Alle CAS-Engines analysieren automatisch.',
      );
    if (bodeEl) bodeEl.innerHTML = emptyState('📊', 'Bode', 'Periodische Funktion erkennen.');
    practiceActive = false;
    activeTargetId = null;
  });

  // Sound and export
  document.getElementById('bSound')?.addEventListener('click', playAudio);
  document.getElementById('bExport')?.addEventListener('click', exportPNG);

  // Tabs
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll<HTMLElement>('.tab').forEach((x) => {
        x.classList.remove('active');
      });
      t.classList.add('active');
      ['tRes', 'tCas', 'tInp', 'tBode', 'tHist', 'tTrain'].forEach((id) =>
        document.getElementById(id)?.classList.remove('on'),
      );
      const map: Record<string, string> = {
        res: 'tRes',
        cas: 'tCas',
        inp: 'tInp',
        bode: 'tBode',
        hist: 'tHist',
        train: 'tTrain',
      };
      const targetId = map[t.dataset['t'] || ''];
      if (targetId) document.getElementById(targetId)?.classList.add('on');
    });
  });

  // Engine selector
  document.getElementById('engSel')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-eng]');
    if (!btn) return;
    document.querySelectorAll<HTMLElement>('#engSel .b').forEach((b) => {
      b.classList.remove('on');
    });
    btn.classList.add('on');
    selectedEngine = btn.dataset['eng'] || 'all';
  });

  // CAS input buttons
  const casOps = ['simplify', 'diff', 'integrate', 'taylor', 'laplace', 'solve', 'plot'];
  casOps.forEach((op) => {
    const btn = document.querySelector<HTMLElement>(`button[data-cas-op="${op}"]`);
    if (btn) {
      btn.replaceWith(btn.cloneNode(true));
      const newBtn = document.querySelector<HTMLElement>(`button[data-cas-op="${op}"]`);
      if (newBtn) {
        newBtn.addEventListener('click', () => {
          const raw = (document.getElementById('casIn') as HTMLInputElement)?.value.trim();
          if (!raw) {
            toast('Formel eingeben!');
            return;
          }
          renderCasResult(op as CasOperation, raw);
        });
      }
    }
  });

  // Fix solve equation button
  const eqBtn = document.getElementById('btnSolveEq');
  if (eqBtn) {
    const newBtn = eqBtn.cloneNode(true) as HTMLElement;
    eqBtn.replaceWith(newBtn);
    newBtn.addEventListener('click', multiSolveEq);
  }

  // CAS auto-load
  setupGiacAutoload();
}

// ---- Expose globals for HTML inline usage / Playwright ----
const g = window as unknown as Record<string, unknown>;
g['cpT'] = copyToClipboard;
g['_casTab'] = () => {
  document.querySelectorAll<HTMLElement>('.tab')[1]?.click();
};
g['__sk'] = {
  get best() {
    return best;
  },
  get ovlP() {
    return ovlP;
  },
  get custP() {
    return custP;
  },
  get selectedEngine() {
    return selectedEngine;
  },
  get trainData() {
    return trainData;
  },
  get practiceActive() {
    return practiceActive;
  },
  get showOvl() {
    try {
      return getState().showOverlay;
    } catch {
      return true;
    }
  },
  get showGrid() {
    try {
      return getState().showGrid;
    } catch {
      return true;
    }
  },
  get selEng() {
    return selectedEngine;
  },
  normPts,
  getAllPoints,
  saveTrainData,
  loadTrainData,
  saveTrainingTarget,
  deleteTarget,
  startPractice,
  endPractice,
  trainMode,
  exportTrainingData,
  genId,
  evalTemplate,
};

// ---- Init ----
function init(): void {
  initCanvas();
  setStrokeCompleteCallback(scheduleR);
  loadTrainData();
  trainMode('record');
  setupUIHandlers();
  renderH();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {
  toast,
  renderKaTeX,
  updateScore,
  emptyState,
  esc,
  runCas,
  getSymExpr,
  drawBode,
  scheduleR,
  recognize,
};
