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
  pk: number;
  vl: number;
  pkV: number[];
  vlV: number[];
  isDamp: boolean;
}

export interface TemplateCandidate {
  label: string;
  latex: string;
  err: number;
  params: Record<string, number | string>;
}

export interface TrainingTarget {
  id: string;
  timestamp: number;
  label: string;
  strokes: Stroke[];
  normalizedPoints: Point[];
  difficulty: string;
}

export interface TrainingAttempt {
  timestamp: number;
  targetId: string;
  score: number;
  strokes: Stroke[];
}

export interface TrainingData {
  targets: TrainingTarget[];
  attempts: TrainingAttempt[];
}

export interface HistoryEntry {
  label: string;
  latex: string;
  time: string;
}

export type EngineSelector = 'all' | 'algebrite' | 'nerdamer' | 'xcas';

export type TrainMode = 'record' | 'practice' | 'stats';
