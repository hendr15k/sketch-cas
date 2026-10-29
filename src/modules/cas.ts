// ============================================================
// CAS Engine Abstraction (Algebrite, Nerdamer, Xcas/Giac)
// Uses npm packages directly instead of CDN globals.
// ============================================================

import type { CasOperation, CasResponse, CasResult } from '../types';
import { exprToLatex } from './latex';

import Algebrite from 'algebrite';
import nerdamer from 'nerdamer';
import 'nerdamer/Calculus';
// Extra brings laplace/ilt/sum, Solve brings solve/solveEquations.
// These must be static ESM imports: `require()` does not exist in the
// browser bundle, so the old try/require() silently never registered the
// plugins and solve/laplace stayed broken.
import 'nerdamer/Extra';
import 'nerdamer/Solve';

/**
 * nerdamer 1.1.13's bundled typings omit methods that its plugins add at
 * runtime (sub from the core, simplify from the Algebra plugin), so widen the
 * expression type locally instead of scattering casts.
 */
interface NerdamerExpr {
  sub(variable: string, value: string): NerdamerExpr;
  simplify(): NerdamerExpr;
  evaluate(): NerdamerExpr;
  toString(): string;
}
const nexpr = (v: unknown): NerdamerExpr => v as NerdamerExpr;

/* ---- Shared helpers ---- */

/**
 * Algebrite prints long decimals as "2.495872..." (its internal precision
 * marker). The ellipsis leaks into the rendered formula, so round it away.
 */
function cleanNum(s: string): string {
  return s.replace(/(\d+\.\d{3,})\.\.\./g, (_m, digits: string) => {
    const v = Number(digits);
    return Number.isFinite(v) ? String(Number(v.toFixed(6))) : digits;
  });
}

/** "x^2-4=0" -> "(x^2-4)-(0)" so root finders get a zero-form expression. */
function toZeroForm(eq: string): string {
  const i = eq.indexOf('=');
  if (i < 0) return eq;
  const lhs = eq.slice(0, i).trim();
  const rhs = eq.slice(i + 1).trim();
  if (!rhs) return lhs;
  return '(' + lhs + ')-(' + rhs + ')';
}

/** "list[-2,2]" / "[-2,2]" / "list[2]" -> ["-2", "2"] */
function parseSolutionList(s: string): string[] {
  const m = /^(?:list)?\[(.*)\]$/s.exec(s.trim());
  const body = m ? m[1]! : s;
  return body
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function solutionLatex(sols: string[]): string {
  return 'x \\in \\{' + sols.map((v) => exprToLatex(v)).join(',\\;') + '\\}';
}

/* ---- Laplace helpers ---- */

/** Split a sum into signed top-level terms, respecting parentheses. */
function splitSumTerms(e: string): string[] {
  const s = e.replace(/\s+/g, '');
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if ((c === '+' || c === '-') && depth === 0 && i > 0) {
      const prev = s[i - 1]!;
      if (prev !== '*' && prev !== '^' && prev !== '/' && prev !== '(') {
        out.push(cur);
        cur = c === '-' ? '-' : '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.filter((t) => t !== '' && t !== '-' && t !== '+');
}

/**
 * nerdamer's laplace() mis-parses sums with a negative constant term:
 * laplace(x^2-4,x,s) evaluates to -4*(-4*s^(-1)+factorial(2)*s^(-3)), which is
 * plain wrong. Laplace is linear, so transform term by term and add up.
 */
function nerdamerLaplace(e: string): string {
  const parts = splitSumTerms(e).map((t) => nerdamer('laplace(' + t + ',x,s)').toString());
  const joined = parts.join('+').replace(/\+-/g, '-');
  return nexpr(nerdamer(joined || '0'))
    .evaluate()
    .toString();
}

/* ---- Algebrite Laplace (table + polynomial terms) ---- */
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

  // Polynomials and constants: L{x^n} = n!/s^(n+1), summed per power of x.
  const byPower = new Map<number, number>();
  for (const term of splitSumTerms(el)) {
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+)?)\*?(x(?:\^(\d+))?)?$/.exec(term);
    if (!m || (!m[2] && !m[1])) return '\\text{(nicht direkt)}';
    const coeff = m[1] ? Number(m[1]) : 1;
    const power = m[2] ? (m[3] ? Number(m[3]) : 1) : 0;
    if (!Number.isFinite(coeff)) return '\\text{(nicht direkt)}';
    // L{x^n} = n!/s^(n+1): factorial of the power, not (n+1)!.
    let fact = 1;
    for (let k = 2; k <= power; k++) fact *= k;
    byPower.set(power, (byPower.get(power) ?? 0) + coeff * fact);
  }
  const parts: string[] = [];
  for (const [power, coeff] of [...byPower.entries()].sort((a, b) => a[0] - b[0])) {
    if (coeff === 0) continue;
    const sign = coeff < 0 ? '-' : '';
    const num = Math.abs(coeff);
    const den = power === 0 ? 's' : 's^' + (power + 1);
    const frac = '\\frac{' + num + '}{' + den + '}';
    parts.push(parts.length === 0 ? sign + frac : sign ? '-' + frac : '+' + frac);
  }
  if (parts.length === 0) return '\\text{(nicht direkt)}';
  return parts.join('');
}

function algebriteSolve(e: string): string {
  try {
    const r = Algebrite.roots(toZeroForm(e)).toString();
    const sols = parseSolutionList(r);
    return solutionLatex(sols);
  } catch {
    return '\\text{(nicht lösbar)}';
  }
}

/** Raw solution list for the copy line under the Algebrite card. */
function algebriteRawSolutions(e: string): string {
  try {
    return parseSolutionList(Algebrite.roots(toZeroForm(e)).toString()).join(', ');
  } catch {
    return 'keine Lösung';
  }
}

/* ---- Run on individual engines ---- */
function runAlgebrite(expr: string, op: CasOperation): CasResult {
  const e = expr.replace(/\*\*/g, '^');
  switch (op) {
    case 'simplify': {
      const s = cleanNum(Algebrite.simplify(e).toString());
      return { latex: exprToLatex(s), raw: s };
    }
    case 'diff': {
      const d = cleanNum(Algebrite.derivative(e, 'x').toString());
      return {
        latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
        raw: d,
      };
    }
    case 'integrate': {
      const i = cleanNum(Algebrite.integral(e, 'x').toString());
      return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
    }
    case 'taylor': {
      const t = cleanNum(Algebrite.taylor(e, 'x', 5).toString());
      return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
    }
    case 'laplace': {
      const lp = algebriteLaplace(e);
      return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + lp, raw: lp };
    }
    case 'solve':
      return { latex: algebriteSolve(e), raw: algebriteRawSolutions(e) };
    case 'plot':
      return { latex: '\\text{Plot: }' + exprToLatex(e), raw: e };
  }
}

function nerdamerTaylor(e: string, order = 5): string {
  // nerdamer 1.1.13 ships no taylor(); build the Maclaurin series directly.
  let deriv = e;
  let factorial = 1;
  let series = '';
  for (let k = 0; k <= order; k++) {
    const coeff = nexpr(nerdamer(deriv)).sub('x', '0').evaluate().toString();
    if (coeff !== '0') {
      series += '+(' + coeff + ')' + (k > 0 ? '*x^' + k : '') + '/' + factorial;
    }
    deriv = nerdamer.diff(deriv, 'x').toString();
    factorial *= k + 1;
  }
  const trimmed = series.replace(/^\+/, '');
  return nexpr(nerdamer(trimmed || '0'))
    .evaluate()
    .toString();
}

function nerdamerSolve(e: string): string[] {
  // solve() lives in the Solve plugin and expects a zero-form expression.
  const r = nerdamer('solve(' + toZeroForm(e) + ',x)').toString();
  return parseSolutionList(r);
}

function runNerdamer(expr: string, op: CasOperation): CasResult {
  const e = expr.replace(/\*\*/g, '^');
  switch (op) {
    case 'simplify': {
      const s = nexpr(nerdamer(e)).simplify().toString();
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
      const t = nerdamerTaylor(e, 5);
      return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
    }
    case 'laplace': {
      const lp = nerdamerLaplace(e);
      return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + exprToLatex(lp), raw: lp };
    }
    case 'solve': {
      try {
        const sols = nerdamerSolve(e);
        if (sols.length === 0) return { latex: '\\text{(nicht lösbar)}', raw: 'leer' };
        return { latex: solutionLatex(sols), raw: sols.join(', ') };
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

/**
 * The Giac web build (giac.js) calls into a global `UI` object that belongs to
 * Giac's own web UI (an ASM_CONSTS hook fires on every caseval() call, so even
 * `1+1` dies with "UI is not defined"). Without this stub the whole engine is
 * unusable, so install a minimal, side-effect-free stand-in.
 */
function installGiacUiStub(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w['UI']) return;
  w['UI'] = {
    Datestart: Date.now(),
    disable3d: 1,
    add_evalf: 1,
    js_bigint: 0,
    python_output: '',
    warnpy: false,
    assistant_matr_maxrows: 10,
    assistant_matr_maxcols: 10,
    add_python_output(): void {
      /* no-op: output is consumed via the caseval return value */
    },
    clean_for_html: (t: string): string => t,
    set_config_width(): void {
      /* no-op */
    },
  };
}

/** Load Giac/Xcas WASM lazily. */
export function loadGiac(): void {
  if (giacLoaded || giacLoading) return;
  giacLoading = true;

  installGiacUiStub();

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
      clearTimeout(watchdog);
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

  // If the runtime never initialises (WASM OOM, aborted fetch) the flag
  // would stay true and no retry could ever succeed.
  const watchdog = setTimeout(() => {
    if (!giacLoaded) {
      giacLoading = false;
      if (statusEl) {
        statusEl.innerHTML = '<span style="color:var(--color-accent-red)">✗ Giac</span>';
      }
    }
  }, 60000);

  const script = document.createElement('script');
  script.src = 'giac.js';
  script.async = true;
  script.onerror = () => {
    clearTimeout(watchdog);
    giacLoading = false;
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:var(--color-accent-red)">✗ Giac</span>';
    }
  };
  document.body.appendChild(script);
}

/**
 * Register auto-load on first CAS interaction.
 * Uses a shared `maybeLoadGiac` helper (no `{once:true}`) so the listener
 * remains available across tab switches and re-tries on transient failures.
 */
export function setupGiacAutoload(): void {
  const casTab = document.querySelector('[data-t="cas"]');
  const inpTab = document.querySelector('[data-t="inp"]');
  const maybeLoadGiac = (): void => {
    if (!giacLoaded && !giacLoading) loadGiac();
  };
  casTab?.addEventListener('click', maybeLoadGiac);
  inpTab?.addEventListener('click', maybeLoadGiac);
}

/* ---- Run on Xcas ---- */

/**
 * Call caseval with a clean session: this Giac build ships a default
 * assumption x>0, which makes solve(x^2-4=0,x) return only "list[2]".
 * `purge(x)` clears it; ':' suppresses the result, but giac still prefixes a
 * status token ("Done", a quoted message), which is stripped here.
 */
function giacCall(cmd: string): string {
  const raw = caseval!('purge(x):;' + cmd);
  let out = raw;
  while (/^"[^"]*"\s*,\s*/.test(out)) out = out.replace(/^"[^"]*"\s*,\s*/, '');
  return out;
}

function runXcas(expr: string, op: CasOperation): CasResult {
  const e = expr.replace(/\*\*/g, '^');
  try {
    switch (op) {
      case 'simplify': {
        const s = giacCall('normal(simplify(' + e + '))');
        return { latex: exprToLatex(s), raw: s };
      }
      case 'diff': {
        const d = giacCall('diff(' + e + ',x)');
        return {
          latex: '\\frac{d}{dx}\\left(' + exprToLatex(e) + '\\right)=' + exprToLatex(d),
          raw: d,
        };
      }
      case 'integrate': {
        const i = giacCall('integrate(' + e + ',x)');
        return { latex: '\\int ' + exprToLatex(e) + '\\,dx=' + exprToLatex(i) + '+C', raw: i };
      }
      case 'taylor': {
        // giac's signature is taylor(expr, var, order, point) — the old call
        // passed (x,0,5) and expanded around x=5 instead of x=0.
        const t = giacCall('taylor(' + e + ',x,5,0)').replace(/\+?x\^\d+\*order_size\(x\)/g, '');
        return { latex: 'T_5(x)=' + exprToLatex(t), raw: t };
      }
      case 'laplace': {
        const lp = giacCall('laplace(' + e + ',x,s)');
        return { latex: '\\mathcal{L}\\{' + exprToLatex(e) + '\\}=' + exprToLatex(lp), raw: lp };
      }
      case 'solve': {
        const sol = giacCall('solve(' + toZeroForm(e) + ',x)');
        const sols = parseSolutionList(sol);
        return { latex: solutionLatex(sols), raw: sols.join(', ') };
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
    } else {
      // The WASM build takes a few seconds; show the column while it loads
      // instead of silently dropping it from the comparison.
      results.push({
        engine: 'Xcas(Giac)',
        tag: 'xca',
        error: giacLoading ? 'Engine lädt… bitte nochmal klicken.' : 'Engine nicht geladen.',
        loading: true,
      });
    }
  }

  return results;
}

export interface EngineSolution {
  engine: string;
  tag: 'alg' | 'ner' | 'xca';
  solutions?: string[];
  error?: string;
  loading?: boolean;
}

/**
 * Solve one equation on every available engine. Lives here so the UI never has
 * to reach for window globals (the engines are bundled modules, not CDN globals).
 */
export function solveEquation(eq: string): EngineSolution[] {
  const out: EngineSolution[] = [];

  if (hasAlgebrite()) {
    try {
      out.push({
        engine: 'Algebrite',
        tag: 'alg',
        solutions: parseSolutionList(Algebrite.roots(toZeroForm(eq)).toString()),
      });
    } catch (e) {
      out.push({ engine: 'Algebrite', tag: 'alg', error: (e as Error).message });
    }
  }

  if (hasNerdamer()) {
    try {
      out.push({ engine: 'Nerdamer', tag: 'ner', solutions: nerdamerSolve(eq) });
    } catch (e) {
      out.push({ engine: 'Nerdamer', tag: 'ner', error: (e as Error).message });
    }
  }

  if (hasXcas()) {
    try {
      out.push({
        engine: 'Xcas(Giac)',
        tag: 'xca',
        solutions: parseSolutionList(giacCall('solve(' + toZeroForm(eq) + ',x)')),
      });
    } catch (e) {
      out.push({ engine: 'Xcas(Giac)', tag: 'xca', error: (e as Error).message });
    }
  } else {
    out.push({
      engine: 'Xcas(Giac)',
      tag: 'xca',
      error: 'Wird geladen… Klicke nochmal.',
      loading: true,
    });
  }

  return out;
}

export { solutionLatex };

/** Get a symbolic expression string from a template candidate. */
export function getSymExpr(c: { params: Record<string, unknown> }): string | null {
  const raw = buildSymExpr(c);
  return raw === null ? null : collapseSigns(raw);
}

/**
 * Signed-term concatenation produces "+-1.5" / "(x--1)" for negative values.
 * Nerdamer tolerates that, Algebrite answers with "syntax error" — so fold the
 * double signs away before the expression reaches an engine.
 */
function collapseSigns(s: string): string {
  return s.replace(/\+-/g, '-').replace(/--/g, '+');
}

function buildSymExpr(c: { params: Record<string, unknown> }): string | null {
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
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + F(ph, 4) : '') +
        '))' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'damped':
      return (
        F(a, 4) +
        '*exp(-' +
        F((p['decay'] as number) || f * 2, 4) +
        '*x)*sin(' +
        F(2 * Math.PI * f, 4) +
        '*x' +
        (Math.abs(ph) > 0.05 ? '+' + F(ph, 4) : '') +
        ')' +
        (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '')
      );
    case 'heaviside':
      return F(a, 4) + '*sign(x)' + (Math.abs(o) > 0.05 ? '+' + F(o, 4) : '');
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
        (lC > 0.011 ? '+' + F(lC, 4) : lC < -0.011 ? '-' + F(-lC, 4) : '') +
        ')' +
        (Math.abs(lOff) > 0.05 ? '+' + F(lOff, 4) : '')
      );
    }
    case 'sqrt': {
      const sA = (p['fA'] as number) ?? 1;
      const sOff = (p['offset'] as number) ?? o;
      const sShift = (p['fShift'] as number) ?? 0;
      const arg =
        'x' + (sShift > 0.001 ? '+' + F(sShift, 4) : sShift < -0.001 ? '-' + F(-sShift, 4) : '');
      return F(sA, 4) + '*sqrt(' + arg + ')' + (Math.abs(sOff) > 0.05 ? '+' + F(sOff, 4) : '');
    }
    case 'reciprocal': {
      const rA = (p['fA'] as number) || 1;
      const rC = (p['fC'] as number) || 0.01;
      const rOff = (p['offset'] as number) || o;
      return (
        F(rA, 4) +
        '/(x' +
        (rC > 0.011 ? '+' + F(rC, 4) : rC < -0.011 ? '-' + F(-rC, 4) : '') +
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
    case 'gaussian': {
      const gA = (p['fA'] as number) ?? 1;
      const mu = (p['mu'] as number) ?? 0.5;
      const sigma = (p['sigma'] as number) ?? 0.2;
      const gOff = (p['offset'] as number) ?? 0;
      return (
        F(gA, 4) +
        '*exp(-(x-' +
        F(mu, 4) +
        ')^2/(2*' +
        F(sigma, 4) +
        '^2))' +
        (Math.abs(gOff) > 0.05 ? '+' + F(gOff, 4) : '')
      );
    }
    case 'sigmoid': {
      const sA = (p['fA'] as number) ?? 1;
      const k = (p['k'] as number) ?? 10;
      const x0 = (p['x0'] as number) ?? 0.5;
      const sOff = (p['offset'] as number) ?? 0;
      return (
        F(sA, 4) +
        '/(1+exp(' +
        F(-k, 4) +
        '*(x-' +
        F(x0, 4) +
        ')))' +
        (Math.abs(sOff) > 0.05 ? '+' + F(sOff, 4) : '')
      );
    }
    case 'tanh': {
      const tA = (p['fA'] as number) ?? 1;
      const k = (p['k'] as number) ?? 10;
      const x0 = (p['x0'] as number) ?? 0.5;
      const tOff = (p['offset'] as number) ?? 0;
      return (
        F(tA, 4) +
        '*tanh(' +
        F(k, 4) +
        '*(x-' +
        F(x0, 4) +
        '))' +
        (Math.abs(tOff) > 0.05 ? '+' + F(tOff, 4) : '')
      );
    }
    case 'sawtooth': {
      const sA = (p['amp'] as number) ?? a;
      const sPh = (p['phase'] as number) ?? ph;
      const sOff = (p['offset'] as number) ?? o;
      // Neither Algebrite nor Nerdamer knows a sawtooth() function: both
      // silently treat the name as a symbol and return nonsense (Nerdamer
      // produced "sawtooth*x").  Expand the definition instead, which both
      // engines parse and differentiate:
      //   amp*(2*frac(t) - 1) + off,  t = (w*x + phase)/(2*pi)
      const w = 2 * Math.PI * f;
      const t = '(' + F(w, 4) + '*x' + (Math.abs(sPh) > 0.05 ? '+' + F(sPh, 4) : '') + ')/(2*pi)';
      return (
        F(sA, 4) +
        '*(2*(' +
        t +
        '-floor(' +
        t +
        '))-1)' +
        (Math.abs(sOff) > 0.05 ? '+' + F(sOff, 4) : '')
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
