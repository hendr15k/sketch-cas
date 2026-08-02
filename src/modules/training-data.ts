import type {
  TrainingData,
  TrainingTarget,
  TrainingAttempt,
  LabeledExample,
  Point,
  Stroke,
} from '../types';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(v: unknown): string {
  return typeof v === 'string' && ID_RE.test(v) ? v : '';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizePoints(v: unknown): Point[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: Point[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const o = raw as Record<string, unknown>;
    if (!isFiniteNumber(o['x']) || !isFiniteNumber(o['y'])) continue;
    const p: Point = { x: o['x'], y: o['y'] };
    if (isFiniteNumber(o['pressure'])) p.pressure = o['pressure'];
    out.push(p);
  }
  return out.length > 0 ? out : null;
}

function sanitizeStroke(v: unknown): Stroke | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const points = sanitizePoints(o['points']);
  if (!points) return null;
  return {
    points,
    color: typeof o['color'] === 'string' ? o['color'] : '#5cc8ff',
    width: isFiniteNumber(o['width']) ? o['width'] : 2.5,
  };
}

function sanitizeTarget(v: unknown): TrainingTarget | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = safeId(o['id']);
  const label = typeof o['label'] === 'string' ? o['label'] : '';
  if (!id || !label) return null;
  const normalizedPoints = sanitizePoints(o['normalizedPoints']);
  const strokes = Array.isArray(o['strokes'])
    ? o['strokes'].map(sanitizeStroke).filter((s): s is Stroke => s !== null)
    : [];
  if (!normalizedPoints && strokes.length === 0) return null;
  return {
    id,
    timestamp: isFiniteNumber(o['timestamp']) ? o['timestamp'] : Date.now(),
    label,
    strokes,
    normalizedPoints: normalizedPoints ?? [],
    difficulty: typeof o['difficulty'] === 'string' ? o['difficulty'] : 'Einfach',
    matchedType: typeof o['matchedType'] === 'string' ? o['matchedType'] : '',
  };
}

function sanitizeAttempt(v: unknown): TrainingAttempt | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const targetId = safeId(o['targetId']);
  if (!targetId) return null;
  return {
    timestamp: isFiniteNumber(o['timestamp']) ? o['timestamp'] : Date.now(),
    targetId,
    score: isFiniteNumber(o['score']) ? o['score'] : 0,
    strokes: Array.isArray(o['strokes'])
      ? o['strokes'].map(sanitizeStroke).filter((s): s is Stroke => s !== null)
      : [],
  };
}

function sanitizeCorrection(v: unknown): LabeledExample | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = safeId(o['id']);
  const label = typeof o['label'] === 'string' ? o['label'] : '';
  const normalizedPoints = sanitizePoints(o['normalizedPoints']);
  if (!id || !label || !normalizedPoints) return null;
  return {
    id,
    timestamp: isFiniteNumber(o['timestamp']) ? o['timestamp'] : Date.now(),
    label,
    normalizedPoints,
    matchedType: typeof o['matchedType'] === 'string' ? o['matchedType'] : '',
  };
}

export function normalizeTrainingData(raw: unknown): TrainingData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (
    !Array.isArray(o['targets']) ||
    !Array.isArray(o['attempts']) ||
    !Array.isArray(o['corrections'])
  ) {
    return null;
  }
  return {
    targets: o['targets'].map(sanitizeTarget).filter((t): t is TrainingTarget => t !== null),
    attempts: o['attempts'].map(sanitizeAttempt).filter((t): t is TrainingAttempt => t !== null),
    corrections: o['corrections']
      .map(sanitizeCorrection)
      .filter((t): t is LabeledExample => t !== null),
  };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const out = [...existing];
  const seen = new Set(out.map((e) => e.id));
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      out.push(item);
      seen.add(item.id);
    }
  }
  return out;
}

function mergeAttempts(
  existing: TrainingAttempt[],
  incoming: TrainingAttempt[],
): TrainingAttempt[] {
  const out = [...existing];
  const seen = new Set(out.map((a) => a.targetId + ':' + a.timestamp));
  for (const item of incoming) {
    const key = item.targetId + ':' + item.timestamp;
    if (!seen.has(key)) {
      out.push(item);
      seen.add(key);
    }
  }
  return out;
}

export function mergeTrainingData(existing: TrainingData, incoming: TrainingData): TrainingData {
  return {
    targets: mergeById(existing.targets, incoming.targets),
    attempts: mergeAttempts(existing.attempts, incoming.attempts),
    corrections: mergeById(existing.corrections, incoming.corrections),
  };
}

export function parseTrainingDataJson(text: string): TrainingData | null {
  try {
    return normalizeTrainingData(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
