import * as THREE from 'three';
import { PlayerRig } from './PlayerRig.js';
import { loadCharacterAssets, disposeResources } from './CharacterAssets.js';
import { StadiumCrowd } from './StadiumCrowd.js';
import { StadiumScoreboard } from './StadiumScoreboard.js';
import { PHYSICS as P, STADIUM as S, FIELD_POSITIONS, clamp, seededRandom } from './config.js';

const TAU = Math.PI * 2;
const makeMaterial = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture() {
  return canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#fffbe6e0'); g.addColorStop(0.15, '#fff9d26f');
    g.addColorStop(0.45, '#fff8d721'); g.addColorStop(1, '#fff8d700');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
}

function mesh(parent, geometry, material, position = [0, 0, 0], shadow = false) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.castShadow = shadow;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function flatBox(parent, material, x, z, width, depth, y = 0.021) {
  return mesh(parent, new THREE.BoxGeometry(width, 0.012, depth), material, [x, y, z]);
}

/** Owns WebGL and visual assets only. CricketEngine owns every gameplay decision. */
export class CricketScene {
  constructor(container, { runupSeconds, ballsPerOver } = {}) {
    this.container = container;
    this.disposed = false;
    this.runupSeconds = runupSeconds;
    this.ballsPerOver = ballsPerOver ?? 6;
    this.assetStatus = 'loading';
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Live 3D WebGL cricket field. Arrow keys control your bat.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#435e61');
    this.scene.fog = new THREE.FogExp2('#405454', 0.005);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camera.position.set(-0.5, 5.8, -11.7);
    this.cameraTarget = new THREE.Vector3(0, 0.7, 13);
    this.desiredCamera = new THREE.Vector3();
    this.desiredTarget = new THREE.Vector3();
    this.hitCameraDirection = new THREE.Vector2(0, 1);
    this.lastPhase = null;
    this.camera.lookAt(this.cameraTarget);
    this.glowMap = glowTexture();
    this.buildLighting();
    this.buildGround();
    this.buildStadium();
    this.buildPlayers();
    this.buildWickets();
    this.buildBall();
    this.buildEffects();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.assetsReady = loadCharacterAssets().then(assets => {
      if (this.disposed) {
        disposeResources(Object.values(assets).flatMap(asset => asset.scene ? [asset.scene] : []),
          Object.values(assets).filter(asset => asset.isTexture));
        return;
      }
      this.assets = assets;
      this.batter.attach(assets.batter);
      this.nonStriker.attach(assets.batter);
      this.bowler.attach(assets.fielder);
      this.fielders.forEach(rig => rig.attach(assets.fielder));
      this.crowd = new StadiumCrowd(assets.crowd, this.crowdPlacements, assets['crowd-atlas'], assets['crowd-mask']);
      this.scene.add(this.crowd.group);
      this.assetStatus = 'ready';
      this.needsRender = true;
    }).catch(error => {
      this.assetStatus = 'error';
      throw error;
    });
  }

  buildLighting() {
    this.scene.add(new THREE.HemisphereLight('#c8e1ed', '#657148', 1.85));
    const key = new THREE.DirectionalLight('#fff1d5', 2.4);
    key.position.set(-15, 28, -10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -32; key.shadow.camera.right = 32;
    key.shadow.camera.top = 48; key.shadow.camera.bottom = -24;
    key.shadow.camera.near = 1; key.shadow.camera.far = 100;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.022;
    key.target.position.set(0, 0, 12);
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight('#b4d8f5', 0.7);
    fill.position.set(20, 18, 30);
    this.scene.add(fill);
    // A procedural sky dome, with no network texture.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(130, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#142c48') },
        bottom: { value: new THREE.Color('#63828b') },
      },
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vPosition; void main(){float t=smoothstep(-0.1,0.85,normalize(vPosition).y);gl_FragColor=vec4(mix(bottom,top,t),1.0);}',
    }));
    this.scene.add(sky);
  }

  buildGround() {
    const rng = seededRandom(2706);
    const grassTexture = canvasTexture(512, 512, (c, w, h) => {
      c.fillStyle = '#5b8243'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 27000; i++) {
        c.fillStyle = rng() < 0.5 ? '#24432927' : '#bfd48c23';
        c.fillRect(rng() * w, rng() * h, 0.6 + rng() * 1.5, 1 + rng() * 2);
      }
    });
    grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(12, 12);
    grassTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const ground = mesh(this.scene, new THREE.CircleGeometry(S.innerRadius - 0.5, 128),
      makeMaterial('#b7c98a', { map: grassTexture }), [0, -0.018, P.fieldCenterZ]);
    ground.rotation.x = -Math.PI / 2;
    const mowing = new THREE.MeshBasicMaterial({ color: '#d4e5af', transparent: true, opacity: 0.065, depthWrite: false });
    for (let z = P.fieldCenterZ - S.innerRadius + 6; z < P.fieldCenterZ + S.innerRadius - 3; z += 10) {
      const edge = Math.abs(z - P.fieldCenterZ) + 2.5;
      const width = 2 * Math.sqrt((S.innerRadius - 0.5) ** 2 - edge ** 2);
      const band = mesh(this.scene, new THREE.PlaneGeometry(width, 5), mowing, [0, -0.010, z]);
      band.rotation.x = -Math.PI / 2;
    }
    const pitchTexture = canvasTexture(512, 1024, (c, w, h) => {
      c.fillStyle = '#bca16b'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 22000; i++) {
        c.fillStyle = rng() < 0.5 ? '#775e3f30' : '#f4dda72a';
        c.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 3);
      }
      for (let i = 0; i < 38; i++) {
        c.strokeStyle = '#59472f32'; c.lineWidth = 1;
        const x = rng() * w, y = rng() * h;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + rng() * 9, y + 12 + rng() * 26); c.stroke();
      }
      c.fillStyle = '#806a4727'; c.fillRect(w * 0.32, 0, w * 0.35, h);
    });
    pitchTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const squareTexture = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#85905a'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 8000; i++) {
        c.fillStyle = rng() < 0.6 ? '#42552c32' : '#c5b5842a';
        c.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
      }
    });
    squareTexture.wrapS = squareTexture.wrapT = THREE.RepeatWrapping;
    squareTexture.repeat.set(3, 7);
    flatBox(this.scene, makeMaterial('#c2c78f', { map: squareTexture }), 0, 10.5, 8.6, 26, -0.004);
    flatBox(this.scene, makeMaterial('#fff4d8', { map: pitchTexture }), 0, 10.5, 3.10, 24.2, 0.010);
    const creasePaint = makeMaterial('#f5f2de');
    for (const z of [P.crease, 20.1]) flatBox(this.scene, creasePaint, 0, z, 3.6, 0.047);
    for (const z of [0, 21.4]) {
      flatBox(this.scene, creasePaint, 0, z, 2.68, 0.042);
      for (const x of [-1.34, 1.34]) flatBox(this.scene, creasePaint, x, z, 0.045, 2.65);
    }
    const rope = mesh(this.scene, new THREE.TorusGeometry(P.boundaryRadius, 0.065, 6, 160),
      makeMaterial('#e7ddae'), [0, 0.065, P.fieldCenterZ]);
    rope.rotation.x = -Math.PI / 2;
    const circlePoints = [];
    for (let i = 0; i <= 140; i++) circlePoints.push(new THREE.Vector3(
      Math.sin(i / 140 * TAU) * 25, 0.014, 10 + Math.cos(i / 140 * TAU) * 25));
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints),
      new THREE.LineDashedMaterial({ color: '#b7c89c', dashSize: 0.3, gapSize: 0.32, transparent: true, opacity: 0.45 })));
    this.scene.children.at(-1).computeLineDistances();
    const branding = canvasTexture(512, 128, (c, w, h) => {
      c.font = '900 94px Arial'; c.fillStyle = '#f0ecd2'; c.textAlign = 'center';
      c.fillText('CREASE.', w / 2, 102);
    });
    const brand = mesh(this.scene, new THREE.PlaneGeometry(7, 1.75),
      new THREE.MeshBasicMaterial({ map: branding, transparent: true, opacity: 0.28, depthWrite: false }), [5.5, 0.012, 11]);
    brand.rotation.x = -Math.PI / 2;
    this.targetRing = mesh(this.scene, new THREE.RingGeometry(0.47, 0.50, 64),
      new THREE.MeshBasicMaterial({ color: '#d9ef87', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }), [0, 0.03, P.crease]);
    this.targetRing.rotation.x = -Math.PI / 2;
  }

  buildStadium() {
    const rng = seededRandom(8428);
    const structure = makeMaterial('#233c40', { roughness: 0.98 });
    const tierMaterial = makeMaterial('#657774');
    const riserMaterial = makeMaterial('#324c4a');
    for (let tier = 0; tier < S.tiers; tier++) {
      const inner = S.innerRadius + tier * S.tierDepth, outer = inner + S.tierDepth + 0.05;
      const y = 0.8 + tier * S.tierRise;
      const ring = mesh(this.scene, new THREE.RingGeometry(inner, outer, 128), tierMaterial, [0, y, P.fieldCenterZ]);
      ring.rotation.x = -Math.PI / 2;
      const wall = mesh(this.scene, new THREE.CylinderGeometry(inner, inner, 1.6, 128, 1, true),
        riserMaterial, [0, y - 0.8, P.fieldCenterZ]);
      wall.material.side = THREE.DoubleSide;
    }
    const { rows, columns, tiers, sectors } = S;
    const count = tiers * rows * columns;
    const seatGeometry = new THREE.BoxGeometry(0.50, 0.34, 0.46);
    // Separate static seat buffers keep the larger bowl frustum-cullable.
    this.seatBatches = Array.from({ length: sectors }, () =>
      new THREE.InstancedMesh(seatGeometry, structure, count / sectors));
    const indices = Array(sectors).fill(0);
    this.crowdPlacements = [];
    const dummy = new THREE.Object3D();
    for (let tier = 0; tier < tiers; tier++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const angle = col / columns * TAU;
          const radius = S.innerRadius + 0.3 + tier * S.tierDepth + row * S.rowDepth;
          dummy.position.set(Math.sin(angle) * radius, 1.12 + tier * S.tierRise + row * S.rowRise,
            P.fieldCenterZ + Math.cos(angle) * radius);
          dummy.rotation.set(0, angle, 0);
          dummy.updateMatrix();
          const sector = Math.floor(col * sectors / columns);
          this.seatBatches[sector].setMatrixAt(indices[sector]++, dummy.matrix);
          dummy.position.y -= 0.32;
          this.crowdPlacements.push({
            position: dummy.position.clone(), angle, scale: 0.85 + rng() * 0.15,
            turn: (rng() - 0.5) * 0.16, palette: Math.floor(rng() * 7), skin: Math.floor(rng() * 5),
            detail: tier === 0 && row === 0, pose: rng() < 0.12 ? 0 : rng() < 0.28 ? 1 : 2,
          });
        }
      }
    }
    for (const seats of this.seatBatches) {
      seats.instanceMatrix.needsUpdate = true;
      seats.computeBoundingSphere();
      this.scene.add(seats);
    }
    const roof = mesh(this.scene, new THREE.TorusGeometry(S.outerRadius, 0.36, 6, 160),
      structure, [0, S.roofHeight, P.fieldCenterZ]);
    roof.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU;
      mesh(this.scene, new THREE.CylinderGeometry(0.12, 0.17, S.roofHeight, 5), structure,
        [Math.sin(a) * S.outerRadius, S.roofHeight / 2, P.fieldCenterZ + Math.cos(a) * S.outerRadius]);
    }
    const adsTexture = canvasTexture(1024, 128, (c, w, h) => {
      c.fillStyle = '#193532'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#d9ef87'; c.font = 'bold 60px Arial'; c.textAlign = 'center';
      c.fillText('CREASE.  /  FIND YOUR MOMENT', w / 2, 85);
      c.fillStyle = '#d9ef87'; c.fillRect(0, 0, w, 3);
    });
    adsTexture.wrapS = THREE.RepeatWrapping; adsTexture.repeat.x = 16;
    const boards = mesh(this.scene, new THREE.CylinderGeometry(S.innerRadius - 1, S.innerRadius - 1, 0.9, 160, 1, true),
      new THREE.MeshBasicMaterial({ map: adsTexture, side: THREE.DoubleSide }), [0, 0.58, P.fieldCenterZ]);
    boards.rotation.y = 0.12;
    for (const angle of [-0.58, 0.58, 2.2, -2.2]) {
      const x = Math.sin(angle) * S.outerRadius, z = P.fieldCenterZ + Math.cos(angle) * S.outerRadius;
      const lightHeight = 24.5;
      mesh(this.scene, new THREE.CylinderGeometry(0.15, 0.30, lightHeight, 8), structure, [x, lightHeight / 2, z]);
      const head = new THREE.Group(); head.position.set(x, lightHeight, z); head.lookAt(0, 4, P.fieldCenterZ);
      mesh(head, new THREE.BoxGeometry(4.2, 1.3, 0.22), structure);
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 6; col++) {
          mesh(head, new THREE.BoxGeometry(0.46, 0.37, 0.12),
            new THREE.MeshBasicMaterial({ color: '#fff5d3' }), [-1.65 + col * 0.66, -0.33 + row * 0.65, 0.16]);
        }
      }
      this.scene.add(head);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowMap, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      halo.position.set(x, lightHeight, z); halo.scale.set(16, 16, 1); this.scene.add(halo);
    }
    this.scoreboard = new StadiumScoreboard(this.ballsPerOver);
    const boardY = S.roofHeight + 1.5, boardZ = P.fieldCenterZ + S.outerRadius - 3.5;
    mesh(this.scene, new THREE.BoxGeometry(S.scoreboardWidth + 0.7, S.scoreboardHeight + 0.5, 0.30),
      structure, [0, boardY, boardZ]);
    this.scoreboardPosition = new THREE.Vector3(0, boardY, boardZ - 0.19);
    const board = mesh(this.scene, new THREE.PlaneGeometry(S.scoreboardWidth, S.scoreboardHeight),
      new THREE.MeshBasicMaterial({ map: this.scoreboard.texture }), this.scoreboardPosition.toArray());
    board.rotation.y = Math.PI;
  }

  buildPlayers() {
    this.batter = new PlayerRig('batter');
    // Three.js looks toward +Z, so camera-right is -X. Reflect game-space X
    // at the rendering boundary so Left/Right remain intuitive on screen.
    this.batter.group.scale.x = -1;
    this.batter.group.position.set(0.57, 0.03, 0.78);
    this.batter.group.rotation.y = -0.12;
    this.scene.add(this.batter.group);
    this.nonStriker = new PlayerRig('batter');
    this.nonStriker.group.scale.x = -1;
    this.nonStriker.group.position.set(-0.65, 0.03, P.farCrease);
    this.nonStriker.group.rotation.y = Math.PI;
    this.scene.add(this.nonStriker.group);
    this.bowler = new PlayerRig('bowler');
    this.bowler.group.scale.x = -1;
    this.bowler.group.rotation.y = Math.PI;
    this.scene.add(this.bowler.group);
    this.fielders = FIELD_POSITIONS.map(() => {
      const rig = new PlayerRig('fielder');
      rig.group.scale.x = -1;
      // Faraway fielders use inexpensive contact shadows, not 150 additional
      // meshes in the dynamic shadow pass.
      rig.group.traverse(object => { if (object.isMesh) object.castShadow = false; });
      this.scene.add(rig.group);
      return rig;
    });
    const shadowMap = canvasTexture(64, 64, (c) => {
      const gradient = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, '#09221490'); gradient.addColorStop(1, '#09221400');
      c.fillStyle = gradient; c.fillRect(0, 0, 64, 64);
    });
    this.fielders.forEach(rig => {
      const shadow = mesh(rig.group, new THREE.PlaneGeometry(0.95, 0.60),
        new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false }), [0, 0.01, 0]);
      shadow.rotation.x = -Math.PI / 2;
    });
  }

  wicket(z) {
    const group = new THREE.Group();
    group.position.z = z;
    const stumpMaterial = makeMaterial('#e0bf80', { roughness: 0.58 });
    for (const x of [-0.112, 0, 0.112]) {
      mesh(group, new THREE.CylinderGeometry(0.018, 0.020, 0.74, 12), stumpMaterial, [x, 0.38, 0], true);
      for (const y of [0.14, 0.45]) {
        mesh(group, new THREE.CylinderGeometry(0.019, 0.019, 0.015, 12),
          makeMaterial('#88703f'), [x, y, 0]);
      }
    }
    const bails = [-0.074, 0.074].map(x => {
      const bail = mesh(group, new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8), stumpMaterial, [x, 0.77, 0], true);
      bail.rotation.z = Math.PI / 2;
      return bail;
    });
    this.scene.add(group);
    return { group, bails };
  }

  buildWickets() {
    this.nearWicket = this.wicket(0);
    this.farWicket = this.wicket(P.farWicket);
    this.flyingBails = Array.from({ length: 2 }, () => {
      const bail = mesh(this.scene, new THREE.CylinderGeometry(0.018, 0.018, 0.19, 8), makeMaterial('#e7ca90'), [0, -10, 0], true);
      bail.visible = false;
      return bail;
    });
  }

  buildBall() {
    const rng = seededRandom(1882);
    const leather = canvasTexture(256, 128, (c, w, h) => {
      c.fillStyle = '#f3ecd9'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2400; i++) {
        c.fillStyle = i % 2 ? '#a197792e' : '#ffffff75';
        c.fillRect(rng() * w, rng() * h, 0.6, 0.6);
      }
    });
    this.ball = new THREE.Group();
    mesh(this.ball, new THREE.SphereGeometry(0.069, 24, 16),
      makeMaterial('#fffce9', { map: leather, roughness: 0.56 }));
    for (const offset of [-0.003, 0.003]) {
      mesh(this.ball, new THREE.TorusGeometry(0.069, 0.0014, 4, 48),
        makeMaterial('#b38b60'), [0, 0, offset]);
    }
    this.scene.add(this.ball);
    this.ball.visible = false;
    this.ballHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowMap, opacity: 0.34, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.ballHalo.scale.set(0.50, 0.50, 1);
    this.scene.add(this.ballHalo);
    this.ballHalo.visible = false;
  }

  buildEffects() {
    this.particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(90 * 3);
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setDrawRange(0, 0);
    this.particles = new THREE.Points(this.particleGeometry, new THREE.PointsMaterial({
      color: '#e8d598', size: 0.055, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(50 * 3);
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeometry,
      new THREE.LineBasicMaterial({ color: '#fff0bc', transparent: true, opacity: 0.38, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
  }

  resize() {
    if (this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 1 ? 58 : 48;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  render(state, time, dt) {
    if (this.disposed) return;
    this.scoreboard.update(state);
    const poseDt = state.paused ? 0 : dt;
    const running = ['flight', 'return'].includes(state.phase) && state.running.mode !== 'idle';
    const r = state.running;
    const direction = (r.completed % 2 ? -1 : 1) * (r.mode === 'returning' ? -1 : 1);
    this.batter.group.position.set(0.57, 0.03, state.batHit ? r.strikerZ : 0.78);
    this.nonStriker.group.position.set(-0.65, 0.03, r.nonStrikerZ);
    this.batter.face(running ? direction > 0 ? 0 : Math.PI : -0.12, poseDt);
    this.nonStriker.face(running ? direction > 0 ? Math.PI : 0 : Math.PI, poseDt);
    this.batter.pose(state, time, running ? r.motion : 0, poseDt, { moving: running });
    this.nonStriker.pose(null, time, running ? r.motion : 0, poseDt, { moving: running });
    const followThrough = state.phase === 'delivery' ? Math.min(state.phaseTime * 4, 1.1) : state.ball ? 1.1 : 0;
    this.bowler.group.position.set(-state.bowler.x - followThrough * 0.28, 0.025, state.bowler.z - followThrough);
    this.bowler.pose(state, time, 0, poseDt, { runupSeconds: this.runupSeconds });
    state.fielders.forEach((f, i) => {
      const rig = this.fielders[i];
      rig.group.position.set(-f.x, 0.025, f.z);
      const target = state.phase === 'return' && state.chaserId === f.id
        ? { x: 0, z: state.returnThrow.targetZ }
        : state.phase === 'flight' && state.chaserId === f.id ? f.target ?? state.ball
          : { x: 0, z: P.crease };
      rig.face(Math.atan2(-(target.x - f.x), target.z - f.z), poseDt);
      const moving = state.phase === 'flight' && Math.abs(rig.lastMotion - f.running) > 0.0001;
      rig.pose(state, time, f.running, poseDt, { fieldId: f.id, moving });
      rig.lastMotion = f.running;
    });
    const b = state.ball;
    this.ball.visible = this.ballHalo.visible = !!b;
    if (b) {
      this.ball.position.set(-b.x, b.y, b.z);
      this.ball.rotation.set(b.seam, b.seam * 0.35, b.seam * 0.2);
      this.ballHalo.position.copy(this.ball.position);
      const broadcastScale = clamp(this.camera.position.distanceTo(this.ball.position) / 17, 1, 2);
      this.ball.scale.setScalar(broadcastScale);
      this.ballHalo.scale.setScalar(0.48 * broadcastScale);
    }
    this.nearWicket.bails.forEach(bail => { bail.visible = state.brokenWicketZ !== 0; });
    this.farWicket.bails.forEach(bail => { bail.visible = state.brokenWicketZ !== P.farWicket; });
    this.flyingBails.forEach((object, i) => {
      const bail = state.bails[i];
      object.visible = !!bail;
      if (bail) {
        object.position.set(-bail.x, bail.y, bail.z);
        object.rotation.set(bail.angle * 0.7, -bail.angle * 0.3, -bail.angle);
      }
    });
    const count = Math.min(90, state.particles.length);
    for (let i = 0; i < count; i++) {
      const point = state.particles[i];
      this.particlePositions.set([-point.x, point.y, point.z], i * 3);
    }
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.setDrawRange(0, count);
    const trailCount = Math.min(50, state.trail.length);
    for (let i = 0; i < trailCount; i++) {
      const point = state.trail[i];
      this.trailPositions.set([-point.x, point.y, point.z], i * 3);
    }
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, trailCount);
    const imminent = state.phase === 'delivery' && b ? clamp(1 - (b.z - P.crease) / 5, 0, 1) : 0;
    this.targetRing.material.opacity = state.phase === 'delivery' ? 0.5 + imminent * 0.45 : 0.28;
    this.targetRing.scale.setScalar(1.25 - imminent * 0.25);
    const desiredCamera = this.desiredCamera.set(-0.5, 5.8, -11.7);
    const desiredTarget = this.desiredTarget.set(0, 0.7, 13);
    const following = b && (['flight', 'return'].includes(state.phase) || state.phase === 'result' && state.batHit);
    if (state.phase === 'flight' && this.lastPhase !== 'flight' && b) {
      this.hitCameraDirection.set(-b.vx, b.vz).normalize();
    }
    if (following) {
      desiredTarget.set(-b.x, Math.max(0.45, b.y), b.z);
      if (!this.reducedMotion) {
        // A true chase camera travels behind the struck ball, including lateral
        // shots and return throws. The minimap preserves the running context.
        desiredCamera.set(-b.x - this.hitCameraDirection.x * 13,
          Math.max(7.5, b.y + 6), b.z - this.hitCameraDirection.y * 13);
      }
    }
    const damping = 1 - Math.exp(-6 * dt);
    this.camera.position.lerp(desiredCamera, damping);
    // Smooth the camera's travel, not the aim: aim lag can leave a fast-moving
    // ball outside the portrait viewport. Reduced-motion mode keeps gentle pans.
    if (following && !this.reducedMotion) this.cameraTarget.copy(desiredTarget);
    else this.cameraTarget.lerp(desiredTarget, damping);
    if (!state.paused && !this.reducedMotion && state.shake) {
      this.camera.position.x += Math.sin(time * 73) * state.shake * 0.018;
      this.camera.position.y += Math.cos(time * 61) * state.shake * 0.009;
    }
    this.camera.lookAt(this.cameraTarget);
    this.lastPhase = state.phase;
    this.crowd?.update(time, this.reducedMotion, this.camera, state.paused);
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    [this.batter, this.nonStriker, this.bowler, ...this.fielders].forEach(rig => rig.dispose());
    const assets = Object.values(this.assets ?? {});
    disposeResources([this.scene, ...assets.flatMap(asset => asset.scene ? [asset.scene] : [])],
      assets.filter(asset => asset.isTexture));
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
