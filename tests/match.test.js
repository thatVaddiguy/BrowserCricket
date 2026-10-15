import test from 'node:test';
import assert from 'node:assert/strict';
import { CricketEngine } from '../src/game/CricketEngine.js';
import { PHYSICS as P, DIFFICULTIES, seededRandom } from '../src/game/config.js';
import { recordInnings, recordKey, loadRecords, saveRecords } from '../src/game/Records.js';

function engine(seed = 42, options = {}) {
  return new CricketEngine({ rng: seededRandom(seed), ...options });
}
function until(game, predicate, limit = 20000) {
  for (let i = 0; i < limit; i++) {
    if (predicate(game.state)) return;
    game.update(P.step);
  }
  assert.fail(`Simulation timeout in phase ${game.state.phase}`);
}
function chaseFlight(target, score) {
  const game = engine(7, { format: 'quick', mode: 'chase' });
  game.startInnings();
  Object.assign(game.state, { target, score });
  game.releaseBall();
  Object.assign(game.state, { phase: 'flight', batHit: true, shot: 'right', chaserId: 0 });
  Object.assign(game.state.ball, {
    x: -25, z: 20, y: P.radius, vx: 0, vy: 0, vz: 0,
    hitX: 0, hitZ: P.crease, rolling: true, bounced: true,
  });
  game.state.fielders.forEach(f => Object.assign(f, { x: 35, z: -10, target: { x: -25, z: 20 } }));
  return game;
}

test('formats set innings length, are validated, and only change before an innings', () => {
  const game = engine(42, { format: 'classic' });
  assert.equal(game.maxBalls, 30);
  assert.equal(game.snapshot().maxWickets, 5);
  assert.equal(game.state.batsmen.length, 7);
  assert.throws(() => engine(42, { format: 'test-match' }), RangeError);
  assert.throws(() => engine(42, { mode: 'super-over' }), RangeError);
  assert.equal(game.setMatch({ format: 'quick' }), true);
  assert.equal(game.maxBalls, 12);
  game.startInnings();
  assert.equal(game.setMatch({ format: 'classic' }), false, 'An active innings keeps its format.');
  assert.equal(game.maxBalls, 12);
  game.startInnings('normal', { format: 'classic', mode: 'chase' });
  assert.equal(game.maxBalls, 30);
  assert.equal(game.snapshot().mode, 'chase');
});

test('a chase sets a difficulty-scaled target only when the innings starts', () => {
  const free = engine(3, { format: 'quick' });
  free.startInnings();
  assert.equal(free.state.target, null);
  assert.equal(free.snapshot().runsNeeded, null);
  const game = engine(3, { format: 'quick', mode: 'chase' });
  assert.equal(game.state.target, null, 'No target before taking the crease.');
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    game.startInnings(difficulty);
    const par = 12 * DIFFICULTIES[difficulty].targetRate;
    assert.ok(game.state.target >= Math.round(par * 0.85) && game.state.target <= Math.round(par * 1.15),
      `${difficulty} target ${game.state.target} is near par ${par}`);
    assert.equal(game.snapshot().runsNeeded, game.state.target);
    assert.equal(game.snapshot().ballsLeft, 12);
  }
});

test('the winning run ends the chase at once and a later throw cannot run anyone out', () => {
  const game = chaseFlight(10, 9);
  game.toggleRun();
  until(game, s => s.phase !== 'flight');
  assert.equal(game.state.phase, 'result');
  assert.equal(game.state.score, 10);
  assert.equal(game.state.wickets, 0);
  assert.equal(game.state.result.reason, 'target');
  assert.equal(game.state.feedback.title, 'Target reached!');
  until(game, s => s.phase === 'over');
  const view = game.snapshot();
  assert.deepEqual(view.outcome, { result: 'won', margin: 'Won by 3 wickets with 11 balls to spare' });
  assert.equal(view.runsNeeded, 0);
});

test('a boundary can win the chase, and running out of balls loses or ties it', () => {
  const won = chaseFlight(12, 9);
  won.finishBall(4, false, 'boundary');
  assert.equal(won.state.feedback.title, 'Target reached!');
  until(won, s => s.phase === 'over');
  assert.equal(won.snapshot().outcome.result, 'won');

  for (const [score, result, margin] of [[5, 'lost', 'Lost by 4 runs'], [9, 'tied', 'Scores level. A tie.']]) {
    const game = engine(5, { mode: 'chase' });
    game.startInnings();
    game.state.target = 10;
    game.state.score = score;
    game.state.balls = 11;
    game.finishBall(0, false, 'defended');
    until(game, s => s.phase === 'over');
    assert.deepEqual(game.snapshot().outcome, { result, margin });
  }
  const free = engine();
  free.startInnings();
  free.state.balls = 11;
  free.finishBall(0);
  until(free, s => s.phase === 'over');
  assert.equal(free.snapshot().outcome, null);
});

test('the chase ends on the exact run that reaches the target, not before', () => {
  const game = chaseFlight(20, 18);
  game.toggleRun();
  until(game, s => s.running.completed === 1);
  assert.equal(game.state.phase, 'flight', 'One short: the ball is still live.');
  game.toggleRun();
  until(game, s => s.phase === 'result');
  assert.equal(game.state.wickets, 0, 'The second completed run reached the target first.');
  assert.equal(game.state.score, 20);
});

test('innings statistics count dots, boundaries, perfect hits and the top scorer', () => {
  const game = engine();
  game.startInnings();
  game.finishBall(0, false, 'defended');
  until(game, s => s.phase === 'runup');
  game.finishBall(4, false, 'boundary');
  until(game, s => s.phase === 'runup');
  game.state.perfects = 2;
  game.finishBall(6, false, 'boundary');
  const { stats } = game.snapshot();
  assert.equal(stats.dots, 1);
  assert.equal(stats.fours, 1);
  assert.equal(stats.sixes, 1);
  assert.equal(stats.perfects, 2);
  assert.equal(stats.strikeRate, Math.round(10 / 3 * 100));
  assert.deepEqual(stats.topScorer, { name: 'Arjun Rao', runs: 10, balls: 3, out: false });
});

test('records track bests per format and difficulty, and chase streaks', () => {
  const view = (score, outcome = null, format = 'quick', difficulty = 'normal') =>
    ({ score, outcome, format, difficulty });
  let { records, achieved } = recordInnings({}, view(14));
  assert.equal(achieved.newBest, false, 'A first innings is not celebrated as beating a best.');
  assert.equal(records[recordKey(view(0))].best, 14);
  ({ records, achieved } = recordInnings(records, view(21, { result: 'won' })));
  assert.equal(achieved.newBest, true);
  assert.equal(achieved.previousBest, 14);
  ({ records, achieved } = recordInnings(records, view(19, { result: 'won' })));
  assert.equal(achieved.newBest, false);
  assert.equal(achieved.best, 21);
  assert.equal(achieved.streak, 2);
  ({ records, achieved } = recordInnings(records, view(3, { result: 'lost' })));
  assert.deepEqual([achieved.wins, achieved.chases, achieved.streak, achieved.bestStreak], [2, 3, 0, 2]);
  ({ records } = recordInnings(records, view(50, null, 'classic', 'hard')));
  assert.equal(records['quick:normal'].best, 21, 'Other formats and levels keep separate bests.');
  assert.equal(records['classic:hard'].best, 50);
});

test('record storage survives missing, corrupt and throwing storage', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  saveRecords({ 'quick:easy': { best: 9 } }, storage);
  assert.deepEqual(loadRecords(storage), { 'quick:easy': { best: 9 } });
  memory.set('crease.records.v1', '{not json');
  assert.deepEqual(loadRecords(storage), {});
  memory.set('crease.records.v1', '[1,2]');
  assert.deepEqual(loadRecords(storage), {});
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadRecords(broken), {});
  assert.doesNotThrow(() => saveRecords({}, broken));
  assert.deepEqual(loadRecords(undefined), {});
});
