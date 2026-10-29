// ============================================================
// Expression to LaTeX Conversion
// ============================================================

/**
 * Convert a mathematical expression string to LaTeX format.
 * Handles common function names, powers, square roots, etc.
 */
export function exprToLatex(s: string): string {
  if (!s) return '';

  // Helper to find balanced closing paren
  function findBalanced(s: string, start: number): number {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return s.length;
  }

  let result = '';
  let i = 0;
  while (i < s.length) {
    // sqrt with balanced parens
    if (s.startsWith('sqrt(', i)) {
      const end = findBalanced(s, i + 4);
      result += '\\sqrt{' + exprToLatex(s.substring(i + 5, end)) + '}';
      i = end + 1;
      continue;
    }
    // abs with balanced parens
    if (s.startsWith('abs(', i)) {
      const end = findBalanced(s, i + 3);
      result += '\\left|' + exprToLatex(s.substring(i + 4, end)) + '\\right|';
      i = end + 1;
      continue;
    }
    result += s[i];
    i++;
  }

  return (
    result
      .replace(/\*\*/g, '^')
      .replace(/asin\(/g, '\\arcsin(')
      .replace(/acos\(/g, '\\arccos(')
      .replace(/atan\(/g, '\\arctan(')
      .replace(/\bsin\(/g, '\\sin(')
      .replace(/\bcos\(/g, '\\cos(')
      .replace(/\btan\(/g, '\\tan(')
      .replace(/sinh\(/g, '\\sinh(')
      .replace(/cosh\(/g, '\\cosh(')
      .replace(/tanh\(/g, '\\tanh(')
      .replace(/log\(/g, '\\ln(')
      .replace(/\bpi\b/g, '\\pi')
      .replace(/(\d)([a-z(])/g, '$1\\cdot $2')
      // KaTeX only takes the first token as superscript: x^10 would render as
      // x¹0 and x^-1 as x⁻1.  Brace plain numeric exponents.
      .replace(/\^(-?\d+(?:\.\d+)?)/g, '^{$1}')
  );
}

/**
 * Format a number for LaTeX display.
 */
function formatNum(n: number, decimalPlaces?: number): string {
  if (Math.abs(n) < 0.001) return '0';
  if (decimalPlaces === undefined && Math.abs(n - Math.round(n)) < 0.01) {
    return '' + Math.round(n);
  }
  return n
    .toFixed(decimalPlaces ?? 2)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

/**
 * "(x - 2)" / "(x + 2)" / "x" — a negative shift must not render as "x--2".
 */
function xShift(v: number, dp = 2): string {
  if (Math.abs(v) < 0.001) return 'x';
  return v > 0 ? '(x - ' + formatNum(v, dp) + ')' : '(x + ' + formatNum(-v, dp) + ')';
}

/**
 * Build LaTeX for sinusoidal/trig templates.
 */
export function buildLatex(
  type: string,
  omega: number,
  phase: number,
  amp: number,
  offset: number,
  extra?: Record<string, number>,
): string {
  const inner = Math.abs(omega - 1) < 0.1 ? 'x' : formatNum(omega) + 'x';
  let arg = inner;
  if (Math.abs(phase) > 0.05) {
    arg += (phase > 0 ? ' + ' : ' - ') + formatNum(Math.abs(phase));
  }

  let result = '';
  switch (type) {
    case 'sin':
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\sin\\!\\left(' +
        arg +
        '\\right)';
      break;
    case 'cos':
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\cos\\!\\left(' +
        arg +
        '\\right)';
      break;
    case 'abs_sin':
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\left|\\sin\\!\\left(' +
        arg +
        '\\right)\\right|';
      break;
    case 'sgn':
      result = formatNum(amp) + '\\,\\mathrm{sgn}(\\sin(' + arg + '))';
      break;
    case 'dmp': {
      const d = extra?.['d'] ?? 1;
      // e^{--1x} is invalid; keep the sign explicit.
      const dec = (d >= 0 ? '-' : '+') + formatNum(Math.abs(d), 2);
      result = formatNum(amp) + '\\,e^{' + dec + 'x}\\sin(' + arg + ')';
      break;
    }
    case 'lin':
      // A degenerate slope (flat stroke) must not read as "0x".
      if (Math.abs(amp) < 0.005) {
        return formatNum(offset);
      }
      result = formatNum(amp) + '\\,x';
      if (Math.abs(offset) > 0.01) {
        result += (offset > 0 ? ' + ' : ' - ') + formatNum(Math.abs(offset));
      }
      return result;
    case 'exp': {
      const b = extra?.['b'] ?? 1;
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp, 2) + '\\cdot ' : '') +
        'e^{' +
        formatNum(b, 2) +
        'x}';
      if (Math.abs(offset) > 0.01) {
        result += (offset > 0 ? ' + ' : ' - ') + formatNum(Math.abs(offset), 2);
      }
      return result;
    }
    case 'tan':
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\tan\\!\\left(' +
        arg +
        '\\right)';
      break;
    case 'ln': {
      const c = extra?.['c'] ?? 0.01;
      const aVal = amp;
      result = (Math.abs(aVal - 1) > 0.01 ? formatNum(aVal) + '\\cdot ' : '') + '\\ln\\!\\left(x';
      if (c > 0.011) {
        result += ' + ' + formatNum(c);
      } else if (c < -0.011) {
        result += ' - ' + formatNum(Math.abs(c));
      }
      result += '\\right)';
      break;
    }
    case 'sqrt': {
      const aVal = amp;
      const shift = extra?.['c'] ?? 0;
      result = (Math.abs(aVal - 1) > 0.01 ? formatNum(aVal) + '\\cdot ' : '') + '\\sqrt{x';
      if (shift > 0.011) {
        result += ' + ' + formatNum(shift);
      } else if (shift < -0.011) {
        result += ' - ' + formatNum(Math.abs(shift));
      }
      result += '}';
      break;
    }
    case 'recip': {
      const c = extra?.['c'] ?? 0.01;
      const aVal = amp;
      result = formatNum(aVal) + '\\,\\frac{1}{x';
      if (c > 0.011) {
        result += ' + ' + formatNum(c);
      } else if (c < -0.011) {
        result += ' - ' + formatNum(Math.abs(c));
      }
      result += '}';
      break;
    }
    case 'gauss': {
      const mu = extra?.['mu'] ?? 0.5;
      const sigma = extra?.['sigma'] ?? 0.2;
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        'e^{-\\frac{' +
        xShift(mu) +
        '^2}{2\\cdot ' +
        formatNum(sigma) +
        '^2}}';
      break;
    }
    case 'sigmoid': {
      const k = extra?.['k'] ?? 10;
      const x0 = extra?.['x0'] ?? 0.5;
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) : '1') +
        '\\,\\frac{1}{1+e^{' +
        formatNum(-k) +
        xShift(x0) +
        '}}';
      break;
    }
    case 'tanh': {
      const k = extra?.['k'] ?? 10;
      const x0 = extra?.['x0'] ?? 0.5;
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\tanh\\!\\left(' +
        formatNum(k) +
        xShift(x0) +
        '\\right)';
      break;
    }
    case 'saw': {
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\mathrm{saw}\\!\\left(' +
        arg +
        '\\right)';
      break;
    }
  }

  if (Math.abs(offset) > 0.01 && type !== 'lin') {
    result += (offset > 0 ? ' + ' : ' - ') + formatNum(Math.abs(offset));
  }
  return result;
}

/**
 * Build LaTeX for a polynomial from coefficients [a0, a1, ..., ad].
 */
export function buildLatexPoly(coefficients: number[]): string {
  const degree = coefficients.length - 1;
  let result = '';
  for (let i = 0; i <= degree; i++) {
    const val = coefficients[i]!;
    const power = i;
    if (Math.abs(val) < 0.001) continue;
    if (result !== '') {
      result += val > 0 ? ' + ' : ' - ';
    } else if (val < 0) {
      result += '-';
    }
    const absVal = Math.abs(val);
    if (power === 0) {
      result += formatNum(absVal);
    } else if (power === 1) {
      result += (Math.abs(absVal - 1) < 0.01 ? '' : formatNum(absVal)) + 'x';
    } else {
      result += (Math.abs(absVal - 1) < 0.01 ? '' : formatNum(absVal)) + 'x^{' + power + '}';
    }
  }
  return result || '0';
}

/**
 * Best-effort reverse of the LaTeX this app generates, so a history entry
 * written by an older version can still be loaded into the plain-text CAS
 * input (which cannot parse LaTeX).
 */
export function latexToExpr(s: string): string {
  if (!s) return '';
  let out = s;

  // \frac{A}{B} → ((A)/(B)), innermost first
  for (let guard = 0; guard < 10 && out.includes('\\frac{'); guard++) {
    const start = out.indexOf('\\frac{');
    const numStart = start + 5; // index of '{'
    const numEnd = matchBrace(out, numStart);
    if (numEnd < 0) break;
    const denStart = numEnd + 1; // index of the '{' after the numerator
    const denEnd = matchBrace(out, denStart);
    if (denEnd < 0) break;
    const num = out.substring(numStart + 1, numEnd);
    const den = out.substring(denStart + 1, denEnd);
    out = out.substring(0, start) + '((' + num + ')/(' + den + '))' + out.substring(denEnd + 1);
  }

  // \sqrt{X} → sqrt(X)
  for (let guard = 0; guard < 10 && out.includes('\\sqrt{'); guard++) {
    const start = out.indexOf('\\sqrt{');
    const argStart = start + 5;
    const argEnd = matchBrace(out, argStart);
    if (argEnd < 0) break;
    out =
      out.substring(0, start) +
      'sqrt(' +
      out.substring(argStart + 1, argEnd) +
      ')' +
      out.substring(argEnd + 1);
  }

  out = out
    .replace(/\\left\|/g, 'abs(')
    .replace(/\\right\|/g, ')')
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .replace(/\\mathrm\{sgn\}/g, 'sign')
    .replace(/\\mathrm\{saw\}/g, 'sawtooth')
    .replace(/\\cdot/g, '*')
    .replace(/\\pi/g, 'pi')
    .replace(/\\arcsin/g, 'asin')
    .replace(/\\arccos/g, 'acos')
    .replace(/\\arctan/g, 'atan')
    .replace(/\\sinh/g, 'sinh')
    .replace(/\\cosh/g, 'cosh')
    .replace(/\\(sin|cos|tan|ln|log|tanh|exp|abs|sqrt)/g, '$1')
    .replace(/\\[!,;]/g, '')
    .replace(/\\ /g, '')
    .replace(/[!;,]/g, ' ')
    .replace(/\\,/g, '');

  // x^{2} → x^2 (single-token exponents); e^{...} → exp(...)
  out = out.replace(/e\^\{([^{}]*)\}/g, 'exp($1)');
  out = out.replace(/\^\{([^{}]*)\}/g, '^($1)');
  // Explicit multiplication: the CAS engines reject "6.28x".
  out = out.replace(/(\d)([a-zA-Z(])/g, '$1*$2');
  out = out.replace(/\s*\+\s*/g, '+').replace(/\s*-\s*/g, '-');
  return out.trim();
}

/** Index of the '}' matching the '{' at `open`, or -1. */
function matchBrace(s: string, open: number): number {
  if (s[open] !== '{') return -1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export { formatNum };
