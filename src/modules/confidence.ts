// ============================================================
// Recognition Confidence
// ============================================================
//
// The composite scores of the templates span several orders of magnitude:
// a clean sine is fitted to ~1e-4 RMSE while a rough exponential sits at 1e-2.
// A fixed softmax temperature over those absolute errors made every
// near-perfect fit look like a coin toss (50 % / 50 %) — on a clean sine the
// sine and the cosine scored within 1e-6 of each other, so the UI reported
// "Beste: 50 %" for a recognition that was, in fact, unambiguous.
//
// Confidence is therefore computed on *relative* errors: how much worse is a
// candidate than the winner, measured in units of the winner's own error.
// The absolute fit quality is a separate signal and gates auto-training, so a
// bad-but-unique fit can not be stored as a "confirmed" example.

import type { TemplateCandidate } from '../types';

/** Softmax temperature in units of the winner's error. */
export const SOFTMAX_REL_TEMPERATURE = 0.15;

/**
 * Errors below this are treated as "perfect": differences smaller than the
 * stroke resolution must not create certainty that is not in the data.
 */
export const ERROR_FLOOR = 0.002;

/** Below this probability the recognition is shown as "too uncertain". */
export const DISCARD_THRESHOLD = 0.05;

/** Winner needs at least this probability to be auto-saved as a training example. */
export const AUTO_SAVE_THRESHOLD = 0.5;

/** The top two candidates must be at least this far apart to auto-train. */
export const AUTO_SAVE_MARGIN = 0.1;

/** A stroke this poorly fitted is not a confirmation of anything. */
export const MAX_AUTO_SAVE_RMSE = 0.02;

/**
 * Convert candidate composite errors to probabilities.
 * Lower error → higher probability; the scale is relative to the winner.
 */
export function errorsToProbs(cands: TemplateCandidate[]): number[] {
  if (!cands.length) return [];
  const errs = cands.map((c) => Math.max(0, c.err));
  const minErr = Math.min(...errs);
  const scale = Math.max(minErr, ERROR_FLOOR);
  const exps = errs.map((e) => Math.exp(-(e - minErr) / (SOFTMAX_REL_TEMPERATURE * scale)));
  const sum = exps.reduce((s, v) => s + v, 0);
  return sum > 0 ? exps.map((e) => e / sum) : exps.map(() => 1 / cands.length);
}

export interface AutoSaveInput {
  /** Winner probability from {@link errorsToProbs}. */
  prob: number;
  /** Probability of the runner-up (0 when there is only one candidate). */
  runnerUpProb: number;
  /** Raw RMSE of the winner's fitted curve. */
  rawErr: number;
  /** Template type of the winner. */
  type: string;
  /** True when the training boost, not the fit, decided the winner. */
  trainingBoostApplied: boolean;
}

export interface AutoSaveDecision {
  save: boolean;
  reason: string;
}

/**
 * Decide whether a recognition may be stored as a training example.
 *
 * Auto-training is only useful when the app is *right*: a self-confident
 * wrong fit teaches the recognizer its own mistakes. Both the separation
 * from the runner-up and the absolute fit quality have to hold.
 */
export function shouldAutoSave(input: AutoSaveInput): AutoSaveDecision {
  if (!input.type || input.type === 'unknown') {
    return { save: false, reason: 'no template type' };
  }
  if (input.trainingBoostApplied) {
    return { save: false, reason: 'winner came from the training boost' };
  }
  if (input.prob < AUTO_SAVE_THRESHOLD) {
    return { save: false, reason: 'too uncertain' };
  }
  if (input.prob - input.runnerUpProb < AUTO_SAVE_MARGIN) {
    return { save: false, reason: 'top two candidates too close' };
  }
  if (!(input.rawErr <= MAX_AUTO_SAVE_RMSE)) {
    return { save: false, reason: 'fit too poor to confirm' };
  }
  return { save: true, reason: 'confident, well fitted' };
}
