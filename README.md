# Crease cricket game

A modular React and Three.js WebGL batting game. Play a **Quick** 12-ball
innings with three wickets or a **Classic** 30-ball innings with five, either
as a free innings or chasing a target. Players and spectators use a licensed
Rocketbox human library asset adapted in Blender to cricket rigs and equipment.
Stadium textures, wickets,
ball art, and optional sound effects are generated locally; there are no
external image, font, or audio requests.

## Requirements

- **Docker** with Docker Compose v2 (Docker Desktop on Windows and macOS, or
  Docker Engine with the Compose plugin on Linux). Docker Desktop must be running.
- A browser with JavaScript and WebGL 2 enabled for the 3D game.
- Internet access the first time you build, to download the base images and
  npm dependencies.

You do **not** need Node.js or npm on your machine: dependencies are installed
inside Linux containers, so the same commands work on Windows, macOS and Linux.

Check your installation:

```sh
docker --version
docker compose version
```

## Quick start (Docker)

1. Open a terminal in the `cricketGame` folder, where `docker-compose.yml` lives.
2. Build and start the game:

```sh
docker compose up --build
```

3. Open **`http://localhost:8080`** in your browser.
4. Click **Take the crease** or press **Enter** to start your innings.

This builds the production bundle and serves it with nginx. Press **Ctrl+C**
to stop it. To run it in the background instead, add `-d`, and stop it later
with `docker compose down`:

```sh
docker compose up --build -d
docker compose down
```

Re-run `docker compose up --build` after changing the source so the image is
rebuilt. Without `--build`, Compose reuses the last image.

### Use a different port

Edit the `ports` entry of the `game` service in `docker-compose.yml`, for
example `"9090:8080"`, then open `http://localhost:9090`.

### Develop with hot reload

The `dev` service runs the Vite development server with your source folder
mounted into the container, so edits appear in the browser immediately:

```sh
docker compose --profile dev up --build dev
```

Open **`http://localhost:5173`**. The container keeps its own Linux
`node_modules`; your host's folder (if any) is never used. File watching uses
polling because bind mounts on Windows and macOS do not deliver file events.
After changing `package.json`, rebuild with `--build` and add `-V`
(`--renew-anon-volumes`) so the container's dependencies are reinstalled.

The development build exposes `window.__CREASE_DEV__` for the browser tests;
the production `game` service does not.

### Deploy the image

The `game` image is a self-contained static site on port 8080:

```sh
docker build --target production -t crease-cricket .
docker run --rm -p 8080:8080 crease-cricket
```

It contains the whole `dist/` folder, including `dist/models/` and the
`classic.html` fallback. No model service, credentials or network textures are
needed during gameplay.

### Without Docker

If you prefer a local toolchain, install **Node.js** 20.19+ (20.x line) or
22.12+, then:

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
npm run build      # writes dist/
npm run preview    # http://127.0.0.1:4173
```

Run `npm ci` on the machine that runs the game: `node_modules` contains
platform-specific build tools, so a folder installed on Linux (or in a
container) does not work on Windows, and vice versa.

**Do not double-click `index.html`.** The React/Three.js game must be loaded
through a server (the Docker container, or the Vite server), not a `file://`
address.

## Play the classic version without installing anything

Open `classic.html` directly in your browser. This standalone Canvas version
does not need Node.js, npm, a server, or WebGL.

It is the older version of the game: the manual running, run-outs,
ball-follow camera, and running minimap described below belong to the 3D game.

## Controls

| Input | Action |
| --- | --- |
| Left arrow | Leg-side flick or on-drive |
| Right arrow | Off-side cover drive or cut |
| Up arrow | Lofted straight drive |
| Down arrow | Defensive block or leave outside the stumps |
| Enter | Start, resume, or restart at the innings screen |
| Space | Start a run; press again while running to turn back |
| P / Escape | Pause or resume (Escape also exits browser fullscreen) |
| F | Enter or exit browser fullscreen |

On-screen shot buttons also support touch. Each delivery permits one shot.
The game fills the browser window. Use the fullscreen icon or **F** to hide
browser chrome; if browser fullscreen is unavailable, window-filling play
still works. The scorecard and detailed controls open from the header icon.

After contact, **Space** (or the on-screen Run button) sends both batters to
the opposite creases. Each completed crossing adds one run to the live score.
Press again after reaching the crease to attempt another run; runs are never
queued automatically. Pressing during a crossing turns the batters back;
pressing while returning recommits them to that same run.

Fielders collect the ball and throw to the nearer wicket. Batters caught
outside their creases when the throw arrives are **run out**, even if turning
back. Previously completed runs count, but incomplete crossings do not.
Boundaries award four or six without stacking running runs; a catch cancels
all runs on that delivery. The ball-follow camera tracks hits and returns,
while the bottom-left minimap shows both runners, the fielders, and the ball.

Swing just before the ball reaches the crease ring: the bat has a short
wind-up before contact. Delivery and shot animation use cinematic time scales;
gravity, bounce restitution, swing, and spin still operate in world space.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `docker` is not found, or "cannot connect to the Docker daemon" | Install Docker Desktop (or Docker Engine) and make sure it is running, then reopen your terminal. |
| Compose cannot find a configuration file | Change to the `cricketGame` folder, where `docker-compose.yml` lives. |
| "port is already allocated" | Stop whatever uses port 8080 (or 5173 for `dev`), or change the `ports` mapping in `docker-compose.yml`. |
| The build fails while downloading | Check your internet connection, then retry `docker compose build --no-cache`. |
| Changes do not appear on port 8080 | The `game` service serves a built image: run `docker compose up --build` again, or use the `dev` service. |
| The browser cannot connect | Keep the container running (`docker compose ps`) and use `http://localhost:8080`, or `:5173` for `dev`. |
| A blank page appears after opening `index.html` | Start a container and open its HTTP address instead of the HTML file. |
| “WEBGL NOT AVAILABLE” appears | Check browser hardware acceleration / WebGL settings, or select **Play classic Canvas version**. |
| Browser fullscreen is unavailable | The game still fills the browser window. Use **F** or the fullscreen icon when the browser permits it. |
| The game pauses after changing tabs | Return to the game and press **P** or **Enter** to resume. |

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/App.jsx` | React UI, scorecard, modal screens, accessible controls |
| `src/game/config.js` | Match rules, world constants, shot definitions |
| `src/game/CricketEngine.js` | Pure fixed-step innings simulation, timing, scoring, wickets, events |
| `src/game/DeliveryPlanner.js` | Replaceable AI delivery-generation strategy |
| `src/game/CricketScene.js` | Three.js camera, WebGL lighting, stadium, effects, resource lifecycle |
| `src/game/PlayerRig.js` | Independently cloned glTF skeletons, blended animation, physics-clock sampling |
| `src/game/CharacterAssets.js` | Local GLB loading, time normalization, resource disposal |
| `src/game/StadiumCrowd.js` | 8,640 spectators, 12 culled sectors, baked distant sprites and close-range 3D |
| `src/game/Batting.js` | Fictional batter identities and engine-backed live batting statistics |
| `src/game/StadiumScoreboard.js` | Stadium score/batter texture, uploaded only when statistics change |
| `src/game/GameAudio.js` | Opt-in synthesized Web Audio, including crowd cheers and groans |
| `src/game/Records.js` | Personal bests and chase win streaks, saved in browser storage |
| `src/game/useCricketGame.js` | React integration, animation loop, keyboard input, pause handling |
| `src/game/RunningMinimap.jsx` | Live running controls and top-down pitch / field map |
| `src/game/useFullscreen.js` | Browser fullscreen controls, keyboard shortcut, graceful fallback |

The engine has no React, DOM, or Three.js dependencies. Tests run it with
deterministic random seeds, independently of the renderer.

## Blender characters and crowd

The Three.js game uses actual **weighted skinned meshes**, not the previous
runtime cylinders and boxes. Microsoft Rocketbox's **Sports_Male_01** avatar
provides human topology, photographic facial/skin maps, and blended skin weights.
Its bind pose and weights are adapted to our cricket equipment
and 19-bone skeletons. Batters wear helmets with metal grilles, fingered gloves,
ribbed pads and shoes, and carry full-sized willow bats. The fielding team has
its own textured uniform. The library human has locally adapted cricket kit;
the cricket actions are authored, not motion capture. Players currently share
one base human identity; shirt/skin variation differentiates crowd instances.

The assets were imported, adapted, baked and exported through Blender MCP.
Editable current source: `assets/blender/cricket-library-players.blend`.
The original workshop remains preserved at `assets/blender/cricket-characters.blend`.
Base rebuilding recipe: `tools/build_cricket_assets.py` (run in Blender's Text Editor;
set its `__file__` to the saved script path if the editor does not supply one).
The recipe creates a separate workshop scene; rename an existing workshop
before rebuilding so hand-edited work is not silently destroyed.
Blender MCP safe mode requires submitting the authoring functions inline;
it does not permit `exec(open(...))`. For the library upgrade, import
`assets/library/rocketbox/Sports_Male_01.fbx` into the base workshop and submit
`tools/upgrade_library_players.py` inline. It restores the **200fps** action
clock after FBX import, merges facial/finger weights into head/hand joints,
and splits clothing hems before assigning materials. The library folder
contains original and optimized texture maps and the upstream MIT notice.

Runtime assets in `public/models/`:

- `batter.glb`: stance, running, turning, left / right / lofted drive and block.
- `fielder.glb`: idle, running, turning, bowling, pickup, throwing and catching.
- `crowd.glb`: three decimated, unskinned library humans for close-range instancing.
- `crowd-atlas.png` / `crowd-mask.png`: three Blender-baked human poses, with
  separate shirt/skin tint masks for cheap, varied distant spectators.
- `crowd-far.glb`: preserved legacy asset, **no longer loaded** by the game.
- `manifest.json` / `LICENSE.txt` / `ROCKETBOX-LICENSE.txt`: provenance, budgets
  and the correct mixed MIT/CC0 notices.

Every player has an independent skeleton and mixer. Transitions blend while
the animation samples the engine clock: strokes reach the contact key at
**0.105 seconds**, bowling reaches release at the configured run-up duration,
and the throwing release key coincides with **0.32 seconds** of collection.
Animations never award runs, cause wickets, or change ball physics.
Turning back eases the player's heading rather than snapping it 180 degrees.
Crowd clothing, skin tones, sizes, head turns and poses vary; gentle shader
motion freezes on pause and is disabled for reduced-motion users.

The crowd is divided into **12 frustum-cullable seating sectors**. From the
pitch, everyone uses an alpha-tested billboard: **17,280 triangles maximum**,
rather than roughly 960,000 in the previous, smaller two-mesh-tier crowd (about 98%
less crowd geometry, not a measured FPS claim). The front row switches to
merged, vertex-coloured 3D bodies with photographic textured heads within
18 metres. There are at most 84 batches (only 12 enabled from the pitch),
no spectator shadows or per-person matrix updates, and only near-tier GPU sway.
LOD checks run only when the camera moves.

The enlarged stadium has **six tiers and 8,640 seats**, an inner stand radius
of 61.5 metres and a 75.45-metre roof ring. Seats are also split into 12 cullable
instance batches. The pitch and 43-metre playing boundary are unchanged.

Select **Easy, Normal or Hard** before starting. Difficulty adjusts bowling
speed/movement, contact/perfect timing windows, fielder chase and return throws;
Normal retains the original balance. Changes during play are queued for the
next innings: resuming preserves progress and difficulty, while Restart applies
the selection. Running speed is **13.5 m/s** (gameplay-tuned): one crossing takes
about **1.4 seconds**, two manual crossings about **2.8 seconds**, with matching
animation cadence. Space still starts each run or turns an active run back;
incomplete crossings can still result in run-outs.

The stadium's top board shows score, wickets, overs, both batters' names,
runs, balls, fours/sixes and strike rate. Fictional batter identities rotate
on odd runs and at over ends; wickets replace the dismissed runner. Completed
runs are provisional until the engine resolves the ball. The board redraws
and uploads only when its displayed data changes, including reset.

The game waits for its local assets before starting. Missing GLBs show a
readable error with a classic-game fallback. Successful partial loads,
late loads after unmount, mixers, bones, materials, textures, bitmap images
and instance buffers are disposed.
Deploy **the entire `dist/` folder**, including `dist/models/`, not just the
JavaScript bundle. No model service, credentials or network textures are
needed during gameplay.

## Formats, chases and personal bests

Choose a **format** and **mode** alongside the difficulty before taking the
crease. Like difficulty, changes made during an innings wait for the next one.

| Format | Balls | Wickets |
| --- | --- | --- |
| Quick · 2 overs | 12 | 3 |
| Classic · 5 overs | 30 | 5 |

**Chase a target** sets a target when the innings starts, scaled to the
format's length and the difficulty (about 1.05, 1.35 and 1.65 runs per ball on
Easy, Normal and Hard, give or take 15%). The broadcast bar, scorecard and
stadium board show what you need and from how many balls. The innings ends the
moment the target is reached: the winning run completes the chase even if a
return throw would otherwise have caught a batter short. The result card reports
the margin (won by wickets, lost by runs, or a tie).

The end-of-innings card also shows fours, sixes, dot balls, perfectly timed
hits, strike rate and the top scorer. Personal bests and chase records are kept
per format and difficulty in the browser's local storage (`crease.records.v1`);
the game plays normally if storage is unavailable.

The engine still accepts custom rules for other modes:

```js
const engine = new CricketEngine({
  rules: { overs: 5, wickets: 10 },
});
// or a built-in format and mode
const chase = new CricketEngine({ format: 'classic', mode: 'chase' });
```

## Future bowling

For player-controlled bowling, replace the `deliveryPlanner` strategy with a
controller that supplies the same release position, velocities, swing, spin,
and bounce parameters. The bowler animation and ball simulation can then stay
unchanged.

**Not implemented yet:** manual bowling input, a second innings with a bowled
target, team rosters, extras, and a full match controller. A complete match
should coordinate two innings engines rather than mixing match-level rules into
the renderer.

## Validation

Run the simulation tests in a container:

```sh
docker compose --profile test run --rm test
```

Run the browser playtests in Playwright's official image, which bundles
Chromium and its system libraries:

```sh
docker compose --profile test run --rm browser-test
```

The browser tests start their own development server inside the container.
Screenshots and failure traces are written to the host's `test-results/`.
Both test services build from the current source; add `--build` after changing
it (for example `docker compose --profile test run --build --rm test`).
The Playwright image tag in the `Dockerfile` must match the `@playwright/test`
version in `package.json`; update both together.

Without Docker, the same suites run with `npm test` and `npm run test:browser`.
Locally, browser tests use an installed Chrome/Chromium when available; set
`CHROME_PATH` to another executable, or run `npx playwright install chromium`.

The development server exposes `window.__CREASE_DEV__` for deterministic browser
tests. This bridge is excluded from the production build.
