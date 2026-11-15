/*
 * BBSim: a made-up basketball game for the practice page, the mock stats page and the tests. The teams'
 * players are invented and the game is generated from a seed, so it is the same every time. It stands in
 * for a real play-by-play until one is transcribed; nothing here is a real result.
 *
 * Each step is one trip down the floor (or a whistle): a few play lines and the box score after them.
 * Home lines use the StatCrew wording ("GOOD! 3 PTR by ALDER,JONAH"); away lines use sentences
 * ("Theo Marsh made 3-pt. jump shot (assist by Cal Reyes)"), so both styles get exercised.
 */
(function (root) {
  'use strict';

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // use: share of the shots. three: how often the shot is a three. p2, p3, ft: make rates.
  // reb, ast, stl, blk, foul: relative weights.
  const P = (uni, first, last, use, three, p2, p3, ft, reb, ast, stl, blk, foul) => ({ uni, first, last, use, three, p2, p3, ft, reb, ast, stl, blk, foul });
  const TEAMS = {
    home: { code: 'MSU', name: 'Montana St.', players: [
      P('3', 'Jonah', 'Alder', 26, 0.45, 0.52, 0.41, 0.86, 3, 4, 3, 1, 2),
      P('11', 'Marcus', 'Brandt', 14, 0.30, 0.50, 0.35, 0.78, 3, 9, 4, 1, 2),
      P('21', 'Eli', 'Castellan', 16, 0.10, 0.58, 0.30, 0.68, 9, 2, 2, 5, 4),
      P('24', 'Dre', 'Dunmore', 15, 0.40, 0.47, 0.37, 0.80, 4, 3, 3, 1, 3),
      P('32', 'Owen', 'Everly', 11, 0.05, 0.60, 0.20, 0.60, 10, 1, 1, 4, 4),
      P('5', 'Niko', 'Fenwick', 8, 0.50, 0.44, 0.36, 0.82, 2, 3, 2, 0, 2),
      P('13', 'Tate', 'Garrow', 5, 0.20, 0.48, 0.30, 0.70, 5, 1, 1, 2, 3),
      P('0', 'Sam', 'Holt', 5, 0.55, 0.42, 0.34, 0.75, 2, 2, 2, 0, 2),
    ] },
    away: { code: 'RDG', name: 'Ridgeline', players: [
      P('1', 'Theo', 'Marsh', 24, 0.40, 0.50, 0.38, 0.84, 3, 4, 3, 1, 2),
      P('4', 'Cal', 'Reyes', 13, 0.25, 0.48, 0.33, 0.80, 3, 8, 4, 0, 3),
      P('15', 'Bo', 'Tanager', 17, 0.08, 0.56, 0.25, 0.64, 9, 2, 1, 4, 5),
      P('22', 'Ike', 'Vance', 14, 0.45, 0.46, 0.36, 0.77, 4, 2, 2, 1, 3),
      P('34', 'Rowan', 'Whitlock', 12, 0.05, 0.57, 0.20, 0.58, 10, 1, 1, 3, 4),
      P('10', 'Jude', 'Yarrow', 9, 0.50, 0.43, 0.35, 0.79, 2, 3, 2, 0, 2),
      P('12', 'Abe', 'Zeller', 6, 0.15, 0.50, 0.28, 0.66, 5, 1, 1, 2, 3),
      P('2', 'Finn', 'Okafor', 5, 0.50, 0.41, 0.33, 0.72, 2, 2, 2, 0, 2),
    ] },
  };
  const FIELDS = ['min', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'to', 'pf', 'pts'];
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const mmss = (secs) => Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
  const ORD = ['', '1st', '2nd', '3rd', '4th'];

  function createGame(opts) {
    opts = opts || {};
    const rand = mulberry(opts.seed == null ? 20261115 : opts.seed);
    const periods = opts.periods === 4 ? 4 : 2, L = periods === 4 ? 600 : 1200;
    const box = { home: {}, away: {} };
    for (const side of ['home', 'away']) for (const p of TEAMS[side].players) { box[side][p.uni] = {}; for (const f of FIELDS) box[side][p.uni][f] = 0; }
    const score = { home: 0, away: 0 };
    const floor = { home: TEAMS.home.players.slice(0, 5), away: TEAMS.away.players.slice(0, 5) };
    const steps = [];
    const stat = (side, p) => box[side][p.uni];
    const pick = (list, w) => {
      let tot = 0; for (const x of list) tot += Math.max(0.01, w(x));
      let r = rand() * tot;
      for (const x of list) { r -= Math.max(0.01, w(x)); if (r <= 0) return x; }
      return list[list.length - 1];
    };
    // Home wording is StatCrew's; away wording is sentences.
    const nm = (side, p) => (side === 'home' ? `${p.last.toUpperCase()},${p.first.toUpperCase()}` : `${p.first} ${p.last}`);
    const say = {
      made: (side, p, kind) => (side === 'home' ? `GOOD! ${{ three: '3 PTR', dunk: 'DUNK', layup: 'LAYUP', jumper: 'JUMPER' }[kind]} by ${nm(side, p)}`
        : `${nm(side, p)} made ${{ three: '3-pt. jump shot', dunk: 'dunk', layup: 'layup', jumper: 'jump shot' }[kind]}`),
      miss: (side, p, kind) => (side === 'home' ? `MISSED ${{ three: '3 PTR', dunk: 'DUNK', layup: 'LAYUP', jumper: 'JUMPER' }[kind]} by ${nm(side, p)}`
        : `${nm(side, p)} missed ${{ three: '3-pt. jump shot', dunk: 'dunk', layup: 'layup', jumper: 'jump shot' }[kind]}`),
      ast: (side, p) => (side === 'home' ? `ASSIST by ${nm(side, p)}` : `Assist by ${nm(side, p)}`),
      reb: (side, p, off) => (side === 'home' ? `REBOUND (${off ? 'OFF' : 'DEF'}) by ${nm(side, p)}` : `${off ? 'Offensive' : 'Defensive'} rebound by ${nm(side, p)}`),
      blk: (side, p) => (side === 'home' ? `BLOCK by ${nm(side, p)}` : `Block by ${nm(side, p)}`),
      stl: (side, p) => (side === 'home' ? `STEAL by ${nm(side, p)}` : `Steal by ${nm(side, p)}`),
      to: (side, p) => (side === 'home' ? `TURNOVR by ${nm(side, p)}` : `Turnover by ${nm(side, p)}`),
      foul: (side, p) => (side === 'home' ? `FOUL by ${nm(side, p)}` : `Foul on ${nm(side, p)}`),
      ft: (side, p, ok) => (side === 'home' ? `${ok ? 'GOOD!' : 'MISSED'} FT SHOT by ${nm(side, p)}` : `${nm(side, p)} ${ok ? 'made' : 'missed'} free throw`),
    };

    let period = 1, clock = L, poss = rand() < 0.5 ? 'home' : 'away';
    const push = (lines, extra) => {
      const snapBox = { home: {}, away: {} };
      for (const side of ['home', 'away']) for (const u in box[side]) snapBox[side][u] = { ...box[side][u] };
      steps.push({ period, clock, score: { ...score }, box: snapBox, lines, ...(extra || {}) });
    };
    // The home side heats up early in the last period; the visitors answer late. It gives the board a
    // long run, a hot hand and a close finish to show.
    const hot = (side) => {
      if (period !== periods) return 0;
      const frac = clock / L;
      if (frac < 0.80 && frac > 0.55) return side === 'home' ? 0.22 : -0.22;
      if (frac < 0.25) return side === 'away' ? 0.12 : -0.08;
      return 0;
    };
    const media = new Set();
    const subs = (side) => {
      // Now and then a starter sits; anyone with five fouls is done.
      const team = TEAMS[side].players, on = floor[side];
      for (let i = 0; i < on.length; i++) {
        const out = stat(side, on[i]).pf >= 5 || rand() < 0.06;
        if (!out) continue;
        const bench = team.filter((p) => !on.includes(p) && stat(side, p).pf < 5);
        if (bench.length) on[i] = pick(bench, (p) => p.use + 6);
      }
    };

    push([], { pre: true });
    for (;;) {
      if (clock <= 0) {
        // End of a period: an intermission step, then the next period starts.
        if (period >= periods && score.home !== score.away) break;
        push([period === periods / 2 ? 'End of the half' : `End of period ${period}`], { intermission: true });
        period += 1; clock = period <= periods ? L : 300;
        continue;
      }
      const used = Math.min(clock, 7 + Math.floor(rand() * 21));
      for (const side of ['home', 'away']) for (const p of floor[side]) stat(side, p).min += used / 60;
      clock -= used;
      const lines = [];
      const off = poss, def = other(poss);
      // Media timeout at the first whistle under 16, 12, 8 and 4 minutes (halves) or under 5 (quarters).
      for (const mark of (periods === 2 ? [960, 720, 480, 240] : [300])) {
        const k = period + ':' + mark;
        if (period <= periods && clock < mark && !media.has(k) && lines.length === 0 && rand() < 0.5) { media.add(k); lines.push('TIMEOUT MEDIA'); }
      }
      const shooter = pick(floor[off], (p) => p.use * (off === 'home' && p.uni === '3' && hot('home') > 0 ? 2.2 : 1));
      const S = stat(off, shooter);
      const r = rand(), bias = hot(off);
      let next = def;
      if (r < 0.15 - bias * 0.2) {
        // Turnover, often a steal.
        const loser = pick(floor[off], (p) => p.use);
        stat(off, loser).to += 1; lines.push(say.to(off, loser));
        if (rand() < 0.55) { const th = pick(floor[def], (p) => p.stl); stat(def, th).stl += 1; lines.push(say.stl(def, th)); }
      } else if (r < 0.25) {
        // Shooting foul: two free throws (three behind the line now and then).
        const fouler = pick(floor[def], (p) => p.foul);
        stat(def, fouler).pf += 1; lines.push(say.foul(def, fouler));
        const n = rand() < 0.12 ? 3 : 2;
        let lastMissed = false;
        for (let i = 0; i < n; i++) {
          const ok = rand() < shooter.ft;
          S.fta += 1; if (ok) { S.ftm += 1; S.pts += 1; score[off] += 1; }
          lines.push(say.ft(off, shooter, ok)); lastMissed = !ok;
        }
        if (lastMissed) { const rb = pick(floor[def], (p) => p.reb); stat(def, rb).dreb += 1; stat(def, rb).reb += 1; lines.push(say.reb(def, rb, false)); }
      } else {
        const three = rand() < shooter.three;
        const kind = three ? 'three' : rand() < 0.12 ? 'dunk' : rand() < 0.45 ? 'layup' : 'jumper';
        const pMake = Math.max(0.08, Math.min(0.92, (three ? shooter.p3 : shooter.p2 + (kind === 'dunk' ? 0.3 : kind === 'layup' ? 0.06 : -0.06)) + bias));
        S.fga += 1; if (three) S.tpa += 1;
        if (rand() < pMake) {
          S.fgm += 1; if (three) S.tpm += 1;
          const pts = three ? 3 : 2; S.pts += pts; score[off] += pts;
          lines.push(say.made(off, shooter, kind));
          if (rand() < (three ? 0.8 : 0.5)) {
            const mates = floor[off].filter((p) => p !== shooter);
            const a = pick(mates, (p) => p.ast); stat(off, a).ast += 1;
            if (off === 'home') lines.push(say.ast(off, a)); else lines[lines.length - 1] += ` (assist by ${nm(off, a)})`;
          }
        } else {
          lines.push(say.miss(off, shooter, kind));
          if (!three && rand() < 0.14) { const bl = pick(floor[def], (p) => p.blk); stat(def, bl).blk += 1; lines.push(say.blk(def, bl)); }
          if (rand() < 0.27) { const rb = pick(floor[off], (p) => p.reb); stat(off, rb).oreb += 1; stat(off, rb).reb += 1; lines.push(say.reb(off, rb, true)); next = off; }
          else { const rb = pick(floor[def], (p) => p.reb); stat(def, rb).dreb += 1; stat(def, rb).reb += 1; lines.push(say.reb(def, rb, false)); }
        }
      }
      // A non-shooting foul now and then, and the odd team timeout.
      if (rand() < 0.05) { const f = pick(floor[def], (p) => p.foul); stat(def, f).pf += 1; lines.push(say.foul(def, f)); }
      if (rand() < 0.02) lines.push(`TIMEOUT 30sec by ${TEAMS[def].code}`);
      push(lines);
      subs('home'); subs('away');
      poss = next;
      if (steps.length > 900) break;
    }
    push(['End of game'], { final: true });
    const total = steps.length - 1;

    function snapshot(n) {
      const st = steps[Math.max(0, Math.min(total, n))];
      const team = (side) => {
        const players = TEAMS[side].players.map((p) => {
          const b = st.box[side][p.uni];
          return { uni: p.uni, first: p.first, last: p.last, ...b, min: Math.round(b.min) };
        });
        const totals = {};
        for (const f of FIELDS) totals[f] = players.reduce((a, p) => a + p[f], 0);
        return { code: TEAMS[side].code, name: TEAMS[side].name, players, totals };
      };
      return { sport: 'bb', status: st.pre ? 'pre' : st.final ? 'final' : 'live', period: st.period, periods,
        clock: st.final || st.intermission ? '0:00' : mmss(st.clock), intermission: !!st.intermission,
        set: st.period, score: { ...st.score }, setsWon: { home: 0, away: 0 }, teams: { home: team('home'), away: team('away') } };
    }
    const status = (n) => {
      const st = steps[Math.max(0, Math.min(total, n))];
      if (st.pre) return 'Pregame';
      if (st.final) return st.period > periods ? 'Final/OT' : 'Final';
      if (st.intermission) return st.period === periods / 2 ? 'Halftime' : `End of ${ORD[st.period] || 'OT'}`;
      return (st.period > periods ? 'OT' : ORD[st.period]) + ' ' + mmss(st.clock);
    };
    // Points by period up to step n, for a line score: { home: [..], away: [..] }.
    function byPeriod(n) {
      const out = { home: [], away: [] };
      let base = { home: 0, away: 0 };
      for (let i = 0; i <= Math.min(total, n); i++) {
        const st = steps[i];
        for (const side of ['home', 'away']) out[side][st.period - 1] = st.score[side] - base[side];
        if (st.intermission) base = { ...st.score };
      }
      return out;
    }
    return {
      total, periods, teams: TEAMS, snapshot, byPeriod,
      linesAt: (n) => (n >= 1 && n <= total ? steps[n].lines.slice() : []),
      // The tab title a stats page would show: "RDG 31, MSU 38 - 2nd 12:34".
      title: (n) => { const st = steps[Math.max(0, Math.min(total, n))]; return `${TEAMS.away.code} ${st.score.away}, ${TEAMS.home.code} ${st.score.home} - ${status(n)}`; },
      label: (n) => { const st = steps[Math.max(0, Math.min(total, n))]; return `${status(n)} · ${TEAMS.home.code} ${st.score.home}–${st.score.away} ${TEAMS.away.code}`; },
      // First step at which fn(step) is true, or -1.
      find: (fn) => steps.findIndex((st, i) => fn({ ...st, n: i })),
    };
  }

  const api = { createGame, TEAMS, FIELDS };
  root.BBSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
