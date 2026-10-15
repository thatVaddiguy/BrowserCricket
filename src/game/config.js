// Match rules are independent of the UI and renderer. A future five-over innings
// can supply { overs: 5, wickets: 10 } without changing ball physics.
export const DEFAULT_RULES = Object.freeze({
  overs: 2,
  ballsPerOver: 6,
  wickets: 3,
  runupSeconds: 1.8,
  resultSeconds: 1.8,
});

export const PHYSICS = Object.freeze({
  step: 1 / 180,
  gravity: 9.81,
  crease: 1.25,
  farWicket: 21.4,
  farCrease: 20.15,
  runSpeed: 13.5,
  throwSpeed: 24,
  pickupSeconds: 0.32,
  radius: 0.036,
  boundaryRadius: 43,
  fieldCenterZ: 10,
  deliveryTimeScale: 0.68,
  shotTimeScale: 1.6,
  contactDelay: 0.105,
  contactWindow: 0.125,
  perfectWindow: 0.030,
});

// Difficulty changes the contest, not the animation's contact/release keys.
export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ label: 'Easy', description: 'Slower bowling, forgiving timing, relaxed fielders.',
    speed: 0.8, swing: 0.7, spin: 0.7, contactWindow: 0.17, perfectWindow: 0.05,
    fieldSpeed: 0.82, throwSpeed: 0.85, targetRate: 1.05 }),
  normal: Object.freeze({ label: 'Normal', description: 'Balanced bowling, timing and fielding.',
    speed: 1, swing: 1, spin: 1, contactWindow: PHYSICS.contactWindow,
    perfectWindow: PHYSICS.perfectWindow, fieldSpeed: 1, throwSpeed: 1, targetRate: 1.35 }),
  hard: Object.freeze({ label: 'Hard', description: 'Faster bowling, tighter timing, sharper fielders.',
    speed: 1.18, swing: 1.25, spin: 1.2, contactWindow: 0.095, perfectWindow: 0.022,
    fieldSpeed: 1.18, throwSpeed: 1.1, targetRate: 1.65 }),
});

// Formats only change the innings length; physics and timing stay identical.
export const FORMATS = Object.freeze({
  quick: Object.freeze({ label: 'Quick · 2 overs', description: '12 balls, 3 wickets.', overs: 2, wickets: 3 }),
  classic: Object.freeze({ label: 'Classic · 5 overs', description: '30 balls, 5 wickets.', overs: 5, wickets: 5 }),
});

export const MODES = Object.freeze({
  free: Object.freeze({ label: 'Free innings', description: 'Score as many as you can.' }),
  chase: Object.freeze({ label: 'Chase a target', description: 'Reach the target before the balls or wickets run out.' }),
});

// Spectator capacity grows independently of the pitch and scoring boundary.
export const STADIUM = Object.freeze({
  tiers: 6, rows: 3, columns: 480, sectors: 12,
  innerRadius: 61.5, tierDepth: 2.35, tierRise: 2.15,
  rowDepth: 0.54, rowRise: 0.32,
  outerRadius: 75.45, roofHeight: 14.55,
  scoreboardWidth: 20, scoreboardHeight: 10,
});

export const SHOTS = Object.freeze({
  left: { name: 'Leg-side flick', label: 'Leg side', detail: 'Flick / on-drive', key: '←' },
  right: { name: 'Cover drive', label: 'Off side', detail: 'Cover drive / cut', key: '→' },
  up: { name: 'Lofted straight drive', label: 'Straight', detail: 'Lofted drive', key: '↑' },
  down: { name: 'Defensive block', label: 'Defend', detail: 'Block / leave', key: '↓' },
});

export const FIELD_POSITIONS = Object.freeze([
  [-25, 17], [25, 20], [-12, 35], [14, 37], [-34, 4],
  [35, 5], [0, 49], [-19, -8], [20, -7],
]);

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function seededRandom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
