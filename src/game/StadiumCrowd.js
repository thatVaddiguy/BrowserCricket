import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STADIUM } from './config.js';

const SHIRTS = ['#b0a167', '#e25f44', '#5f9ddb', '#eeebe0', '#457f5b', '#ca9bbc', '#252f42'];
const SKIN_TINT = ['#ffffff', '#e2c3a3', '#b39278', '#816951', '#efd8c1'];
export const CROWD_SECTORS = STADIUM.sectors;
export const CROWD_NEAR_DISTANCE = 18;

/** One vertex-coloured human per pose, not seven material draws. */
export function crowdGeometry(variant, sampleTexture = () => null, include = () => true) {
  const parts = [];
  variant.traverse(source => {
    if (!source.isMesh || !include(source)) return;
    const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
    const material = source.material;
    const shirt = /Kit_Fabric|Fielding_Fabric/.test(material.name);
    const skin = /Rocketbox_(Head|Skin)|Skin_Pores/.test(material.name);
    const colors = [], tint = [];
    const color = new THREE.Color();
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      const texel = !shirt && uv && sampleTexture(material.map, uv.getX(i), uv.getY(i));
      color.copy(material.color);
      if (texel) color.multiply(new THREE.Color().setRGB(...texel, THREE.SRGBColorSpace));
      if (shirt) color.set('#ffffff');
      colors.push(color.r, color.g, color.b);
      tint.push(shirt ? 1 : 0, skin ? 1 : 0);
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal'].includes(name)) geometry.deleteAttribute(name);
    }
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('crowdTint', new THREE.Float32BufferAttribute(tint, 2));
    parts.push(geometry.toNonIndexed());
    geometry.dispose();
  });
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}

function textureSampler() {
  const images = new Map();
  return (texture, u, v) => {
    if (!texture?.image) return null;
    if (!images.has(texture)) {
      const canvas = document.createElement('canvas');
      canvas.width = texture.image.width; canvas.height = texture.image.height;
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(texture.image, 0, 0);
      images.set(texture, c.getImageData(0, 0, canvas.width, canvas.height));
    }
    const image = images.get(texture);
    const x = Math.min(image.width - 1, Math.floor(((u % 1 + 1) % 1) * image.width));
    const y = Math.min(image.height - 1, Math.floor(((v % 1 + 1) % 1) * image.height));
    const offset = (y * image.width + x) * 4;
    return [image.data[offset] / 255, image.data[offset + 1] / 255, image.data[offset + 2] / 255];
  };
}

function instanceGeometry(geometry, people) {
  const copy = geometry.clone();
  const shirts = [], skin = [], poses = [], detail = [];
  for (const person of people) {
    const shirt = new THREE.Color(SHIRTS[person.palette % SHIRTS.length]);
    const face = new THREE.Color(SKIN_TINT[person.skin % SKIN_TINT.length]);
    shirts.push(shirt.r, shirt.g, shirt.b); skin.push(face.r, face.g, face.b);
    poses.push(person.pose); detail.push(person.detail ? 1 : 0);
  }
  copy.setAttribute('audienceShirt', new THREE.InstancedBufferAttribute(new Float32Array(shirts), 3));
  copy.setAttribute('audienceSkin', new THREE.InstancedBufferAttribute(new Float32Array(skin), 3));
  copy.setAttribute('audiencePose', new THREE.InstancedBufferAttribute(new Float32Array(poses), 1));
  copy.setAttribute('audienceDetail', new THREE.InstancedBufferAttribute(new Float32Array(detail), 1));
  return copy;
}

const ATTRIBUTES = `
  attribute vec3 audienceShirt;
  attribute vec3 audienceSkin;
`;

/** Culled sectors, 2-triangle impostors, 3D only near the camera. */
export class StadiumCrowd {
  constructor(asset, placements, atlas, mask) {
    this.group = new THREE.Group();
    this.group.name = 'Library_Stadium_Crowd';
    this.count = placements.length;
    this.motion = { value: 0 };
    this.batches = [];
    this.sectors = [];
    asset.scene.updateMatrixWorld(true);
    const sample = textureSampler();
    const poses = new Map();
    const heads = new Map();
    asset.scene.children.forEach(variant => {
      const pose = variant.name.includes('cheering') ? 0 : variant.name.includes('clapping') ? 1 : 2;
      const isHead = source => source.material.name.startsWith('Rocketbox_Head');
      poses.set(pose, crowdGeometry(variant, sample, source => !isHead(source)));
      variant.traverse(source => {
        if (source.isMesh && isHead(source)) heads.set(pose, {
          geometry: source.geometry.clone().applyMatrix4(source.matrixWorld),
          material: source.material,
        });
      });
    });
    const plane = new THREE.PlaneGeometry(1.05, 2.1).translate(0, 1.05, 0);
    const dummy = new THREE.Object3D();
    for (let sectorId = 0; sectorId < CROWD_SECTORS; sectorId++) {
      const people = placements.filter(p => Math.floor(p.angle / (2 * Math.PI) * CROWD_SECTORS) === sectorId);
      const nearEnabled = { value: 0 };
      const far = new THREE.MeshBasicMaterial({
        map: atlas, alphaTest: 0.35, side: THREE.DoubleSide, toneMapped: false,
      });
      // Exposed for normal resource disposal; the shader owns this sampler.
      far.crowdMask = mask;
      far.onBeforeCompile = shader => {
        shader.uniforms.crowdMask = { value: mask };
        shader.uniforms.nearEnabled = nearEnabled;
        shader.vertexShader = `${ATTRIBUTES}
          attribute float audiencePose;
          attribute float audienceDetail;
          varying vec3 shirtTint;
          varying vec3 skinTint;
          varying float poseIndex;
          varying float detailPerson;\n${shader.vertexShader}`;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          shirtTint = audienceShirt; skinTint = audienceSkin;
          poseIndex = audiencePose; detailPerson = audienceDetail;
        `).replace('#include <project_vertex>', `
          vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float size = length(instanceMatrix[0].xyz);
          vec3 toEye = cameraPosition - center.xyz;
          vec3 right = normalize(vec3(toEye.z, 0.0, -toEye.x) + vec3(0.00001, 0.0, 0.0));
          vec3 world = center.xyz + right * position.x * size + vec3(0.0, position.y * size, 0.0);
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        `);
        shader.fragmentShader = `
          uniform sampler2D crowdMask;
          uniform float nearEnabled;
          varying vec3 shirtTint;
          varying vec3 skinTint;
          varying float poseIndex;
          varying float detailPerson;\n${shader.fragmentShader}`;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          if (nearEnabled > 0.5 && detailPerson > 0.5) discard;
          vec2 spriteUv = vec2((vMapUv.x + poseIndex) / 3.0, vMapUv.y);
          vec4 texel = texture2D(map, spriteUv);
          vec2 tint = texture2D(crowdMask, spriteUv).rg;
          texel.rgb *= mix(vec3(1.0), shirtTint, tint.r) * mix(vec3(1.0), skinTint, tint.g);
          diffuseColor *= texel;
        `);
      };
      far.customProgramCacheKey = () => 'crowd-baked-billboards-v1';
      const addBatch = (geometry, material, members) => {
        const batch = new THREE.InstancedMesh(instanceGeometry(geometry, members), material, members.length);
        members.forEach((person, i) => {
          dummy.position.copy(person.position);
          dummy.scale.setScalar(person.scale);
          dummy.rotation.set(0, person.angle + Math.PI + person.turn, 0);
          dummy.updateMatrix(); batch.setMatrixAt(i, dummy.matrix);
        });
        batch.instanceMatrix.needsUpdate = true;
        batch.computeBoundingSphere();
        batch.name = `Crowd_Sector_${sectorId}`;
        batch.receiveShadow = false;
        this.group.add(batch); this.batches.push(batch);
        return batch;
      };
      addBatch(plane, far, people);
      const close = [];
      for (const [pose, geometry] of poses) {
        const members = people.filter(p => p.detail && p.pose === pose);
        if (!members.length) continue;
        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        material.onBeforeCompile = shader => {
          shader.uniforms.crowdTime = this.motion;
          shader.vertexShader = `${ATTRIBUTES}
            attribute vec2 crowdTint;
            uniform float crowdTime;\n${shader.vertexShader}`;
          shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `
            #include <color_vertex>
            vColor.rgb *= mix(vec3(1.0), audienceShirt, crowdTint.x)
              * mix(vec3(1.0), audienceSkin, crowdTint.y);
          `).replace('#include <begin_vertex>', `
            #include <begin_vertex>
            transformed.x += sin(crowdTime * 2.0 + instanceMatrix[3].x)
              * smoothstep(0.7, 1.5, transformed.y) * 0.015;
          `);
        };
        material.customProgramCacheKey = () => 'crowd-near-colours-v1';
        const batch = addBatch(geometry, material, members);
        batch.visible = false;
        close.push(batch);
        const head = heads.get(pose);
        if (head) {
          // Keep photographic features: vertex colours cannot represent eyes/lips well.
          const face = new THREE.MeshLambertMaterial({ map: head.material.map, color: head.material.color });
          face.onBeforeCompile = shader => {
            shader.uniforms.crowdTime = this.motion;
            shader.vertexShader = `
              attribute vec3 audienceSkin;
              varying vec3 faceTint;
              uniform float crowdTime;\n${shader.vertexShader}`;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
              #include <begin_vertex>
              faceTint = audienceSkin;
              transformed.x += sin(crowdTime * 2.0 + instanceMatrix[3].x)
                * smoothstep(0.7, 1.5, transformed.y) * 0.015;
            `);
            shader.fragmentShader = `varying vec3 faceTint;\n${shader.fragmentShader}`;
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
              #include <map_fragment>
              diffuseColor.rgb *= faceTint;
            `);
          };
          face.customProgramCacheKey = () => 'crowd-near-textured-head-v1';
          const headBatch = addBatch(head.geometry, face, members);
          headBatch.visible = false;
          close.push(headBatch);
        }
      }
      this.sectors.push({ close, nearEnabled, people: people.filter(p => p.detail) });
    }
    plane.dispose(); poses.forEach(geometry => geometry.dispose());
    heads.forEach(head => head.geometry.dispose());
    this.farTriangles = placements.length * 2;
    this.updateCount = 0;
  }

  update(time, reducedMotion, camera, paused = false) {
    if (!paused) this.motion.value = reducedMotion ? 0 : time;
    // No per-person animation/matrix uploads. LOD checks are movement-throttled.
    if (this.lastCamera && this.lastCamera.distanceToSquared(camera.position) < 0.25) return;
    this.lastCamera ??= new THREE.Vector3();
    this.lastCamera.copy(camera.position);
    this.updateCount++;
    for (const sector of this.sectors) {
      const visible = sector.people.some(p => p.position.distanceToSquared(camera.position) < CROWD_NEAR_DISTANCE ** 2);
      sector.nearEnabled.value = visible ? 1 : 0;
      sector.close.forEach(batch => { batch.visible = visible; });
    }
  }
}
