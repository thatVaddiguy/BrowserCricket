import { PHYSICS as P } from './config.js';

const mapX = x => 110 + x * 1.6;
const mapY = z => 64 - (z - P.fieldCenterZ) * 1.1;

export function RunningMinimap({ view, run }) {
  const r = view.running;
  const status = !view.canRun ? view.runOut ? 'RUN OUT' : view.phase === 'result' ? 'BALL COMPLETE' : 'HIT THE BALL, THEN RUN' :
    view.throwIncoming ? 'THROW INCOMING · GET HOME!' :
      r.mode === 'returning' ? 'TURNING BACK' : r.mode === 'outbound' ? 'RUNNING BETWEEN WICKETS' : 'SPACE TO RUN';
  const action = r.mode === 'outbound' ? 'Cancel run' : r.mode === 'returning' ? 'Run again' : 'Run';
  return <div className="running-hud" data-danger={view.throwIncoming && r.mode !== 'idle'}>
    <div className="running-heading"><span>{status}</span><b data-testid="completed-runs">{r.completed} RUN{r.completed === 1 ? '' : 'S'}</b></div>
    <svg className="running-map" viewBox="0 0 220 116" role="img"
      aria-label={`Pitch minimap: ${r.completed} completed runs, batters ${r.mode === 'idle' ? 'at the creases' : !view.canRun ? 'stopped between creases' : r.mode === 'returning' ? 'turning back' : 'running'}`}
      data-testid="running-minimap">
      <ellipse cx="110" cy="64" rx="72" ry="49" fill="#234735" stroke="#819963" strokeWidth="1" />
      <rect x="104" y={mapY(P.farWicket)} width="12" height={mapY(0) - mapY(P.farWicket)} rx="2" fill="#b39866" />
      {[103, 117].map(x => <path key={x} d={`M${x} ${mapY(P.crease)}V${mapY(P.farCrease)}`}
        stroke={x === 103 ? '#d9ef87' : '#f5a461'} strokeOpacity=".5" strokeDasharray="2 2" />)}
      {[P.crease, P.farCrease].map(z => <path key={z} d={`M99 ${mapY(z)}h22`} stroke="#fff4d7" />)}
      {[0, P.farWicket].map(z => <path key={z} d={`M106 ${mapY(z)}h8`} stroke="#fff" strokeWidth="2" />)}
      {view.fielders.map(f => <circle key={f.id} cx={mapX(f.x)} cy={mapY(f.z)} r="2" fill="#92b9d4" />)}
      <circle cx="103" cy={mapY(r.strikerZ)} r="4" fill="#d9ef87" stroke="#0b2116" data-testid="map-striker" />
      <circle cx="117" cy={mapY(r.nonStrikerZ)} r="4" fill="#f5a461" stroke="#0b2116" data-testid="map-nonstriker" />
      {view.ball && <circle cx={mapX(view.ball.x)} cy={mapY(view.ball.z)} r="2.5" fill="#fff" />}
      <text x="10" y="107" fill="#c9d5c3" fontSize="8">● YOU</text>
      <text x="64" y="107" fill="#f5a461" fontSize="8">● PARTNER</text>
      <text x="148" y="107" fill="#fff" fontSize="8">● BALL</text>
    </svg>
    <button className="run-btn" onClick={run} disabled={!view.canRun} aria-label={action}
      data-testid="run-control"><kbd>SPACE</kbd>{action}<span>{r.mode === 'idle' ? '↔' : '↶'}</span></button>
    <div className="running-tip">{!view.canRun ? 'Hit the ball to enable running.' :
      r.mode === 'idle' ? 'One press per run. Repeat for another.' : 'Space turns back. You can still be run out.'}</div>
  </div>;
}
