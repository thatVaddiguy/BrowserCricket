import {
  DEFAULT_RULES, PHYSICS as P, FIELD_POSITIONS, SHOTS, DIFFICULTIES, FORMATS, MODES,
  clamp, lerp, smooth, distance,
} from './config.js';
import { planDelivery } from './DeliveryPlanner.js';
import { makeBatsman, battingDisplay } from './Batting.js';

/**
 * Pure, fixed-step simulation. No React, DOM, or Three.js imports.
 * A delivery strategy, RNG, and rules can be supplied by future game modes.
 * World axes: +X off side, +Y height, +Z toward the bowler.
 */
export class CricketEngine {
  constructor({
    rules = {}, rng = Math.random, deliveryPlanner = planDelivery, difficulty = 'normal',
    format = null, mode = 'free',
  } = {}) {
    this.baseRules = { ...DEFAULT_RULES, ...rules };
    this.rng = rng;
    this.deliveryPlanner = deliveryPlanner;
    this.events = [];
    this.applyFormat(format);
    this.applyMode(mode);
    this.applyDifficulty(difficulty);
    this.reset(false);
  }

  /** A null format keeps the constructor rules (custom or default). */
  applyFormat(format) {
    if (format !== null && !Object.hasOwn(FORMATS, format)) throw new RangeError('Unknown match format.');
    const rules = format ? { ...this.baseRules, overs: FORMATS[format].overs, wickets: FORMATS[format].wickets }
      : { ...this.baseRules };
    if (!Number.isInteger(rules.overs) || rules.overs < 1 ||
      !Number.isInteger(rules.ballsPerOver) || rules.ballsPerOver < 1 ||
      !Number.isInteger(rules.wickets) || rules.wickets < 1) {
      throw new RangeError('Overs, balls per over, and wickets must be positive integers.');
    }
    this.format = format;
    this.rules = rules;
    this.maxBalls = rules.overs * rules.ballsPerOver;
  }

  applyMode(mode) {
    if (!Object.hasOwn(MODES, mode)) throw new RangeError('Unknown game mode.');
    this.mode = mode;
  }

  applyDifficulty(difficulty) {
    if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new RangeError('Unknown difficulty level.');
    this.difficulty = difficulty;
    this.profile = DIFFICULTIES[difficulty];
  }

  setDifficulty(difficulty) {
    if (!Object.hasOwn(DIFFICULTIES, difficulty)) throw new RangeError('Unknown difficulty level.');
    if (!['ready', 'over'].includes(this.state.phase)) return false;
    this.applyDifficulty(difficulty);
    return true;
  }

  /** Format and mode change before an innings; elsewhere they are queued for startInnings. */
  setMatch({ format = this.format, mode = this.mode } = {}) {
    if (this.state.phase !== 'ready') return false;
    this.applyFormat(format);
    this.applyMode(mode);
    this.reset(false);
    return true;
  }

  startInnings(difficulty = this.difficulty, { format = this.format, mode = this.mode } = {}) {
    this.applyDifficulty(difficulty);
    this.applyFormat(format);
    this.applyMode(mode);
    this.reset(true);
  }

  /** Runs needed to win: roughly the difficulty's par rate, with some variety. */
  planTarget() {
    return Math.max(4, Math.round(this.maxBalls * this.profile.targetRate * this.random(0.85, 1.15)));
  }

  targetReached(extra = 0) {
    return this.state.target != null && this.state.score + extra >= this.state.target;
  }


  random(a, b) { return a + this.rng() * (b - a); }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  consumeEvents() { const events = this.events; this.events = []; return events; }

  reset(playing = true) {
    this.events = [];
    this.state = {
      phase: playing ? 'runup' : 'ready', phaseTime: 0, paused: false,
      score: 0, wickets: 0, balls: 0, history: [], boundaries: 0, boundaryBalls: [],
      ball: null, delivery: null, swing: null, shotUsed: false, shot: null,
      contactError: null, batHit: false, fielders: this.makeFielders(), chaserId: null,
      bowler: { x: 0.15, z: 28.5 }, particles: [], bails: [], trail: [],
      feedback: null, timing: 'WAIT FOR IT', result: null, shake: 0,
      running: this.makeRunning(), returnThrow: null, brokenWicketZ: null,
      batsmen: Array.from({ length: this.rules.wickets + 2 }, (_, id) => makeBatsman(id)),
      strikerId: 0, nonStrikerId: 1, nextBatsmanId: 2, nextPair: null,
      target: playing && this.mode === 'chase' ? this.planTarget() : null,
      dots: 0, perfects: 0,
    };
    if (playing) this.beginDelivery();
    this.emit('reset');
  }

  makeFielders() {
    return FIELD_POSITIONS.map(([x, z], id) => ({ x, z, homeX: x, homeZ: z, id, running: 0 }));
  }

  makeRunning() {
    return {
      completed: 0, progress: 0, mode: 'idle', motion: 0,
      strikerZ: P.crease, nonStrikerZ: P.farCrease,
    };
  }

  canRun() {
    return !this.state.paused && this.state.batHit &&
      ['flight', 'return'].includes(this.state.phase);
  }

  toggleRun() {
    if (!this.canRun()) return false;
    const r = this.state.running;
    r.mode = r.mode === 'outbound' ? 'returning' : 'outbound';
    this.state.swing = null;
    this.emit('run', { mode: r.mode });
    return true;
  }

  updateRunning(dt) {
    const r = this.state.running;
    if (r.mode === 'idle') return;
    const span = P.farCrease - P.crease;
    r.progress = clamp(r.progress + (r.mode === 'outbound' ? 1 : -1) * P.runSpeed * dt / span, 0, 1);
    // The authored cycle used 17 phase units/sec at 8.4 m/sec. Track distance
    // so faster gameplay running also accelerates the feet.
    r.motion += dt * P.runSpeed * (17 / 8.4);
    if (r.progress >= 1) {
      r.completed++;
      r.progress = 0;
      r.mode = 'idle';
      this.emit('runComplete', { runs: r.completed });
      // The winning run ends the match at once; a later throw cannot run anyone out.
      if (this.targetReached(r.completed)) {
        r.strikerZ = r.completed % 2 ? P.farCrease : P.crease;
        r.nonStrikerZ = r.completed % 2 ? P.crease : P.farCrease;
        this.finishBall(r.completed, false, 'target');
        return;
      }
    } else if (r.progress <= 0) {
      r.mode = 'idle';
      this.emit('runCancelled');
    }
    const start = r.completed % 2 ? P.farCrease : P.crease;
    const end = r.completed % 2 ? P.crease : P.farCrease;
    r.strikerZ = lerp(start, end, r.progress);
    r.nonStrikerZ = lerp(end, start, r.progress);
  }

  feedback(title, subtitle = '', tone = 'good') {
    this.state.feedback = { title, subtitle, tone };
    this.emit('feedback');
  }

  beginDelivery() {
    const s = this.state;
    if (s.nextPair) {
      [s.strikerId, s.nonStrikerId] = s.nextPair;
      s.nextPair = null;
    }
    s.delivery = this.deliveryPlanner(s.balls, this.rng, null, this.profile);
    s.phase = 'runup';
    s.phaseTime = 0;
    s.ball = null;
    s.swing = null;
    s.shotUsed = false;
    s.shot = null;
    s.contactError = null;
    s.batHit = false;
    s.trail = [];
    s.bails = [];
    s.particles = [];
    s.chaserId = null;
    s.feedback = null;
    s.result = null;
    s.running = this.makeRunning();
    s.returnThrow = null;
    s.brokenWicketZ = null;
    s.bowler = { x: 0.15, z: 28.5 };
    s.fielders = this.makeFielders();
    s.timing = 'WATCH THE RUN-UP';
    this.emit('delivery');
  }

  releaseBall() {
    const s = this.state;
    const d = s.delivery;
    s.ball = {
      x: d.initialX, y: d.releaseY, z: d.releaseZ,
      vx: d.vx, vy: d.vy, vz: d.vz, ax: d.swing,
      bounced: false, bounces: 0, rolling: false, seam: 0,
      age: 0, hitAge: 0, quality: 0, furthest: 0,
    };
    s.phase = 'delivery';
    s.phaseTime = 0;
    s.timing = 'WAIT FOR THE BOUNCE';
    this.emit('release');
  }

  playShot(direction) {
    const s = this.state;
    if (!SHOTS[direction] || s.paused || s.shotUsed || !['runup', 'delivery'].includes(s.phase)) return false;
    s.shotUsed = true;
    s.shot = direction;
    s.swing = { direction, time: 0, checked: false, contacted: false };
    if (s.phase === 'runup') {
      s.swing.checked = true;
      this.feedback('Too Early', 'Let the bowler release the ball first.', 'warm');
      s.timing = 'TOO EARLY';
    }
    this.emit('shot');
    return true;
  }

  pause(paused = !this.state.paused) {
    if (['ready', 'over'].includes(this.state.phase)) return;
    this.state.paused = paused;
    this.emit('pause');
  }

  tryContact() {
    const s = this.state, ball = s.ball, swing = s.swing;
    if (!ball || s.phase !== 'delivery' || !swing) return;
    const error = (ball.z - P.crease) / Math.max(1, -ball.vz * P.deliveryTimeScale);
    s.contactError = error;
    if (Math.abs(error) > this.profile.contactWindow) {
      this.feedback(error > 0 ? 'Too Early' : 'Too Late',
        error > 0 ? 'The ball is still on its way.' : 'The ball has passed your bat.', 'warm');
      s.timing = error > 0 ? 'TOO EARLY' : 'TOO LATE';
      return;
    }
    const defend = swing.direction === 'down';
    if (defend && Math.abs(ball.x) > 0.25) {
      this.feedback('Good leave', 'Outside the stumps. Let it go.', 'neutral');
      s.timing = 'WELL JUDGED';
      return;
    }
    // The bat meets a corridor around the popping crease. A late attempt cannot
    // magically hit a ball that has already travelled through the wicket.
    if (Math.abs(ball.x) > 0.80 || ball.y > 1.65 || ball.z < 0.08) {
      this.feedback('Beaten!', 'That one moved away from the bat.', 'bad');
      s.timing = 'BEATEN';
      return;
    }
    let quality = clamp(1 - (Math.abs(error) / this.profile.contactWindow) ** 1.35, 0, 1);
    const wrongSide = (s.shot === 'left' && ball.x > 0.25) || (s.shot === 'right' && ball.x < -0.25);
    if (wrongSide) quality *= 0.76;
    const perfect = Math.abs(error) <= this.profile.perfectWindow && !wrongSide;
    swing.contacted = true;
    s.batHit = true;
    Object.assign(ball, {
      quality, bounced: false, bounces: 0, rolling: false, hitAge: 0, ax: 0,
      hitX: ball.x, hitZ: ball.z,
    });
    const power = defend ? 4.2 : lerp(10, 35, quality);
    let angle = s.shot === 'left' ? -0.96 + error * 2.2 :
      s.shot === 'right' ? 1.02 + error * 2.2 : clamp(ball.x * 0.3 + error * 1.7, -0.4, 0.4);
    if (defend) angle = ball.x * 0.7;
    ball.vx = Math.sin(angle) * power;
    ball.vz = Math.cos(angle) * power;
    ball.vy = defend ? 0.75 : s.shot === 'up' ? lerp(5.0, 16.2, quality) : lerp(2.3, 5.0, quality);
    if (!defend && quality < 0.4) ball.vy += 3;
    s.phase = 'flight';
    s.phaseTime = 0;
    s.trail = [];
    s.shake = perfect && !defend ? 0.65 : 0.15;
    const landingTime = (ball.vy + Math.sqrt(ball.vy ** 2 + 2 * P.gravity * ball.y)) / P.gravity;
    const landing = { x: ball.x + ball.vx * landingTime, z: ball.z + ball.vz * landingTime };
    const radial = Math.hypot(landing.x, landing.z - P.fieldCenterZ);
    if (radial > P.boundaryRadius - 2) {
      landing.x *= (P.boundaryRadius - 2) / radial;
      landing.z = P.fieldCenterZ + (landing.z - P.fieldCenterZ) * (P.boundaryRadius - 2) / radial;
    }
    const chaser = s.fielders.reduce((best, f) => distance(f, landing) < distance(best, landing) ? f : best);
    chaser.target = landing;
    s.chaserId = chaser.id;
    this.feedback(defend ? 'Solid defense' : perfect ? 'Perfect!' : quality > 0.50 ? 'Good timing' : 'An edge!',
      SHOTS[s.shot].name + (wrongSide ? ' · Across the line' : ''), defend ? 'neutral' : perfect ? 'good' : 'warm');
    s.timing = defend ? 'BLOCKED' : perfect ? 'PERFECT!' : quality > 0.50 ? 'GOOD TIMING' : 'MISTIMED';
    if (perfect && !defend) s.perfects++;
    this.particles(ball.x, ball.y, ball.z, perfect ? 12 : 6, 'hit');
    this.emit('contact', { kind: defend ? 'block' : 'hit', perfect });
  }

  particles(x, y, z, count, kind) {
    for (let i = 0; i < count; i++) {
      this.state.particles.push({
        x, y, z, vx: this.random(-2.2, 2.2), vy: this.random(1, 4),
        vz: this.random(-2, 2), life: this.random(0.25, 0.65), kind,
      });
    }
  }

  breakWicket(z = 0) {
    this.state.brokenWicketZ = z;
    this.state.bails = [-0.10, 0.10].map(x => ({
      x, y: 0.77, z, vx: this.random(-2, 2), vy: this.random(2.8, 4.7),
      vz: this.random(-2.5, -1), angle: 0, spin: this.random(-12, 12),
    }));
    this.particles(0, 0.5, z, 14, 'wicket');
  }

  finishBall(runs, wicket = false, reason = '') {
    const s = this.state;
    if (['ready', 'result', 'over'].includes(s.phase)) return;
    const boundary = !wicket && (reason === 'boundary' || !reason && runs >= 4);
    const batter = s.batsmen[s.strikerId];
    batter.runs += runs;
    batter.balls++;
    if (boundary && runs === 4) batter.fours++;
    if (boundary && runs === 6) batter.sixes++;
    const pair = [s.strikerId, s.nonStrikerId];
    let dismissed = s.strikerId;
    if (wicket && reason === 'runout' && s.returnThrow && s.running.mode !== 'idle') {
      const startNear = s.running.completed % 2 === 0;
      const strikerHeadsNear = s.running.mode === 'returning' ? startNear : !startNear;
      if (strikerHeadsNear !== (s.returnThrow.targetZ === 0)) dismissed = s.nonStrikerId;
    }
    if (runs % 2 && !boundary) pair.reverse();
    if (wicket) {
      s.batsmen[dismissed].out = true;
      if (s.wickets + 1 < this.rules.wickets && s.balls + 1 < this.maxBalls && !this.targetReached(runs)) {
        pair[pair.indexOf(dismissed)] = s.nextBatsmanId++;
      }
    }
    if ((s.balls + 1) % this.rules.ballsPerOver === 0) pair.reverse();
    s.nextPair = pair;
    s.score += runs;
    s.balls++;
    if (wicket) s.wickets++;
    if (boundary) { s.boundaries++; s.boundaryBalls.push(s.balls - 1); }
    if (!wicket && runs === 0) s.dots++;
    s.history.push(wicket ? 'W' : runs);
    s.result = { runs, wicket, reason };
    s.phase = 'result';
    s.phaseTime = 0;
    if (wicket) {
      this.feedback(reason === 'runout' ? 'Run out!' : reason === 'caught' ? 'Caught!' : 'Bowled!',
        reason === 'runout' ? `Short of the crease. ${runs} completed ${runs === 1 ? 'run counts' : 'runs count'}.` :
          'A wicket falls. Reset and go again.', 'bad');
      s.timing = 'WICKET';
      s.shake = 1.4;
    } else if (boundary) {
      this.feedback(runs === 6 ? 'SIX!' : 'FOUR!', runs === 6 ? 'All the way. Into the stands.' : 'Finds the gap. Finds the rope.');
      s.shake = 0.7;
    } else if (runs > 0) {
      this.feedback(`+${runs} ${runs === 1 ? 'run' : 'runs'}`, 'Safely home. Good running between the wickets.');
    } else {
      const timing = s.contactError == null ? '' : s.contactError > 0 ? 'Too early. ' : 'Too late. ';
      this.feedback('Dot ball', reason === 'defended' ? 'A tidy block. Your wicket is safe.' :
        reason === 'leave' ? 'Well left. Safely through to the keeper.' :
        s.batHit ? 'The fielder cuts it off.' : `${timing}No contact, no run.`, 'neutral');
    }
    if (!wicket && this.targetReached()) {
      const left = this.maxBalls - s.balls;
      this.feedback('Target reached!', `${boundary ? `Finished with a ${runs === 6 ? 'six' : 'four'}` : 'Chase complete'} · ` +
        `${left} ${left === 1 ? 'ball' : 'balls'} to spare.`);
      s.shake = Math.max(s.shake, 0.9);
    }
    this.emit('result', { runs, wicket, reason, boundary, score: s.score, wickets: s.wickets, balls: s.balls });
  }

  updateDelivery(dt) {
    const s = this.state, b = s.ball, t = dt * P.deliveryTimeScale;
    const previous = { x: b.x, y: b.y, z: b.z };
    // Constant-acceleration integration; the crease and wicket use swept collisions.
    b.x += b.vx * t + 0.5 * b.ax * t * t;
    b.y += b.vy * t - 0.5 * P.gravity * t * t;
    b.z += b.vz * t;
    b.vx += b.ax * t;
    b.vy -= P.gravity * t;
    b.age += dt;
    b.seam += t * (18 + Math.abs(s.delivery.spin) * 24);
    if (b.y <= P.radius && b.vy < 0) {
      b.y = P.radius;
      b.vy *= -s.delivery.restitution;
      b.vz *= 0.86;
      b.vx += s.delivery.spin * 1.7;
      b.ax *= 0.32;
      b.bounced = true;
      b.bounces++;
      this.particles(b.x, 0.015, b.z, 7, 'dust');
      this.emit('bounce');
      if (!s.shotUsed) s.timing = 'GET READY…';
    }
    if (previous.z > 0 && b.z <= 0) {
      const fraction = previous.z / (previous.z - b.z);
      const x = lerp(previous.x, b.x, fraction), y = lerp(previous.y, b.y, fraction);
      if (Math.abs(x) <= 0.155 + P.radius && y >= 0 && y <= 0.79 + P.radius) {
        this.breakWicket();
        Object.assign(b, { vx: this.random(-3, 3), vy: 1.8, vz: -3 });
        this.finishBall(0, true, 'bowled');
        return;
      }
    }
    if (b.z < -3.4) this.finishBall(0, false, s.shot === 'down' ? 'leave' : 'miss');
  }

  updateFlight(dt) {
    const s = this.state, b = s.ball, t = dt * P.shotTimeScale;
    b.hitAge += dt;
    if (b.rolling) {
      const speed = Math.hypot(b.vx, b.vz);
      const ratio = speed > 0 ? Math.max(0, speed - 5.2 * t) / speed : 0;
      b.vx *= ratio;
      b.vz *= ratio;
      b.y = P.radius;
      b.seam += Math.hypot(b.vx, b.vz) * t / 0.09;
    } else {
      b.y += b.vy * t - 0.5 * P.gravity * t * t;
      b.vy -= P.gravity * t;
      b.vx *= Math.exp(-0.06 * t);
      b.vz *= Math.exp(-0.06 * t);
      b.seam += t * 34;
      if (b.y <= P.radius && b.vy < 0) {
        b.y = P.radius;
        b.vy *= -0.32;
        b.vx *= 0.83;
        b.vz *= 0.83;
        b.bounced = true;
        b.bounces++;
        this.particles(b.x, 0.015, b.z, 5, 'grass');
        if (b.vy < 1.1 || b.bounces >= 3) { b.rolling = true; b.vy = 0; }
      }
    }
    b.x += b.vx * t;
    b.z += b.vz * t;
    b.furthest = Math.max(b.furthest, Math.hypot(b.x - b.hitX, b.z - b.hitZ));
    if (Math.hypot(b.x, b.z - P.fieldCenterZ) >= P.boundaryRadius) {
      this.finishBall(!b.bounced && b.y > P.radius * 2 ? 6 : 4, false, 'boundary');
      return;
    }
    const f = s.fielders.find(fielder => fielder.id === s.chaserId);
    if (f) {
      const target = b.rolling || b.bounced ? b : f.target;
      const dx = target.x - f.x, dz = target.z - f.z, length = Math.hypot(dx, dz);
      const step = Math.min(length, 5.8 * t * this.profile.fieldSpeed);
      if (length > 0.05) {
        f.x += dx / length * step; f.z += dz / length * step;
        f.running += t * 8 * this.profile.fieldSpeed;
      }
      if (distance(f, b) < 1.25 && b.hitAge > 0.2) {
        if (!b.bounced && b.y >= 0.65 && b.y <= 2.1) {
          this.finishBall(0, true, 'caught');
          return;
        }
        if (b.y <= 0.42) { this.finishFielded(); return; }
      }
    }
    // A stopped ball still needs to be collected: never award distance-based runs
    // or teleport a return throw from the outfield.
    if (b.hitAge > 6.3) {
      const nearest = s.fielders.reduce((best, fielder) =>
        distance(fielder, b) < distance(best, b) ? fielder : best);
      s.chaserId = nearest.id;
      nearest.target = { x: b.x, z: b.z };
    }
  }

  finishFielded() {
    const s = this.state, b = s.ball;
    if (s.phase !== 'flight' || !b) return;
    const nearDistance = Math.hypot(b.x, b.z);
    const farDistance = Math.hypot(b.x, b.z - P.farWicket);
    const targetZ = nearDistance <= farDistance ? 0 : P.farWicket;
    s.returnThrow = {
      from: { x: b.x, y: 0.9, z: b.z }, targetZ, elapsed: 0,
      duration: Math.max(0.22, Math.min(nearDistance, farDistance) / (P.throwSpeed * this.profile.throwSpeed)),
    };
    Object.assign(b, { y: 0.9, vx: 0, vy: 0, vz: 0, rolling: false });
    s.phase = 'return';
    s.phaseTime = 0;
    this.emit('fielded');
  }

  updateReturn(dt) {
    const s = this.state, t = s.returnThrow;
    t.elapsed += dt;
    const progress = clamp((t.elapsed - P.pickupSeconds) / t.duration, 0, 1);
    s.ball.x = lerp(t.from.x, 0, progress);
    s.ball.z = lerp(t.from.z, t.targetZ, progress);
    s.ball.y = lerp(t.from.y, 0.65, progress) + Math.sin(progress * Math.PI) * 1.1;
    s.ball.seam += dt * 35;
    if (progress < 1) return;
    const out = s.running.mode !== 'idle' && s.running.progress > 0;
    if (out) this.breakWicket(t.targetZ);
    this.finishBall(s.running.completed, out, out ? 'runout' : s.shot === 'down' ? 'defended' : 'fielded');
  }

  update(dt) {
    const s = this.state;
    if (s.paused || ['ready', 'over'].includes(s.phase)) return;
    s.phaseTime += dt;
    s.shake = Math.max(0, s.shake - dt * 2.5);
    if (s.phase === 'runup') {
      const progress = s.phaseTime / this.rules.runupSeconds;
      s.bowler.z = lerp(28.5, 21.5, smooth(progress));
      s.bowler.x = 0.15 + Math.sin(progress * Math.PI * 8) * 0.055;
      if (progress >= 1) this.releaseBall();
    } else if (s.phase === 'delivery') {
      this.updateDelivery(dt);
    } else if (s.phase === 'flight') {
      this.updateRunning(dt);
      if (s.phase === 'flight') this.updateFlight(dt);
    } else if (s.phase === 'return') {
      this.updateRunning(dt);
      if (s.phase === 'return') this.updateReturn(dt);
    } else if (s.phase === 'result') {
      if (s.ball && s.result.reason === 'bowled') {
        const b = s.ball;
        b.vy -= P.gravity * dt;
        b.y = Math.max(P.radius, b.y + b.vy * dt);
        b.x += b.vx * dt; b.z += b.vz * dt;
      }
      if (s.phaseTime >= this.rules.resultSeconds) {
        if (s.balls >= this.maxBalls || s.wickets >= this.rules.wickets || this.targetReached()) {
          s.phase = 'over';
          s.feedback = null;
          this.emit('over');
        } else this.beginDelivery();
      }
    }
    if (s.swing) {
      s.swing.time += dt;
      if (!s.swing.checked && s.swing.time >= P.contactDelay) {
        s.swing.checked = true;
        this.tryContact();
      }
      if (s.swing.time > 0.62) s.swing = null;
    }
    for (const particle of s.particles) {
      particle.life -= dt;
      particle.vy -= P.gravity * dt;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.z += particle.vz * dt;
    }
    s.particles = s.particles.filter(particle => particle.life > 0 && particle.y > -0.03);
    for (const bail of s.bails) {
      bail.vy -= P.gravity * dt; bail.x += bail.vx * dt;
      bail.y += bail.vy * dt; bail.z += bail.vz * dt; bail.angle += bail.spin * dt;
      if (bail.y < 0.015) { bail.y = 0.015; bail.vy *= -0.28; bail.vx *= 0.8; bail.vz *= 0.8; }
    }
    s.trail.forEach(point => { point.life -= dt; });
    s.trail = s.trail.filter(point => point.life > 0);
    if (s.ball && ['delivery', 'flight', 'return'].includes(s.phase)) {
      s.trail.push({ x: s.ball.x, y: s.ball.y, z: s.ball.z, life: 0.13 });
    }
  }

  snapshot() {
    const s = this.state;
    let timingProgress = null;
    if (s.phase === 'delivery' && s.ball) {
      const remaining = (s.ball.z - P.crease) / Math.max(1, -s.ball.vz * P.deliveryTimeScale);
      timingProgress = clamp(0.80 + (P.contactDelay - remaining) * 0.74, 0, 1);
    }
    const score = s.score + (['flight', 'return'].includes(s.phase) ? s.running.completed : 0);
    return {
      phase: s.phase, paused: s.paused, difficulty: this.difficulty, format: this.format, mode: this.mode,
      score, wickets: s.wickets,
      target: s.target, runsNeeded: s.target == null ? null : Math.max(0, s.target - score),
      ballsLeft: this.maxBalls - s.balls, outcome: this.outcome(), stats: this.inningsStats(),
      balls: s.balls, history: [...s.history], boundaries: s.boundaries,
      boundaryBalls: [...s.boundaryBalls],
      maxBalls: this.maxBalls, maxWickets: this.rules.wickets,
      batsmen: battingDisplay(s, this.rules.ballsPerOver).batsmen,
      overs: `${Math.floor(s.balls / this.rules.ballsPerOver)}.${s.balls % this.rules.ballsPerOver}`,
      delivery: s.delivery ? { name: s.delivery.name, speed: Math.round(s.delivery.speed), spin: Math.abs(s.delivery.spin) > 0.4 } : null,
      feedback: s.feedback ? { ...s.feedback } : null, timing: s.timing, timingProgress,
      canShoot: !s.paused && !s.shotUsed && ['runup', 'delivery'].includes(s.phase),
      shot: s.shot,
      batHit: s.batHit, runOut: s.result?.reason === 'runout',
      canRun: this.canRun(), running: { ...s.running },
      ball: s.ball ? { x: s.ball.x, z: s.ball.z } : null,
      fielders: s.fielders.map(({ x, z, id }) => ({ x, z, id })),
      throwIncoming: s.phase === 'return',
    };
  }

  inningsStats() {
    const s = this.state;
    const played = s.batsmen.filter(b => b.balls > 0 || b.out);
    const top = played.reduce((best, b) => !best || b.runs > best.runs ? b : best, null);
    return {
      fours: played.reduce((sum, b) => sum + b.fours, 0),
      sixes: played.reduce((sum, b) => sum + b.sixes, 0),
      dots: s.dots, perfects: s.perfects,
      strikeRate: s.balls ? Math.round(s.score / s.balls * 100) : 0,
      topScorer: top ? { name: top.name, runs: top.runs, balls: top.balls, out: top.out } : null,
    };
  }

  /** Chase result once the innings is over; null for a free innings. */
  outcome() {
    const s = this.state;
    if (s.phase !== 'over' || s.target == null) return null;
    if (s.score >= s.target) {
      const wickets = this.rules.wickets - s.wickets, balls = this.maxBalls - s.balls;
      return { result: 'won', margin: `Won by ${wickets} ${wickets === 1 ? 'wicket' : 'wickets'}` +
        (balls ? ` with ${balls} ${balls === 1 ? 'ball' : 'balls'} to spare` : ' off the last ball') };
    }
    const short = s.target - 1 - s.score;
    if (short === 0) return { result: 'tied', margin: 'Scores level. A tie.' };
    return { result: 'lost', margin: `Lost by ${short} ${short === 1 ? 'run' : 'runs'}` };
  }
}
