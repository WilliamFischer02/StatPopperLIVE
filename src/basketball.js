/*
 * PopBasketball: the basketball half of PopEngine. Pure logic, no DOM. The engine (engine.js) owns the
 * card selection, Pin, Pass, Hide, stars and rotation rules; this file supplies everything that differs
 * for basketball: the stat line, what counts as notable, the pops, runs, fouls, alerts and play parsing.
 *
 * Snapshot contract (what a page reader must produce for basketball):
 *   { sport:'bb', status:'pre'|'live'|'final', period:Number (0 = unknown), periods: 2|4|0,
 *     clock:'12:34'|null, intermission:Boolean, rawStatus:String, set: period, score:{home,away},
 *     setsWon:{home:0,away:0},
 *     teams:{ home:{code,name,players:[P],totals?:P,extra?:X}, away:{...} } }
 *   P = { uni, first, last, min, fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, reb, ast, stl, blk, to, pf, pts }
 *   X = { paint, offTo, second, fast, bench }   (optional team extras, when the page lists them)
 *
 * Cadence: volleyball counts rallies. Basketball has no rallies, so the engine's counter advances once
 * per update in which the score or any stat changed (a "play"). Windows below are in plays.
 */
(function (root) {
  'use strict';

  const SIDES = ['home', 'away'];
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const playerKey = (side, uni) => side + ':' + uni;
  const FIELDS = ['min', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'to', 'pf', 'pts'];

  const ma = (m, a) => m + '-' + a;
  const pc = (v) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(1));
  const mmss = (secs) => { secs = Math.max(0, Math.round(secs)); return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); };

  function derive(p) {
    const q = { uni: String(p.uni), first: p.first || '', last: p.last || '' };
    for (const f of FIELDS) q[f] = num(p[f]);
    if (q.reb < q.oreb + q.dreb) q.reb = q.oreb + q.dreb;
    const calc = 2 * q.fgm + q.tpm + q.ftm;
    if (p.pts == null || (q.pts === 0 && calc > 0)) q.pts = calc;
    q.fgPct = q.fga > 0 ? q.fgm / q.fga : null;
    q.tpPct = q.tpa > 0 ? q.tpm / q.tpa : null;
    q.ftPct = q.fta > 0 ? q.ftm / q.fta : null;
    return q;
  }

  function teamTotals(t) {
    if (t.totals) return derive({ uni: 'TM', ...t.totals });
    const sum = { uni: 'TM' };
    for (const f of FIELDS) sum[f] = 0;
    for (const p of t.players) for (const f of FIELDS) sum[f] += num(p[f]);
    return derive(sum);
  }

  // ------------------------------------------------------------ game time

  const periodsOf = (s) => (num(s.periods) === 4 ? 4 : 2);
  const periodLen = (s) => (periodsOf(s) === 4 ? 600 : 1200);
  // "12:34", or "45.3" in the last minute. Returns seconds left in the period, or null.
  function clockSecs(c) {
    const t = String(c == null ? '' : c).trim();
    let m = /^(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(t);
    if (m) return +m[1] * 60 + +m[2];
    m = /^:?(\d{1,2})\.(\d)$/.exec(t);
    if (m) return +m[1];
    return null;
  }
  // Game seconds played. From the period and clock when the page gives them; otherwise estimated from
  // the combined score (about 3.6 points a minute), held inside the current period when that is known.
  function elapsed(s) {
    const P = periodsOf(s), L = periodLen(s), reg = P * L;
    const per = num(s.period);
    const est = (num(s.score && s.score.home) + num(s.score && s.score.away)) / 3.6 * 60;
    if (s.status === 'final') return Math.max(reg, per > P ? reg + (per - P) * 300 : reg);
    if (!per) return Math.min(reg, est);
    const start = per <= P ? (per - 1) * L : reg + (per - P - 1) * 300;
    const len = per <= P ? L : 300;
    if (s.intermission) return start + len;
    const c = clockSecs(s.clock);
    if (c != null && c <= len) return start + (len - c);
    return Math.max(start, Math.min(start + len, est));
  }
  // Notability scales with 10-minute blocks played (4 at the end of regulation), so 8 points is a pop
  // in the first ten minutes and ordinary by the fourth.
  const eff = (s) => Math.max(0.8, elapsed(s) / 600);

  function periodLabel(s) {
    const P = periodsOf(s), per = num(s.period);
    if (s.status === 'final') return 'Final' + (per > P ? (per - P > 1 ? ' · ' + (per - P) + 'OT' : ' · OT') : '');
    if (s.status === 'pre') return 'Pregame';
    if (!per) return s.rawStatus ? String(s.rawStatus).slice(0, 18) : 'Live';
    const name = per > P ? (per - P > 1 ? (per - P) + 'OT' : 'OT') : P === 4 ? 'Q' + per : per === 1 ? '1st Half' : '2nd Half';
    if (s.intermission) return per === P / 2 ? 'Halftime' : 'End of ' + (per >= P ? (per === P ? 'Regulation' : name) : name);
    return name;
  }
  const periodWord = (s) => (periodsOf(s) === 4 ? 'quarter' : 'half');

  // ------------------------------------------------------------ notability

  // Foul trouble, 0 = none. Five fouls is out; four is trouble any time; three before the break and two
  // in the opening quarter of the game are worth a pop too.
  function foulLevel(pf, s) {
    const reg = periodsOf(s) * periodLen(s), t = elapsed(s);
    if (pf >= 5) return 1.6;
    if (pf === 4) return t < reg ? 1.3 : 0.9;
    if (pf === 3) return t < reg / 2 ? 1.05 : t < reg * 0.75 ? 0.6 : 0;
    if (pf === 2) return t < reg / 4 ? 0.8 : 0;
    return 0;
  }

  // 0 = not worth a pop, ~1 = solid, 2-3 = standout.
  function norms(p, e, s) {
    const tier = e < 1.5 ? 0 : e < 2.5 ? 1 : 2;
    const n = (v, par, mins) => (v >= mins[tier] ? Math.min(3, v / (par * e)) : 0);
    const N = {
      pts: n(p.pts, 3.4, [6, 8, 10]),
      reb: n(p.reb, 1.9, [4, 5, 6]),
      ast: n(p.ast, 1.15, [3, 4, 5]),
      stl: n(p.stl, 0.55, [2, 3, 3]),
      blk: n(p.blk, 0.5, [2, 2, 3]),
      tpm: n(p.tpm, 0.6, [2, 3, 3]),
    };
    N.fg = p.fga >= [4, 6, 8][tier] && p.fgm >= [3, 4, 5][tier] && p.fgPct >= 0.5
      ? Math.min(3, (p.fgPct - 0.38) / 0.16 + (p.fgm === p.fga ? 0.4 : 0)) : 0;
    N.tp = N.tpm > 0 ? (p.tpPct >= 0.4 ? N.tpm + (p.tpPct - 0.4) * 1.5 : N.tpm * 0.7) : 0;
    const ftMin = [4, 6, 8][tier];
    N.ft = p.fta >= ftMin && p.ftPct >= 0.8 ? Math.min(2, 0.55 + 0.3 * (p.ftm / ftMin) + (p.ftm === p.fta ? 0.3 : 0)) : 0;
    N.pf = s ? foulLevel(p.pf, s) : 0;
    return N;
  }

  const combo = (x, y) => (x > 0 && y > 0 ? Math.sqrt(x * y) * 1.12 + 0.15 : 0);
  const dd = (p, a, b) => (p[a] >= 10 && p[b] >= 10 ? 0.5 : 0);
  const shotParts = (p) => [{ v: ma(p.fgm, p.fga), l: 'FG' }].concat(p.tpa ? [{ v: ma(p.tpm, p.tpa), l: '3PT' }] : [], p.fta ? [{ v: ma(p.ftm, p.fta), l: 'FT' }] : []);

  // Player pops. `name` is the label on the board; change it here to match the graphics software's buttons.
  const POPS = [
    { id: 'pts', name: 'Points', uses: ['pts'],
      score: (p, N) => N.pts,
      parts: (p) => [{ v: p.pts, l: 'PTS' }].concat(shotParts(p)) },
    { id: 'shoot', name: 'Shooting', uses: ['fg'],
      score: (p, N) => (N.fg > 0 && N.pts > 0 ? 0.4 * N.pts + 0.7 * N.fg : 0),
      parts: (p) => [{ v: ma(p.fgm, p.fga), l: 'FG' }, { v: pc(p.fgPct), l: 'FG%' }].concat(p.tpa ? [{ v: ma(p.tpm, p.tpa), l: '3PT' }] : []) },
    { id: 'three', name: '3-Pointers', uses: ['tpm'],
      score: (p, N) => N.tp,
      parts: (p) => [{ v: ma(p.tpm, p.tpa), l: '3PT' }].concat(p.tpa >= 3 ? [{ v: pc(p.tpPct), l: '3P%' }] : []) },
    { id: 'ft', name: 'Free Throws', uses: ['ft'],
      score: (p, N) => N.ft, parts: (p) => [{ v: ma(p.ftm, p.fta), l: 'FT' }] },
    { id: 'reb', name: 'Rebounds', uses: ['reb'],
      score: (p, N) => N.reb,
      parts: (p) => [{ v: p.reb, l: 'REB' }].concat(p.oreb + p.dreb === p.reb && p.oreb ? [{ v: p.oreb, l: 'OFF' }, { v: p.dreb, l: 'DEF' }] : []) },
    { id: 'ast', name: 'Assists', uses: ['ast'],
      score: (p, N) => N.ast, parts: (p) => [{ v: p.ast, l: 'AST' }].concat(p.to ? [{ v: p.to, l: 'TO' }] : []) },
    { id: 'stl', name: 'Steals', uses: ['stl'],
      score: (p, N) => N.stl, parts: (p) => [{ v: p.stl, l: 'STL' }] },
    { id: 'blk', name: 'Blocks', uses: ['blk'],
      score: (p, N) => N.blk, parts: (p) => [{ v: p.blk, l: 'BLK' }] },
    { id: 'ptsreb', name: 'Points & Rebounds', uses: ['pts', 'reb'],
      score: (p, N) => combo(N.pts, N.reb) + dd(p, 'pts', 'reb'),
      parts: (p) => [{ v: p.pts, l: 'PTS' }, { v: p.reb, l: 'REB' }] },
    { id: 'ptsast', name: 'Points & Assists', uses: ['pts', 'ast'],
      score: (p, N) => combo(N.pts, N.ast) + dd(p, 'pts', 'ast'),
      parts: (p) => [{ v: p.pts, l: 'PTS' }, { v: p.ast, l: 'AST' }] },
    { id: 'line', name: 'Points, Reb & Ast', uses: ['pts', 'reb', 'ast'],
      score: (p, N) => (N.pts > 0 && N.reb > 0 && N.ast > 0 ? Math.cbrt(N.pts * N.reb * N.ast) * 1.2 + 0.15
        + ([p.pts, p.reb, p.ast].every((v) => v >= 10) ? 1 : 0) : 0),
      parts: (p) => [{ v: p.pts, l: 'PTS' }, { v: p.reb, l: 'REB' }, { v: p.ast, l: 'AST' }] },
    { id: 'rebblk', name: 'Rebounds & Blocks', uses: ['reb', 'blk'],
      score: (p, N) => combo(N.reb, N.blk),
      parts: (p) => [{ v: p.reb, l: 'REB' }, { v: p.blk, l: 'BLK' }] },
    { id: 'stlblk', name: 'Steals & Blocks', uses: ['stl', 'blk'],
      score: (p, N) => combo(N.stl, N.blk),
      parts: (p) => [{ v: p.stl, l: 'STL' }, { v: p.blk, l: 'BLK' }] },
    { id: 'pf', name: 'Fouls', uses: ['pf'],
      score: (p, N) => N.pf, parts: (p) => [{ v: p.pf, l: 'PF' }] },
  ];

  const WORDS = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks', tpm: 'threes' };
  const ACTIVITY_MINS = { pts: 6, reb: 4, ast: 3, stl: 2, blk: 2 };
  const activity = (p) => Object.keys(ACTIVITY_MINS).reduce((a, f) => a + p[f] / ACTIVITY_MINS[f], 0);

  function badges(p, N) {
    const out = [];
    if (p.pf >= 5) out.push('Fouled out');
    else if (N.pf >= 1) out.push('Foul trouble');
    const cats = ['pts', 'reb', 'ast', 'stl', 'blk'];
    const tens = cats.filter((f) => p[f] >= 10);
    if (tens.length >= 3) out.push('Triple-double');
    else if (tens.length === 2) out.push('Double-double');
    else if (tens.length === 1) {
      const near = cats.filter((f) => p[f] >= 8 && p[f] < 10).sort((a, b) => p[b] - p[a])[0];
      if (near) out.push(`${10 - p[near]} ${WORDS[near].replace(/s$/, p[near] === 9 ? '' : 's')} from a double-double`);
    }
    if (p.fgm >= 4 && p.fgm === p.fga) out.push('Perfect from the field');
    return out;
  }

  // ------------------------------------------------------------ play parsing

  const ACTS = {
    three: { stat: 'tpm', label: '3-pointer', w: 1.2 }, dunk: { stat: 'pts', label: 'Dunk', w: 1.2 },
    layup: { stat: 'pts', label: 'Layup', w: 1 }, fg: { stat: 'pts', label: 'Basket', w: 1 },
    ft: { stat: 'pts', label: 'Free throw', w: 0.4 }, rebound: { stat: 'reb', label: 'Rebound', w: 0.5 },
    oreb: { stat: 'reb', label: 'Offensive rebound', w: 0.7 }, assist: { stat: 'ast', label: 'Assist', w: 0.7 },
    steal: { stat: 'stl', label: 'Steal', w: 1 }, block: { stat: 'blk', label: 'Block', w: 1 },
  };

  // Reads one play line in StatCrew style ("GOOD! 3 PTR by SMITH,JOHN", "REBOUND (DEF) by ...") or in
  // sentence style ("John Smith made 3-pt. jump shot (assist by ...)"). tools = { namesIn, teamIn }.
  function parsePlay(text, snapshot, index, tools) {
    const out = { text, server: null, actor: null, act: null, positive: false, blockers: [], assister: null, alert: null, extras: [] };
    const s = String(text || '').trim();
    const team = tools.teamIn(s, snapshot);
    if (/\btime[- ]?out\b/i.test(s)) out.alert = { kind: 'timeout', side: /media|\btv\b|official/i.test(s) ? null : team };
    else if (/technical|flagrant|eject/i.test(s)) out.alert = { kind: 'penalty', side: team };
    else if (/\b(video |official )?review\b|\bmonitor\b/i.test(s)) out.alert = { kind: 'challenge', side: team };
    else if (/\bsubs?\b\s*(in|out)?\s*:|substitution|\benters\b|goes to the bench/i.test(s)) out.alert = { kind: 'sub', side: team };

    const am = s.match(/assist(?:ed)?\s+by\s+([^.;)]+)/i);
    if (am) out.assister = tools.namesIn(am[1], index)[0] || null;
    const core = am ? s.replace(am[0], ' ') : s;
    const names = tools.namesIn(core, index);
    const missed = /\bmiss(ed|es)?\b/i.test(core);
    const made = !missed && /\b(good!?|made|makes|scores?)\b/i.test(core);
    const set = (act, positive) => { out.act = act; out.actor = names[0] || null; out.positive = positive; };

    if (made) {
      if (/free throw|\bft\b/i.test(core)) set('ft', true);
      else if (/\b3[- ]?(pt|ptr|pointer|point)s?\b|\bthree\b/i.test(core)) set('three', true);
      else if (/\bdunk\b/i.test(core)) set('dunk', true);
      else if (/\blay-?up\b/i.test(core)) set('layup', true);
      else set('fg', true);
      if (out.assister) out.extras.push({ ...out.assister, act: 'assist' });
    } else if (missed) set('miss', false);
    else if (/\bblock(ed|s)?\b/i.test(core)) set('block', true);
    else if (/\bsteals?\b/i.test(core)) set('steal', true);
    else if (/\brebound\b/i.test(core)) { if (!/dead ?ball|\bteam\b/i.test(core)) set(/\boff/i.test(core) ? 'oreb' : 'rebound', true); }
    else if (/\bassist\b/i.test(s)) { set('assist', true); out.actor = out.assister || names[0] || null; }
    else if (/turnover|turnovr|travel|bad pass/i.test(core)) set('turnover', false);
    else if (/\bfoul\b/i.test(core)) set('foul', false);
    else if (names[0]) out.actor = names[0];
    if (!out.actor) out.positive = false;
    if (out.actor && !out.positive) out.actor = { ...out.actor, negative: true };
    return out;
  }

  // ------------------------------------------------------------ tracking

  const freshMem = () => ({
    last: null,          // { period, score, stats: key -> derived line, totals: {home,away}, sig }
    scoring: [],         // { side, key|null, n, t, tick } per scoring event, oldest first
    periodStart: null,   // { period, totals: {home,away}, exact }
    foulBase: null,      // { fouls: {home,away}, exact }: team fouls when this half or quarter began
    finished: null,      // { period, label, tick, stats: {home,away}, pts: {home,away} }
    lastFg: { home: null, away: null },    // game seconds at each team's last made field goal
    foulAlerts: [],      // { tick, text, sub }
    bonusAt: { home: null, away: null },
    leader: null, leadAlert: null,
    view: null,
  });

  const sigOf = (s) => JSON.stringify([s.status, s.period, !!s.intermission, s.score,
    SIDES.map((side) => s.teams[side].players.map((p) => FIELDS.map((f) => num(p[f])).join(',')).join(';'))]);

  const teamFouls = (s, side) => {
    const t = s.teams[side];
    return t.totals && num(t.totals.pf) > 0 ? num(t.totals.pf) : t.players.reduce((a, p) => a + num(p.pf), 0);
  };
  const diffLine = (a, b) => { const d = { uni: 'TM' }; for (const f of FIELDS) d[f] = num(a[f]) - num(b[f]); return derive(d); };

  // Runs once per update, before the play lines are read. Advances the play counter when anything
  // changed, attributes new points to players, and sets a "just now" pin from the box-score change
  // itself, so the board reacts even when the page's play-by-play wording is not recognised.
  function track(ctx, s) {
    const mem = ctx.mem, b = mem.bb, t = elapsed(s);
    const stats = {};
    for (const side of SIDES) for (const p of s.teams[side].players) stats[playerKey(side, p.uni)] = derive(p);
    const totals = { home: teamTotals(s.teams.home), away: teamTotals(s.teams.away) };
    const cur = { period: num(s.period), score: { home: num(s.score.home), away: num(s.score.away) }, stats, totals, sig: sigOf(s) };
    const fouls = { home: teamFouls(s, 'home'), away: teamFouls(s, 'away') };
    const prev = b.last;
    b.last = cur;
    if (!prev) {
      const fromTip = cur.score.home + cur.score.away === 0 && fouls.home + fouls.away === 0;
      b.periodStart = { period: cur.period, totals, exact: fromTip };
      b.foulBase = { fouls: fromTip ? fouls : { home: 0, away: 0 }, exact: fromTip };
      b.leader = cur.score.home === cur.score.away ? null : cur.score.home > cur.score.away ? 'home' : 'away';
      mem.lastScore = { set: cur.period, home: cur.score.home, away: cur.score.away };
      return false;
    }
    if (cur.sig === prev.sig) return false;
    mem.rally += 1;
    mem.lastScore = { set: cur.period, home: cur.score.home, away: cur.score.away };
    const P = periodsOf(s);

    // A new period: close the old one out (for the period summary line) and start the foul count again
    // (overtime carries the last regulation period's fouls).
    if (cur.period > prev.period && prev.period > 0) {
      // The break was only seen if this update is a small step from the last one. After a jump (the page
      // was paused over the break, or a different part of the game was loaded) the last reading is not
      // the end of the old period, so the new period's fouls and the old period's summary are unknown.
      const jump = cur.period - prev.period > 1
        || Math.abs(cur.score.home + cur.score.away - prev.score.home - prev.score.away) > 8
        || Math.abs(fouls.home + fouls.away - prev.totals.home.pf - prev.totals.away.pf) > 3;
      if (jump) {
        b.periodStart = { period: cur.period, totals, exact: false };
        b.foulBase = { fouls: { home: 0, away: 0 }, exact: false };
        b.bonusAt = { home: null, away: null };
      } else {
        closePeriod(ctx, s, prev);
        b.periodStart = { period: cur.period, totals: prev.totals, exact: true };
        if (cur.period <= P) { b.foulBase = { fouls: { home: prev.totals.home.pf, away: prev.totals.away.pf }, exact: true }; b.bonusAt = { home: null, away: null }; }
      }
    } else if (s.intermission && (!b.finished || b.finished.period !== cur.period)) {
      closePeriod(ctx, s, cur);
    }

    // Who scored. One event per scorer; points the box score has not caught up with wait as key null.
    for (const side of SIDES) {
      const ds = cur.score[side] - prev.score[side];
      const scorers = [];
      for (const p of s.teams[side].players) {
        const k = playerKey(side, p.uni), was = prev.stats[k];
        const dp = was ? stats[k].pts - was.pts : 0;
        if (dp > 0 && dp <= 6) scorers.push({ key: k, n: dp });
      }
      if (ds > 0 && ds <= 8) {
        const sum = scorers.reduce((a, x) => a + x.n, 0);
        if (scorers.length && sum === ds) for (const x of scorers) b.scoring.push({ side, key: x.key, n: x.n, t, tick: mem.rally });
        else b.scoring.push({ side, key: scorers.length === 1 ? scorers[0].key : null, n: ds, t, tick: mem.rally });
      } else if (ds === 0 && scorers.length === 1) {
        // The box caught up with a basket already on the scoreboard: name its scorer.
        const open = b.scoring.slice().reverse().find((x) => x.side === side && x.key === null && x.n === scorers[0].n && mem.rally - x.tick <= 6);
        if (open) open.key = scorers[0].key;
      }
      if (totals[side].fgm > prev.totals[side].fgm) b.lastFg[side] = t;
    }
    if (b.scoring.length > 120) b.scoring.splice(0, b.scoring.length - 120);

    // Box-score pins: the most telling thing that changed on each side.
    const ORDER = ['three', 'fg', 'block', 'steal', 'assist', 'oreb', 'ft', 'rebound'];
    for (const side of SIDES) {
      let best = null;
      for (const p of s.teams[side].players) {
        const k = playerKey(side, p.uni), now = stats[k], was = prev.stats[k];
        if (!was) continue;
        const up = (f) => { const d = now[f] - was[f]; return d > 0 && d <= 3; };
        const act = up('tpm') ? 'three' : up('fgm') ? 'fg' : up('blk') ? 'block' : up('stl') ? 'steal' : up('ast') ? 'assist'
          : up('oreb') ? 'oreb' : up('ftm') ? 'ft' : up('reb') ? 'rebound' : null;
        if (act) {
          mem.involvement.push({ rally: mem.rally, key: k, w: ACTS[act].w });
          if (!best || ORDER.indexOf(act) < ORDER.indexOf(best.act)) best = { key: k, act };
        }
        // Foul trouble: the foul that takes a player to a level worth knowing about.
        if (now.pf > was.pf && now.pf - was.pf <= 2 && foulLevel(now.pf, s) >= 1 && foulLevel(now.pf, s) > foulLevel(was.pf, s)) {
          b.foulAlerts.push({ tick: mem.rally, text: (now.pf >= 5 ? 'Fouled out' : 'Foul trouble') + ` · ${s.teams[side].code} #${now.uni} ${now.last}`, sub: `${now.pf} fouls` });
        }
      }
      if (best) mem.pins[side] = { key: best.key, stat: ACTS[best.act].stat, label: ACTS[best.act].label, rally: mem.rally };
    }
    b.foulAlerts = b.foulAlerts.filter((a) => mem.rally - a.tick <= 4);

    // Bonus: the play on which a team's fouls first put the other team at the line.
    for (const side of SIDES) {
      const bn = bonusOf(b, s, side);
      if (bn && !b.bonusAt[side]) b.bonusAt[side] = { tick: mem.rally, text: bn };
      else if (bn && b.bonusAt[side].text !== bn) b.bonusAt[side] = { tick: mem.rally, text: bn };
    }

    // Lead changes and ties, once the game has settled (five minutes in).
    const lead = cur.score.home === cur.score.away ? null : cur.score.home > cur.score.away ? 'home' : 'away';
    if (lead !== b.leader && t >= 300 && cur.score.home + cur.score.away > prev.score.home + prev.score.away) {
      b.leadAlert = lead ? { tick: mem.rally, text: `${s.teams[lead].code} takes the lead`, sub: `${cur.score[lead]}–${cur.score[other(lead)]}` }
        : { tick: mem.rally, text: `Tied at ${cur.score.home}`, sub: '' };
    }
    b.leader = lead;
    if (mem.consoleAlert && mem.consoleAlert.rally < mem.rally - 3) mem.consoleAlert = null;
    return true;
  }

  function closePeriod(ctx, s, at) {
    const b = ctx.mem.bb;
    if (!b.periodStart || !b.periodStart.exact || (b.finished && b.finished.period === at.period)) return;
    const label = periodLabel({ ...s, status: 'live', intermission: false, period: at.period });
    b.finished = { period: at.period, label, tick: ctx.mem.rally,
      stats: { home: diffLine(at.totals.home, b.periodStart.totals.home), away: diffLine(at.totals.away, b.periodStart.totals.away) } };
  }

  // Team fouls this half (or quarter). exact is false when the reader started partway through it,
  // and then n is the team's fouls for the whole game.
  function foulsOf(b, s, side) {
    const total = teamFouls(s, side);
    if (!b.foulBase || !b.foulBase.exact) return { n: total, exact: false };
    return { n: Math.max(0, total - b.foulBase.fouls[side]), exact: true };
  }
  // What `side`'s fouls have given the other team: '' | 'Bonus' | 'Double bonus'.
  function bonusOf(b, s, side) {
    const f = foulsOf(b, s, side);
    if (!f.exact) return '';
    if (periodsOf(s) === 4) return f.n >= 5 ? 'Bonus' : '';
    return f.n >= 10 ? 'Double bonus' : f.n >= 7 ? 'Bonus' : '';
  }

  // Runs, in points. active: unanswered points right now. ext: the best "14-3" stretch that is still going.
  function runs(b, side) {
    const sc = b.scoring;
    let active = 0, i = sc.length - 1;
    for (; i >= 0 && sc[i].side === side; i--) active += sc[i].n;
    const startT = active && sc[i + 1] ? (i >= 0 ? sc[i].t : sc[i + 1].t) : null;
    let ext = null;
    if (sc.length && sc[sc.length - 1].side === side) {
      let a = 0, o = 0;
      for (let j = sc.length - 1; j >= 0; j--) {
        if (sc[j].side === side) a += sc[j].n; else o += sc[j].n;
        if (o > 5) break;
        if (o > 0 && sc[j].side === side && a >= 9 && a - o >= 7 && a >= 3 * o && (!ext || a - o > ext.a - ext.b)) ext = { a, b: o, t: j > 0 ? sc[j - 1].t : sc[j].t };
      }
    }
    return { active, startT, ext };
  }

  // A player scoring his team's points by himself: "9 straight MSU points".
  function hotOf(ctx, side) {
    const b = ctx.mem.bb;
    const mine = b.scoring.filter((x) => x.side === side);
    if (!mine.length) return null;
    const lastOne = mine[mine.length - 1];
    if (!lastOne.key || ctx.mem.rally - lastOne.tick > 12) return null;
    let n = 0;
    for (let i = mine.length - 1; i >= 0 && mine[i].key === lastOne.key; i--) n += mine[i].n;
    return n >= 7 ? { key: lastOne.key, n } : null;
  }

  // ------------------------------------------------------------ team card lines

  function teamCards(ctx, s, side, e) {
    const mem = ctx.mem, b = mem.bb;
    const T = teamTotals(s.teams[side]), O = teamTotals(s.teams[other(side)]);
    const code = s.teams[side].code, oc = s.teams[other(side)].code;
    const X = s.teams[side].extra || null, XO = s.teams[other(side)].extra || null;
    const c = [];
    const now = elapsed(s), clocked = clockSecs(s.clock) != null;

    const fin = b.finished;
    if (fin && (s.intermission || mem.rally - fin.tick <= 6)) {
      const A = fin.stats[side], B = fin.stats[other(side)];
      if (A.fga > 0) c.push({ id: 'persum', score: 9, big: `${fin.label}: ${A.pts} PTS, ${pc(A.fgPct)} FG%`, sub: `${oc} ${B.pts} PTS, ${pc(B.fgPct)} FG%` });
    }

    const r = runs(b, side);
    const own = num(s.score[side]), opp = num(s.score[other(side)]);
    const span = (t0) => (clocked && t0 != null && now - t0 >= 20 ? `over ${mmss(now - t0)}` : '');
    if (r.active >= 6) {
      c.push({ id: 'run', score: 10 + r.active / 2, live: true, big: `${r.active}-0 Scoring Run`,
        sub: [span(r.startT), `from ${own - r.active}–${opp}`].filter(Boolean).join(' · ') });
    } else if (r.ext) {
      c.push({ id: 'run', score: 8 + (r.ext.a - r.ext.b) * 0.3, live: true, big: `${r.ext.a}-${r.ext.b} Run`,
        sub: [span(r.ext.t), `from ${own - r.ext.a}–${opp - r.ext.b}`].filter(Boolean).join(' · ') });
    }

    // Field-goal drought, only when the page gives a game clock and the reader has seen this team's last make.
    if (clocked && s.status === 'live' && !s.intermission && b.lastFg[side] != null && now - b.lastFg[side] >= 240) {
      const mins = Math.floor((now - b.lastFg[side]) / 60);
      c.push({ id: 'drought', score: 1.6 + mins / 4, big: `No Field Goal in ${mins}+ Min`, sub: `last ${code} basket ${mmss(now - b.lastFg[side])} ago` });
    }

    const bn = bonusOf(b, s, other(side));
    if (bn && s.status === 'live') {
      const f = foulsOf(b, s, other(side));
      c.push({ id: 'bonus', score: 1.2 + (bn === 'Double bonus' ? 0.3 : 0), big: `In the ${bn}`, sub: `${oc} ${f.n} team fouls this ${periodWord(s)}` });
    }

    if (T.fga >= 15) {
      const d = T.fgPct - (O.fga >= 15 ? O.fgPct : T.fgPct);
      const n = (T.fgPct - 0.42) / 0.05 + Math.max(0, d) / 0.06;
      if (T.fgPct >= 0.47 && n >= 1) c.push({ id: 'fg', score: Math.min(4, n), big: `Team FG% ${pc(T.fgPct)}`, sub: `${ma(T.fgm, T.fga)} · ${oc} ${pc(O.fgPct)} (${ma(O.fgm, O.fga)})` });
    }
    if (T.tpa >= 8 && T.tpm >= 4 && (T.tpPct >= 0.4 || T.tpm >= O.tpm + 4)) {
      c.push({ id: 'tp', score: 0.9 + (T.tpPct - 0.33) / 0.07 * 0.5 + Math.max(0, T.tpm - O.tpm) / 4, big: `Team 3PT ${ma(T.tpm, T.tpa)}`, sub: `${pc(T.tpPct)}% · ${oc} ${ma(O.tpm, O.tpa)}` });
    }
    const rebSub = `${T.oreb ? T.oreb + ' offensive · ' : ''}${oc} ${O.reb}`;
    if (T.reb >= 8 && (T.reb >= O.reb + 6 || (T.oreb >= 2.5 * e && T.oreb >= O.oreb + 3))) {
      c.push({ id: 'reb', score: 0.9 + (T.reb - O.reb) / 6, big: `${T.reb} Team Rebounds`, sub: rebSub });
    }
    if (O.to >= Math.max(5, 3.6 * e) && O.to >= T.to + 3) {
      c.push({ id: 'tof', score: 1 + (O.to - T.to) / 4, big: `${O.to} Turnovers Forced`, sub: `${T.stl} steals · ${code} ${T.to} turnovers` });
    }
    if (T.fgm >= 10 && T.ast >= 0.62 * T.fgm && T.ast >= O.ast + 4) {
      c.push({ id: 'ast', score: 0.9 + (T.ast - O.ast) / 5, big: `${T.ast} Team Assists`, sub: `on ${T.fgm} made FG · ${oc} ${O.ast}` });
    }
    if (T.blk >= Math.max(3, 1.3 * e) && T.blk >= O.blk + 2) c.push({ id: 'blk', score: 0.9 + (T.blk - O.blk) / 3, big: `${T.blk} Team Blocks`, sub: `${oc} ${O.blk}` });
    if (T.stl >= Math.max(4, 2 * e) && T.stl >= O.stl + 3) c.push({ id: 'stl', score: 0.9 + (T.stl - O.stl) / 4, big: `${T.stl} Team Steals`, sub: `${oc} ${O.stl}` });
    if (T.fta >= 8 && (T.ftPct >= 0.85 || T.fta >= O.fta + 8)) {
      c.push({ id: 'ft', score: 0.85 + Math.max(0, T.fta - O.fta) / 10, big: `Team FT ${ma(T.ftm, T.fta)}`, sub: `${pc(T.ftPct)}% · ${oc} ${ma(O.ftm, O.fta)}` });
    }
    // Team extras, when the page lists them (points in the paint, off turnovers, bench and so on).
    if (X && XO) {
      const ex = (id, label, lead, base) => {
        const a = num(X[id]), o = num(XO[id]);
        if (X[id] != null && XO[id] != null && a >= base && a >= o + lead) c.push({ id: 'x' + id, score: 0.9 + (a - o) / (lead * 2), big: `${a} ${label}`, sub: `${oc} ${o}` });
      };
      ex('paint', 'Points in the Paint', 8, 12); ex('offTo', 'Points off Turnovers', 6, 8);
      ex('bench', 'Bench Points', 8, 10); ex('fast', 'Fast Break Points', 6, 8); ex('second', '2nd Chance Points', 6, 8);
    }

    // Fillers: the everyday lines, greyed, so each team card always has something to read.
    const have = new Set(c.map((x) => x.id));
    const fill = (id, ok, ratio, big, sub) => {
      if (!have.has(id) && ok) c.push({ id, dim: true, score: 0.05 + 0.5 * Math.max(0, Math.min(1, ratio)), big, sub });
    };
    const pl = (n, word) => `${n} Team ${word}${+n === 1 ? '' : 's'}`;
    fill('fg', T.fga >= 4, (T.fgPct - 0.3) / 0.25, `Team FG% ${pc(T.fgPct)}`, `${ma(T.fgm, T.fga)} · ${oc} ${pc(O.fgPct)} (${ma(O.fgm, O.fga)})`);
    fill('reb', T.reb > 0, T.reb / (9 * e), pl(T.reb, 'Rebound'), rebSub);
    fill('tp', T.tpa > 0, T.tpm / (2 * e), `Team 3PT ${ma(T.tpm, T.tpa)}`, `${oc} ${ma(O.tpm, O.tpa)}`);
    fill('ast', T.ast > 0, T.ast / (3.5 * e), pl(T.ast, 'Assist'), `on ${T.fgm} made FG · ${oc} ${O.ast}`);
    fill('ft', T.fta >= 2, T.ftm / (4 * e), `Team FT ${ma(T.ftm, T.fta)}`, `${oc} ${ma(O.ftm, O.fta)}`);
    fill('tof', O.to > 0, O.to / (3.5 * e), `${O.to} Turnover${O.to === 1 ? '' : 's'} Forced`, `${code} ${T.to} turnovers`);
    if (s.status === 'pre' && !c.length) {
      c.push({ id: 'fg', dim: true, score: 0.06, big: 'Team FG% 0.0', sub: `${oc} 0.0` });
      c.push({ id: 'reb', dim: true, score: 0.05, big: '0 Team Rebounds', sub: `${oc} 0` });
      c.push({ id: 'tp', dim: true, score: 0.04, big: 'Team 3PT 0-0', sub: `${oc} 0-0` });
    }
    return c;
  }

  // ------------------------------------------------------------ alerts, header

  function alerts(ctx, s) {
    const mem = ctx.mem, b = mem.bb, out = [];
    const P = periodsOf(s), per = num(s.period);
    const h = num(s.score.home), a = num(s.score.away);
    if (s.status === 'final') {
      const w = h >= a ? 'home' : 'away';
      out.push({ kind: 'final', sev: 'info', text: `Final · ${s.teams[w].code} wins ${s.score[w]}–${s.score[other(w)]}${per > P ? ' · OT' : ''}` });
      return out;
    }
    if (s.intermission && s.status === 'live') out.push({ kind: 'break', sev: 'info', text: periodLabel(s), sub: `${s.teams.home.code} ${h}–${a} ${s.teams.away.code}` });
    // Late and close: the last two minutes of regulation or overtime, one possession apart.
    const c = clockSecs(s.clock);
    if (!s.intermission && s.status === 'live' && per >= P && c != null && c <= 120 && Math.abs(h - a) <= 3) {
      out.push({ kind: 'close', sev: 'crit', text: h === a ? 'Tie game' : 'One-possession game', sub: `${s.clock} left` });
    }
    for (const fa of b.foulAlerts) out.push({ kind: 'foul', sev: 'warn', text: fa.text, sub: fa.sub });
    for (const side of SIDES) {
      const at = b.bonusAt[side];
      if (at && mem.rally - at.tick <= 4) out.push({ kind: 'bonus', sev: 'info', text: `${s.teams[other(side)].code} in the ${at.text.toLowerCase()}`, sub: `${s.teams[side].code} ${foulsOf(b, s, side).n} team fouls` });
    }
    if (b.leadAlert && mem.rally - b.leadAlert.tick <= 2) out.push({ kind: 'lead', sev: 'quiet', text: b.leadAlert.text, sub: b.leadAlert.sub });
    if (mem.consoleAlert) {
      const ca = mem.consoleAlert;
      const words = { timeout: 'Timeout', challenge: 'Review', penalty: 'Technical', sub: 'Substitution' };
      const sev = { timeout: 'info', challenge: 'violet', penalty: 'warn', sub: 'quiet' }[ca.kind];
      out.push({ kind: ca.kind, sev, text: words[ca.kind] + (ca.side ? ' · ' + s.teams[ca.side].code : ''), sub: ca.text });
    }
    return out;
  }

  // The parts of the view that belong to basketball: period and clock, team fouls, the margin line and leaders.
  function header(ctx, s) {
    const b = ctx.mem.bb;
    const h = num(s.score.home), a = num(s.score.away);
    const fouls = {}, leaders = {};
    for (const side of SIDES) {
      const f = foulsOf(b, s, side);
      fouls[side] = { n: f.n, exact: f.exact, bonus: bonusOf(b, s, side) };
      const ps = s.teams[side].players.map(derive);
      leaders[side] = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST']].map(([f2, l]) => {
        const top = ps.slice().sort((x, y) => y[f2] - x[f2])[0];
        return top && top[f2] > 0 ? { l, v: top[f2], uni: top.uni, last: top.last } : { l, v: 0, uni: '', last: '' };
      });
    }
    let info = '';
    if (s.status !== 'pre') {
      const lead = h === a ? null : h > a ? 'home' : 'away';
      info = lead ? `${s.teams[lead].code} by ${Math.abs(h - a)}` : `Tied at ${h}`;
      for (const side of SIDES) {
        const r = runs(b, side);
        if (r.active >= 6) info += ` · ${s.teams[side].code} on a ${r.active}-0 run`;
        else if (r.ext) info += ` · ${s.teams[side].code} on a ${r.ext.a}-${r.ext.b} run`;
      }
    }
    return { period: { label: periodLabel(s), clock: s.status === 'live' && !s.intermission && clockSecs(s.clock) != null ? String(s.clock) : '',
      n: num(s.period), of: periodsOf(s), word: periodWord(s) }, fouls, leaders, info };
  }

  const listStats = (p) => ({ pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, fg: ma(p.fgm, p.fga), tp: ma(p.tpm, p.tpa),
    ft: ma(p.ftm, p.fta), pf: p.pf, to: p.to, min: p.min });

  const api = {
    id: 'bb', FIELDS, POPS, WORDS, ACTS, derive, teamTotals, norms, badges, activity, parsePlay, eff, elapsed, clockSecs,
    periodLabel, periodsOf, foulLevel, freshMem, track, teamCards, alerts, header, hotOf, listStats, sigOf,
    // Cadence, in plays (score or stat changes): about three plays to one volleyball rally.
    cfg: { passRallies: 25, dwellRallies: 8, pinWindow: 2, recentWindow: 30 },
    activeFields: ['pts', 'reb', 'ast', 'stl', 'blk', 'pf'],
    leadFields: ['pts', 'reb', 'ast', 'stl', 'blk'],
    highMins: { pts: 10, reb: 6, ast: 4, stl: 3, blk: 3 },
    highWord: 'Game-high',
    singleMins: { pts: 6, reb: 4, ast: 3, stl: 2, blk: 2, tpm: 2 },
    singleOk: (x) => ['pts', 'reb', 'ast', 'stl', 'blk', 'three'].includes(x.id),
    // A "just now" pin only takes a card when the stat behind it is worth reading: already notable,
    // or the second-plus three, steal or block.
    pinWorthy: (p, N, pin) => (N[pin.stat] > 0) || (['tpm', 'stl', 'blk'].includes(pin.stat) && p[pin.stat] >= 2),
    pinWhen: (d) => (d === 0 ? 'Just now · ' : 'Moments ago · '),
    passText: 'Skip this player for the next few minutes',
    unit: ['play', 'plays'],
  };
  root.PopBasketball = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
