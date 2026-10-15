import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PlayerRig, selectPlayerAnimation } from '../src/game/PlayerRig.js';
import { PHYSICS as P } from '../src/game/config.js';
import * as THREE from 'three';
import { normalizeAnimationClips, disposeResources } from '../src/game/CharacterAssets.js';

test('shared resources and bitmap images are released once, along with every instance buffer', () => {
  const released = { geometry: 0, material: 0, texture: 0, image: 0, instances: 0 };
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture({ close: () => { released.image++; } });
  const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => { released.geometry++; });
  material.addEventListener('dispose', () => { released.material++; });
  texture.addEventListener('dispose', () => { released.texture++; });
  const roots = [0, 1].map(() => {
    const root = new THREE.Group(), instance = new THREE.InstancedMesh(geometry, material, 1);
    instance.addEventListener('dispose', () => { released.instances++; });
    root.add(instance);
    return root;
  });
  disposeResources(roots);
  assert.deepEqual(released, { geometry: 1, material: 1, texture: 1, image: 1, instances: 2 });
});

test('shared glTF input accessors are normalized only once per track, without corrupting durations', () => {
  const times = new Float32Array([.005, .11, .625]);
  const clips = [0, 1].map(() => {
    const tracks = [0, 1].map(i => {
      const track = new THREE.NumberKeyframeTrack(`bone${i}.position[x]`, times, [0, 1, 2]);
      track.times = times;
      return track;
    });
    return new THREE.AnimationClip('drive', -1, tracks);
  });
  normalizeAnimationClips(clips);
  for (const clip of clips) {
    assert.ok(Math.abs(clip.duration - .62) < 1e-6);
    for (const track of clip.tracks) {
      assert.equal(track.times[0], 0);
      assert.ok(Math.abs(track.times[1] - P.contactDelay) < 1e-6);
    }
  }
  assert.ok(times[0] > 0);
});

test('mixers own independent bones, blend continuously, turn smoothly and freeze on pause', () => {
  const scene = new THREE.Group(), bone = new THREE.Bone();
  bone.name = 'hips';
  scene.add(bone);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  scene.add(mesh);
  mesh.bind(new THREE.Skeleton([bone]));
  const clip = (name, duration, values, times = [0, duration]) => new THREE.AnimationClip(name, duration,
    [new THREE.NumberKeyframeTrack('hips.position[y]', times, values)]);
  const asset = {
    scene,
    animations: [clip('stance', 2, [0, 0]), clip('run', .72, [0, .02]),
      clip('turn', .42, [0, .03]), clip('drive_up', .62, [0, .1, 0], [0, .105, .62])],
  };
  const a = new PlayerRig('batter'), b = new PlayerRig('batter');
  a.attach(asset); b.attach(asset);
  const aBone = a.model.getObjectByName('hips'), bBone = b.model.getObjectByName('hips');
  assert.notEqual(aBone, bBone);
  a.pose({ phase: 'flight' }, 1, 1, .06, { moving: true });
  assert.ok(aBone.position.y > 0);
  assert.equal(bBone.position.y, 0);
  assert.ok(Math.abs([...a.weights.values()].reduce((s, w) => s + w, 0) - 1) < 1e-9);
  a.face(Math.PI, .05);
  assert.ok(a.group.rotation.y > 0 && a.group.rotation.y < Math.PI);
  a.pose({ phase: 'flight' }, 1, 2, .05, { moving: true });
  assert.equal(a.activeAnimation, 'turn');
  a.pose({ phase: 'flight' }, 2, 3, .5, { moving: true });
  assert.equal(a.activeAnimation, 'run');
  const before = aBone.position.y;
  a.pose({ paused: true }, 90, 500, 1, { moving: true });
  assert.equal(aBone.position.y, before);
  a.pose({ swing: { direction: 'up', time: .105 } }, 3, 0, .016, { moving: false });
  assert.ok(Math.abs(aBone.position.y - .1) < 1e-6);
  assert.equal(a.weights.get('drive_up'), 1);
  a.dispose(); b.dispose();
});

function glb(name) {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  return {
    json: JSON.parse(bytes.subarray(20, 20 + length).toString()),
    binary: bytes.subarray(28 + length),
  };
}

for (const name of ['batter', 'fielder']) {
  test(`${name} is a textured, weighted glTF skeleton rather than a static sculpture`, () => {
    const { json: j, binary } = glb(name);
    assert.equal(j.skins.length, 1);
    assert.equal(j.skins[0].joints.length, 19);
    assert.ok(j.images.length >= 3);
    assert.ok(j.images.every(image => image.bufferView !== undefined && !image.uri));
    assert.ok(j.nodes.some(node => node.skin === 0 && node.name.startsWith('Library_Cricket_Player')));
    assert.ok(j.materials.some(material => material.name.startsWith('Rocketbox_Head_MIT')));
    assert.ok(j.nodes.every(node => !node.name.startsWith('Library_Crowd')));
    for (const mesh of j.meshes) for (const primitive of mesh.primitives) {
      assert.notEqual(primitive.attributes.JOINTS_0, undefined);
      assert.notEqual(primitive.attributes.TEXCOORD_0, undefined);
      const weights = j.accessors[primitive.attributes.WEIGHTS_0];
      assert.equal(weights.componentType, 5126);
      const view = j.bufferViews[weights.bufferView];
      for (let v = 0; v < weights.count; v++) {
        const offset = (view.byteOffset ?? 0) + (weights.byteOffset ?? 0) + v * (view.byteStride ?? 16);
        const sum = [0, 1, 2, 3].reduce((s, i) => s + binary.readFloatLE(offset + i * 4), 0);
        assert.ok(Math.abs(sum - 1) < 0.001, `Unweighted vertex in ${mesh.name}`);
      }
    }
    assert.ok(j.animations.some(clip => clip.name === 'run'));
    assert.ok(j.animations.some(clip => clip.name === 'turn'));
  });
}

test('batting exports include an exact key at the authoritative contact delay', () => {
  const { json: j, binary } = glb('batter');
  for (const animation of j.animations.filter(a => /drive|defend/.test(a.name))) {
    const bat = animation.channels.find(channel =>
      j.nodes[channel.target.node].name === 'bat' && channel.target.path === 'translation');
    const input = j.accessors[animation.samplers[bat.sampler].input];
    const view = j.bufferViews[input.bufferView];
    const offset = (view.byteOffset ?? 0) + (input.byteOffset ?? 0);
    const start = binary.readFloatLE(offset);
    const times = Array.from({ length: input.count }, (_, i) => binary.readFloatLE(offset + i * 4) - start);
    assert.ok(times.some(t => Math.abs(t - P.contactDelay) < 1e-6));
    assert.ok(times.at(-1) < .63, 'FBX import must not slow the 200fps cricket actions to 30fps');
  }
});

test('asset catalog preserves the library MIT notice, checksums and download budget', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/models/manifest.json', import.meta.url)));
  let total = 0;
  for (const [name, entry] of Object.entries(manifest.files)) {
    const bytes = readFileSync(new URL(`../public/models/${name}`, import.meta.url));
    total += bytes.length;
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.ok(entry.license.includes('MIT'));
  }
  assert.ok(total < 4_000_000, 'Character textures must not regress to uncompressed 2K maps');
  const notice = readFileSync(new URL('../public/models/ROCKETBOX-LICENSE.txt', import.meta.url), 'utf8');
  assert.ok(notice.includes('Copyright (c) 2020 Microsoft'));
});

test('three close-range library crowd poses have bounded geometry and no runtime skeletons', () => {
  const { json: j } = glb('crowd');
  assert.ok(!j.skins?.length);
  assert.equal(j.nodes.length, 3);
  for (const mesh of j.meshes) {
    const triangles = mesh.primitives.reduce((sum, p) => sum + j.accessors[p.indices].count / 3, 0);
    // These are now close-range-only humans, not rendered across the entire stadium.
    assert.ok(triangles < 1000);
  }
});

test('crowd keeps photographic faces, separate clothing and correctly lowered seated hips', () => {
  const { json: j } = glb('crowd');
  for (const node of j.nodes) {
    const primitives = j.meshes[node.mesh].primitives;
    assert.equal(primitives.length, 5, 'Rebaking must not erase polygon material indices.');
    const materials = primitives.map(p => j.materials[p.material]);
    assert.ok(materials.some(m => m.name.startsWith('Kit_Fabric')));
    const head = materials.find(m => m.name === 'Rocketbox_Head_MIT');
    assert.ok(head?.pbrMetallicRoughness.baseColorTexture);
    if (node.name.endsWith('_seated')) {
      const height = Math.max(...primitives.map(p => j.accessors[p.attributes.POSITION].max[1]));
      const ground = Math.min(...primitives.map(p => j.accessors[p.attributes.POSITION].min[1]));
      assert.ok(height > 1.3 && height < 1.5, 'Seated spectators should not float at standing height.');
      assert.ok(Math.abs(ground) < .05);
    }
  }
});

test('the distant crowd LOD has fewer than 200 triangles per pose', () => {
  const { json: j } = glb('crowd-far');
  assert.ok(!j.skins?.length);
  for (const mesh of j.meshes) {
    const triangles = mesh.primitives.reduce((sum, p) => sum + j.accessors[p.indices].count / 3, 0);
    assert.ok(triangles < 200);
  }
});

test('batting and bowling sample physics clocks, including configurable run-up duration', () => {
  for (const direction of ['left', 'right', 'up', 'down']) {
    const pose = selectPlayerAnimation('batter', { swing: { direction, time: P.contactDelay } }, 19);
    assert.equal(pose.name, direction === 'down' ? 'defend' : `drive_${direction}`);
    assert.equal(pose.time, P.contactDelay);
    assert.equal(pose.loop, false);
  }
  assert.equal(selectPlayerAnimation('bowler', { phase: 'runup', phaseTime: 2.4 }, 0, 0,
    { runupSeconds: 2.4 }).time, 1.8);
  assert.ok(Math.abs(selectPlayerAnimation('bowler', { phase: 'delivery', phaseTime: 0.1 }, 0).time - 1.9) < 1e-9);
});

test('fielders gather, release on pickupSeconds, catch, and stop their run cycles', () => {
  const state = { phase: 'return', chaserId: 2, returnThrow: { elapsed: 0.05 } };
  const context = { fieldId: 2, moving: false };
  assert.equal(selectPlayerAnimation('fielder', state, 0, 8, context).name, 'pickup');
  state.returnThrow.elapsed = P.pickupSeconds;
  const release = selectPlayerAnimation('fielder', state, 0, 8, context);
  assert.equal(release.name, 'throw');
  assert.ok(Math.abs(release.time - 0.12) < 1e-9);
  Object.assign(state, { phase: 'result', phaseTime: 0, result: { reason: 'caught' } });
  assert.equal(selectPlayerAnimation('fielder', state, 0, 8, context).name, 'catch');
  assert.equal(selectPlayerAnimation('fielder', { phase: 'flight' }, 0, 8, context).name, 'idle');
});
