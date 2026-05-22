// ============================================================
// CAS Engine Abstraction (Algebrite, Nerdamer, Xcas/Giac)
// ============================================================

import type { CasOperation, CasResponse, CasResult } from '../types';
import { exprToLatex } from './latex';

/* ---- Global declarations for CDN-loaded libraries ---- */
declare global {
  interface Window {
    Algebrite?: {
      simplify: (e: string) => { toString(): string };
      derivative: (e: string, v: string) => { toString(): string };
      integral: (e: string, v: string) => { toString(): string };
      taylor: (e: string, v: string, n: number) => { toString(): string };
      roots: (e: string) => { toString(): string };
    };
    nerdamer?: {
      (e: string): {
        evaluate: () => { toString(): string };
        toString: () => string;
      };
      diff: (e: string, v: string) => { evaluate: () => { toString(): string } };
      integrate: (e: string, v: string) => { toString: () => string };
      solveEquations: (e: string) => Array<{ toString(): string }>;
    };
    Module?: {
      cwrap: (name: string, ret: string, args: string[]) => (s: string) => string;
    };
  }
}

let giacLoaded = false;
let giacLoading = false;
let caseval: ((s: string) => string) | null = null;

/** Check which engines are available. */
export function hasAlgebrite(): boolean {
  return typeof window.Algebrite !== 'undefined';
}

export function hasNerdamer(): boolean {
  return typeof window.nerdamer !== 'undefined';
}

export function hasXcas(): boolean {
  return giacLoaded && caseval !== null;
}

export function isGiacLoading(): boolean {
  return giacLoading;
}

/** Load Giac/Xcas WASM lazily. */
export function loadGiac(): void {
  if (giacLoaded || giacLoading) return;
  giacLoading = true;

  const statusEl = document.getElementById('engStatus');
  if (statusEl) {
    statusEl.innerHTML = '<span style="color:#da3688">⏳ Giac laden…</span>';
  }

  window.Module = {
    noInitialRun: true,
    onRuntimeInitialized() {
      caseval = window.Module!.cwrap('caseval', 'string', ['string']);
      giacLoaded = true;
      giacLoading = false;
      if (statusEl) {
        statusEl.innerHTML = '<span style="color:#238636">✓ Giac</span>';
      }
      try {
        caseval('caseval');
      } catch {
        // ignore init test error
      }
    },
    setStatus(s: string) {
      if (s && s.indexOf('/') === -1 && s !== 'All downloads complete.') {
        if (statusEl) statusEl.innerHTML = '<span style="color:#da3688">⏳ ' + s + '</span>';
      }
    },
  } as unknown as typeof window.Module;

  const script = document.createElement('script');
  script.src = 'giac.js';
  script.async = true;
  script.onerror = () => {
    giacLoading = false;
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#f85149">✗ Giac</span>';
    }
  };
  document.body.appendChild(script);
}

/** Register auto-load on first CAS interaction. */
export function setupGiacAutoload(): void {
  const casTab = document.querySelector('[data-t="cas"]');
  const inpTab = document.querySelector('[data-t="inp"]');
  const handler = () => {
    if (!giacLoaded && !giacLoading) loadGiac();
  };
  casTab?.addEventListener('click', handler, { once: true });
  inpTab?.addEventListener('click', handler, { once: true });
}

/* ---- Algebrite Laplace (hardcoded table) ---- */
function algebriteLaplace(e: string): string {
  const el = e.toLowerCase().replace(/\s+/g, '');
  if (el === 'sin(t)' || el === 'sin(x)') return '\\frac{1}{s^2+1}';
  if (el === 'cos(t)' || el === 'cos(x)') return '\\frac{s}{s^2+1}';
  if (el === 'exp(-t)' || el === 'exp(-x)') return '\\frac{1}{s+1}';
  if (el === '1' || el === '1(t)') return '\\frac{1}{s}';
  if (el === 't' || el === 'x') return '\\frac{1}{s^2}';

  const sm = e.match(/^(\d*\.?\d*)\*?sin\((\d*\.?\d*)\*?[tx]\)$/);
  if (sm) {
    const a = sm[1] || '1';
    const b = sm[2] || '1';
    return '\\frac{' + a + '\\cdot ' + b + '}{s^2+' + b + '^2}';
  }
  const cm = e.match(/^(\d*\.?\d*)\*?cos\((\d*\.?\d*)\*?[tx]\)$/);
  if (cm) {
    const a = cm[1] || '1';
    const b = cm[2] || '1';
    return '\\frac{' + a + '\\cdot s}{s^2+' + b + '^2}';
  }
  return '\\text{(nicht direkt)}';
}

function algebriteSolve(e: string): string {
  try {
    const r = window.Algebrite!.roots(e).toString();
    return '\\text{Roots: }' + exprToLatex(r);
  } catch {
    return '\\text{(nicht lösbar)}';
  }
}

/* ---- Run on individual engines ---- */
function runAlgebrite(expr: string, op: CasOperation): CasResult {
  const e = expr.replace(/\*\*/g, '^');
  switch (op) {
    case 'simplify':
      return {
        latex: exprToLatex(window.Algebrite!.simplify(e).toString()),
        raw: window.Algebrite!.simplify(e).toString(),
      };
    case 'diff': {
      const d = window.Algebrite!.derivative(e, 'x').toString();
      return {
        latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
        raw: d,
      };
    }
    case 'integrate': {
      const i = window.Algebrite!.integral(e, 'x').toString();
      return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
    }
    case 'taylor': {
      const t = window.Algebrite!.taylor(e, 'x', 5).toString();
      return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
    }
    case 'laplace': {
      const lp = algebriteLaplace(e);
      return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + lp, raw: lp };
    }
    case 'solve':
      return { latex: algebriteSolve(e), raw: e };
    case 'plot':
      return { latex: '\\text{Plot: }' + exprToLatex(e), raw: e };
  }
}

function runNerdamer(expr: string, op: CasOperation): CasResult {
  const e = expr;
  switch (op) {
    case 'simplify': {
      const s = window.nerdamer!(e).evaluate().toString();
      return { latex: exprToLatex(s), raw: s };
    }
    case 'diff': {
      const d = window.nerdamer!.diff(e, 'x').evaluate().toString();
      return {
        latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
        raw: d,
      };
    }
    case 'integrate': {
      const i = window.nerdamer!.integrate(e, 'x').toString();
      return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
    }
    case 'taylor': {
      const t = window.nerdamer!('taylor(' + e + ',x,0,5)').toString();
      return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
    }
    case 'laplace': {
      const lp = window.nerdamer!('laplace(' + e + ',x,s)').toString();
      return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + exprToLatex(lp), raw: lp };
    }
    case 'solve': {
      const eq = e.replace(/=/g, '-').replace(/==/g, '-');
      try {
        const sol = window.nerdamer!.solveEquations(eq);
        const lt = 'x \\in \\{' + sol.map((v) => exprToLatex(v.toString())).join(',\\;') + '\\}';
        return { latex: lt, raw: sol.toString() };
      } catch {
        return { latex: '\\text{(nicht lösbar)}', raw: 'error' };
      }
    }
    case 'plot':
      return { latex: '\\text{Plot: }' + exprToLatex(e), raw: e };
  }
}

function runXcas(expr: string, op: CasOperation): CasResult {
  const e = expr;
  switch (op) {
    case 'simplify': {
      const s = caseval!('normal(simplify(' + e + '))').toString();
      return { latex: exprToLatex(s), raw: s };
    }
    case 'diff': {
      const d = caseval!('diff(' + e + ',x)').toString();
      return {
        latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
        raw: d,
      };
    }
    case 'integrate': {
      const i = caseval!('integrate(' + e + ',x)').toString();
      return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
    }
    case 'taylor': {
      const t = caseval!('taylor(' + e + ',x,0,5)').toString();
      return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
    }
    case 'laplace': {
      const lp = caseval!('laplace(' + e + ',x,s)').toString();
      return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + exprToLatex(lp), raw: lp };
    }
    case 'solve': {
      const sol = caseval!('solve(' + e + ',x)').toString();
      return { latex: '\\text{solve: }' + exprToLatex(sol), raw: sol };
    }
    case 'plot':
      return { latex: '\\text{Plot: }' + exprToLatex(e), raw: e };
  }
}

/**
 * Run an expression on one or all CAS engines.
 */
export function runCas(expr: string, op: CasOperation, selectedEngine: string): CasResponse[] {
  const results: CasResponse[] = [];

  if (selectedEngine === 'all' || selectedEngine === 'algebrite') {
    if (hasAlgebrite()) {
      try {
        results.push({ engine: 'Algebrite', tag: 'alg', result: runAlgebrite(expr, op) });
      } catch (e) {
        results.push({ engine: 'Algebrite', tag: 'alg', error: (e as Error).message });
      }
    }
  }

  if (selectedEngine === 'all' || selectedEngine === 'nerdamer') {
    if (hasNerdamer()) {
      try {
        results.push({ engine: 'Nerdamer', tag: 'ner', result: runNerdamer(expr, op) });
      } catch (e) {
        results.push({ engine: 'Nerdamer', tag: 'ner', error: (e as Error).message });
      }
    }
  }

  if (selectedEngine === 'all' || selectedEngine === 'xcas') {
    if (hasXcas()) {
      try {
        results.push({ engine: 'Xcas(Giac)', tag: 'xca', result: runXcas(expr, op) });
      } catch (e) {
        results.push({ engine: 'Xcas(Giac)', tag: 'xca', error: (e as Error).message });
      }
    }
  }

  if (selectedEngine === 'xcas' && !hasXcas()) {
    results.push({
      engine: 'Xcas(Giac)',
      tag: 'xca',
      error: 'Wird geladen… Klicke nochmal.',
      loading: true,
    });
  }

  return results;
}

/**
 * Get a symbolic expression string from a template candidate.
 */
export function getSymExpr(c: { params: Record<string, number | string> }): string | null {
  const p = c.params;
  const t = p['type'] as string;
  const a = (p['amp'] as number) || 0;
  const f = (p['freq'] as number) || 0;
  const o = (p['offset'] as number) || 0;
  const ph = (p['phase'] as number) || 0;
  const F = (n: number, dp?: number): string => {
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
        F(a, 4) +
        '*sin(' +
        F(2 * Math.PI * f, 4) +
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + F(ph, 4) : '') +
        ')' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'cos':
      return (
        F(a, 4) +
        '*cos(' +
        F(2 * Math.PI * f, 4) +
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + F(ph, 4) : '') +
        ')' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'linear':
      return F(a * 2, 4) + '*x+' + F(o, 4);
    case 'exponential':
      return (
        F(a, 4) +
        '*exp(' +
        F((p['fB'] as number) || 1, 4) +
        '*x)' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'abs_sin':
      return (
        F(a, 4) +
        '*abs(sin(' +
        F(2 * Math.PI * f, 4) +
        '*x))' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'damped':
      return F(a, 4) + '*exp(-' + F(f * 2, 4) + '*x)*sin(' + F(2 * Math.PI * f, 4) + '*x)';
    case 'heaviside':
      return F(a, 4) + '*(x>0?1:0)' + (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '');
    default:
      return null;
  }
}
