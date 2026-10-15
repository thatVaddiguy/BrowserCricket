import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StadiumCrowd, crowdGeometry, CROWD_SECTORS } from '../src/game/StadiumCrowd.js';
import { disposeResources } from '../src/game/CharacterAssets.js';
import { STADIUM as S, PHYSICS } from '../src/game/config.js';

function asset() {
  const scene = new THREE.Group();
  for (const pose of ['seated', 'cheering', 'clapping']) {
    const group = new THREE.Group(); group.name = pose;
    for (const name of ['Kit_Fabric', 'Rocketbox_Head_MIT']) {
      const material = new THREE.MeshStandardMaterial(); material.name = name;
      group.add(new THREE.Mesh(new THREE.BoxGeometry(.3, .4, .2), material));
    }
    scene.add(group);
  }
  return { scene };
}

test('material primitives merge into one coloured, unskinned geometry per pose', () => {
  const source = asset();
  source.scene.updateMatrixWorld();
  const geometry = crowdGeometry(source.scene.children[0]);
  assert.equal(geometry.getAttribute('color').count, geometry.getAttribute('position').count);
  assert.equal(geometry.hasAttribute('skinWeight'), false);
  assert.equal(geometry.groups.length, 0);
  assert.equal(geometry.getAttribute('position').count / 3, 24);
  geometry.dispose(); disposeResources([source.scene]);
});

test('larger stadium preserves the playing boundary with six tiers and 8,640 seats', () => {
  assert.equal(S.tiers * S.rows * S.columns, 8640);
  assert.equal(S.tiers, 6);
  assert.ok(S.innerRadius > 60 && S.outerRadius > 75);
  assert.equal(S.columns % CROWD_SECTORS, 0);
  assert.equal(PHYSICS.boundaryRadius, 43);
  assert.equal(PHYSICS.farWicket, 21.4);
});

test('all 8,640 spectators use 17,280 far triangles, cullable sections and movement-only LOD', () => {
  const placements = Array.from({ length: S.tiers * S.rows * S.columns }, (_, i) => {
    const angle = i % S.columns / S.columns * Math.PI * 2;
    return { angle, position: new THREE.Vector3(Math.sin(angle) * S.innerRadius, 1, 10 + Math.cos(angle) * S.innerRadius),
      scale: 1, turn: 0, palette: i % 7, skin: i % 5, pose: i % 3, detail: i < S.columns };
  });
  const source = asset(), atlas = new THREE.Texture(), mask = new THREE.Texture();
  const crowd = new StadiumCrowd(source, placements, atlas, mask);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 5, 10);
  crowd.update(1, false, camera);
  assert.equal(crowd.count, 8640);
  assert.equal(crowd.farTriangles, 17280);
  assert.equal(crowd.batches.filter(batch => batch.visible).length, CROWD_SECTORS);
  assert.ok(crowd.batches.every(batch => batch.frustumCulled && !batch.castShadow));
  const versions = crowd.batches.map(batch => batch.instanceMatrix.version);
  for (let i = 0; i < 60; i++) crowd.update(i, false, camera);
  assert.equal(crowd.updateCount, 1);
  assert.deepEqual(crowd.batches.map(batch => batch.instanceMatrix.version), versions);
  camera.position.set(0, 4, 65);
  crowd.update(2, false, camera);
  assert.ok(crowd.sectors.some(sector => sector.close.some(batch => batch.visible)));
  const frozen = crowd.motion.value;
  crowd.update(20, false, camera, true);
  assert.equal(crowd.motion.value, frozen);
  crowd.update(20, true, camera);
  assert.equal(crowd.motion.value, 0);
  disposeResources([crowd.group, source.scene]);
});
