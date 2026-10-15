import { useCallback, useEffect, useRef, useState } from 'react';
import { CricketEngine } from './CricketEngine.js';
import { CricketScene } from './CricketScene.js';
import { GameAudio } from './GameAudio.js';
import { PHYSICS } from './config.js';
import { loadRecords, recordInnings, saveRecords } from './Records.js';

export function useCricketGame(containerRef) {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new CricketEngine({ format: 'quick', mode: 'free' });
  const engine = engineRef.current;
  const [view, setView] = useState(() => engine.snapshot());
  const [difficultyChoice, setDifficultyChoice] = useState(engine.difficulty);
  const [formatChoice, setFormatChoice] = useState(engine.format);
  const [modeChoice, setModeChoice] = useState(engine.mode);
  const recordsRef = useRef(null);
  if (!recordsRef.current) recordsRef.current = loadRecords();
  const [records, setRecords] = useState(recordsRef.current);
  const [achievement, setAchievement] = useState(null);
  const [error, setError] = useState('');
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const audioRef = useRef(null);
  const sync = useCallback(() => setView(engine.snapshot()), [engine]);

  useEffect(() => {
    let scene;
    try {
      scene = new CricketScene(containerRef.current, {
        runupSeconds: engine.rules.runupSeconds, ballsPerOver: engine.rules.ballsPerOver,
      });
      setError('');
    } catch {
      setAssetsLoading(false);
      setError('WebGL could not start. Enable hardware acceleration, or try the classic Canvas version.');
      return undefined;
    }
    scene.assetsReady.then(() => {
      if (!scene.disposed) setAssetsLoading(false);
    }).catch(assetError => {
      if (!scene.disposed) {
        setAssetsLoading(false);
        engine.pause(true);
        setError(assetError.message);
        sync();
      }
    });
    const audio = new GameAudio();
    audio.enable(soundRef.current);
    audioRef.current = audio;
    let raf, last = 0, accumulator = 0, renderTime = 0, lastUi = 0;
    const tick = (timestamp) => {
      if (!last) last = timestamp;
      const elapsed = Math.min((timestamp - last) / 1000, 0.05);
      last = timestamp;
      if (!engine.state.paused) {
        renderTime += elapsed;
        accumulator += elapsed;
        while (accumulator >= PHYSICS.step) {
          engine.update(PHYSICS.step);
          accumulator -= PHYSICS.step;
        }
      } else accumulator = 0;
      const events = engine.consumeEvents();
      for (const event of events) {
        if (event.type === 'bounce') audio.play('bounce');
        else if (event.type === 'contact') audio.play(event.kind);
        else if (event.type === 'over') {
          const finished = engine.snapshot();
          const { records: next, achieved } = recordInnings(recordsRef.current, finished);
          recordsRef.current = next;
          saveRecords(next);
          setRecords(next);
          setAchievement(achieved);
          if (finished.outcome?.result === 'won') audio.play('cheer');
          setAnnouncement(`Innings complete. ${finished.score} for ${finished.wickets}.` +
            (finished.outcome ? ` ${finished.outcome.margin}.` : ''));
        } else if (event.type === 'result') {
          audio.play(event.wicket ? 'wicket' : event.boundary ? 'boundary' : 'block');
          if (event.boundary) audio.play('cheer');
          else if (event.wicket) audio.play('groan');
          setAnnouncement(`Ball ${event.balls}: ${event.reason === 'runout' ? `run out, ${event.runs} completed runs` :
            event.wicket ? 'wicket' : `${event.runs} runs`}. Score ${event.score} for ${event.wickets}.`);
        } else if (event.type === 'runComplete') {
          setAnnouncement(`${event.runs} completed runs. Press Space to run again.`);
        } else if (event.type === 'run') {
          setAnnouncement(event.mode === 'returning' ? 'Run cancelled. Get back to the crease.' : 'Running.');
        }
      }
      const animating = !engine.state.paused && !['ready', 'over'].includes(engine.state.phase);
      if (events.length || (animating && timestamp - lastUi >= 1000 / 30)) {
        setView(engine.snapshot());
        lastUi = timestamp;
      }
      if (animating || scene.needsRender || events.length) {
        scene.render(engine.state, renderTime, engine.state.paused ? 0 : elapsed);
      }
      raf = requestAnimationFrame(tick);
    };
    const pauseWhenHidden = () => {
      if (document.hidden) { engine.pause(true); sync(); }
      last = 0;
      accumulator = 0;
    };
    const pauseWhenBlurred = () => { engine.pause(true); sync(); };
    const contextLost = (event) => {
      event.preventDefault();
      engine.pause(true);
      setError('The graphics context was interrupted. Reload this page, or play the classic Canvas version.');
      sync();
    };
    const contextRestored = () => { setError(''); sync(); };
    scene.renderer.domElement.addEventListener('webglcontextlost', contextLost);
    scene.renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    window.addEventListener('blur', pauseWhenBlurred);
    // Development-only bridge for deterministic browser tests; excluded from production.
    if (import.meta.env.DEV) window.__CREASE_DEV__ = { engine, scene };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      window.removeEventListener('blur', pauseWhenBlurred);
      scene.renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      scene.renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      if (import.meta.env.DEV) delete window.__CREASE_DEV__;
      scene.dispose();
      audio.dispose();
      audioRef.current = null;
    };
  }, [containerRef, engine, sync]);

  const start = useCallback(() => {
    if (assetsLoading || error) return;
    if (engine.state.paused) engine.pause(false);
    else {
      engine.startInnings(difficultyChoice, { format: formatChoice, mode: modeChoice });
      setAchievement(null);
    }
    if (audioRef.current?.enabled) audioRef.current.enable(true);
    setAnnouncement(engine.state.target == null ? '' : `Chase on. ${engine.state.target} to win from ${engine.maxBalls} balls.`);
    sync();
  }, [engine, sync, assetsLoading, error, difficultyChoice, formatChoice, modeChoice]);
  const restart = useCallback(() => {
    if (assetsLoading || error) return;
    engine.startInnings(difficultyChoice, { format: formatChoice, mode: modeChoice });
    setAchievement(null);
    setAnnouncement(engine.state.target == null ? 'New innings.' : `New chase. ${engine.state.target} to win.`);
    sync();
  }, [engine, sync, assetsLoading, error, difficultyChoice, formatChoice, modeChoice]);
  const chooseDifficulty = useCallback(difficulty => {
    engine.setDifficulty(difficulty);
    setDifficultyChoice(difficulty);
    sync();
  }, [engine, sync]);
  const chooseFormat = useCallback(format => {
    engine.setMatch({ format });
    setFormatChoice(format);
    sync();
  }, [engine, sync]);
  const chooseMode = useCallback(mode => {
    engine.setMatch({ mode });
    setModeChoice(mode);
    sync();
  }, [engine, sync]);
  const pause = useCallback(() => { engine.pause(); sync(); }, [engine, sync]);
  const shot = useCallback(direction => { engine.playShot(direction); sync(); }, [engine, sync]);
  const run = useCallback(() => { engine.toggleRun(); sync(); }, [engine, sync]);
  const toggleSound = useCallback(() => {
    soundRef.current = !soundRef.current;
    audioRef.current?.enable(soundRef.current);
    setSound(soundRef.current);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const shots = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (shots[event.key]) {
        event.preventDefault();
        if (!event.repeat) shot(shots[event.key]);
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) {
          if (['ready', 'over'].includes(engine.state.phase)) start();
          else if (engine.state.paused) start();
          else run();
        }
      } else if (event.code === 'KeyP' || event.key === 'Escape') {
        if (!['ready', 'over'].includes(engine.state.phase)) {
          event.preventDefault();
          if (!event.repeat) pause();
        }
      } else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON' &&
        (engine.state.paused || ['ready', 'over'].includes(engine.state.phase))) {
        event.preventDefault();
        if (!event.repeat) start();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [engine, start, shot, pause, run]);

  return { view, error, assetsLoading, sound, announcement, difficultyChoice, chooseDifficulty,
    formatChoice, chooseFormat, modeChoice, chooseMode, records, achievement,
    start, restart, pause, shot, run, toggleSound };
}
