const NAMES = ['Arjun Rao', 'Sam Ellis', 'Dev Shah', 'Alex Morgan', 'Noah Reed',
  'Kiran Patel', 'Tom Hayes', 'Ravi Menon'];

export function makeBatsman(id) {
  return { id, name: NAMES[id] ?? `Batter ${id + 1}`, runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
}

/** Provisional completed runs are visible, but never committed twice. */
export function battingDisplay(state, ballsPerOver = 6) {
  const live = ['flight', 'return'].includes(state.phase) ? state.running.completed : 0;
  return {
    score: state.score + live,
    wickets: state.wickets, target: state.target ?? null,
    overs: `${Math.floor(state.balls / ballsPerOver)}.${state.balls % ballsPerOver}`,
    batsmen: [state.strikerId, state.nonStrikerId].map(id => {
      const player = state.batsmen[id];
      const runs = player.runs + (id === state.strikerId ? live : 0);
      return { ...player, runs, striker: id === state.strikerId,
        strikeRate: player.balls ? (runs / player.balls * 100).toFixed(1) : '0.0' };
    }),
  };
}
