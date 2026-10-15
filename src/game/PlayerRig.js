import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { PHYSICS as P, DEFAULT_RULES, clamp } from './config.js';

/** Pure selection logic: animation clocks never drive physics or scoring. */
export function selectPlayerAnimation(kind, state, time, motion = 0, context = {}) {
  const moving = context.moving ?? motion > 0;
  if (kind === 'batter') {
    if (moving) return { name: 'run', time: motion / 10, loop: true };
    if (state?.swing) return {
      name: state.swing.direction === 'down' ? 'defend' : `drive_${state.swing.direction}`,
      time: state.swing.time, loop: false, fade: 0.035,
    };
    return { name: 'stance', time, loop: true };
  }
  if (kind === 'bowler' && ['runup', 'delivery'].includes(state?.phase)) {
    return {
      name: 'bowl',
      time: state.phase === 'runup'
        ? state.phaseTime / (context.runupSeconds ?? DEFAULT_RULES.runupSeconds) * 1.8
        : 1.8 + state.phaseTime,
      loop: false,
    };
  }
  if (state && context.fieldId !== undefined && context.fieldId === state.chaserId) {
    if (state.phase === 'return' && state.returnThrow) {
      const elapsed = state.returnThrow.elapsed;
      const gather = P.pickupSeconds - 0.12;
      return elapsed < gather
        ? { name: 'pickup', time: elapsed / gather * 0.32, loop: false, fade: 0.06 }
        : { name: 'throw', time: elapsed - gather, loop: false, fade: 0.07 };
    }
    if (state.phase === 'result' && state.result?.reason === 'caught') {
      return { name: 'catch', time: 0.16 + state.phaseTime, loop: false, fade: 0.045 };
    }
    const f = state.fielders?.find(player => player.id === context.fieldId);
    const b = state.ball;
    if (state.phase === 'flight' && f && b && !b.bounced && b.y > 0.65 && b.y < 2.1
      && Math.hypot(f.x - b.x, f.z - b.z) < 2.5) {
      return { name: 'catch', time: 0.16, loop: false, fade: 0.045 };
    }
  }
  return moving
    ? { name: 'run', time: motion / 8, loop: true }
    : { name: 'idle', time, loop: true };
}

/** glTF skin, with an independent skeleton and mixer for every player. */
export class PlayerRig {
  constructor(kind = 'fielder') {
    this.kind = kind;
    this.group = new THREE.Group();
    this.group.name = `Cricket_${kind}`;
    this.actions = new Map();
    this.weights = new Map();
    this.loaded = false;
    this.lastMotion = 0;
    this.turnTime = Infinity;
  }

  attach(asset) {
    this.model = clone(asset.scene);
    this.group.add(this.model);
    const materials = new Map();
    this.model.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = this.kind !== 'fielder';
      object.receiveShadow = true;
      if (object.isSkinnedMesh) object.frustumCulled = false;
      const customize = source => {
        if (!materials.has(source)) {
          const material = source.clone();
          if (source.name === 'Kit_Fabric' && this.kind !== 'batter') {
            material.map = null;
            material.color.set('#ad593c');
          }
          materials.set(source, material);
        }
        return materials.get(source);
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(customize) : customize(object.material);
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of asset.animations) {
      const action = this.mixer.clipAction(clip).play();
      action.paused = true;
      action.setEffectiveWeight(0);
      this.actions.set(clip.name, action);
      this.weights.set(clip.name, 0);
    }
    this.hand = this.model.getObjectByName('hand_R');
    this.loaded = true;
    this.sample({ name: this.kind === 'batter' ? 'stance' : 'idle', time: 0, loop: true }, 0);
  }

  face(yaw, dt) {
    const delta = Math.atan2(Math.sin(yaw - this.group.rotation.y), Math.cos(yaw - this.group.rotation.y));
    if (Math.abs(delta) > 2.5 && this.wasMoving && this.turnTime > 0.42) this.turnTime = 0;
    this.group.rotation.y += delta * (1 - Math.exp(-14 * Math.max(0, dt)));
  }

  pose(state, time, motion = 0, dt = 0, context = {}) {
    if (!this.loaded || state?.paused) return;
    this.turnTime += dt;
    const selection = selectPlayerAnimation(this.kind, state, time, motion, context);
    if (selection.name === 'run' && this.turnTime < 0.42) {
      selection.name = 'turn';
      selection.time = this.turnTime;
      selection.loop = false;
    }
    this.wasMoving = selection.name === 'run' || selection.name === 'turn';
    this.sample(selection, dt);
  }

  sample(selection, dt) {
    const target = this.actions.get(selection.name);
    if (!target) return;
    if (this.activeAnimation !== selection.name) {
      this.fromWeights = new Map(this.weights);
      this.blendTime = 0;
      this.blendDuration = this.activeAnimation ? selection.fade ?? 0.12 : 0;
      this.activeAnimation = selection.name;
    }
    this.blendTime += dt;
    if (/^(drive_|defend)/.test(selection.name) && selection.time >= 0.04) {
      this.blendTime = this.blendDuration;
    }
    const mix = this.blendDuration ? clamp(this.blendTime / this.blendDuration, 0, 1) : 1;
    const duration = target.getClip().duration;
    target.time = selection.loop ? selection.time % duration : clamp(selection.time, 0, duration - 1e-6);
    for (const [name, action] of this.actions) {
      const from = this.fromWeights.get(name) ?? 0;
      const weight = THREE.MathUtils.lerp(from, name === selection.name ? 1 : 0, mix);
      this.weights.set(name, weight);
      action.setEffectiveWeight(weight);
    }
    this.mixer.update(0);
    this.animationTime = target.time;
  }

  dispose() {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer.uncacheRoot(this.model);
  }
}
