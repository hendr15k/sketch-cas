// ============================================================
// Shared Type Definitions for Sketch-CAS
// ============================================================

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

export interface CasResult {
  latex: string;
  raw: string;
}

export interface CasResponse {
  engine: string;
  tag: 'alg' | 'ner' | 'xca';
  result?: CasResult;
  error?: string;
  loading?: boolean;
}

export type CasOperation =
  | 'simplify'
  | 'diff'
  | 'integrate'
  | 'taylor'
  | 'laplace'
  | 'solve'
  | 'plot';

export interface Features {
  amp: number;
  off: number;
  period: number;
  isPer: boolean;
  crossings: number;
  pk: number;
  vl: number;
  pkV: number[];
  vlV: number[];
  isDamp: boolean;
  curvatureVar: number; // variance of 2nd derivative: low=parabola, high=sin
  sqrtLike: boolean; // true if curve is monotonically increasing + concave down (sqrt shape)
  concaveDown: boolean; // true if 2nd derivative is consistently negative (sqrt, ln, exp decay)
  stepLike: boolean; // true for square-like signals: sharp transitions + flat extremes
  tanLike: boolean; // true for tan-like signals: sharp transition + wings tilted toward center
  expLike: boolean; // true for monotonic concave curves whose right-side slope is steeper than left ← exp(x)
}

export interface TemplateCandidate {
  label: string;
  latex: string;
  err: number;
  params: Record<string, number | string | number[]>;
}

export interface TrainingTarget {
  id: string;
  timestamp: number;
  label: string;
  strokes: Stroke[];
  normalizedPoints: Point[];
  difficulty: string;
  matchedType?: string;
}

export interface TrainingAttempt {
  timestamp: number;
  targetId: string;
  score: number;
  strokes: Stroke[];
}

export interface LabeledExample {
  id: string;
  timestamp: number;
  label: string;
  normalizedPoints: Point[];
  matchedType: string;
}

export interface TrainingData {
  targets: TrainingTarget[];
  attempts: TrainingAttempt[];
  corrections: LabeledExample[];
}

export interface HistoryEntry {
  label: string;
  latex: string;
  time: string;
}

export type EngineSelector = 'all' | 'algebrite' | 'nerdamer' | 'xcas';

export type TrainMode = 'record' | 'practice' | 'stats';
