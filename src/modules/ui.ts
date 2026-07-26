// ============================================================
// UI Helper Functions
// ============================================================

/**
 * Show a brief toast notification at the bottom of the screen.
 */
export function toast(message: string): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
  }, 1500);
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function esc(s: string): string {
  return s
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
 */
export function renderKaTeX(el: HTMLElement): void {
  requestAnimationFrame(() => {
    el.querySelectorAll<HTMLElement>('[data-latex]').forEach((e) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const katex = (window as any)['katex'] as {
          render: (tex: string, target: HTMLElement, opts: Record<string, unknown>) => void;
        };
        if (katex) {
          const latex = e.getAttribute('data-latex');
          if (latex) {
            katex.render(latex, e, { throwOnError: false, displayMode: false });
          }
        }
      } catch {
        const latex = e.getAttribute('data-latex');
        if (latex) {
          e.textContent = latex;
        }
      }
    });
  });
}
