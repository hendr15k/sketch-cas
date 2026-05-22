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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  return `<div class="es"><div class="bi">${icon}</div><h3>${title}</h3><p>${desc}</p></div>`;
}

/**
 * Copy text to clipboard and show toast.
 */
export function copyToClipboard(el: HTMLElement): void {
  const text = el.textContent || el.getAttribute('data-latex') || '';
  void navigator.clipboard.writeText(text).then(() => {
    toast('Kopiert!');
  });
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
