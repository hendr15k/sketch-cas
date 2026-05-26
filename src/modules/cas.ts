// ============================================================
// CAS Engine Abstraction (Algebrite, Nerdamer, Xcas/Giac)
// Uses npm packages directly instead of CDN globals.
// ============================================================

import type { CasOperation, CasResponse, CasResult } from '../types';
import { exprToLatex } from './latex';

import Algebrite from 'algebrite';
import nerdamer from 'nerdamer';
import 'nerdamer/Calculus';
// nerdamer/Solve throws uncaught TypeError on import (line 213: undefined[0])
// on some browser/config combos. We suppress it — solve is non-critical since
// the page uses nerdamer.solveEquations() which is part of the Solve plugin.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('nerdamer/Solve');
} catch {
  // non-fatal — diff, integrate, taylor, laplace all work without Solve
}

/* ---- Algebrite Laplace (hardcoded table) ---- */
function algebriteLaplace(e: string): string {
  const el = e.toLowerCase().replace(/\s+/g, '');
  if (el === 'sin(t)' || el === 'sin(x)') return '\\frac{1}{s^2+1}';
  if (el === 'cos(t)' || el === 'cos(x)') return '\\frac{s}{s^2+1}';
  if (el === 'exp(-t)' || el === 'exp(-x)') return '\\frac{1}{s+1}';
  if (el === '1' || el === '1(t)') return '\\frac{1}{s}';
  if (el === 't' || el === 'x') return '\\frac{1}{s^2}';

  const sm = el.match(/^(\d*\.?\d*)\*?sin\((\d*\.?\d*)\*?[tx]\)$/);
  if (sm) {
    const a = sm[1] || '1';
    const b = sm[2] || '1';
    return '\\frac{' + a + '\\cdot ' + b + '}{s^2+' + b + '^2}';
  }
  const cm = el.match(/^(\d*\.?\d*)\*?cos\((\d*\.?\d*)\*?[tx]\)$/);
  if (cm) {
    const a = cm[1] || '1';
    const b = cm[2] || '1';
    return '\\frac{' + a + '\\cdot s}{s^2+' + b + '^2}';
  }
  return '\\text{(nicht direkt)}';
}

function algebriteSolve(e: string): string {
  try {
    const r = Algebrite.roots(e).toString();
    return '\\text{Roots: }' + exprToLatex(r);
  } catch {
    return '\\text{(nicht lösbar)}';
  }
}

/* ---- Run on individual engines ---- */
function runAlgebrite(expr: string, op: CasOperation): CasResult {
  const e = expr.replace(/\*\*/g, '^');
  switch (op) {
    case 'simplify': {
      const s = Algebrite.simplify(e).toString();
      return { latex: exprToLatex(s), raw: s };
    }
    case 'diff': {
      const d = Algebrite.derivative(e, 'x').toString();
      return {
        latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
        raw: d,
      };
    }
    case 'integrate': {
      const i = Algebrite.integral(e, 'x').toString();
      return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
    }
    case 'taylor': {
      const t = Algebrite.taylor(e, 'x', 5).toString();
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
  const e = expr.replace(/\*\*/g, '^');
  switch (op) {
    case 'simplify': {
      const s = nerdamer(e).evaluate().toString();
      return { latex: exprToLatex(s), raw: s };
    }
    case 'diff': {
      const d = nerdamer.diff(e, 'x').evaluate().toString();
      return {
        latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
        raw: d,
      };
    }
    case 'integrate': {
      const i = nerdamer.integrate(e, 'x').toString();
      return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
    }
    case 'taylor': {
      const t = nerdamer('taylor(' + e + ',x,0,5)').toString();
      return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
    }
    case 'laplace': {
      const lp = nerdamer('laplace(' + e + ',x,s)').toString();
      return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + lp, raw: lp };
    }
    case 'solve': {
      // nerdamer.solveEquations natively supports '=' syntax — no manual parsing needed
      try {
        const sol = nerdamer.solveEquations(e) as unknown as {
          [key: string]: { toString(): string };
        };
        const lt =
          'x \\in \\{' +
          Object.values(sol)
            .map((v) => exprToLatex(v.toString()))
            .join(',\\;') +
          '\\}';
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return { latex: lt, raw: sol.toString() };
      } catch {
        return { latex: '\\text{(nicht lösbar)}', raw: 'error' };
      }
    }
    case 'plot':
      return { latex: '\\text{Plot: }' + exprToLatex(e), raw: e };
  }
}

/* ---- Xcas/Giac WASM lazy-loading ---- */
let giacLoaded = false;
let giacLoading = false;
let caseval: ((s: string) => string) | null = null;

/** Check which engines are available. */
export function hasAlgebrite(): boolean {
  return typeof Algebrite !== 'undefined';
}

export function hasNerdamer(): boolean {
  return typeof nerdamer === 'function';
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
    statusEl.innerHTML = '<span style="color:var(--color-accent-pink)">⏳ Giac laden…</span>';
  }

  // Giac uses Emscripten Module pattern — set up the global Module config
  (window as unknown as Record<string, unknown>)['Module'] = {
    noInitialRun: true,
    onRuntimeInitialized() {
      const mod = (
        window as unknown as Record<
          string,
          { cwrap: (name: string, ret: string, args: string[]) => (s: string) => string }
        >
      )['Module'] as {
        cwrap: (name: string, ret: string, args: string[]) => (s: string) => string;
      };
      caseval = mod.cwrap('caseval', 'string', ['string']);
      giacLoaded = true;
      giacLoading = false;
      if (statusEl) {
        statusEl.innerHTML = '<span style="color:var(--color-accent-green)">✓ Giac</span>';
      }
      try {
        caseval('caseval');
      } catch {
        // ignore init test error
      }
    },
    setStatus(s: string) {
      if (s && s.indexOf('/') === -1 && s !== 'All downloads complete.') {
        if (statusEl)
          statusEl.innerHTML = '<span style="color:var(--color-accent-pink)">⏳ ' + s + '</span>';
      }
    },
  };

  const script = document.createElement('script');
  script.src = 'giac.js';
  script.async = true;
  script.onerror = () => {
    giacLoading = false;
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:var(--color-accent-red)">✗ Giac</span>';
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

/* ---- Run on Xcas ---- */
function runXcas(expr: string, op: CasOperation): CasResult {
  const e = expr.replace(/\*\*/g, '^');
  try {
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
        return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + lp, raw: lp };
      }
      case 'solve': {
        const sol = caseval!('solve(' + e + ',x)').toString();
        return { latex: '\\text{solve: }' + exprToLatex(sol), raw: sol };
      }
      case 'plot':
        return { latex: '\\text{Plot: }' + exprToLatex(e), raw: e };
    }
  } catch {
    return { latex: '\\text{(Fehler bei Xcas)}', raw: '' };
  }
  return { latex: '', raw: '' };
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

/** Get a symbolic expression string from a template candidate. */
export function getSymExpr(c: { params: Record<string, unknown> }): string | null {
  const p = c.params;
  const t = p['type'] as string;
  const a = (p['amp'] as number) || 0;
  const f = (p['freq'] as number) || 1;
  const o = (p['offset'] as number) || 0;
  const ph = (p['phase'] as number) || 0;
  const F = (n: number, dp?: number): string => {
    if (Math.abs(n) < 0.001) return '0';
    if (dp === undefined && Math.abs(n - Math.round(n)) < 0.01) return '' + Math.round(n);
    const fixed = n.toFixed(dp || 2);
    // Strip trailing zeros but keep at least one decimal digit (avoids empty string for near-zero values)
    const stripped = fixed.replace(/0+$/, '');
    return stripped.endsWith('.') ? stripped + '0' : stripped || '0';
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
    case 'exponential':
      return (
        F((p['fA'] as number) ?? 1, 4) +
        '*exp(' +
        F((p['fB'] as number) ?? 1, 4) +
        '*x)' +
        (Math.abs((p['fC'] as number) ?? 0) > 0.05 ? '+' + F((p['fC'] as number) ?? 0, 4) : '')
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
      return (
        F(a, 4) +
        '*exp(-' +
        F((p['decay'] as number) || f * 2, 4) +
        '*x)*sin(' +
        F(2 * Math.PI * f, 4) +
        '*x)'
      );
    case 'heaviside':
      return F(a, 4) + '*(x>=0?1:0)' + (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '');
    case 'square':
      return (
        F(a, 4) +
        '*sign(sin(' +
        F(2 * Math.PI * f, 4) +
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + F(ph, 4) : '') +
        '))' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'logarithmic': {
      const lA = (p['fA'] as number) || 1;
      const lC = (p['fC'] as number) || 0.01;
      const lOff = (p['offset'] as number) || o;
      return (
        F(lA, 4) +
        '*log(x' +
        (lC > 0.011 ? '+' + F(lC, 4) : '') +
        ')' +
        (Math.abs(lOff) > 0.05 ? '+' + F(lOff, 4) : '')
      );
    }
    case 'sqrt': {
      const sA = (p['fA'] as number) || 1;
      const sOff = (p['offset'] as number) || o;
      return F(sA, 4) + '*sqrt(x)' + (Math.abs(sOff) > 0.05 ? '+' + F(sOff, 4) : '');
    }
    case 'reciprocal': {
      const rA = (p['fA'] as number) || 1;
      const rC = (p['fC'] as number) || 0.01;
      const rOff = (p['offset'] as number) || o;
      return (
        F(rA, 4) +
        '/(x' +
        (rC > 0.011 ? '+' + F(rC, 4) : '') +
        ')' +
        (Math.abs(rOff) > 0.05 ? '+' + F(rOff, 4) : '')
      );
    }
    case 'tan': {
      const tA = (p['amp'] as number) || a;
      const tPh = (p['phase'] as number) || ph;
      const tOmega = 2 * Math.PI * f;
      return (
        F(tA, 4) +
        '*tan(' +
        F(tOmega, 4) +
        '*x' +
        (Math.abs(tPh) > 0.05 ? '+' + F(tPh, 4) : '') +
        ')' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    }
    case 'linear': {
      const m = (p['m'] as number) ?? a * 2;
      const b = (p['b'] as number) ?? o - a;
      return F(m, 4) + '*x' + (b >= 0 ? '+' + F(b, 4) : '-' + F(Math.abs(b), 4));
    }
    case 'poly2':
    case 'poly3':
    case 'poly4': {
      const coeffs = p['coeffs'] as number[] | undefined;
      if (!coeffs || coeffs.length === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i <= coeffs.length - 1; i++) {
        const val = coeffs[i]!;
        if (Math.abs(val) < 0.001) continue;
        const power = i;
        const absVal = Math.abs(val);
        const sign = val >= 0 ? '+' : '-';
        let term = '';
        if (power === 0) term = F(absVal, 4);
        else if (power === 1) term = F(absVal, 4) + '*x';
        else term = F(absVal, 4) + '*x^' + power;
        parts.push(sign + term);
      }
      const polyStr = parts.join('').replace(/^\+/, '') || '0';
      return polyStr;
    }
    default:
      return null;
  }
}
