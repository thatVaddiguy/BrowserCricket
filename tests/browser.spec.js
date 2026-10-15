import { test, expect } from '@playwright/test';

async function openGame(page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const scene = window.__CREASE_DEV__?.scene;
    return scene?.assetStatus === 'ready' && !scene.needsRender;
  });
}

test('difficulty selection starts a new level, queues changes and preserves an innings on resume', async ({ page }) => {
  await openGame(page);
  await page.locator('#modal-difficulty').selectOption('easy');
  await expect(page.getByTestId('active-difficulty')).toHaveText('Easy');
  await page.getByRole('button', { name: 'Take the crease' }).click();
  const speed = await page.evaluate(() => window.__CREASE_DEV__.engine.state.delivery.speed);
  expect(speed).toBeLessThan(120);
  await page.getByRole('button', { name: 'Pause game', exact: true }).click();
  await page.evaluate(() => {
    const { engine } = window.__CREASE_DEV__;
    engine.state.score = 7;
    engine.consumeEvents();
  });
  await page.locator('#modal-difficulty').selectOption('hard');
  await expect(page.getByTestId('active-difficulty')).toHaveText('Easy');
  await expect(page.getByTestId('game-modal')).toContainText('Resume keeps Easy');
  await page.getByRole('button', { name: 'Back to the crease' }).click();
  await expect(page.getByTestId('score')).toHaveText('7');
  await expect(page.getByTestId('active-difficulty')).toHaveText('Easy');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByTestId('active-difficulty')).toHaveText('Hard');
  await expect(page.getByTestId('score')).toHaveText('0');
  expect(await page.evaluate(() => window.__CREASE_DEV__.engine.state.delivery.speed)).toBeGreaterThan(160);
});

test('small-screen difficulty and start controls remain reachable in the intro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 660 });
  await openGame(page);
  await page.locator('#modal-difficulty').selectOption('hard');
  const start = page.getByRole('button', { name: 'Take the crease' });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeInViewport();
  await start.click();
  await expect(page.getByTestId('game-modal')).toHaveCount(0);
  await expect(page.getByTestId('active-difficulty')).toHaveText('Hard');
});

test('Blender skins, independent skeletons, animation contact and instanced people load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openGame(page);
  const report = await page.evaluate(() => {
    const { scene, engine } = window.__CREASE_DEV__;
    const meshes = [];
    scene.batter.model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const firstBone = meshes[0].skeleton.bones[0];
    let shared = false;
    scene.nonStriker.model.traverse(o => {
      if (o.isSkinnedMesh && o.skeleton.bones.includes(firstBone)) shared = true;
    });
    engine.state.swing = { direction: 'up', time: .105 };
    scene.render(engine.state, 1, .05);
    const time = scene.batter.animationTime;
    const weight = scene.batter.weights.get('drive_up');
    engine.state.paused = true;
    scene.render(engine.state, 1, .05);
    return {
      skins: meshes.length, bones: meshes[0].skeleton.bones.length, shared,
      crowd: scene.crowd.count, batches: scene.crowd.batches.length,
      seats: scene.seatBatches.map(batch => ({ count: batch.count, culled: batch.frustumCulled,
        radius: batch.boundingSphere.radius })),
      time, weight, pausedTime: scene.batter.animationTime,
    };
  });
  expect(report.skins).toBeGreaterThan(0);
  expect(report.bones).toBe(19);
  expect(report.shared).toBe(false);
  expect(report.crowd).toBe(8640);
  expect(report.seats).toHaveLength(12);
  expect(report.seats.reduce((sum, batch) => sum + batch.count, 0)).toBe(8640);
  expect(report.seats.every(batch => batch.culled && batch.radius < 35)).toBe(true);
  expect(report.batches).toBeLessThanOrEqual(84); // 12 far, 36 near bodies, 36 textured heads.
  expect(report.time).toBeCloseTo(.105, 5);
  expect(report.pausedTime).toBe(report.time);
  expect(report.weight).toBe(1);
  expect(errors).toEqual([]);
});

test('Blender player and crowd close-ups render with valid WebGL materials', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openGame(page);
  await page.addStyleTag({ content: '.modal-layer { display: none !important; }' });
  await page.evaluate(() => {
    const { scene, engine } = window.__CREASE_DEV__;
    scene.batter.pose(engine.state, 0, 0, 1, { moving: false });
    engine.state.paused = true;
    scene.needsRender = false;
    scene.camera.position.set(2.5, 2.0, 4.0);
    scene.camera.lookAt(.5, 1.1, .8);
    scene.renderer.render(scene.scene, scene.camera);
  });
  await page.screenshot({ path: 'test-results/crease-player-detail.png' });
  await page.evaluate(() => {
    const { scene } = window.__CREASE_DEV__;
    scene.camera.position.set(0, 5.0, 65);
    scene.camera.lookAt(0, 4.4, 75);
    scene.crowd.update(0, true, scene.camera, true);
    scene.renderer.render(scene.scene, scene.camera);
  });
  await page.screenshot({ path: 'test-results/crease-crowd-detail.png' });
  expect(errors).toEqual([]);
});

test('crowd uses a bounded impostor budget and the stadium board shows live batting statistics', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openGame(page);
  const report = await page.evaluate(() => {
    const { scene, engine } = window.__CREASE_DEV__;
    engine.state.paused = true;
    scene.camera.position.set(0, 5, 10);
    scene.camera.lookAt(0, 8, 60);
    scene.crowd.update(0, true, scene.camera, true);
    scene.renderer.render(scene.crowd.group, scene.camera);
    const performance = { ...scene.renderer.info.render };
    const version = scene.scoreboard.texture.version;
    scene.scoreboard.update(engine.state);
    const unchanged = scene.scoreboard.texture.version === version;
    engine.reset();
    engine.finishBall(6, false, 'boundary');
    engine.state.paused = true;
    scene.render(engine.state, 0, 0);
    const scored = structuredClone(scene.scoreboard.data);
    engine.beginDelivery(); engine.finishBall(1); engine.beginDelivery();
    scene.scoreboard.update(engine.state);
    const striker = scene.scoreboard.data.batsmen[0].name;
    engine.reset(false);
    engine.state.paused = true;
    scene.render(engine.state, 0, 0);
    return { performance, unchanged, scored, striker, reset: scene.scoreboard.data };
  });
  expect(report.performance.triangles).toBeLessThanOrEqual(17280);
  expect(report.performance.calls).toBeLessThanOrEqual(12);
  await test.info().attach('crowd-and-scoreboard-report', {
    body: JSON.stringify(report, null, 2), contentType: 'application/json',
  });
  expect(report.unchanged).toBe(true);
  expect(report.scored.score).toBe(6);
  expect(report.scored.overs).toBe('0.1');
  expect(report.scored.batsmen[0]).toMatchObject({ name: 'Arjun Rao', runs: 6, balls: 1, sixes: 1 });
  expect(report.striker).toBe('Sam Ellis');
  expect(report.reset.score).toBe(0);
  expect(report.reset.batsmen[0].balls).toBe(0);
  await page.addStyleTag({ content: '.modal-layer { display: none !important; }' });
  await page.evaluate(() => {
    const { scene, engine } = window.__CREASE_DEV__;
    engine.reset(); engine.finishBall(4, false, 'boundary'); engine.state.paused = true;
    scene.scoreboard.update(engine.state);
    scene.camera.position.copy(scene.scoreboardPosition);
    scene.camera.position.z -= 29;
    scene.camera.lookAt(scene.scoreboardPosition);
    scene.crowd.update(0, true, scene.camera, true);
    scene.renderer.render(scene.scene, scene.camera);
    engine.consumeEvents();
    scene.needsRender = false;
  });
  await page.screenshot({ path: 'test-results/crease-live-scoreboard.png' });
  expect(errors).toEqual([]);
});

test('a missing character asset shows a usable fallback without unhandled errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/models/batter.glb', route => route.fulfill({ status: 404, body: 'Missing asset' }));
  await page.goto('/');
  await expect(page.getByText('PLAYER ASSETS UNAVAILABLE')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('link', { name: /Play classic Canvas version/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading players' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('WebGL stadium renders, keyboard swings, pauses, and restarts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openGame(page);
  await expect(page.getByRole('heading', { name: 'Own the crease.' })).toBeVisible();
  await expect(page.locator('.webgl-scene canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.__CREASE_DEV__?.scene.renderer.info.render.calls > 0);
  const info = await page.evaluate(() => ({
    webgl: window.__CREASE_DEV__.scene.renderer.getContext() instanceof WebGL2RenderingContext,
    triangles: window.__CREASE_DEV__.scene.renderer.info.render.triangles,
  }));
  expect(info.webgl).toBe(true);
  expect(info.triangles).toBeGreaterThan(10000);
  expect(await page.evaluate(() => {
    const { scene } = window.__CREASE_DEV__;
    return scene.batter.group.position.clone().project(scene.camera).x;
  })).toBeLessThan(0);
  await page.screenshot({ path: 'test-results/crease-desktop-intro.png' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('game-modal')).toHaveCount(0);
  await expect(page.getByTestId('arena')).toHaveAttribute('data-phase', 'runup');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('feedback')).toContainText('Too Early');
  await page.keyboard.press('p');
  await expect(page.getByRole('heading', { name: 'Time out.' })).toBeVisible();
  await expect(page.getByTestId('arena')).toHaveAttribute('data-paused', 'true');
  const before = await page.evaluate(() => window.__CREASE_DEV__.engine.state.phaseTime);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__CREASE_DEV__.engine.state.phaseTime)).toBe(before);
  await page.keyboard.press('p');
  await expect(page.getByTestId('game-modal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByTestId('score')).toHaveText('0');
  await expect(page.getByTestId('wickets')).toHaveText('0');
  await expect(page.getByTestId('balls')).toHaveText('0');
  await page.screenshot({ path: 'test-results/crease-desktop-playing.png' });
  expect(errors).toEqual([]);
});

test('actual arrow input connects with a timed delivery and scores', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  // Set up a deterministic incoming ball; dispatch the public keyboard input,
  // then let the normal animation loop perform wind-up, contact, and flight.
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    engine.releaseBall();
    const b = engine.state.ball;
    Object.assign(b, { x: 0, y: 0.65, z: 3.19, vx: 0, vy: 1, vz: -27, ax: 0, bounced: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  await expect(page.getByTestId('feedback')).toContainText('Perfect!', { timeout: 30000 });
  await page.screenshot({ path: 'test-results/crease-perfect-contact.png' });
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 2000 && engine.state.phase !== 'result'; i++) engine.update(1 / 180);
  });
  await expect(page.getByTestId('score')).not.toHaveText('0', { timeout: 20000 });
  await expect(page.getByTestId('balls')).toHaveText('1');
});

test('three wickets show game over and restart creates a clean innings', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 3; i++) {
      engine.finishBall(0, true, 'bowled');
      for (let step = 0; step < 340; step++) engine.update(1 / 180);
    }
  });
  await expect(page.getByText('ALL OUT · INNINGS COMPLETE')).toBeVisible();
  await expect(page.getByTestId('wickets')).toHaveText('3');
  await page.screenshot({ path: 'test-results/crease-game-over.png' });
  await page.getByRole('button', { name: 'Play another innings' }).click();
  await expect(page.getByTestId('wickets')).toHaveText('0');
  await expect(page.getByTestId('balls')).toHaveText('0');
});

test('mobile layout fits without horizontal overflow and touch controls work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await page.waitForFunction(() => window.__CREASE_DEV__?.scene.renderer.info.render.calls > 0);
  await page.screenshot({ path: 'test-results/crease-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await page.locator('[data-mobile-shot="down"]').click();
  await expect(page.getByTestId('feedback')).toContainText('Too Early');
});

test('twelve balls end the innings and the sound toggle is accessible', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Turn sound on' }).click();
  await expect(page.getByRole('button', { name: 'Turn sound off' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 12; i++) {
      engine.finishBall(1);
      for (let step = 0; step < 340; step++) engine.update(1 / 180);
    }
  });
  await expect(page.getByText('12 BALLS · INNINGS COMPLETE')).toBeVisible();
  await expect(page.getByTestId('balls')).toHaveText('12');
  await expect(page.getByTestId('score')).toHaveText('12');
});

test('unsupported WebGL offers a working classic fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === 'webgl2' || type === 'webgl' ? null : getContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('WEBGL NOT AVAILABLE')).toBeVisible();
  await page.getByRole('link', { name: 'Play classic Canvas version' }).click();
  await expect(page).toHaveURL(/classic\.html$/);
  await expect(page.getByRole('heading', { name: 'Own the crease.' })).toBeVisible();
});

async function setRunningFlight(page) {
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    engine.releaseBall();
    Object.assign(engine.state, { phase: 'flight', batHit: true, shot: 'right', chaserId: 0 });
    Object.assign(engine.state.ball, {
      x: -25, z: 20, y: 0.036, vx: 0, vy: 0, vz: 0,
      hitX: 0, hitZ: 1.25, rolling: true, bounced: true,
    });
    engine.state.fielders.forEach(f => Object.assign(f, {
      x: 35, z: -10, target: { x: -25, z: 20 },
    }));
  });
  await expect(page.getByTestId('run-control')).toBeEnabled();
}

test('Space runs and cancels, repeat input is ignored, two runs score, and the minimap tracks both batters', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openGame(page);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await setRunningFlight(page);
  const initialY = Number(await page.getByTestId('map-striker').getAttribute('cy'));
  await page.keyboard.press('Space');
  await expect(page.getByTestId('run-control')).toContainText('Cancel run');
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true, bubbles: true }));
    for (let i = 0; i < 90; i++) window.__CREASE_DEV__.engine.update(1 / 180);
  });
  await page.waitForFunction(() => window.__CREASE_DEV__.engine.state.running.progress > 0.2);
  expect(await page.evaluate(() => window.__CREASE_DEV__.engine.state.running.mode)).toBe('outbound');
  await expect(page.getByTestId('arena')).toHaveAttribute('data-paused', 'false');
  await expect.poll(async () => Number(await page.getByTestId('map-striker').getAttribute('cy'))).toBeLessThan(initialY);
  await page.screenshot({ path: 'test-results/crease-running-ball-follow.png' });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('run-control')).toContainText('Run again');
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 500 && engine.state.running.mode !== 'idle'; i++) engine.update(1 / 180);
  });
  await expect(page.getByTestId('completed-runs')).toHaveText('0 RUNS');
  await expect(page.getByTestId('run-control')).toHaveAccessibleName('Run');
  for (let runs = 1; runs <= 2; runs++) {
    if (runs === 1) await page.keyboard.press('Space');
    else await page.getByTestId('run-control').click();
    await page.evaluate(target => {
      const engine = window.__CREASE_DEV__.engine;
      for (let i = 0; i < 600 && engine.state.running.completed < target; i++) engine.update(1 / 180);
    }, runs);
    await expect(page.getByTestId('completed-runs')).toHaveText(`${runs} RUN${runs === 1 ? '' : 'S'}`);
    await expect(page.getByTestId('score')).toHaveText(`${runs}`);
  }
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 3000 && engine.state.phase !== 'result'; i++) engine.update(1 / 180);
  });
  await expect(page.getByTestId('feedback')).toContainText('+2 runs');
  await expect(page.getByTestId('balls')).toHaveText('1');
  await expect(page.getByTestId('wickets')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('ball-follow camera tracks outfield hits, returning throws, and resets for the next delivery', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await setRunningFlight(page);
  await page.evaluate(() => {
    const { engine, scene } = window.__CREASE_DEV__;
    scene.render(engine.state, 2, 2);
  });
  const followed = await page.evaluate(() => {
    const { scene } = window.__CREASE_DEV__;
    return {
      target: { x: scene.cameraTarget.x, z: scene.cameraTarget.z },
      position: { x: scene.camera.position.x, z: scene.camera.position.z },
      screenBall: scene.ball.position.clone().project(scene.camera).toArray(),
    };
  });
  expect(followed.target.x).toBeCloseTo(25, 1);
  expect(followed.target.z).toBeCloseTo(20, 1);
  expect(followed.position.x).toBeGreaterThan(15);
  expect(followed.position.z).toBeGreaterThan(0);
  expect(Math.abs(followed.screenBall[0])).toBeLessThan(0.1);
  await page.evaluate(() => {
    const { engine, scene } = window.__CREASE_DEV__;
    engine.finishFielded();
    engine.update(0.7);
    scene.render(engine.state, 4, 2);
  });
  expect(await page.evaluate(() => {
    const { engine, scene } = window.__CREASE_DEV__;
    return Math.abs(scene.cameraTarget.x + engine.state.ball.x);
  })).toBeLessThan(0.1);
  await page.evaluate(() => {
    const { engine, scene } = window.__CREASE_DEV__;
    engine.beginDelivery();
    scene.render(engine.state, 6, 2);
  });
  expect(await page.evaluate(() => window.__CREASE_DEV__.scene.camera.position.z)).toBeCloseTo(-11.7, 1);
});

test('short of either crease produces visible run-out feedback and a wicket', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await setRunningFlight(page);
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 100; i++) engine.update(1 / 180);
    Object.assign(engine.state.ball, { x: 0.5, z: 21.4 });
    engine.finishFielded();
  });
  await expect(page.locator('.running-hud')).toHaveAttribute('data-danger', 'true');
  await page.screenshot({ path: 'test-results/crease-return-throw.png' });
  await page.evaluate(() => {
    const engine = window.__CREASE_DEV__.engine;
    for (let i = 0; i < 160 && engine.state.phase !== 'result'; i++) engine.update(1 / 180);
  });
  await expect(page.getByTestId('feedback')).toContainText('Run out!');
  await expect(page.getByTestId('wickets')).toHaveText('1');
  await expect(page.getByTestId('score')).toHaveText('0');
  expect(await page.evaluate(() => window.__CREASE_DEV__.scene.farWicket.bails.every(b => !b.visible))).toBe(true);
  await page.screenshot({ path: 'test-results/crease-run-out.png' });
});

test('fullscreen fills the viewport, native fullscreen toggles, and its rejection is handled', async ({ page }) => {
  await openGame(page);
  const arena = await page.getByTestId('arena').boundingBox();
  expect(arena.x).toBe(0);
  expect(arena.y).toBe(0);
  expect(arena.width).toBe(1440);
  expect(arena.height).toBe(1000);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.fullscreenElement?.classList.contains('shell'))).toBe(true);
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    document.querySelector('.shell').requestFullscreen = () => Promise.reject(new Error('Unsupported'));
  });
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect(page.getByText('Browser fullscreen is unavailable. The game still fills the window.')).toBeVisible();
});

test('mobile run control is usable and minimap stays inside the fullscreen playfield', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await page.getByRole('button', { name: 'Take the crease' }).click();
  await setRunningFlight(page);
  await page.getByTestId('run-control').click();
  await expect(page.getByTestId('run-control')).toContainText('Cancel run');
  const ballInView = await page.evaluate(() => {
    const { scene } = window.__CREASE_DEV__;
    return scene.ball.position.clone().project(scene.camera).toArray();
  });
  expect(Math.abs(ballInView[0])).toBeLessThan(0.1);
  expect(Math.abs(ballInView[1])).toBeLessThan(0.1);
  await page.screenshot({ path: 'test-results/crease-mobile-running.png' });
  const map = await page.getByTestId('running-minimap').boundingBox();
  const button = await page.getByTestId('run-control').boundingBox();
  expect(map.x).toBeGreaterThanOrEqual(0);
  expect(map.x + map.width).toBeLessThanOrEqual(390);
  expect(button.y + button.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('a chase shows the equation, finishes with a result card and remembers the personal best', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.removeItem('crease.records.v1'));
  await openGame(page);
  await page.locator('#modal-mode').selectOption('chase');
  await expect(page.getByRole('heading', { name: 'Chase it down.' })).toBeVisible();
  await page.getByRole('button', { name: 'Take the crease' }).click();
  const target = await page.evaluate(() => window.__CREASE_DEV__.engine.state.target);
  expect(target).toBeGreaterThan(0);
  await expect(page.getByTestId('target')).toHaveText(String(target));
  await expect(page.getByTestId('chase-equation')).toContainText(`${target} off 12`);
  await page.evaluate(() => {
    const { engine } = window.__CREASE_DEV__;
    engine.state.score = engine.state.target - 4;
    engine.finishBall(4, false, 'boundary');
  });
  await expect(page.getByTestId('feedback')).toContainText('Target reached!');
  await expect(page.getByRole('heading', { name: 'Chase complete.' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('game-modal')).toContainText('Won by 3 wickets with 11 balls to spare');
  await expect(page.getByTestId('innings-breakdown')).toContainText('1fours');
  await expect(page.getByTestId('record-line')).toContainText('Chases won: 1/1');
  await expect(page.getByTestId('personal-best')).toHaveText(String(target));
  await page.screenshot({ path: 'test-results/crease-chase-won.png' });
  await page.locator('#modal-format').selectOption('classic');
  await page.getByRole('button', { name: 'Play another innings' }).click();
  expect(await page.evaluate(() => window.__CREASE_DEV__.engine.maxBalls)).toBe(30);
  await expect(page.getByTestId('chase-equation')).toContainText('off 30');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crease.records.v1'))['quick:normal'].wins)).toBe(1);
  expect(errors).toEqual([]);
});
