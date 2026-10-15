import { useEffect, useRef, useState } from 'react';
import { useCricketGame } from './game/useCricketGame.js';
import { useFullscreen } from './game/useFullscreen.js';
import { RunningMinimap } from './game/RunningMinimap.jsx';
import { SHOTS, DIFFICULTIES, FORMATS, MODES } from './game/config.js';
import { recordKey } from './game/Records.js';

function Icon({ name, ...props }) {
  const paths = {
    arrow: 'M4 12h15m-6-6 6 6-6 6',
    restart: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
    pause: 'M8 5v14M16 5v14',
    play: 'm8 5 11 7-11 7V5Z',
    sound: 'M11 5 6 9H3v6h3l5 4V5ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
    muted: 'M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6',
    shield: 'm12 3 7 3v6c0 5-7 8-7 8s-7-3-7-8V6l7-3Zm-3 9 2 2 5-5',
    bat: 'm7 16 9-10 3 3-9 10-3-3Zm9-10 3-3M5 20l2-4M4 6l3 3m-3 1 3-3',
    stumps: 'M7 21V9m5 12V9m5 12V9M5 8h7m0 0h7M6 5h5m2 0h5',
    fullscreen: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    scorecard: 'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}><path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Options({ options }) {
  return Object.entries(options).map(([value, option]) => <option key={value} value={value}>{option.label}</option>);
}

/** Difficulty, format and mode apply to the next innings; an active innings is never changed. */
function MatchSettings({ view, settings, idPrefix }) {
  const { difficultyChoice, chooseDifficulty, formatChoice, chooseFormat, modeChoice, chooseMode } = settings;
  const queued = !['ready', 'over'].includes(view.phase);
  const matchChanged = queued && (formatChoice !== view.format || modeChoice !== view.mode);
  return <div className="difficulty-control">
    <label htmlFor={`${idPrefix}-difficulty`}>{queued ? 'NEXT INNINGS DIFFICULTY' : 'DIFFICULTY'}</label>
    <select id={`${idPrefix}-difficulty`} value={difficultyChoice} onChange={event => chooseDifficulty(event.target.value)}>
      <Options options={DIFFICULTIES} />
    </select>
    <p>{DIFFICULTIES[difficultyChoice].description}</p>
    <div className="match-settings">
      <div><label htmlFor={`${idPrefix}-format`}>FORMAT</label>
        <select id={`${idPrefix}-format`} value={formatChoice} onChange={event => chooseFormat(event.target.value)}>
          <Options options={FORMATS} />
        </select></div>
      <div><label htmlFor={`${idPrefix}-mode`}>MODE</label>
        <select id={`${idPrefix}-mode`} value={modeChoice} onChange={event => chooseMode(event.target.value)}>
          <Options options={MODES} />
        </select></div>
    </div>
    <p>{FORMATS[formatChoice].description} {MODES[modeChoice].description}</p>
    {queued && difficultyChoice !== view.difficulty &&
      <p className="difficulty-notice">Restart to apply. Resume keeps {DIFFICULTIES[view.difficulty].label}.</p>}
    {matchChanged && <p className="difficulty-notice">The new format and mode start with the next innings.</p>}
  </div>;
}

function InningsSummary({ view, achievement }) {
  const { stats } = view;
  return <>
    <div className="final-stats">
      {[[view.score, 'runs'], [`${view.wickets}/${view.maxWickets}`, 'wickets'], [`${view.balls}/${view.maxBalls}`, 'balls']].map(([value, label]) =>
        <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
    </div>
    <div className="innings-breakdown" data-testid="innings-breakdown">
      {[[stats.fours, 'fours'], [stats.sixes, 'sixes'], [stats.dots, 'dots'], [stats.perfects, 'perfect'], [stats.strikeRate, 'strike rate']].map(([value, label]) =>
        <div key={label}><b>{value}</b><span>{label}</span></div>)}
    </div>
    {stats.topScorer?.balls > 0 && <p className="top-scorer">Top score: {stats.topScorer.name} {stats.topScorer.runs}{stats.topScorer.out ? '' : '*'} ({stats.topScorer.balls})</p>}
    {achievement && <p className="record-line" data-testid="record-line" data-new-best={achievement.newBest}>
      {achievement.newBest ? `New personal best! Previous best ${achievement.previousBest}.` : `Personal best: ${achievement.best}.`}
      {view.outcome && ` Chases won: ${achievement.wins}/${achievement.chases}${achievement.streak > 1 ? ` · ${achievement.streak} in a row` : ''}.`}
    </p>}
  </>;
}

function GameModal({ view, start, error, assetsLoading, settings, achievement }) {
  const buttonRef = useRef(null);
  const visible = view.paused || ['ready', 'over'].includes(view.phase) || !!error;
  const over = view.phase === 'over';
  useEffect(() => {
    if (over || view.paused) buttonRef.current?.focus({ preventScroll: true });
  }, [over, view.paused]);
  if (!visible) return null;
  const chase = view.mode === 'chase';
  const result = view.outcome?.result;
  const title = error ? 'Let’s get you playing.' : view.paused ? 'Time out.' : !over ? chase ? 'Chase it down.' : 'Own the crease.' :
    result === 'won' ? 'Chase complete.' : result === 'tied' ? 'Honours even.' : result === 'lost' ? 'So close.' :
      view.score >= 40 ? 'What an innings.' : view.score >= 20 ? 'Nicely played.' : 'One more innings?';
  return (
    <div className="modal-layer" data-testid="game-modal">
      <div className="modal" role="dialog" aria-labelledby="modal-title" aria-describedby="modal-description">
        <div className="modal-symbol"><Icon name="stumps" /></div>
        <div className="eyebrow">{error ? error.startsWith('Cricket character') ? 'PLAYER ASSETS UNAVAILABLE' : 'WEBGL NOT AVAILABLE' : view.paused ?
          view.target == null ? 'TAKE A BREATHER' : `NEED ${view.runsNeeded} OFF ${view.ballsLeft}` : over ?
          view.outcome ? `TARGET ${view.target} · ${view.outcome.result.toUpperCase()}` :
            `${view.wickets >= view.maxWickets ? 'ALL OUT' : `${view.maxBalls} BALLS`} · INNINGS COMPLETE` :
            `THE ${view.maxBalls}-BALL ${chase ? 'CHASE' : 'CHALLENGE'}`}</div>
        <h2 id="modal-title">{title}</h2>
        <p id="modal-description">{error || (view.paused ? 'Your innings will be right here. Ready when you are.' :
          over ? view.outcome ? `${view.outcome.margin}.` :
            view.wickets >= view.maxWickets ? `${view.maxWickets} wickets down. The best innings starts with the next ball.` : `That’s your ${view.maxBalls} balls. A little more patience. A little more power.` :
            <>Time your swing with the arrow keys.<br />Press Space to run, again to turn back.<br />
              {chase ? 'A target is set when you take the crease. Reach it in time.' : 'Reach the crease before the return throw.'}</>)}</p>
        {!over && !view.paused && !error && <div className="intro-keys"><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd><span>Your bat. Your call.</span></div>}
        {over && <InningsSummary view={view} achievement={achievement} />}
        {!error && <MatchSettings view={view} settings={settings} idPrefix="modal" />}
        {error ? <a className="primary-btn" href="./classic.html">Play classic Canvas version<Icon name="arrow" /></a> :
          <button className="primary-btn" ref={buttonRef} disabled={assetsLoading}
            onClick={(event) => { start(); event.currentTarget.blur(); }}>
            <span>{view.paused ? 'Back to the crease' : over ? 'Play another innings' : 'Take the crease'}</span><Icon name="arrow" />
          </button>}
        <p className="micro">{error ? 'The classic game works without WebGL.' : view.paused ? 'Press P or Enter to resume' :
          over ? 'Press Enter to restart · New innings, new possibilities' : 'Enter to play · P to pause · F for fullscreen'}</p>
      </div>
    </div>
  );
}

function Scorecard({ view, shot, settings, records }) {
  const best = records[recordKey(view)]?.best;
  return <aside className="side-panel" aria-label="Scorecard and batting controls">
    <section className="panel-section">
      <div className="score-heading"><span className="eyebrow">YOUR INNINGS</span><span className="innings-badge">{view.paused ? 'PAUSED' : view.phase === 'ready' ? 'READY' : view.phase === 'over' ? 'COMPLETE' : 'AT THE CREASE'}</span></div>
      <div className="main-score"><span data-testid="score">{view.score}</span><span className="wicket-score"> / <span data-testid="wickets">{view.wickets}</span></span></div>
      <div className="score-caption">Runs on the board{best != null && <> · Best <span data-testid="personal-best">{best}</span></>}</div>
      <div className="stat-grid">
        <div className="stat-cell"><span>BALLS FACED</span><b><span className="inline-stat" data-testid="balls">{view.balls}</span><small> / {view.maxBalls}</small></b></div>
        <div className="stat-cell"><span>WICKETS LEFT</span><b>{view.maxWickets - view.wickets}</b></div>
        {view.target != null && <>
          <div className="stat-cell"><span>TARGET</span><b data-testid="target">{view.target}</b></div>
          <div className="stat-cell"><span>NEED</span><b>{view.runsNeeded}<small> off {view.ballsLeft}</small></b></div>
        </>}
      </div>
    </section>
    <section className="panel-section">
      <MatchSettings view={view} settings={settings} idPrefix="scorecard" />
    </section>
    <section className="panel-section">
      <div className="eyebrow">THE OVER STORY</div>
      <div className="ball-history" aria-label="Ball-by-ball results">
        {Array.from({ length: view.maxBalls }, (_, i) => {
          const result = view.history[i];
          const current = result == null && i === view.balls && !['ready', 'over'].includes(view.phase);
          const style = result == null ? current ? ' current' : '' : result === 'W' ? ' wicket' : view.boundaryBalls.includes(i) ? ' boundary' : ' played';
          return <span key={i} className={`ball-slot${style}`} aria-label={`Ball ${i + 1}: ${result == null ? 'not faced' : result === 'W' ? 'wicket' : `${result} runs`}`}>
            {result == null ? '–' : result === 0 ? '·' : result}
          </span>;
        })}
      </div>
      <p className="over-summary">{view.balls === 0 ? 'A fresh innings. A clean slate.' :
        `${view.boundaries} ${view.boundaries === 1 ? 'boundary' : 'boundaries'} · ${view.wickets} ${view.wickets === 1 ? 'wicket' : 'wickets'} · ${view.balls} delivered`}</p>
    </section>
    <section className="panel-section">
      <div className="timing-title"><span className="eyebrow">TIMING IS EVERYTHING</span><span className="timing-status">{view.timing}</span></div>
      <div className="timing-track" aria-hidden="true"><div className="timing-window" /><div className="timing-perfect" />
        <div className="timing-marker" style={{ opacity: view.timingProgress == null ? 0 : 1, left: `${(view.timingProgress ?? 0) * 100}%` }} />
      </div>
      <div className="timing-labels"><span>EARLY</span><span className="sweet-label">SWEET SPOT</span><span>LATE</span></div>
    </section>
    <section className="panel-section controls-section">
      <div className="eyebrow">CHOOSE YOUR SHOT</div>
      <div className="control-grid">
        {Object.entries(SHOTS).map(([direction, details]) =>
          <button className={`shot-btn${view.shot === direction ? ' active' : ''}`} key={direction} data-shot={direction}
            aria-label={`${details.key} ${details.label}: ${details.detail}`} disabled={!view.canShoot}
            onClick={() => shot(direction)}>
            <kbd>{details.key}</kbd><span>{details.label}<small>{details.detail}</small></span>
          </button>)}
      </div>
      <p className="control-tip">Arrows to bat. Space to run or turn back. Press again after reaching the crease for another run. P to pause. F for fullscreen.</p>
    </section>
  </aside>;
}

export default function App() {
  const rootRef = useRef(null);
  const sceneRef = useRef(null);
  const [showScorecard, setShowScorecard] = useState(false);
  const { view, error, assetsLoading, sound, announcement, difficultyChoice, chooseDifficulty,
    formatChoice, chooseFormat, modeChoice, chooseMode, records, achievement,
    start, restart, pause, shot, run, toggleSound } = useCricketGame(sceneRef);
  const settings = { difficultyChoice, chooseDifficulty, formatChoice, chooseFormat, modeChoice, chooseMode };
  const { fullscreen, fullscreenNotice, toggleFullscreen } = useFullscreen(rootRef);
  const playing = !['ready', 'over'].includes(view.phase);
  return <div className={`shell${showScorecard ? ' stats-open' : ''}`} ref={rootRef}>
    <header>
      <div className="brand"><div className="brand-mark"><Icon name="bat" width="24" height="24" /></div>
        <div><div className="brand-name">crease<span className="accent-text">.</span></div><div className="brand-sub">THE GAME IS IN YOUR TIMING</div></div>
      </div>
      <div className="header-actions">
        <span className="offline"><i className="dot" />REACT × THREE.JS</span>
        <button className="icon-btn" onClick={() => setShowScorecard(!showScorecard)} title="Scorecard and controls"
          aria-label="Scorecard and controls" aria-expanded={showScorecard}><Icon name="scorecard" /></button>
        <button className="icon-btn" onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-pressed={fullscreen}><Icon name="fullscreen" /></button>
        <button className="icon-btn" onClick={toggleSound} title={sound ? 'Turn sound off' : 'Turn sound on'} aria-label={sound ? 'Turn sound off' : 'Turn sound on'} aria-pressed={sound}><Icon name={sound ? 'sound' : 'muted'} /></button>
        <button className="icon-btn" onClick={pause} title={view.paused ? 'Resume (P)' : 'Pause (P)'} aria-label={view.paused ? 'Resume game' : 'Pause game'} aria-pressed={view.paused} disabled={!playing}><Icon name={view.paused ? 'play' : 'pause'} /></button>
        <button className="icon-btn restart-btn" onClick={restart} title="Start a fresh innings"><Icon name="restart" />Restart</button>
      </div>
    </header>
    <main>
      <section className="arena" aria-label="Cricket game" data-phase={view.phase} data-paused={view.paused} data-testid="arena">
        <div className="webgl-scene" ref={sceneRef} />
        {assetsLoading && <div className="asset-loading" role="status">Loading players and crowd…</div>}
        <div className="field-labels" aria-hidden="true"><span>LEG SIDE</span><span>OFF SIDE</span></div>
        <div className="arena-top">
          <div className="venue"><div className="eyebrow"><span className="live-badge">LIVE</span>THE NIGHT SESSION</div>
            <div className="venue-name">Crease Oval · Under the lights · <span data-testid="active-difficulty">{DIFFICULTIES[view.difficulty].label}</span></div></div>
          <div className="broadcast-score" aria-label="Live score"><div><small>YOU</small><b>{view.score} / {view.wickets}</b></div><div className="score-divider" /><div><small>OVERS</small><b>{view.overs}</b></div>
            {view.target != null && view.phase !== 'over' && <><div className="score-divider" /><div data-testid="chase-equation"><small>NEED</small><b>{view.runsNeeded}<small className="chase-off"> off {view.ballsLeft}</small></b></div></>}</div>
        </div>
        {view.feedback && <div className="feedback" data-tone={view.feedback.tone} aria-live="polite" aria-atomic="true" data-testid="feedback"><div className="feedback-title">{view.feedback.title}</div><div className="feedback-sub">{view.feedback.subtitle}</div></div>}
        <RunningMinimap view={view} run={run} />
        {fullscreenNotice && <div className="fullscreen-notice" role="status">{fullscreenNotice}</div>}
        <div className="arena-bottom">
          <div className="delivery-panel"><div className="eyebrow">{view.delivery ? `DELIVERY ${Math.min(view.balls + (view.phase === 'result' || view.phase === 'over' ? 0 : 1), view.maxBalls)} OF ${view.maxBalls}` : 'NEXT UP'}</div>
            <div className="delivery-name">{view.delivery?.name ?? 'Right-arm pace'}</div>
            <div className="delivery-speed">{view.delivery ? `${view.delivery.speed} km/h · ${view.delivery.spin ? 'SPIN' : 'PACE'}` : 'WATCH THE BALL. FIND YOUR MOMENT.'}</div>
          </div>
          <div className="camera-label">{['flight', 'return'].includes(view.phase) || view.phase === 'result' && view.batHit ? 'BALL FOLLOW CAM' : 'BATTER CAM 01'}<br /><span>ARROWS TO BAT · SPACE TO RUN · P TO PAUSE</span></div>
        </div>
        <div className="touch-controls" role="group" aria-label="Touch batting controls">
          {Object.entries(SHOTS).map(([direction, details]) =>
            <button key={direction} type="button" data-mobile-shot={direction}
              className={view.shot === direction ? 'selected' : ''}
              aria-label={`Touch: ${details.label}`} disabled={!view.canShoot}
              onClick={() => shot(direction)}>{details.key}</button>)}
        </div>
        <GameModal view={view} start={start} error={error} assetsLoading={assetsLoading}
          settings={settings} achievement={achievement} />
      </section>
      <Scorecard view={view} shot={shot} settings={settings} records={records} />
    </main>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
  </div>;
}
