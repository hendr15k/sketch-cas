// ============================================================
// Bode Plot Drawing
// ============================================================

import type { TemplateCandidate } from '../types';

/**
 * Draw magnitude and phase Bode plots for a recognized function.
 */
export function drawBode(c: TemplateCandidate): void {
  const el = document.getElementById('tBode');
  if (!el) return;

  el.innerHTML =
    '<div class="card best">' +
    '<div class="cr"><span>Frequenzgang</span><span class="badge">Bode</span></div>' +
    '<canvas class="bode-canvas" id="bodeMag"></canvas>' +
    '<div style="text-align:center;font-size:9px;color:#8b949e;margin:2px 0">|H(j omega)| dB</div>' +
    '<canvas class="bode-canvas" id="bodePhase" style="margin-top:4px"></canvas>' +
    '<div style="text-align:center;font-size:9px;color:#8b949e">Phase (Grad)</div>' +
    '</div>';

  const t = c.params['type'] as string;
  const freq = (c.params['freq'] as number) || 1;
  const amp = (c.params['amp'] as number) || 1;
  const om0 = 2 * Math.PI * freq;

  requestAnimationFrame(() => {
    const magC = document.getElementById('bodeMag') as HTMLCanvasElement | null;
    const phC = document.getElementById('bodePhase') as HTMLCanvasElement | null;
    if (!magC || !phC) return;

    const dpr = window.devicePixelRatio || 1;
    for (const cv of [magC, phC]) {
      const rect = cv.getBoundingClientRect();
      cv.width = rect.width * dpr;
      cv.height = rect.height * dpr;
      cv.style.width = rect.width + 'px';
      cv.style.height = rect.height + 'px';
      cv.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const W = magC.getBoundingClientRect().width;
    const H = magC.getBoundingClientRect().height;
    const magCtx = magC.getContext('2d')!;
    const phCtx = phC.getContext('2d')!;

    // Background and grid
    for (const ctx of [magCtx, phCtx]) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#21262d';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 6; i++) {
        const x = (i / 6) * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        const y = (i / 4) * H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    }

    const N = 200;
    const fMin = 0.01;
    const fMax = 100;
    const magData: number[] = [];
    const phData: number[] = [];

    for (let i = 0; i < N; i++) {
      const logF = Math.log10(fMin) + (i / (N - 1)) * (Math.log10(fMax) - Math.log10(fMin));
      const f = Math.pow(10, logF);
      const w = 2 * Math.PI * f;
      let mag: number;
      let phase: number;

      if (t === 'sin' || t === 'cos' || t === 'abs_sin') {
        mag = amp / Math.sqrt(Math.pow(w * w - om0 * om0, 2) + Math.pow(w * om0 * 0.5, 2) + 0.001);
        phase = -Math.atan2(w * om0 * 0.5, w * w - om0 * om0) * (180 / Math.PI);
      } else if (t === 'exponential' || t === 'heaviside') {
        const tau = 1 / freq;
        mag = amp / Math.sqrt(1 + Math.pow(w * tau, 2));
        phase = -Math.atan(w * tau) * (180 / Math.PI);
      } else if (t === 'damped') {
        const z = 0.3;
        mag =
          (amp * om0 * om0) /
          Math.sqrt(Math.pow(om0 * om0 - w * w, 2) + Math.pow(2 * z * om0 * w, 2) + 0.001);
        phase = -Math.atan2(2 * z * om0 * w, om0 * om0 - w * w) * (180 / Math.PI);
      } else {
        mag = amp / (1 + w / om0);
        phase = -Math.atan(w / om0) * (180 / Math.PI);
      }
      magData.push(mag);
      phData.push(phase);
    }

    const maxDB = 20 * Math.log10(Math.max(...magData) + 0.001);
    const minDB = Math.min(-40, maxDB - 60);

    // Draw magnitude
    magCtx.strokeStyle = '#58a6ff';
    magCtx.lineWidth = 1.5;
    magCtx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * W;
      const db = 20 * Math.log10(magData[i]! + 0.001);
      const y = H - ((db - minDB) / (maxDB - minDB + 1)) * H;
      if (i === 0) magCtx.moveTo(x, y);
      else magCtx.lineTo(x, y);
    }
    magCtx.stroke();

    // Draw phase
    phCtx.strokeStyle = '#f0883e';
    phCtx.lineWidth = 1.5;
    phCtx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * W;
      const y = H / 2 - (phData[i]! / 180) * (H / 2);
      if (i === 0) phCtx.moveTo(x, y);
      else phCtx.lineTo(x, y);
    }
    phCtx.stroke();

    // Frequency labels
    magCtx.fillStyle = '#6e7681';
    magCtx.font = '8px monospace';
    for (const f of [0.01, 0.1, 1, 10, 100]) {
      const x = ((Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * W;
      const label = f >= 1 ? '' + f : f.toFixed(2);
      magCtx.fillText(label, x - 8, H - 2);
      phCtx.fillText(label, x - 8, H - 2);
    }
  });
}
