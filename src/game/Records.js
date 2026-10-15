const STORAGE_KEY = 'crease.records.v1';

/** Records are grouped by format and difficulty: a quick Easy innings never beats a classic Hard one. */
export const recordKey = ({ format, difficulty }) => `${format ?? 'custom'}:${difficulty}`;

/** Pure update: returns the new records and what the finished innings achieved. */
export function recordInnings(records, view) {
  const key = recordKey(view);
  const previous = records[key] ?? { best: null, innings: 0, chases: 0, wins: 0, streak: 0, bestStreak: 0 };
  const next = { ...previous, innings: previous.innings + 1 };
  const newBest = previous.best == null || view.score > previous.best;
  if (newBest) next.best = view.score;
  if (view.outcome) {
    const won = view.outcome.result === 'won';
    next.chases++;
    if (won) next.wins++;
    next.streak = won ? previous.streak + 1 : 0;
    next.bestStreak = Math.max(previous.bestStreak, next.streak);
  }
  return {
    records: { ...records, [key]: next },
    // A first innings is a best by definition; only celebrate beating a real score.
    achieved: { newBest: newBest && previous.best != null, previousBest: previous.best, ...next },
  };
}

/** Browser storage may be unavailable (private mode, blocked site data); records are a convenience. */
export function loadRecords(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function saveRecords(records, storage = globalThis.localStorage) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* storage unavailable */ }
}
