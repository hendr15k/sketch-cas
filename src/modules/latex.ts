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

  return result
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
    .replace(/(\d)([a-z(])/g, '$1\\cdot $2');
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
      result = formatNum(amp) + '\\,e^{-' + formatNum(d, 2) + 'x}\\sin(' + arg + ')';
      break;
    }
    case 'lin':
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
      if (Math.abs(c) > 0.011) {
        result += ' + ' + formatNum(c);
      }
      result += '\\right)';
      break;
    }
    case 'sqrt': {
      const aVal = amp;
      result = (Math.abs(aVal - 1) > 0.01 ? formatNum(aVal) + '\\cdot ' : '') + '\\sqrt{x}';
      break;
    }
    case 'recip': {
      const c = extra?.['c'] ?? 0.01;
      const aVal = amp;
      result = formatNum(aVal) + '\\,\\frac{1}{x';
      if (Math.abs(c) > 0.011) {
        result += ' + ' + formatNum(c);
      }
      result += '}';
      break;
    }
    case 'gauss': {
      const mu = extra?.['mu'] ?? 0.5;
      const sigma = extra?.['sigma'] ?? 0.2;
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        'e^{-\\frac{(x-' +
        formatNum(mu) +
        ')^2}{2\\cdot ' +
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
        '(x-' +
        formatNum(x0) +
        ')}}';
      break;
    }
    case 'tanh': {
      const k = extra?.['k'] ?? 10;
      const x0 = extra?.['x0'] ?? 0.5;
      result =
        (Math.abs(amp - 1) > 0.01 ? formatNum(amp) + '\\cdot ' : '') +
        '\\tanh\\!\\left(' +
        formatNum(k) +
        '(x-' +
        formatNum(x0) +
        ')\\right)';
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

export { formatNum };
