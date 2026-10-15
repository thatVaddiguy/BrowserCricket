import { useCallback, useEffect, useState } from 'react';

export function useFullscreen(rootRef) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenNotice, setFullscreenNotice] = useState('');
  const enterFullscreen = useCallback(async () => {
    if (document.fullscreenElement) return;
    if (!rootRef.current?.requestFullscreen) {
      setFullscreenNotice('Browser fullscreen is unavailable. The game still fills the window.');
      return;
    }
    try {
      await rootRef.current.requestFullscreen();
      setFullscreenNotice('');
    } catch {
      setFullscreenNotice('Browser fullscreen is unavailable. The game still fills the window.');
    }
  }, [rootRef]);
  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) return enterFullscreen();
    try {
      await document.exitFullscreen();
    } catch {
      setFullscreenNotice('Could not exit fullscreen. Press Escape to exit.');
    }
  }, [enterFullscreen]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === rootRef.current);
    const onKey = event => {
      if (event.code !== 'KeyF' || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      toggleFullscreen();
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('keydown', onKey);
    };
  }, [rootRef, toggleFullscreen]);

  return { fullscreen, fullscreenNotice, enterFullscreen, toggleFullscreen };
}
