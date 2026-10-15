import test from 'node:test';
import assert from 'node:assert/strict';
import { CricketEngine } from '../src/game/CricketEngine.js';
import { battingDisplay } from '../src/game/Batting.js';
import { StadiumScoreboard } from '../src/game/StadiumScoreboard.js';

test('individual boundaries, balls, strike rotation and restart follow engine results', () => {
  const game = new CricketEngine();
  game.reset();
  game.finishBall(4, false, 'boundary');
  assert.deepEqual(game.snapshot().batsmen[0], {
    id: 0, name: 'Arjun Rao', runs: 4, balls: 1, fours: 1, sixes: 0,
    out: false, striker: true, strikeRate: '400.0',
  });
  game.beginDelivery();
  game.finishBall(1);
  game.beginDelivery();
  assert.equal(game.state.strikerId, 1);
  game.finishBall(6, false, 'boundary');
  assert.equal(game.state.batsmen[1].sixes, 1);
  assert.equal(game.state.batsmen[0].runs, 5);
  assert.equal(game.state.batsmen[1].runs, 6);
  const copy = game.snapshot();
  copy.batsmen[0].runs = 999;
  assert.equal(game.state.batsmen[1].runs, 6);
  game.reset();
  assert.equal(game.state.strikerId, 0);
  assert.equal(game.state.nonStrikerId, 1);
  assert.ok(game.state.batsmen.every(b => !b.out && !b.runs && !b.balls));
});

test('completed runs appear provisionally and a boundary overrides them without double counting', () => {
  const game = new CricketEngine();
  game.reset();
  game.state.phase = 'flight';
  game.state.running.completed = 2;
  assert.equal(game.snapshot().score, 2);
  assert.equal(game.snapshot().batsmen[0].runs, 2);
  assert.equal(game.state.batsmen[0].runs, 0);
  game.finishBall(4, false, 'boundary');
  assert.equal(game.snapshot().score, 4);
  assert.equal(game.snapshot().batsmen[0].runs, 4);
  game.finishBall(4);
  assert.equal(game.state.batsmen[0].balls, 1);
});

test('end-of-over strike and scoreboard overs use configurable balls per over', () => {
  const game = new CricketEngine({ rules: { ballsPerOver: 2 } });
  game.reset();
  game.finishBall(0);
  game.beginDelivery();
  game.finishBall(1);
  game.beginDelivery();
  assert.equal(game.state.strikerId, 0); // Run and over both swap strike.
  assert.equal(battingDisplay(game.state, 2).overs, '1.0');
});

test('bowled/caught replaces the striker, and run-out dismisses the targeted runner', () => {
  for (const reason of ['bowled', 'caught']) {
    const game = new CricketEngine();
    game.reset(); game.finishBall(0, true, reason); game.beginDelivery();
    assert.equal(game.state.strikerId, 2);
    assert.equal(game.state.batsmen[0].out, true);
    assert.equal(game.state.batsmen[0].balls, 1);
  }
  const game = new CricketEngine();
  game.reset();
  game.state.phase = 'return';
  Object.assign(game.state.running, { mode: 'outbound', completed: 0, progress: 0.2 });
  game.state.returnThrow = { targetZ: 0 };
  game.finishBall(0, true, 'runout');
  assert.equal(game.state.batsmen[1].out, true);
  assert.equal(game.state.batsmen[0].out, false);
  assert.equal(game.state.batsmen[0].balls, 1);
  assert.equal(game.state.batsmen[1].balls, 0);
  game.beginDelivery();
  assert.equal(game.state.strikerId, 0);
  assert.equal(game.state.nonStrikerId, 2);
});

test('stadium texture uploads only on changed statistics, including paused reset', () => {
  const previous = globalThis.document;
  const painted = [];
  globalThis.document = { createElement: () => ({
    getContext: () => ({ fillRect() {}, fillText: text => painted.push(text) }),
  }) };
  try {
    const board = new StadiumScoreboard(2);
    const game = new CricketEngine({ rules: { ballsPerOver: 2 } });
    assert.equal(board.update(game.state), true);
    const version = board.texture.version;
    assert.equal(board.update(game.state), false);
    assert.equal(board.texture.version, version);
    game.reset(); game.finishBall(6, false, 'boundary');
    assert.equal(board.update(game.state), true);
    assert.ok(painted.includes('6 / 0'));
    assert.equal(board.data.batsmen[0].balls, 1);
    game.reset(false); game.state.paused = true;
    board.update(game.state);
    assert.equal(board.data.score, 0);
    assert.equal(board.data.batsmen[0].runs, 0);
    board.texture.dispose();
  } finally {
    globalThis.document = previous;
  }
});
