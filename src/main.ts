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
import { normalizeAndResample, getFeatures, matchTrainingExamples } from './modules/recognition';
import { generateTemplates } from './modules/templates';
import { evalTemplate } from './modules/numeric';
import { toast, esc, copyToClipboard, updateScore, emptyState, renderKaTeX } from './modules/ui';
import { exprToLatex } from './modules/latex';
import {
  runCas,
  hasAlgebrite,
  hasNerdamer,
  hasXcas,
  setupGiacAutoload,
  getSymExpr,
} from './modules/cas';
import { drawBode } from './modules/bode';
import { getSeedExamples } from './modules/seed-training';
import type { TemplateCandidate, CasOperation } from './types';

// ---- App State (mirrors what was in the inline script) ----
let best: TemplateCandidate | null = null;
let ovlP: { x: number; y: number }[] | null = null;
let custP: { x: number; y: number }[] | null = null;
let seedLoaded = false;

const hist = JSON.parse(localStorage.getItem('scH5') || '[]') as {
  label: string;
  latex: string;
  time: string;
  matchedType?: string;
}[];

// ---- Recognition ----
let recognizeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleR(): void {
  const state = getState();

  // If in tracing mode, save the drawing as a trace example
  if (state.traceTarget && state.traceType && state.traceLabel) {
    const userPts = normalizeAndResample(state.strokes);
    if (userPts && userPts.length >= 5) {
      saveTraceExample(userPts, state.traceType, state.traceLabel);
      // Keep the trace target visible, just clear user strokes
      state.strokes = [];
      state.undoStack = [];
      state.redoStack = [];
      state.overlayPoints = null;
      state.customPoints = null;
      redraw();
      return;
    }
  }

  if (recognizeTimer) clearTimeout(recognizeTimer);
  recognizeTimer = setTimeout(recognize, 350);
}

// ---- Self-Training Thresholds ----
const AUTO_SAVE_THRESHOLD = 0.7; // Save automatically if confidence >= 70%
const DISCARD_THRESHOLD = 0.3; // Show warning if best confidence < 30%

/**
 * Convert candidate errors to softmax probabilities.
 * Lower error → higher probability.
 */
function errorsToProbs(cands: TemplateCandidate[]): number[] {
  const temps = 0.15; // temperature — lower = sharper distribution
  const minErr = Math.min(...cands.map((c) => c.err));
  // Shift so minimum error maps to 0
  const shifted = cands.map((c) => Math.max(0, c.err - minErr));
  const exps = shifted.map((e) => Math.exp(-e / temps));
  const sum = exps.reduce((s, v) => s + v, 0);
  return sum > 0 ? exps.map((e) => e / sum) : exps.map(() => 1 / cands.length);
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

  // Training boost: compare against stored labeled examples
  const allExamples = [
    ...trainData.targets
      .filter((t) => t.normalizedPoints?.length > 2)
      .map((t) => ({
        id: t.id,
        label: t.label,
        normalizedPoints: t.normalizedPoints,
        matchedType: t.matchedType || '',
      })),
    ...trainData.corrections,
  ];
  const trainMatches = matchTrainingExamples(pts, allExamples);

  let trainingBoostApplied = false; // Track if training boost changed the winner
  const prevBestType = (cands[0]?.params['type'] as string) || '';

  if (trainMatches.length > 0 && trainMatches[0]!.rmse < 0.15) {
    const bestMatch = trainMatches[0]!;
    const matchType = bestMatch.example.matchedType;
    // Boost the matching template type — scale with match quality
    // strip 'trace_' and 'auto_' prefixes, map trace-specific names to template types
    const TRACE_TYPE_MAP: Record<string, string> = {
      trace_inv_x: 'reciprocal',
      trace_ln: 'logarithmic',
      trace_heaviside: 'square',
    };
    // Map known function names from custom traces to template types
    const CUSTOM_FN_MAP: Record<string, string> = {
      sqrt: 'sqrt',
      ln: 'logarithmic',
      log: 'logarithmic',
      exp: 'exponential',
      sin: 'sin',
      cos: 'cos',
      tan: 'tan',
      abs: 'abs_sin',
      '1/x': 'reciprocal',
      recip: 'reciprocal',
    };

    // Resolve matchedType → template candidate type
    let templateType = TRACE_TYPE_MAP[matchType] ?? '';
    if (!templateType) {
      // Strip trace_ or auto_ prefix
      const raw = matchType.startsWith('trace_')
        ? matchType.slice(6)
        : matchType.startsWith('auto_')
          ? matchType.slice(5)
          : matchType;
      // Handle trace_custom:sqrt(x) → extract function name
      if (raw.startsWith('custom:')) {
        const fnExpr = raw.slice(7); // e.g. "sqrt(x)"
        const fnName = fnExpr.replace(/\(.*/, '').trim(); // e.g. "sqrt"
        templateType = CUSTOM_FN_MAP[fnName] ?? fnName;
      } else {
        templateType = raw;
      }
    }
    console.log(
      '[TRAIN-BOOST] matchType=' +
        matchType +
        ' → templateType=' +
        templateType +
        ' rmse=' +
        bestMatch.rmse.toFixed(4),
    );
    if (templateType) {
      // Boost strength: RMSE 0 → 0.1 (very strong), RMSE 0.15 → 0.5 (moderate)
      const boostFactor = 0.1 + (bestMatch.rmse / 0.15) * 0.4;
      let found = false;
      for (const c of cands) {
        const cType = (c.params['type'] as string) || '';
        if (cType === templateType) {
          console.log(
            '[TRAIN-BOOST] ✅ Found candidate: ' +
              c.label +
              ' err=' +
              c.err.toFixed(4) +
              ' ×' +
              boostFactor.toFixed(3),
          );
          c.err *= boostFactor;
          found = true;
          break;
        }
      }
      if (!found) {
        console.log(
          '[TRAIN-BOOST] ❌ No candidate with type=' +
            templateType +
            ' (candidates: ' +
            cands.map((c) => c.params['type']).join(', ') +
            ')',
        );
      }
      cands.sort((a, b) => a.err - b.err);
      // Check if training boost changed the winner
      const newBestType = (cands[0]?.params['type'] as string) || '';
      if (newBestType !== prevBestType) {
        trainingBoostApplied = true;
      }
    }
  }

  // Compute softmax probabilities for all candidates
  best = cands[0]!;
  const probs = errorsToProbs(cands);
  const bestProb = probs[0]!;

  console.log('[DEBUG] ALL candidates (' + cands.length + '):');
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]!;
    console.log(
      '[DEBUG]   ' +
        i +
        ': ' +
        c.label +
        ' err=' +
        String(c.err).substring(0, 8) +
        ' p=' +
        (probs[i]! * 100).toFixed(1) +
        '% type=' +
        String(typeof c.params['type'] === 'string' ? c.params['type'] : '?'),
    );
  }

  const xs = pts.map((p) => p.x);
  ovlP = xs.map((x) => ({ x, y: evalTemplate(x, best!) }));
  custP = null;

  // Score display uses raw RMSE (not composite) for user-friendly percentage
  const rawErr = (best.params['rawErr'] as number) ?? best.err;
  const tp = strokes.reduce((s, st) => s + st.points.length, 0);
  const pct = Math.max(0, Math.min(100, 100 * (1 - rawErr * 3))).toFixed(1);
  updateScore('' + tp, best.label, pct + '%');

  // ---- Self-Training Logic ----
  const matchType = (best.params['type'] as string) || '';
  let autoSaved = false;

  if (bestProb >= AUTO_SAVE_THRESHOLD && !trainingBoostApplied) {
    // Skip auto-save for custom/unknown types (no template to boost)
    if (!matchType || matchType === 'unknown') {
      console.log('[SELF-TRAIN] ⏭ Skipped: no template type');
    } else {
      // Deduplication: only save if no existing example of this type has RMSE < 0.05
      // Limit to 5 most recent examples for performance
      const existingSame = trainData.corrections
        .filter((c) => c.matchedType === 'auto_' + matchType)
        .slice(-5);
      const isDuplicate =
        existingSame.length > 0 &&
        existingSame.some((c) => {
          const match = matchTrainingExamples(pts, [c]);
          return match.length > 0 && match[0]!.rmse < 0.05;
        });
      if (isDuplicate) {
        console.log('[SELF-TRAIN] ⏭ Skipped: duplicate of ' + matchType);
      } else {
        // Auto-save as training example (only if training boost didn't change the winner)
        const autoLabel = best.label;
        trainData.corrections.push({
          id: genId(),
          timestamp: Date.now(),
          label: autoLabel,
          normalizedPoints: pts,
          matchedType: 'auto_' + matchType,
        });
        saveTrainData();
        autoSaved = true;
        console.log(
          '[SELF-TRAIN] ✅ Auto-saved: ' + autoLabel + ' (p=' + (bestProb * 100).toFixed(1) + '%)',
        );
      }
    }
  } else if (trainingBoostApplied) {
    console.log(
      '[SELF-TRAIN] ⏸️ Skipped auto-save (training boost changed winner to ' + best.label + ')',
    );
  } else if (bestProb < DISCARD_THRESHOLD) {
    // Too uncertain — discard this recognition
    best = null;
    ovlP = null;
    console.log(
      '[SELF-TRAIN] ❌ Discarded (best p=' +
        (bestProb * 100).toFixed(1) +
        '% < ' +
        DISCARD_THRESHOLD * 100 +
        '%)',
    );
    const resEl = document.getElementById('tRes');
    if (resEl) {
      const topLabels = cands
        .slice(0, 3)
        .map((c) => `${c.label} (${(probs[cands.indexOf(c)]! * 100).toFixed(0)}%)`)
        .join(', ');
      const discardedLabel = cands[0]?.label || 'unbekannt';
      resEl.innerHTML = `<div style="margin:6px 0;padding:8px;background:#f8514922;border:1px solid #f85149;border-radius:5px;font-size:11px;color:#f85149;text-align:center">
        ⚠️ Zu unsicher — verworfen<br>
        <span style="font-size:9px;color:#8b949e">Beste Optionen: ${esc(topLabels)}</span>
      </div>
      <div style="text-align:center;padding:8px"><button class="b btn-correct" data-type="${esc(matchType)}" data-label="${esc(discardedLabel)}">📝 Trotzdem korrigieren</button></div>`;
    }
    updateScore('' + tp, '⚠️ Unklar', (bestProb * 100).toFixed(0) + '%');
    return;
  }

  renderRes(cands, trainMatches, probs, autoSaved);
  renderCAS(best);
  drawBode(best);
  addH(best);
}

function renderRes(
  cands: TemplateCandidate[],
  trainMatches?: { example: { label: string; matchedType: string }; rmse: number }[],
  probs?: number[],
  autoSaved?: boolean,
): void {
  const el = document.getElementById('tRes');
  if (!el) return;

  const mx = Math.max(...cands.map((c) => c.err));
  const mn = cands[0]!.err;

  // Auto-save badge
  let autoSaveBadge = '';
  if (autoSaved) {
    autoSaveBadge = `<div style="margin:6px 0;padding:6px 8px;background:#23863622;border:1px solid #238636;border-radius:5px;font-size:10px;color:#238636;text-align:center">🤖 Auto-gespeichert als Trainingsbeispiel</div>`;
  }

  // Training match badge
  let trainBadge = '';
  if (trainMatches && trainMatches.length > 0 && trainMatches[0]!.rmse < 0.15) {
    const tm = trainMatches[0]!;
    const simPct = Math.round((1 - tm.rmse) * 100);
    trainBadge = `<div style="margin:6px 0;padding:6px 8px;background:#58a6ff22;border:1px solid #58a6ff;border-radius:5px;font-size:10px;color:#58a6ff;text-align:center">🎯 Training: ${esc(tm.example.label)} (${simPct}% Ähnlichkeit)</div>`;
  }

  // Probability distribution header
  let probHeader = '';
  if (probs && probs.length > 0) {
    const topP = probs[0]! * 100;
    const color = topP >= 70 ? '#238636' : topP >= 40 ? '#f0883e' : '#f85149';
    probHeader = `<div style="margin:4px 0;padding:4px 8px;background:${color}11;border:1px solid ${color}44;border-radius:4px;font-size:9px;color:${color};display:flex;justify-content:space-between">
      <span>📊 Wahrscheinlichkeiten</span>
      <span>Beste: ${topP.toFixed(1)}%</span>
    </div>`;
  }

  let h = autoSaveBadge + trainBadge + probHeader;
  cands.slice(0, 6).forEach((c, i) => {
    const pct = Math.max(0, Math.min(100, 100 * (1 - (c.err - mn) / (mx - mn + 0.001))));
    const cls = i === 0 ? 'best' : '';
    const badge = i === 0 ? '<span class="badge">Best</span>' : '';
    const bgColor = i === 0 ? '#238636' : '#58a6ff';
    const prob = probs ? (probs[i]! * 100).toFixed(1) : null;
    const probColor = prob
      ? Number(prob) >= 70
        ? '#238636'
        : Number(prob) >= 40
          ? '#f0883e'
          : '#f85149'
      : bgColor;

    h += `<div class="card ${cls}" onclick="window._casTab()">`;
    h += `<div class="cr"><span>${c.label}</span>${badge}${prob ? `<span style="font-size:9px;color:${probColor};margin-left:auto">${prob}%</span>` : ''}</div>`;
    h += `<div class="cf" data-latex="${esc(c.latex)}"></div>`;
    h += `<div class="mb"><div class="mf" style="width:${pct}%;background:${probColor}"></div></div>`;
    h += `<div class="cm"><span>Fit: ${Math.max(0, Math.min(100, 100 - ((c.params['rawErr'] as number) ?? c.err) * 100)).toFixed(1)}%</span></div>`;
    h += `<div class="cl" onclick="event.stopPropagation();window.cpT(this)">${esc(c.latex)}</div>`;
    if (i === 0) {
      h += `<div style="margin-top:6px;text-align:center"><button class="b btn-correct" data-type="${esc((c.params['type'] as string) || '')}" data-label="${esc(c.label)}">📝 Korrigieren</button></div>`;
    }
    h += '</div>';
  });

  el.innerHTML = h;
  renderKaTeX(el);

  // Attach correction handlers
  el.querySelectorAll<HTMLElement>('.btn-correct').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openCorrectionDialog(btn.dataset['type'] || '', btn.dataset['label'] || '');
    });
  });
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

function addH(c: TemplateCandidate): void {
  const now = new Date();
  const time = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  const matchedType = (c.params['type'] as string) || '';
  hist.unshift({ label: c.label, latex: c.latex, time, matchedType });
  if (hist.length > 50) hist.splice(50);
  localStorage.setItem('scH5', JSON.stringify(hist));
  renderH();
}

function openCorrectionDialog(matchedType: string, currentLabel: string): void {
  // Build a correction dialog
  const labels = [
    'sin(x)',
    'cos(x)',
    'tan(x)',
    'x²',
    'x³',
    'x',
    '1/x',
    'eˣ',
    'ln(x)',
    '|x|',
    'Heaviside(x)',
    'Dämpfte Sinus',
  ];
  let h = `<div style="position:fixed;inset:0;background:#000a;z-index:9999;display:flex;align-items:center;justify-content:center" id="corrDlg">`;
  h += `<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px;max-width:320px;width:90%">`;
  h += `<div style="font-size:13px;font-weight:600;color:#e6edf3;margin-bottom:8px">📝 Erkennung korrigieren</div>`;
  h += `<div style="font-size:10px;color:#8b949e;margin-bottom:10px">Aktuell erkannt als: <b>${esc(currentLabel)}</b></div>`;
  h += `<div style="font-size:10px;color:#c9d1d9;margin-bottom:6px">Schnellauswahl:</div>`;
  h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px" id="corrQuick">`;
  labels.forEach((l) => {
    h += `<button class="b" style="font-size:9px;padding:3px 6px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:4px;cursor:pointer" data-v="${esc(l)}">${esc(l)}</button>`;
  });
  h += `</div>`;
  h += `<input id="corrInput" type="text" placeholder="Oder eingeben: sin(x)" style="width:100%;padding:6px 8px;background:#0d1117;border:1px solid #30363d;border-radius:5px;color:#e6edf3;font-size:12px;margin-bottom:10px" value="">`;
  h += `<div style="display:flex;gap:6px">`;
  h += `<button class="b" style="flex:1;background:#238636;color:#fff;border:none;padding:6px;border-radius:5px;cursor:pointer;font-size:11px" id="corrSave">Speichern</button>`;
  h += `<button class="b" style="flex:1;background:#21262d;color:#8b949e;border:1px solid #30363d;padding:6px;border-radius:5px;cursor:pointer;font-size:11px" id="corrCancel">Abbrechen</button>`;
  h += `</div>`;
  h += `</div></div>`;

  document.body.insertAdjacentHTML('beforeend', h);

  const dlg = document.getElementById('corrDlg')!;
  const input = document.getElementById('corrInput') as HTMLInputElement;

  // Quick selection buttons
  dlg.querySelectorAll<HTMLElement>('[data-v]').forEach((btn) => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset['v']!;
      input.focus();
    });
  });

  // Save handler
  const doSave = () => {
    const label = input.value.trim();
    if (!label) {
      toast('Bezeichnung eingeben!');
      return;
    }
    saveCorrection(label, matchedType);
    dlg.remove();
  };

  document.getElementById('corrSave')?.addEventListener('click', doSave);
  document.getElementById('corrCancel')?.addEventListener('click', () => {
    dlg.remove();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') dlg.remove();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.remove();
  });

  input.focus();
}

function saveCorrection(label: string, matchedType: string): void {
  const pts = normalizeAndResample(getState().strokes);
  if (!pts || pts.length < 2) {
    toast('Keine Zeichnung vorhanden!');
    return;
  }

  trainData.corrections.push({
    id: genId(),
    timestamp: Date.now(),
    label,
    normalizedPoints: pts,
    matchedType,
  });
  saveTrainData();
  toast('✅ Korrektur gespeichert: ' + label);
}

function renderH(): void {
  const el = document.getElementById('tHist');
  if (!el) return;

  if (!hist.length) {
    el.innerHTML = emptyState('🕐', 'Leerer Verlauf', 'Erkennungen werden gespeichert.');
    return;
  }

  let h = '';
  hist.forEach((x, i) => {
    h += `<div class="card" style="cursor:pointer" data-hi="${i}"><div style="display:flex;justify-content:space-between"><span style="font-size:11px">${esc(x.label)}</span><span style="font-size:9px;color:#8b949e">${esc(x.time)}</span></div><div class="cl" style="font-size:9px;margin-top:2px">${esc(x.latex)}</div></div>`;
  });
  el.innerHTML = h;
  el.querySelectorAll<HTMLElement>('[data-hi]').forEach((card) => {
    card.addEventListener('click', () => {
      const entry = hist[Number(card.dataset['hi'])];
      if (!entry) return;
      const inp = document.getElementById('casIn') as HTMLInputElement | null;
      if (inp) {
        inp.value = entry.latex;
        document.querySelectorAll<HTMLElement>('.tab').forEach((x) => {
          x.classList.remove('active');
        });
        document.querySelectorAll<HTMLElement>('.tp').forEach((x) => {
          x.classList.remove('on');
        });
        const inpTab = document.querySelector<HTMLElement>('[data-t="inp"]');
        inpTab?.classList.add('active');
        document.getElementById('tInp')?.classList.add('on');
        toast('Formel geladen: ' + entry.label);
      }
    });
  });
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
  const prepared = expr
    // Step 1: Replace function names and constants FIRST (before Math.pow)
    .replace(/\b(sin|cos|tan|abs|sqrt|exp|log|asin|acos|atan|sinh|cosh|tanh)\b/g, 'Math.$1')
    .replace(/\bpi\b/g, 'Math.PI')
    .replace(/\be\b/g, 'Math.E')
    // Step 2: Convert ^ to Math.pow — avoids unary-minus precedence issues with **
    .replace(/([a-zA-Z0-9._)]+)\^([a-zA-Z0-9.(]+)/g, 'Math.pow($1,$2)')
    // Step 3: Implicit multiplication: 2x -> 2*x, 3Math.sin -> 3*Math.sin
    .replace(/(\d)([a-zA-Z(])/g, '$1*$2')
    .replace(/(\))(\d)/g, '$1*$2')
    .replace(/(\))(\()/g, '$1*$2');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('x', 'return ' + prepared) as (x: number) => number;
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
  matchedType?: string;
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
  corrections: {
    id: string;
    timestamp: number;
    label: string;
    normalizedPoints: { x: number; y: number }[];
    matchedType: string;
  }[];
}

let trainData: TrainData = { targets: [], attempts: [], corrections: [] };
let trainCurrentMode: 'record' | 'practice' | 'trace' | 'stats' = 'record';
let practiceActive = false;
let activeTargetId: string | null = null;

function loadTrainData(): void {
  try {
    const raw = localStorage.getItem('scTrainV6');
    if (raw) trainData = JSON.parse(raw) as TrainData;
  } catch {
    /* ignore */
  }
  if (!trainData) trainData = { targets: [], attempts: [], corrections: [] };
  if (!trainData.targets) trainData.targets = [];
  if (!trainData.attempts) trainData.attempts = [];
  if (!trainData.corrections) trainData.corrections = [];
}

/** Load pre-learned seed examples (only once per session). */
function loadSeedData(): void {
  if (seedLoaded) return;
  seedLoaded = true;
  // Check if seeds are already loaded (dedup by ID prefix)
  const hasSeeds = trainData.corrections.some((c) => c.id.startsWith('seed_'));
  if (hasSeeds) return;
  const seeds = getSeedExamples();
  for (const ex of seeds) {
    trainData.corrections.push({
      id: ex.id,
      timestamp: Date.now() - 86400000,
      label: ex.label,
      normalizedPoints: ex.normalizedPoints,
      matchedType: ex.matchedType,
    });
  }
  saveTrainData();
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

  const matchedType = best ? (best.params['type'] as string) || '' : '';
  const target: TrainTarget = {
    id: genId(),
    timestamp: Date.now(),
    label,
    strokes: structuredClone(getState().strokes),
    normalizedPoints: normPts(allPts),
    difficulty: calcDifficulty(allPts),
    matchedType,
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

function trainMode(mode: 'record' | 'practice' | 'trace' | 'stats'): void {
  const el = document.getElementById('tTrain');
  if (!el) return;
  trainCurrentMode = mode;

  const modeBtns = [
    { m: 'record', l: '📝 Aufzeichnen' },
    { m: 'practice', l: '🎯 Üben' },
    { m: 'trace', l: '🖊 Nachzeichnen' },
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
  } else if (mode === 'trace') {
    const traceFns = [
      { type: 'sin', label: 'sin(x)', latex: 'sin(x)' },
      { type: 'cos', label: 'cos(x)', latex: 'cos(x)' },
      { type: 'linear', label: 'x', latex: 'x' },
      { type: 'exponential', label: 'eˣ', latex: 'exp(x)' },
      { type: 'abs_sin', label: '|sin(x)|', latex: 'abs(sin(x))' },
      { type: 'heaviside', label: 'Heaviside(x)', latex: '(x>0?1:0)' },
      { type: 'poly2', label: 'x²', latex: 'x^2' },
      { type: 'poly3', label: 'x³', latex: 'x^3' },
      { type: 'square', label: 'Rechteck', latex: 'sgn(sin(x))' },
      { type: 'damped', label: 'Gedämpft', latex: 'exp(-x)*sin(x)' },
      { type: 'tan', label: 'tan(x)', latex: 'tan(x)' },
      { type: 'ln', label: 'ln(x)', latex: 'ln(x)' },
      { type: 'inv_x', label: '1/x', latex: '1/x' },
    ];

    const tracingActive = !!getState().traceTarget;
    const tracingLabel = getState().traceLabel || '';

    if (tracingActive) {
      h += '<div class="card" style="border-color:#58a6ff">';
      h +=
        '<div class="cr"><span>🖊 Aktives Nachzeichnen</span><span class="badge blue">Trace</span></div>';
      h += '<div style="text-align:center;padding:12px">';
      h += '<div style="font-size:20px;margin-bottom:8px">✏️</div>';
      h +=
        '<div style="font-size:13px;color:#e6edf3;font-weight:600">Zeichne über: ' +
        esc(tracingLabel) +
        '</div>';
      h +=
        '<div style="font-size:10px;color:#8b949e;margin:6px 0">Male die Funktion auf dem Canvas nach</div>';
      h += '<button class="b red" id="btnStopTrace" style="margin-top:8px">⏹ Stopp</button>';
      h += '</div></div>';
    } else {
      h +=
        '<div class="card"><div class="cr"><span>Funktion wählen</span><span class="badge">Nachzeichnen</span></div>';
      h +=
        '<div style="font-size:10px;color:#8b949e;margin-bottom:8px">Wähle eine Funktion oder gib eine eigene ein. Die Funktion erscheint auf dem Canvas — zeichne sie nach. Dein Zeichnung wird automatisch als Trainingsbeispiel gespeichert.</div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      traceFns.forEach((fn) => {
        h +=
          '<button class="b btn-trace-fn" data-fn-type="' +
          fn.type +
          '" data-fn-label="' +
          fn.label +
          '" data-fn-latex="' +
          fn.latex +
          '" style="flex:1;min-width:80px;text-align:center;padding:8px;font-size:11px">' +
          fn.label +
          '</button>';
      });
      h += '</div></div>';

      // Custom function input
      h += '<div class="card" style="border-color:#da3688">';
      h +=
        '<div class="cr"><span>Eigene Funktion</span><span class="badge pink">Custom</span></div>';
      h +=
        '<div style="font-size:10px;color:#8b949e;margin-bottom:6px">Gib einen Ausdruck ein (z.B. <code>sin(2*x)</code>, <code>x^2 - 1</code>, <code>exp(-x)*cos(x)</code>)</div>';
      h += '<div style="display:flex;gap:4px">';
      h +=
        '<input id="traceCustomInput" type="text" placeholder="z.B. sin(2*x), x^3, exp(-x)" style="flex:1;padding:6px 8px;background:#0d1117;border:1px solid #30363d;border-radius:5px;color:#e6edf3;font-size:12px;font-family:monospace">';
      h += '<button class="b grn" id="btnTraceCustom" style="padding:6px 12px">🖊 Start</button>';
      h += '</div>';
      h +=
        '<div style="font-size:9px;color:#484f58;margin-top:4px">Unterstützt: sin, cos, tan, exp, log, ln, abs, sqrt, ^, pi, e, Klammern</div>';
      h += '</div>';

      // Show saved trace examples count
      const traceExamples = trainData.corrections.filter((c) =>
        c.matchedType.startsWith('trace_'),
      ).length;
      h +=
        '<div class="card"><div class="cr"><span>Gespeicherte Nachzeichnungen</span><span class="badge blue">' +
        traceExamples +
        '</span></div>';
      if (traceExamples === 0) {
        h +=
          '<div style="text-align:center;padding:8px;color:#484f58;font-size:11px">Noch keine Nachzeichnungen gespeichert.</div>';
      } else {
        // Group by type
        const grouped: Record<string, number> = {};
        trainData.corrections
          .filter((c) => c.matchedType.startsWith('trace_'))
          .forEach((c) => {
            const t = c.matchedType.replace('trace_', '');
            grouped[t] = (grouped[t] || 0) + 1;
          });
        h += '<div style="padding:4px 0">';
        Object.entries(grouped).forEach(([t, cnt]) => {
          h +=
            '<div style="display:flex;justify-content:space-between;padding:3px 8px;font-size:10px;color:#c9d1d9"><span>' +
            esc(t) +
            '</span><span>' +
            cnt +
            '×</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    }
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
    h += `<div class="card"><div style="font-size:9px;color:#8b949e">Korrekturen</div><div class="sv2" style="color:#58a6ff">${trainData.corrections.length}</div></div>`;
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

    if (trainData.corrections.length > 0) {
      h +=
        '<div class="card"><div class="cr"><span>Korrekturen</span><span class="badge blue">' +
        trainData.corrections.length +
        '</span></div>';
      trainData.corrections.forEach((c) => {
        const d = new Date(c.timestamp);
        const ts = d.toLocaleDateString('de-DE');
        h += `<div class="tr-target"><div><div class="lbl">📝 ${esc(c.label)}</div><div class="sub">Typ: ${esc(c.matchedType)} · ${ts}</div></div></div>`;
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
      trainMode(btn.dataset['trMode'] as 'record' | 'practice' | 'trace' | 'stats');
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
      trainData = { targets: [], attempts: [], corrections: [] };
      saveTrainData();
      trainMode('stats');
      toast('Gelöscht!');
    }
  });

  // Trace mode handlers
  el.querySelectorAll<HTMLElement>('.btn-trace-fn').forEach((btn) => {
    btn.addEventListener('click', () => {
      startTracing(btn.dataset['fnType']!, btn.dataset['fnLabel']!, btn.dataset['fnLatex']!);
    });
  });

  document.getElementById('btnStopTrace')?.addEventListener('click', () => {
    stopTracing();
  });

  // Custom function trace button
  document.getElementById('btnTraceCustom')?.addEventListener('click', () => {
    const input = document.getElementById('traceCustomInput') as HTMLInputElement | null;
    const expr = input?.value.trim();
    if (!expr) {
      toast('Funktion eingeben!');
      return;
    }
    // Validate expression by trying to compile it
    try {
      makeNumFn(expr);
    } catch (e) {
      toast('Ungültiger Ausdruck: ' + (e as Error).message);
      return;
    }
    startTracing('custom:' + expr, expr, expr);
  });

  // Allow Enter key in custom input
  (document.getElementById('traceCustomInput') as HTMLInputElement | null)?.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btnTraceCustom')?.click();
      }
    },
  );
}

// ---- Trace Training ----
function startTracing(type: string, label: string, _latex: string): void {
  const state = getState();

  // Generate reference points for this function type
  const refPts: { x: number; y: number }[] = [];
  const N = 200;

  // Check if this is a custom function (type starts with 'custom:')
  if (type.startsWith('custom:')) {
    const expr = type.slice(7); // strip 'custom:'
    try {
      const fn = makeNumFn(expr);
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1);
        // Map x from [0,1] to [-3,3] for evaluation
        const xEval = (x - 0.5) * 6;
        const yRaw = fn(xEval);
        // Normalize output to [-1,1]
        refPts.push({ x, y: isFinite(yRaw) ? Math.max(-1, Math.min(1, yRaw / 3)) : 0 });
      }
    } catch {
      // Fallback: show a message and abort
      toast('Fehler beim Auswerten: ' + expr);
      return;
    }
  } else {
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      let y = 0;
      switch (type) {
        case 'sin':
          y = Math.sin(2 * Math.PI * x);
          break;
        case 'cos':
          y = Math.cos(2 * Math.PI * x);
          break;
        case 'linear':
          y = 2 * x - 1;
          break;
        case 'exponential':
          y = Math.exp(-2 + 4 * x) / (Math.exp(2) + Math.exp(-2));
          break;
        case 'abs_sin':
          y = Math.abs(Math.sin(2 * Math.PI * x));
          break;
        case 'heaviside':
          y = x < 0.5 ? -1 : 1;
          break;
        case 'poly2':
          y = (x - 0.5) * (x - 0.5) * 8 - 1;
          break;
        case 'poly3':
          y = (x - 0.5) * (x - 0.5) * (x - 0.5) * 16;
          break;
        case 'square':
          y = Math.sign(Math.sin(2 * Math.PI * x));
          break;
        case 'damped':
          y = Math.exp(-3 * x) * Math.sin(4 * Math.PI * x);
          break;
        case 'tan': {
          const tx = Math.tan(Math.PI * (x - 0.5));
          y = isFinite(tx) ? Math.max(-1, Math.min(1, tx / 5)) : 0;
          break;
        }
        case 'ln': {
          const lx = Math.log((x - 0.5) * 6 + 3);
          y = isFinite(lx) ? Math.max(-1, Math.min(1, lx / 3)) : 0;
          break;
        }
        case 'inv_x': {
          const ix = (x - 0.5) * 6;
          y = ix !== 0 ? 1 / ix : 0;
          y = Math.max(-1, Math.min(1, y));
          break;
        }
        default:
          y = Math.sin(2 * Math.PI * x);
      }
      refPts.push({ x, y: Math.max(-1, Math.min(1, y)) });
    }
  }

  state.traceTarget = refPts;
  state.traceType = type;
  state.traceLabel = label;

  // Clear any existing strokes for fresh tracing
  state.strokes = [];
  state.undoStack = [];
  state.redoStack = [];
  state.overlayPoints = null;
  state.customPoints = null;
  redraw();

  toast('🖊 Zeichne über: ' + label);
  trainMode('trace');
}

function stopTracing(): void {
  const state = getState();
  state.traceTarget = null;
  state.traceType = null;
  state.traceLabel = null;
  state.strokes = [];
  state.undoStack = [];
  state.redoStack = [];
  redraw();
  trainMode('trace');
  toast('Nachzeichnen beendet');
}

function saveTraceExample(
  userPts: { x: number; y: number }[],
  traceType: string,
  traceLabel: string,
): void {
  trainData.corrections.push({
    id: genId(),
    timestamp: Date.now(),
    label: traceLabel,
    normalizedPoints: userPts,
    matchedType: 'trace_' + traceType,
  });
  saveTrainData();
  toast('✅ Nachzeichnung gespeichert: ' + traceLabel);
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
        case 'exponential': {
          const aExp = (p['fA'] as number) || 1;
          const cExp = (p['fC'] as number) || 0;
          y = aExp * Math.exp(((p['fB'] as number) || 1) * x) + cExp;
          break;
        }
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
  let trainInitialized = false;
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
      if (t.dataset['t'] === 'train' && !trainInitialized) {
        trainInitialized = true;
        trainMode('record');
      }
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

// ---- Test API (for Playwright) ----
declare global {
  interface Window {
    __sk?: {
      // Canvas state
      getState: () => ReturnType<typeof getState>;
      clearAll: () => void;
      undo: () => void;
      redo: () => void;
      toggleGrid: () => void;
      toggleOverlay: () => void;
      // Recognition
      recognize: typeof recognize;
      getAllPoints: () => { x: number; y: number }[];
      // Training
      trainData: typeof trainData;
      loadTrainData: () => void;
      saveTrainData: () => void;
      exportTrainingData: () => void;
      // CAS
      runCas: typeof runCas;
      getSymExpr: typeof getSymExpr;
      // UI
      updateScore: (...args: Parameters<typeof updateScore>) => void;
      toast: (...args: Parameters<typeof toast>) => void;
      // Internal state (live via getters)
      best: typeof best;
      ovlP: typeof ovlP;
      custP: typeof custP;
      AUTO_SAVE_THRESHOLD: number;
      DISCARD_THRESHOLD: number;
    };
  }
}

/** Expose internal state for Playwright testing. */
function exposeTestAPI(): void {
  if (typeof window !== 'undefined') {
    // @ts-expect-error — intentionally augment Window at runtime
    window.__sk = {
      getState,
      clearAll,
      undo,
      redo,
      toggleGrid,
      toggleOverlay,
      recognize,
      getAllPoints,
      trainData,
      loadTrainData,
      saveTrainData,
      exportTrainingData,
      runCas,
      getSymExpr,
      updateScore,
      toast,
      AUTO_SAVE_THRESHOLD,
      DISCARD_THRESHOLD,
    };
    // Live getters — these variables are reassigned, not mutated
    Object.defineProperty(window.__sk, 'best', {
      get() {
        return best;
      },
      enumerable: true,
    });
    Object.defineProperty(window.__sk, 'ovlP', {
      get() {
        return ovlP;
      },
      enumerable: true,
    });
    Object.defineProperty(window.__sk, 'custP', {
      get() {
        return custP;
      },
      enumerable: true,
    });
    Object.defineProperty(window.__sk, 'trainData', {
      get() {
        return trainData;
      },
      enumerable: true,
    });
    console.log('[TEST] window.__sk exposed');
  }
}

// ---- Init ----
function init(): void {
  initCanvas();
  setStrokeCompleteCallback(scheduleR);
  loadTrainData();
  loadSeedData();
  setupUIHandlers();
  renderH();
  exposeTestAPI();
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
