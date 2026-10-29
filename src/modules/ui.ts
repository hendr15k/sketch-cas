// ============================================================
// UI Helper Functions
// ============================================================

import katex from 'katex';
import 'katex/dist/katex.min.css';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    toastTimer = null;
  }, 1500);
}

/**
 * Escape HTML special characters to prevent XSS.
 * Accepts unknown so a missing label degrades to text instead of throwing
 * (several call sites render optional, data-derived strings).
 */
export function esc(s: unknown): string {
  // Only strings and primitives are rendered; anything else (a missing label,
  // an object) degrades to an empty string instead of throwing.
  const str =
    typeof s === 'string' ? s : typeof s === 'number' || typeof s === 'boolean' ? String(s) : '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Update the footer score display.
 */
export function updateScore(points: string, match: string, fit: string): void {
  const sP = document.getElementById('sP');
  const sM = document.getElementById('sM');
  const sF = document.getElementById('sF');
  if (sP) sP.textContent = points;
  if (sM) sM.textContent = match;
  if (sF) sF.textContent = fit;
}

/**
 * Generate an empty-state HTML block.
 */
export function emptyState(icon: string, title: string, desc: string): string {
  return `<div class="es"><div class="bi">${icon}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
}

/**
 * Copy text to clipboard and show toast.
 */
export function copyToClipboard(el: HTMLElement): void {
  const text = el.textContent || el.getAttribute('data-latex') || '';
  const finish = () => {
    toast('Kopiert!');
  };
  // navigator.clipboard may be blocked (e.g. in non-secure contexts, some tablets);
  // fall back to the legacy execCommand path so the user still gets feedback.
  const execCopy = (): void => {
    try {
      const range = document.createRange();
      range.selectNode(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      // execCommand is deprecated but remains the only browser-agnostic
      // synchronous fallback for older tablets and non-secure contexts.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (document.execCommand('copy')) finish();
    } catch {
      /* swallow — silent failure is preferable to noisy toast spam */
    }
  };
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard
      .writeText(text)
      .then(finish)
      .catch(() => {
        execCopy();
      });
  } else {
    execCopy();
  }
}

/**
 * Render all KaTeX elements within a container.
 *
 * Renders synchronously: the previous requestAnimationFrame() wrapper never
 * fires while the page is in a background tab (and lags one frame otherwise),
 * leaving formulas blank. KaTeX is bundled — relying on a window global from a
 * CDN <script> made every formula disappear whenever that request failed.
 */
export function renderKaTeX(el: HTMLElement): void {
  el.querySelectorAll<HTMLElement>('[data-latex]').forEach((e) => {
    const latex = e.getAttribute('data-latex');
    if (!latex) return;
    try {
      katex.render(latex, e, { throwOnError: false, displayMode: false });
    } catch {
      e.textContent = latex;
    }
  });
}
