import test from 'node:test';
import assert from 'node:assert/strict';
import { CricketEngine } from '../src/game/CricketEngine.js';
import { PHYSICS as P, DIFFICULTIES, seededRandom } from '../src/game/config.js';
import { DELIVERY_TYPES, planDelivery } from '../src/game/DeliveryPlanner.js';

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
function timeShot(game, direction) {
  until(game, s => s.phase === 'delivery' && (s.ball.z - P.crease) /
    (-s.ball.vz * P.deliveryTimeScale) <= P.contactDelay);
  assert.equal(game.playShot(direction), true);
  until(game, s => s.phase !== 'delivery');
}

test('ready state, configured rules, and restart are clean', () => {
  const game = engine();
  assert.equal(game.state.phase, 'ready');
  assert.equal(game.snapshot().maxBalls, 12);
  assert.equal(game.snapshot().maxWickets, 3);
  game.reset();
  assert.equal(game.state.phase, 'runup');
  assert.equal(game.snapshot().canShoot, true);
  game.state.score = 29;
  game.state.wickets = 2;
  game.reset();
  assert.equal(game.state.score, 0);
  assert.equal(game.state.wickets, 0);
  assert.deepEqual(game.state.history, []);
});

test('five-over rules are supported without changing renderer or physics', () => {
  const game = engine(42, { rules: { overs: 5, wickets: 10 } });
  assert.equal(game.maxBalls, 30);
  assert.equal(game.snapshot().maxWickets, 10);
  assert.throws(() => engine(42, { rules: { overs: 0 } }), RangeError);
  assert.throws(() => engine(42, { rules: { wickets: 1.5 } }), RangeError);
});

test('difficulty is validated and never silently changes an active innings', () => {
  assert.throws(() => engine(42, { difficulty: 'expert' }), RangeError);
  assert.throws(() => engine(42, { difficulty: 'toString' }), RangeError);
  const game = engine();
  assert.equal(game.setDifficulty('easy'), true);
  game.startInnings();
  assert.equal(game.snapshot().difficulty, 'easy');
  game.state.score = 7;
  const delivery = game.state.delivery;
  game.pause(true);
  assert.equal(game.setDifficulty('hard'), false);
  assert.equal(game.difficulty, 'easy');
  assert.equal(game.state.delivery, delivery);
  assert.equal(game.state.score, 7);
  assert.throws(() => game.startInnings('invalid'), RangeError);
  assert.equal(game.state.score, 7);
  game.startInnings('hard');
  assert.equal(game.snapshot().difficulty, 'hard');
  assert.equal(game.state.score, 0);
  assert.equal(game.state.paused, false);
});

test('difficulty regenerates valid bowling trajectories and Normal preserves the default', () => {
  for (const type of DELIVERY_TYPES) {
    const deliveries = Object.entries(DIFFICULTIES).map(([id, profile]) => {
      const d = planDelivery(1, seededRandom(42), type, profile);
      const tb = (d.releaseZ - d.bounceZ) / -d.vz;
      const ta = (d.bounceZ - P.crease) / (-d.vz * .86);
      assert.ok(Math.abs(d.releaseY + d.vy * tb - .5 * P.gravity * tb ** 2 - P.radius) < 1e-8, id);
      const x = d.initialX + d.vx * (tb + ta) + .5 * d.swing * tb ** 2 +
        (d.swing * tb + d.spin * 1.7) * ta + .5 * d.swing * .32 * ta ** 2;
      assert.ok(Math.abs(x - d.line) < 1e-8, id);
      assert.ok(Number.isFinite(d.duration) && d.duration > 0);
      return d;
    });
    assert.ok(deliveries[0].speed < deliveries[1].speed && deliveries[1].speed < deliveries[2].speed);
    assert.ok(deliveries[0].duration > deliveries[1].duration && deliveries[1].duration > deliveries[2].duration);
    assert.deepEqual(deliveries[1], planDelivery(1, seededRandom(42), type));
  }
});

test('timing windows, fielder movement and return speeds respond to difficulty', () => {
  for (const [difficulty, profile] of Object.entries(DIFFICULTIES)) {
    const game = engine(42, { difficulty });
    game.startInnings();
    game.releaseBall();
    game.playShot('right');
    Object.assign(game.state.ball, { x: 0, y: .7,
      z: P.crease + .11 * (-game.state.ball.vz * P.deliveryTimeScale) });
    game.tryContact();
    assert.equal(game.state.batHit, difficulty !== 'hard');
    const fielded = runningFlight();
    fielded.applyDifficulty(difficulty);
    const f = fielded.state.fielders[0], x = f.x, z = f.z;
    fielded.update(P.step);
    assert.ok(Math.abs(Math.hypot(f.x - x, f.z - z) - 5.8 * P.step * P.shotTimeScale * profile.fieldSpeed) < 1e-8);
    Object.assign(fielded.state.ball, { x: 20, z: 0 });
    fielded.finishFielded();
    assert.ok(Math.abs(fielded.state.returnThrow.duration - 20 / (P.throwSpeed * profile.throwSpeed)) < 1e-8);
    assert.equal(P.contactDelay, .105, 'Animation/contact synchronisation is unchanged.');
    assert.equal(P.pickupSeconds, .32, 'Throw release key is unchanged.');
  }
});

test('run-up releases, gravity accelerates, and bounce reduces forward velocity', () => {
  const game = engine();
  game.reset();
  until(game, s => s.phase === 'delivery');
  const initial = { ...game.state.ball };
  for (let i = 0; i < 12; i++) game.update(P.step);
  assert.ok(game.state.ball.y < initial.y);
  assert.ok(game.state.ball.vy < initial.vy);
  assert.ok(game.state.ball.z < initial.z);
  until(game, s => s.ball.bounced);
  assert.ok(game.state.ball.vy > 0);
  assert.equal(game.state.ball.bounces, 1);
  assert.ok(Math.abs(game.state.ball.vz) < Math.abs(initial.vz));
  assert.ok(Math.abs(game.state.ball.z - game.state.delivery.bounceZ) < 0.25);
});

test('spin and swing create different lateral trajectories', () => {
  const out = planDelivery(1, seededRandom(20), DELIVERY_TYPES[0]);
  const inward = planDelivery(1, seededRandom(20), DELIVERY_TYPES[1]);
  assert.ok(out.swing > 0);
  assert.ok(inward.swing < 0);
  const off = planDelivery(1, seededRandom(10), DELIVERY_TYPES[3]);
  const leg = planDelivery(1, seededRandom(10), DELIVERY_TYPES[4]);
  assert.ok(off.spin < 0 && leg.spin > 0);
  for (const type of DELIVERY_TYPES) {
    for (let i = 0; i < 20; i++) {
      const d = planDelivery(1, seededRandom(i), type);
      assert.ok(d.duration > 0 && d.duration < 2);
      assert.ok(Number.isFinite(d.vx) && d.vy < 0);
    }
  }
});

test('a run-up shot is too early and cannot be spammed', () => {
  const game = engine();
  game.reset();
  assert.equal(game.playShot('up'), true);
  assert.equal(game.state.feedback.title, 'Too Early');
  assert.equal(game.playShot('left'), false);
  until(game, s => s.phase === 'result');
  assert.equal(game.state.batHit, false);
});

test('a release-time shot misses rather than auto-hitting', () => {
  const game = engine();
  game.reset();
  until(game, s => s.phase === 'delivery');
  game.playShot('right');
  until(game, s => s.swing?.checked);
  assert.equal(game.state.feedback.title, 'Too Early');
  assert.equal(game.state.batHit, false);
  assert.equal(game.state.phase, 'delivery');
});

test('perfectly timed loft produces a six', () => {
  const game = engine();
  game.reset();
  timeShot(game, 'up');
  assert.equal(game.state.batHit, true);
  assert.equal(game.state.feedback.title, 'Perfect!');
  assert.ok(Math.abs(game.state.contactError) < P.perfectWindow);
  assert.ok(game.state.ball.quality > 0.95);
  until(game, s => s.phase === 'result');
  assert.equal(game.state.result.runs, 6);
  assert.equal(game.state.score, 6);
  assert.equal(game.state.balls, 1);
});

test('left and right shots travel to the requested side', () => {
  for (const [direction, sign] of [['left', -1], ['right', 1]]) {
    const game = engine();
    game.reset();
    timeShot(game, direction);
    assert.equal(game.state.phase, 'flight');
    assert.equal(Math.sign(game.state.ball.vx), sign);
    until(game, s => s.phase === 'result');
    assert.equal(game.state.score, game.state.result.runs >= 4 ? game.state.result.runs : 0,
      'A non-boundary shot does not score automatically.');
  }
});

test('a timely defensive shot is a safe dot ball', () => {
  const game = engine();
  game.reset();
  timeShot(game, 'down');
  assert.equal(game.state.feedback.title, 'Solid defense');
  until(game, s => s.phase === 'result');
  assert.equal(game.state.wickets, 0);
  assert.equal(game.state.score, 0);
  assert.equal(game.state.balls, 1);
});

test('down arrow leaves an outside-stump delivery alone', () => {
  const game = engine();
  game.reset();
  until(game, s => s.phase === 'delivery');
  game.state.ball.x = 0.43;
  game.state.ball.vx = 0;
  game.state.ball.ax = 0;
  game.state.ball.z = P.crease - game.state.ball.vz * P.deliveryTimeScale * P.contactDelay;
  game.playShot('down');
  until(game, s => s.swing?.checked);
  assert.equal(game.state.feedback.title, 'Good leave');
  until(game, s => s.phase === 'result');
  assert.equal(game.state.wickets, 0);
  assert.equal(game.state.result.reason, 'leave');
});

test('swept wicket collision works at high speed and animates bails', () => {
  const game = engine();
  game.reset();
  game.releaseBall();
  Object.assign(game.state.ball, { x: 0, y: 0.4, z: 0.2, vx: 0, vy: 0, vz: -100, ax: 0 });
  game.update(0.01);
  assert.equal(game.state.result.reason, 'bowled');
  assert.equal(game.state.wickets, 1);
  assert.equal(game.state.bails.length, 2);
  game.finishBall(6);
  assert.equal(game.state.balls, 1, 'result is recorded only once');
  assert.equal(game.state.score, 0);
});

test('no input ends the innings at three wickets', () => {
  const game = engine();
  game.reset();
  until(game, s => s.phase === 'over');
  assert.equal(game.state.wickets, 3);
  assert.ok(game.state.balls <= 12);
  assert.equal(game.playShot('up'), false);
});

test('twelve defended deliveries end the innings without a thirteenth ball', () => {
  const game = engine(19);
  game.reset();
  for (let i = 0; i < 12; i++) {
    timeShot(game, 'down');
    until(game, s => s.phase === 'result');
    assert.equal(game.state.balls, i + 1);
    until(game, s => s.phase === 'runup' || s.phase === 'over');
  }
  assert.equal(game.state.phase, 'over');
  assert.equal(game.state.balls, 12);
  assert.ok(game.state.wickets < 3);
  assert.equal(game.state.history.length, 12);
});

test('a five-over innings ends at thirty balls', () => {
  const game = engine(10, { rules: { overs: 5, wickets: 10, resultSeconds: 0.01 } });
  game.reset();
  for (let i = 0; i < 30; i++) {
    game.finishBall(1);
    until(game, s => s.phase === 'runup' || s.phase === 'over');
  }
  assert.equal(game.state.phase, 'over');
  assert.equal(game.state.balls, 30);
  assert.equal(game.state.score, 30);
  assert.equal(game.snapshot().overs, '5.0');
});

test('pause freezes physics and resumes without resetting the innings', () => {
  const game = engine();
  game.reset();
  until(game, s => s.phase === 'delivery');
  game.pause(true);
  const before = JSON.stringify(game.state);
  for (let i = 0; i < 180; i++) game.update(P.step);
  assert.equal(JSON.stringify(game.state), before);
  assert.equal(game.playShot('up'), false);
  game.pause(false);
  game.update(P.step);
  assert.notEqual(JSON.stringify(game.state), before);
});

test('snapshots cannot mutate live score history', () => {
  const game = engine();
  const view = game.snapshot();
  view.history.push('W');
  assert.equal(game.state.history.length, 0);
});

test('late contact gives timing feedback rather than a hit', () => {
  const game = engine();
  game.reset();
  game.releaseBall();
  Object.assign(game.state.ball, { x: 0, y: 0.4, z: 0.15, vx: 0, vy: 0, vz: -2, ax: 0 });
  game.playShot('up');
  game.tryContact();
  assert.equal(game.state.feedback.title, 'Too Late');
  assert.equal(game.state.batHit, false);
});

test('boundary scoring distinguishes a bouncing four from an airborne six', () => {
  for (const [bounced, runs] of [[true, 4], [false, 6]]) {
    const game = engine();
    game.reset();
    game.releaseBall();
    game.state.phase = 'flight';
    game.state.shot = 'right';
    Object.assign(game.state.ball, {
      x: P.boundaryRadius - 0.02, z: P.fieldCenterZ, y: bounced ? P.radius : 2,
      vx: 20, vy: 0, vz: 0, bounced, rolling: bounced,
      hitAge: 1, hitX: 0, hitZ: P.crease, furthest: 42,
    });
    game.update(P.step);
    assert.equal(game.state.result.runs, runs);
    assert.equal(game.state.score, runs);
    assert.equal(game.state.boundaries, 1);
  }
});

test('fielders can catch an airborne ball but not a ball that already bounced', () => {
  for (const bounced of [false, true]) {
    const game = engine();
    game.reset();
    game.releaseBall();
    game.state.phase = 'flight';
    game.state.shot = 'up';
    const f = game.state.fielders[0];
    f.target = { x: f.x, z: f.z };
    game.state.chaserId = f.id;
    Object.assign(game.state.ball, {
      x: f.x, y: 1.2, z: f.z, vx: 0, vy: 0, vz: 0,
      bounced, hitAge: 1, hitX: 0, hitZ: P.crease, furthest: 25,
    });
    game.update(P.step);
    assert.equal(game.state.wickets, bounced ? 0 : 1);
    if (!bounced) assert.equal(game.state.result.reason, 'caught');
  }
});

function runningFlight() {
  const game = engine();
  game.reset();
  game.releaseBall();
  Object.assign(game.state, { phase: 'flight', batHit: true, shot: 'right', chaserId: 0 });
  Object.assign(game.state.ball, {
    x: -25, z: 20, y: P.radius, vx: 0, vy: 0, vz: 0,
    hitX: 0, hitZ: P.crease, rolling: true, bounced: true,
  });
  game.state.fielders.forEach(f => Object.assign(f, {
    x: 35, z: -10, target: { x: -25, z: 20 },
  }));
  return game;
}

test('a crossing takes 1.4 seconds and two manual runs finish in 2.8 seconds', () => {
  const game = runningFlight();
  let elapsed = 0;
  for (let runs = 1; runs <= 2; runs++) {
    assert.equal(game.toggleRun(), true);
    while (game.state.running.completed < runs && elapsed < 3) {
      game.update(P.step);
      elapsed += P.step;
    }
    assert.equal(game.state.running.completed, runs);
    assert.ok(Math.abs(elapsed - runs * 1.4) <= runs * P.step + 1e-8);
    assert.equal(game.state.running.mode, 'idle');
    assert.equal(game.snapshot().score, runs);
  }
  assert.ok(Math.abs(game.state.running.motion - elapsed * 17 * P.runSpeed / 8.4) < 1e-8);
  until(game, s => s.phase === 'result');
  assert.equal(game.state.score, 2, 'Completed runs survive the return throw.');
  assert.equal(game.state.wickets, 0);
});

test('only manual crossings score; two separate runs swap both batters and bank once', () => {
  const game = runningFlight();
  assert.equal(game.toggleRun(), true);
  until(game, s => s.running.completed === 1);
  assert.equal(game.state.running.strikerZ, P.farCrease);
  assert.equal(game.state.running.nonStrikerZ, P.crease);
  assert.equal(game.state.running.mode, 'idle', 'Never start another run automatically.');
  assert.equal(game.snapshot().score, 1, 'Show completed runs live before the return.');
  assert.equal(game.state.score, 0, 'Commit only at the end of the ball.');
  game.toggleRun();
  until(game, s => s.running.completed === 2);
  assert.equal(game.state.running.strikerZ, P.crease);
  assert.equal(game.state.running.nonStrikerZ, P.farCrease);
  until(game, s => s.phase === 'return');
  assert.equal(game.state.ball.x, game.state.returnThrow.from.x, 'Return begins at the pickup.');
  until(game, s => s.phase === 'result');
  assert.equal(game.state.score, 2);
  assert.equal(game.state.wickets, 0);
  assert.equal(game.state.balls, 1);
  game.finishBall(2);
  assert.equal(game.state.score, 2);
});

test('cancelling turns both runners back and does not award an incomplete run', () => {
  const game = runningFlight();
  game.toggleRun();
  for (let i = 0; i < 120; i++) game.update(P.step);
  const z = game.state.running.strikerZ;
  game.toggleRun();
  assert.equal(game.state.running.mode, 'returning');
  game.update(P.step);
  assert.ok(game.state.running.strikerZ < z);
  until(game, s => s.running.mode === 'idle');
  assert.equal(game.state.running.strikerZ, P.crease);
  assert.equal(game.state.running.completed, 0);
  until(game, s => s.phase === 'result');
  assert.equal(game.state.score, 0);
  assert.equal(game.state.wickets, 0);
});

test('a returning runner can recommit to the same run', () => {
  const game = runningFlight();
  game.toggleRun();
  for (let i = 0; i < 90; i++) game.update(P.step);
  game.toggleRun();
  for (let i = 0; i < 10; i++) game.update(P.step);
  game.toggleRun();
  assert.equal(game.state.running.mode, 'outbound');
  until(game, s => s.running.completed === 1);
  assert.equal(game.state.running.completed, 1);
});

test('four completed crossings are running runs, not a boundary', () => {
  const game = runningFlight();
  Object.assign(game.state.ball, { x: -35, z: 15 });
  game.state.fielders.forEach(f => Object.assign(f, { x: 35, z: -30, target: { x: -35, z: 15 } }));
  for (let runs = 1; runs <= 4; runs++) {
    game.toggleRun();
    until(game, s => s.running.completed === runs);
  }
  until(game, s => s.phase === 'result');
  assert.equal(game.state.score, 4);
  assert.equal(game.state.boundaries, 0);
  assert.equal(game.state.feedback.title, '+4 runs');
  assert.deepEqual(game.snapshot().boundaryBalls, []);
});

test('a return throw can run out the batters at either wicket and keep completed runs', () => {
  for (const targetZ of [0, P.farWicket]) {
    const game = runningFlight();
    game.toggleRun();
    until(game, s => s.running.completed === 1);
    Object.assign(game.state.ball, { x: 0.5, z: targetZ });
    game.finishFielded();
    assert.equal(game.state.returnThrow.targetZ, targetZ);
    assert.equal(game.state.phase, 'return');
    assert.equal(game.state.balls, 0, 'Pickup is not an instant result.');
    game.toggleRun();
    until(game, s => s.phase === 'result');
    assert.equal(game.state.result.reason, 'runout');
    assert.equal(game.state.feedback.title, 'Run out!');
    assert.equal(game.state.score, 1);
    assert.equal(game.state.wickets, 1);
    assert.equal(game.state.brokenWicketZ, targetZ);
    assert.equal(game.state.bails.length, 2);
  }
});

test('cancelling during a return is safe only if the batters actually get home', () => {
  for (const late of [false, true]) {
    const game = runningFlight();
    game.toggleRun();
    for (let i = 0; i < (late ? 210 : 50); i++) game.update(P.step);
    Object.assign(game.state.ball, { x: late ? 0.5 : 25, z: 0 });
    game.finishFielded();
    game.toggleRun();
    until(game, s => s.phase === 'result');
    assert.equal(game.state.wickets, late ? 1 : 0);
    assert.equal(game.state.score, 0);
  }
});

test('a caught ball discards provisional running runs, boundaries do not double count', () => {
  for (const caught of [true, false]) {
    const game = runningFlight();
    game.toggleRun();
    until(game, s => s.running.completed === 1);
    if (caught) {
      const f = game.state.fielders[0];
      Object.assign(f, { x: -25, z: 20, target: { x: -25, z: 20 } });
      Object.assign(game.state.ball, { x: -25, z: 20, y: 1.2, vy: 0, rolling: false, bounced: false });
    } else {
      Object.assign(game.state.ball, { x: P.boundaryRadius, z: P.fieldCenterZ, vx: 20 });
    }
    game.update(P.step);
    assert.equal(game.state.score, caught ? 0 : 4);
    assert.equal(game.snapshot().score, caught ? 0 : 4);
    assert.equal(game.state.wickets, caught ? 1 : 0);
  }
});

test('running freezes on pause, snapshots are isolated, and each ball resets the runners', () => {
  const game = runningFlight();
  game.toggleRun();
  game.update(P.step);
  const view = game.snapshot();
  view.running.strikerZ = 100;
  view.fielders[0].x = 100;
  view.ball.x = 100;
  assert.notEqual(game.state.running.strikerZ, 100);
  assert.notEqual(game.state.fielders[0].x, 100);
  assert.notEqual(game.state.ball.x, 100);
  game.pause(true);
  const before = JSON.stringify(game.state);
  game.update(1);
  assert.equal(JSON.stringify(game.state), before);
  assert.equal(game.toggleRun(), false);
  game.pause(false);
  game.finishBall(0);
  assert.equal(game.toggleRun(), false);
  until(game, s => s.phase === 'runup');
  assert.equal(game.state.running.completed, 0);
  assert.equal(game.state.running.progress, 0);
  assert.equal(game.state.running.strikerZ, P.crease);
  assert.equal(game.state.returnThrow, null);
  assert.equal(game.toggleRun(), false);
  game.reset(false);
  assert.equal(game.toggleRun(), false);
});
