/* Stat Pop Board 0.5.1: reads only the page you have open and shares it with the board window on this computer. */
(function () {
'use strict';
if (window.SPB && window.SPB.version) { if (!window.__spbNoReader && window.SPB.show) window.SPB.show(); return; }
var cs = document.currentScript;
var SPB = { version: "0.5.1" };
SPB.origin = window.__spbOrigin || (cs && cs.src ? new URL(cs.src, location.href).origin : null) || "https://stat-pop-board.vercel.app";
SPB.cssHref = SPB.origin ? SPB.origin + '/assets/board.css?v=0.5.1' : null;
SPB.fontsHref = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap";
SPB.rosters = { msuVolleyball: [{"uni":"2","first":"Lauren","last":"Greeny","pos":"OH"},{"uni":"5","first":"Keely","last":"Culler","pos":"OH"},{"uni":"6","first":"Teagan","last":"Jaynes","pos":"S"},{"uni":"7","first":"Lauren","last":"Schloe","pos":"MB/OPP"},{"uni":"9","first":"Maggie","last":"Rhew","pos":"S/DS"},{"uni":"11","first":"Elli","last":"Esko","pos":"OH"},{"uni":"12","first":"Afton","last":"Thomsen","pos":"L/DS"},{"uni":"13","first":"Jolene","last":"Green Ewen","pos":"MB"},{"uni":"14","first":"Taylor","last":"McDonald","pos":"MH/OPP"},{"uni":"15","first":"Teya","last":"Yeomans","pos":"OH"},{"uni":"16","first":"Haven","last":"Rich","pos":"L/DS"},{"uni":"17","first":"Alice","last":"Steman","pos":"MB"},{"uni":"18","first":"Karli","last":"Heidemann","pos":"OH"},{"uni":"22","first":"Joelie","last":"Spelts","pos":"MB"},{"uni":"23","first":"Elli","last":"Tufto","pos":"OH"},{"uni":"45","first":"Nicolette","last":"Noble","pos":"L/DS"}] };
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
})(SPB);

/*
 * PopEngine: turns a stats snapshot + new play-console lines into a small set of
 * pop-ready cards. Pure logic, no DOM. Runs in the browser and in Node (tests).
 *
 * Snapshot contract (what any page reader must produce):
 *   { sport:'vb', status:'pre'|'live'|'final', set:Number,
 *     score:{home,away}, setsWon:{home,away},
 *     teams:{ home:{code,name,players:[P], totals?:T}, away:{...} } }
 *   P = { uni, first, last, k, e, ta, a, sa, se, re, dig, bs, ba, be }
 *
 * Basketball (sport:'bb') has its own contract and rules in basketball.js. The engine picks the sport
 * from snapshot.sport on every update and starts over when it changes.
 */
(function (root) {
  'use strict';

  // The basketball rules: already on the page in the browser bundle, required in Node.
  const BB = root.PopBasketball || (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./basketball.js') : null);

  const SIDES = ['home', 'away'];
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const num = (v) => (Number.isFinite(+v) ? +v : 0);

  function fmtPct(v, lead) {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = Math.abs(v).toFixed(3);
    return (v < 0 ? '-' : '') + (lead ? s : s.replace(/^0/, ''));
  }
  const fmtHalf = (v) => String(Math.round(v * 2) / 2);
  const playerKey = (side, uni) => side + ':' + uni;
  const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

  // A star is {uni, last, first}. Same last name plus same number or first initial;
  // a star with no last name matches on number alone.
  function matchesStar(p, star) {
    if (!star) return false;
    if (!star.last) return String(star.uni) === String(p.uni);
    if (normName(star.last) !== normName(p.last)) return false;
    if (String(star.uni) === String(p.uni)) return true;
    const a = normName(star.first), b = normName(p.first);
    return !!a && !!b && a[0] === b[0];
  }

  function swapSides(s, on) {
    if (!on || !s) return s;
    return { ...s, score: { home: s.score.away, away: s.score.home },
      setsWon: s.setsWon ? { home: s.setsWon.away, away: s.setsWon.home } : { home: 0, away: 0 },
      teams: { home: s.teams.away, away: s.teams.home } };
  }

  // ---------------------------------------------------------------- volleyball

  function vbDerive(p) {
    const q = { uni: String(p.uni), first: p.first || '', last: p.last || '' };
    for (const f of ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be']) q[f] = num(p[f]);
    q.pct = q.ta > 0 ? (q.k - q.e) / q.ta : null;
    q.tb = q.bs + 0.5 * q.ba;
    q.pts = q.k + q.sa + q.bs + 0.5 * q.ba;
    return q;
  }

  // How far into the match we are, in sets. Thresholds scale with it, so
  // 5 kills is notable in set 1 and ordinary by set 4.
  function vbEffSets(s) {
    // Sets already played: from sets won, or from the current set number when set wins are unknown.
    const done = Math.max(num(s.setsWon && s.setsWon.home) + num(s.setsWon && s.setsWon.away), Math.max(0, num(s.set) - 1));
    const cur = Math.min(1, (num(s.score && s.score.home) + num(s.score && s.score.away)) / 46);
    return Math.max(0.75, done + cur);
  }

  // Notability of each stat: 0 = not worth a pop, ~1 = solid, 2-3 = standout.
  function vbNorms(p, e) {
    const n = (v, par, min) => (v >= min ? Math.min(3, v / (par * e)) : 0);
    const N = {
      k: n(p.k, 3.2, e < 1.3 ? 4 : 5),
      dig: n(p.dig, 3.2, e < 1.3 ? 5 : 6),
      a: n(p.a, 9.5, e < 1.3 ? 10 : 12),
      tb: n(p.tb, 0.9, e < 1.3 ? 2 : 3),
      sa: n(p.sa, 0.45, 2),
      pts: n(p.pts, 3.8, 8),
    };
    const minTA = e < 1.3 ? 8 : 10;
    N.pct = p.ta >= minTA && p.k >= 4 && p.pct >= 0.25
      ? Math.min(3, (p.pct - 0.15) / 0.15 + (p.e === 0 ? 0.35 : 0)) : 0;
    return N;
  }

  const combo = (x, y) => (x > 0 && y > 0 ? Math.sqrt(x * y) * 1.12 + 0.15 : 0);
  const hitPart = (p) => ({ v: fmtPct(p.pct), l: 'HIT' });

  // Player pops. `name` should match the button label in the graphics software.
  const VB_POPS = [
    { id: 'atk', name: 'Attacks', group: 'atk', uses: ['k'],
      score: (p, N) => (N.k > 0 && N.pct > 0 ? 0.45 * N.k + 0.75 * N.pct : 0),
      parts: (p) => [{ v: p.k, l: 'K' }, { v: p.e, l: 'E' }, { v: p.ta, l: 'TA' }, hitPart(p)] },
    { id: 'kills', name: 'Kills', group: 'atk', uses: ['k'],
      score: (p, N) => N.k,
      parts: (p) => [{ v: p.k, l: 'K' }].concat(p.ta >= 5 ? [hitPart(p)] : []) },
    { id: 'blk', name: 'Blocks', uses: ['tb'],
      score: (p, N) => N.tb,
      parts: (p) => [{ v: fmtHalf(p.tb), l: 'BLK' }].concat(p.bs ? [{ v: p.bs, l: 'SOLO' }] : [], p.ba ? [{ v: p.ba, l: 'AST' }] : []) },
    { id: 'dig', name: 'Digs', uses: ['dig'],
      score: (p, N) => N.dig, parts: (p) => [{ v: p.dig, l: 'DIG' }] },
    { id: 'ast', name: 'Assists', uses: ['a'],
      score: (p, N) => N.a, parts: (p) => [{ v: p.a, l: 'AST' }] },
    { id: 'ace', name: 'Aces', uses: ['sa'],
      score: (p, N) => N.sa, parts: (p) => [{ v: p.sa, l: 'ACE' }] },
    { id: 'atkblk', name: 'Attacks & Blocks', uses: ['k', 'tb'],
      score: (p, N) => combo(N.k, N.tb),
      parts: (p) => [{ v: p.k, l: 'K' }, hitPart(p), { v: fmtHalf(p.tb), l: 'BLK' }] },
    { id: 'atkdig', name: 'Attacks & Digs', uses: ['k', 'dig'],
      score: (p, N) => combo(N.k, N.dig) + (p.k >= 10 && p.dig >= 10 ? 0.5 : 0),
      parts: (p) => [{ v: p.k, l: 'K' }, hitPart(p), { v: p.dig, l: 'DIG' }] },
    { id: 'digblk', name: 'Digs & Blocks', uses: ['dig', 'tb'],
      score: (p, N) => combo(N.dig, N.tb),
      parts: (p) => [{ v: p.dig, l: 'DIG' }, { v: fmtHalf(p.tb), l: 'BLK' }] },
    { id: 'astdig', name: 'Assists & Digs', uses: ['a', 'dig'],
      score: (p, N) => combo(N.a, N.dig) + (p.a >= 10 && p.dig >= 10 ? 0.5 : 0),
      parts: (p) => [{ v: p.a, l: 'AST' }, { v: p.dig, l: 'DIG' }] },
    { id: 'pts', name: 'Points', uses: ['pts'],
      // Points mostly duplicates Kills for pure hitters, so it only ranks when aces/blocks add to it.
      score: (p, N) => N.pts * (p.pts - p.k >= 2 ? 0.9 : 0.35),
      parts: (p) => [{ v: fmtHalf(p.pts), l: 'PTS' }, { v: p.k, l: 'K' }].concat(p.sa ? [{ v: p.sa, l: 'ACE' }] : [], p.tb ? [{ v: fmtHalf(p.tb), l: 'BLK' }] : []) },
  ];

  const STAT_WORDS = { k: 'kills', dig: 'digs', a: 'assists', tb: 'blocks', sa: 'aces', pts: 'points' };

  // ------------------------------------------------------------ play parsing

  function buildNameIndex(snapshot) {
    const list = [];
    for (const side of SIDES) {
      const t = snapshot.teams && snapshot.teams[side];
      if (!t) continue;
      for (const p of t.players || []) {
        if (!p.last) continue;
        list.push({ side, uni: String(p.uni), first: p.first || '', last: p.last });
      }
    }
    const lastCount = {};
    for (const x of list) lastCount[x.last.toLowerCase()] = (lastCount[x.last.toLowerCase()] || 0) + 1;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const x of list) {
      const L = esc(x.last), F = esc(x.first);
      const pats = [];
      if (x.first) {
        pats.push(new RegExp('\\b' + L + ',\\s*' + F + '\\b', 'i'));
        pats.push(new RegExp('\\b' + F + '\\s+' + L + '\\b', 'i'));
        pats.push(new RegExp('\\b' + esc(x.first[0]) + '\\.\\s*' + L + '\\b', 'i'));
      }
      if (lastCount[x.last.toLowerCase()] === 1) pats.push(new RegExp('\\b' + L + '\\b', 'i'));
      x.pats = pats;
    }
    return list;
  }

  function namesIn(text, index) {
    const hits = [];
    for (const x of index) {
      let best = -1;
      for (const re of x.pats) {
        const m = re.exec(text);
        if (m && (best < 0 || m.index < best)) best = m.index;
      }
      if (best >= 0) hits.push({ side: x.side, uni: x.uni, at: best });
    }
    return hits.sort((a, b) => a.at - b.at);
  }

  function teamIn(text, snapshot) {
    for (const side of SIDES) {
      const t = snapshot.teams[side];
      const words = [t.code, t.name].filter(Boolean);
      for (const w of words) {
        if (new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) return side;
      }
    }
    return null;
  }

  // Reads one console line in either StatCrew style ("[Server] Kill by Last, First
  // (from Setter).") or plain-English style ("Lauren Greeny serves Ace, MSU wins a point").
  function parsePlay(text, snapshot, index) {
    const out = { text, server: null, actor: null, act: null, positive: false, blockers: [], assister: null, alert: null };
    let s = String(text || '').trim();
    const br = s.match(/^\[([^\]]+)\]\s*/);
    if (br) {
      const h = namesIn(br[1], index)[0];
      if (h) out.server = h;
      s = s.slice(br[0].length);
    }
    const team = teamIn(s, snapshot);
    if (/\btime[- ]?out\b/i.test(s)) out.alert = { kind: 'timeout', side: team };
    else if (/\bchallenge|video review|\breview(ed)?\b/i.test(s)) out.alert = { kind: 'challenge', side: team };
    else if (/\b(red|yellow) card|penalty|sanction|delay of game|misconduct/i.test(s)) out.alert = { kind: 'penalty', side: team };
    else if (/\bsubs?\b\s*:|substitution|\benters\b|\breplaces\b/i.test(s)) out.alert = { kind: 'sub', side: team };

    const bm = s.match(/\(block(?:ed)? by ([^)]+)\)/i) || s.match(/\bblocked by ([^.,]+)/i);
    if (bm) out.blockers = namesIn(bm[1], index);
    const am = s.match(/\(from ([^)]+)\)/i) || s.match(/\b(?:assist(?:ed)?|set) by ([^.,)]+)/i);
    if (am) out.assister = namesIn(am[1], index)[0] || null;

    const core = s.replace(/\([^)]*\)/g, ' ').replace(/block error by [^.,]+/i, ' ');
    const names = namesIn(core, index);
    const negative = /\b(miss(es|ed)?|error|fault|out of bounds|in the net|violation)\b/i.test(core);

    if (/service ace|\baces?\b/i.test(core) && !/service error/i.test(core)) {
      out.act = 'ace'; out.actor = out.server || names[0] || null; out.positive = true;
    } else if (/attack error|hitting error/i.test(core)) {
      out.act = 'attackError'; out.actor = names[0] || null;
      if (out.blockers.length) { out.act = 'block'; out.actor = out.blockers[0]; out.positive = true; }
    } else if (/serv(ice|e|ing) error|misses (the )?serve/i.test(core)) {
      out.act = 'serviceError'; out.actor = out.server || names[0] || null;
    } else if (/\bkills?\b/i.test(core)) {
      out.act = 'kill'; out.actor = names[0] || null; out.positive = !negative || /kill by/i.test(core);
    } else if (/\bblock(s|ed)?\b/i.test(core) && !/block error/i.test(core)) {
      out.act = 'block'; out.actor = out.blockers[0] || names[0] || null; out.positive = !negative;
    } else if (/\bdigs?\b/i.test(core)) {
      out.act = 'dig'; out.actor = names[0] || null; out.positive = !negative;
    } else if (names[0]) {
      out.actor = names[0];
    }
    if (out.actor && !out.positive && out.act !== 'ace') out.actor.negative = true;
    return out;
  }

  const ACT_STAT = { kill: 'k', ace: 'sa', block: 'tb', dig: 'dig' };
  const ACT_LABEL = { kill: 'Kill', ace: 'Ace', block: 'Block', dig: 'Dig' };

  // ------------------------------------------------------------------ engine

  // Rough "how much has this player done" for ranking filler cards: each stat over its pop minimum.
  const ACTIVITY_MINS = { k: 4, dig: 5, a: 10, tb: 2, sa: 2 };
  const activityOf = (p) => Object.keys(ACTIVITY_MINS).reduce((a, f) => a + p[f] / ACTIVITY_MINS[f], 0);

  // What the engine needs to know about a sport. Volleyball is defined here; basketball.js supplies the
  // same shape (plus track, teamCards, alerts and header, which volleyball keeps inside create()).
  const VB = {
    id: 'vb', pops: VB_POPS, words: STAT_WORDS, derive: vbDerive, norms: vbNorms, eff: vbEffSets, activity: activityOf,
    fields: ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be'],
    leadFields: ['k', 'dig', 'a', 'tb', 'sa'],
    highMins: { k: 5, dig: 6, a: 12, tb: 3, sa: 2 }, highWord: 'Match-high',
    singleMins: { k: 4, dig: 5, a: 10, tb: 2, sa: 1, pts: 8 },
    singleOk: (x, p) => x.id !== 'atk' && (x.id !== 'pts' || [p.k, p.sa, p.tb].filter((v) => v > 0).length >= 2),
    badges(p) {
      const out = [];
      if (p.k >= 8 && p.e === 0) out.push('0 errors');
      if (['k', 'dig', 'a'].filter((f) => p[f] >= 10).length >= 2) out.push('Double-double');
      return out;
    },
    act: (a) => ({ stat: ACT_STAT[a], label: ACT_LABEL[a], w: a === 'dig' ? 0.5 : 1 }),
    cfg: { passRallies: 10, dwellRallies: 4, pinWindow: 1, recentWindow: 12 },
    pinWorthy: () => true,
    pinWhen: (d) => (d === 0 ? 'Just now · ' : 'Last rally · '),
    listStats: (p) => ({ k: p.k, e: p.e, ta: p.ta, pct: fmtPct(p.pct), a: p.a, sa: p.sa, se: p.se, dig: p.dig,
      bs: p.bs, ba: p.ba, tb: fmtHalf(p.tb), pts: fmtHalf(p.pts) }),
    passText: 'Skip this player for the next 10 rallies',
    unit: ['rally', 'rallies'],
  };
  const BBS = BB ? { ...BB, pops: BB.POPS, words: BB.WORDS, fields: BB.FIELDS,
    act: (a) => BB.ACTS[a] || { stat: null, label: '', w: 1 } } : null;

  function create(opts) {
    opts = opts || {};
    const clock = opts.now || (() => Date.now());
    // minPops: options per player card, filling with greyed lines if needed. holdMs: how long Pin keeps a card.
    // dwellRallies: a card that just arrived gets a stickiness bonus for this many rallies, so cards don't flicker.
    // maxCards: player cards per side (3 or 5; the full-list layout highlights maxCards rows).
    // Team card: one per side with minTeamLines..maxTeamLines stat lines, notable ones first.
    let SP = VB;
    const cfg = { pops: VB_POPS, maxCards: 3, maxPops: 3, minPops: 2, minTeamLines: 3, maxTeamLines: 5, passRallies: 10,
      holdMs: 10 * 60 * 1000, dwellRallies: 4 };
    function setSport(sp) {
      SP = sp; cfg.pops = sp.pops; cfg.passRallies = sp.cfg.passRallies; cfg.dwellRallies = sp.cfg.dwellRallies;
    }
    // held: cards William pinned with the Pin button, key -> { since, until } in clock ms.
    // restore: a player whose Pass was just undone; they come straight back on the next compute.
    const user = { hidden: new Set(), passed: {}, stars: { home: [], away: [] }, held: {}, restore: null };
    let mem, last;
    const freshServe = () => ({ side: null, uni: null, streak: 0, turns: { home: [], away: [] }, lastTurnSide: null });

    function reset() {
      mem = {
        rally: 0, set: null, lastScore: null, setsWon: { home: 0, away: 0 },
        points: [], plays: [], involvement: [], pins: { home: null, away: null },
        serve: freshServe(),
        prevSel: { home: [], away: [] }, prevTeam: { home: [], away: [] }, since: {},
        // statAt: the rally when each player's stat line last changed (staleness). rotateDue: set by rotate().
        statAt: {}, prevStats: {}, rotateDue: { home: false, away: false },
        consoleAlert: null, setWon: null,
        prevTotals: null, setStart: null, finishedSet: null,
        bb: BB ? BB.freshMem() : null,
      };
      user.passed = {};
      last = null;
    }
    reset();
    // What basketball.js works with: the live memory (reset() replaces the object, hence the getter).
    const ctx = { get mem() { return mem; }, cfg };

    // Summary rows that a page reader might still pass as players (team, totals, "Set 1", "Match"). The reader
    // rejects them too (v0.3.5); this is the second line of defence so they never reach a card or a total.
    const NON_PLAYER = /^(sets?|game|match|totals?|team|tm|opp(onent)?s?)\b|^\d+(st|nd|rd|th)?(\s+sets?)?$/i;
    const realPlayer = (p) => p && /^\d{1,2}$/.test(String(p.uni || '').trim()) && /\p{L}/u.test(String(p.last || '')) && !NON_PLAYER.test(String(p.last || '').trim());
    function cleanSnapshot(s) {
      const t = {};
      for (const side of SIDES) t[side] = { ...s.teams[side], players: (s.teams[side].players || []).filter(realPlayer) };
      return { ...s, teams: t };
    }

    function trackStats(s) {
      for (const side of SIDES) for (const p of s.teams[side].players) {
        const key = playerKey(side, p.uni);
        const h = SP.fields.map((f) => num(p[f])).join(',');
        if (mem.prevStats[key] !== h) { mem.prevStats[key] = h; mem.statAt[key] = mem.rally; }
      }
    }

    function onPoint(side) {
      mem.rally += 1;
      mem.points.push(side);
      if (mem.consoleAlert && mem.consoleAlert.rally < mem.rally) mem.consoleAlert = null;
      if (mem.setWon && mem.setWon.rally < mem.rally - 1) mem.setWon = null;
    }

    const TOTAL_FIELDS = ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be'];
    function diffTotals(a, b) {
      const d = { uni: 'TM' };
      for (const f of TOTAL_FIELDS) d[f] = num(a[f]) - num(b[f]);
      return vbDerive(d);
    }
    function closeSet(set, totals) {
      if (!mem.setStart || (mem.finishedSet && mem.finishedSet.set === set)) return;
      mem.finishedSet = { set, rally: mem.rally,
        stats: { home: diffTotals(totals.home, mem.setStart.home), away: diffTotals(totals.away, mem.setStart.away) } };
    }

    function trackScore(s, totals) {
      const cur = { set: num(s.set), home: num(s.score.home), away: num(s.score.away) };
      const sw = { home: num(s.setsWon.home), away: num(s.setsWon.away) };
      let prev = mem.lastScore;
      if (!prev) { mem.lastScore = cur; mem.set = cur.set; return null; }
      let inferredWinner = null;
      if (cur.set > prev.set) {
        inferredWinner = prev.home > prev.away ? 'home' : 'away';
        if (!mem.setWon || mem.setWon.set !== prev.set) {
          const w = inferredWinner;
          mem.setWon = { side: w, set: prev.set, score: [prev[w] + 1, prev[other(w)]], rally: mem.rally };
        }
        mem.points = [];
        mem.serve = freshServe();
        if (mem.prevTotals) { closeSet(prev.set, mem.prevTotals); mem.setStart = mem.prevTotals; }
        prev = { set: cur.set, home: 0, away: 0 };
      } else if (cur.set < prev.set) {
        mem.lastScore = cur; mem.points = []; return null;
      }
      const dh = cur.home - prev.home, da = cur.away - prev.away;
      mem.lastScore = cur;
      mem.set = cur.set;
      let side = null;
      if (dh === 1 && da === 0) side = 'home';
      else if (da === 1 && dh === 0) side = 'away';
      if (side) onPoint(side);
      else if (dh || da) { mem.points.push(null); mem.rally += Math.max(1, dh + da); }
      for (const t of SIDES) {
        if (sw[t] > mem.setsWon[t] && cur.set === prev.set && cur[t] > cur[other(t)]) {
          mem.setWon = { side: t, set: cur.set, score: [cur[t], cur[other(t)]], rally: mem.rally };
          closeSet(cur.set, totals);
        }
      }
      return side;
    }

    function trackServe(play, pointSide) {
      const sv = mem.serve;
      const srv = play && play.server ? play.server : null;
      if (srv) {
        if (sv.lastTurnSide !== srv.side) {
          sv.turns[srv.side].push(srv.uni);
          sv.lastTurnSide = srv.side;
          sv.streak = 0;
        } else if (sv.turns[srv.side][sv.turns[srv.side].length - 1] !== srv.uni) {
          sv.turns[srv.side][sv.turns[srv.side].length - 1] = srv.uni;
          sv.streak = 0;
        }
        sv.side = srv.side; sv.uni = srv.uni;
        if (pointSide === srv.side) sv.streak += 1;
        else if (pointSide) { sv.side = pointSide; sv.uni = null; sv.streak = 0; }
      } else if (pointSide && sv.side !== pointSide) {
        // No server name in the console: the team that won the point serves next.
        sv.side = pointSide; sv.uni = null; sv.streak = 0;
      }
    }

    function ingest(lines, snapshot, index, pointSide) {
      let pointPlay = null;
      for (const text of lines) {
        const play = SP === VB ? parsePlay(text, snapshot, index) : BB.parsePlay(text, snapshot, index, { namesIn, teamIn });
        play.rally = mem.rally;
        play.score = mem.lastScore ? { home: mem.lastScore.home, away: mem.lastScore.away } : null;
        mem.plays.push(play);
        if (play.alert) mem.consoleAlert = { ...play.alert, text: text, rally: mem.rally };
        if (play.positive && play.actor) {
          const a = play.actor;
          const meta = SP.act(play.act);
          mem.pins[a.side] = { key: playerKey(a.side, a.uni), stat: meta.stat, label: meta.label, rally: mem.rally };
          mem.involvement.push({ rally: mem.rally, key: playerKey(a.side, a.uni), w: meta.w });
          for (const b of (play.extras || play.blockers.slice(1))) mem.involvement.push({ rally: mem.rally, key: playerKey(b.side, b.uni), w: 1 });
        }
        if (play.server || play.act) pointPlay = play;
      }
      if (mem.plays.length > 60) mem.plays.splice(0, mem.plays.length - 60);
      // Involvement only counts for 12 rallies; drop older entries so the list never grows for a whole match.
      if (mem.involvement.length > 80) mem.involvement = mem.involvement.filter((x) => mem.rally - x.rally <= SP.cfg.recentWindow);
      if (SP === VB) trackServe(pointPlay, pointSide);
    }

    // ---- runs
    function runs(side) {
      const pts = mem.points;
      let n = 0;
      for (let i = pts.length - 1; i >= 0 && pts[i] === side; i--) n++;
      let ext = null;
      if (pts.length && pts[pts.length - 1] === side) {
        let a = 0, b = 0;
        for (let i = pts.length - 1; i >= 0 && pts[i] !== null; i--) {
          if (pts[i] === side) a++; else b++;
          if (b > 2) break;
          if (b > 0 && a >= 5 && a - b >= 4 && (!ext || a - b > ext.a - ext.b)) ext = { a, b };
        }
      }
      let best = 0, cur = 0;
      for (const p of pts) { cur = p === side ? cur + 1 : 0; best = Math.max(best, cur); }
      return { active: n, ext, best };
    }

    // ---- team stat cards
    function teamTotals(t) {
      if (t.totals) return vbDerive({ uni: 'TM', ...t.totals });
      const sum = { uni: 'TM' };
      for (const f of ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be']) sum[f] = 0;
      for (const p of t.players) for (const f in sum) if (f !== 'uni') sum[f] += num(p[f]);
      return vbDerive(sum);
    }

    function vbTeamLines(s, side, e) {
      const T = teamTotals(s.teams[side]);
      const O = teamTotals(s.teams[other(side)]);
      const oc = s.teams[other(side)].code;
      const c = [];
      const fs = mem.finishedSet;
      if (fs && mem.rally - fs.rally <= 3) {
        const A = fs.stats[side], B = fs.stats[other(side)];
        if (A.ta > 0) c.push({ id: 'setsum', score: 9, big: `Set ${fs.set}: ${A.k} Kills, ${fmtPct(A.pct, true)} Hit%`, sub: `${oc} ${B.k} K, ${fmtPct(B.pct, true)}` });
      }
      let S = null, So = null;
      if (mem.setStart && !(fs && fs.set === num(s.set))) {
        S = diffTotals(T, mem.setStart[side]); So = diffTotals(O, mem.setStart[other(side)]);
        const n = (S.pct - 0.2) / 0.06;
        if (S.ta >= 15 && S.pct >= 0.3 && n >= 1.5) c.push({ id: 'sethit', score: n * 0.9, big: `Set ${s.set} Hit% ${fmtPct(S.pct, true)}`, sub: `${oc} ${fmtPct(So.pct, true)} this set` });
      }
      const r = runs(side);
      if (r.active >= 3) {
        const from = mem.lastScore ? [mem.lastScore[side] - r.active, mem.lastScore[other(side)]] : null;
        c.push({ id: 'run', score: 10 + r.active, live: true, big: `${r.active}-0 Scoring Run`,
          sub: from ? `from ${from[0]}–${from[1]}` : '' });
      } else if (r.ext) {
        c.push({ id: 'run', score: 8 + (r.ext.a - r.ext.b) * 0.5, live: true, big: `${r.ext.a}-${r.ext.b} Run`, sub: 'this set' });
      } else if (r.best >= 5) {
        c.push({ id: 'bestrun', score: 1.1 + r.best * 0.1, big: `${r.best}-0 Run in Set ${s.set}`, sub: 'Longest this set' });
      }
      if (T.ta >= 25) {
        const d = T.pct - (O.ta >= 25 ? O.pct : T.pct);
        const n = (T.pct - 0.19) / 0.06 + Math.max(0, d) / 0.08;
        if (T.pct >= 0.23 && n >= 1) c.push({ id: 'hit', score: n, big: `Team Hit% ${fmtPct(T.pct, true)}`, sub: `${oc} ${fmtPct(O.pct, true)}` });
      }
      const kn = T.k / (13.5 * e);
      if (T.k >= O.k + 6 || kn >= 1.15) c.push({ id: 'kills', score: kn + (T.k - O.k) / 10, big: `${T.k} Team Kills`, sub: `${oc} ${O.k}` });
      if ((T.tb >= 2 * e && T.tb >= O.tb + 2) || T.tb >= 3.2 * e) {
        c.push({ id: 'blk', score: T.tb / (1.8 * e) + (T.tb - O.tb) / 4, big: `${fmtHalf(T.tb)} Team Blocks`, sub: `${T.bs} solo · ${T.ba} assisted · ${oc} ${fmtHalf(O.tb)}` });
      }
      if (T.sa >= 3 && (T.sa >= O.sa + 3 || T.sa / e >= 1.6)) c.push({ id: 'ace', score: 1 + (T.sa - O.sa) / 3, big: `${T.sa} Team Aces`, sub: `${oc} ${O.sa}` });
      if (T.dig >= O.dig + 8 || T.dig / e >= 16) c.push({ id: 'dig', score: T.dig / (14 * e) + (T.dig - O.dig) / 12, big: `${T.dig} Team Digs`, sub: `${oc} ${O.dig}` });
      if (T.se >= 3 * e && T.se >= O.se + 3) c.push({ id: 'se', score: 0.9, big: `${T.se} Service Errors`, sub: `${oc} ${O.se}` });

      // Fillers: the everyday team lines, so each side always has its team cards. They show greyed (dim)
      // until they clear the bars above, and always rank below a real pop (score <= 0.75 with stability).
      const have = new Set(c.map((x) => x.id));
      const fill = (id, ok, ratio, big, sub) => {
        if (!have.has(id) && ok) c.push({ id, dim: true, score: 0.05 + 0.5 * Math.max(0, Math.min(1, ratio)), big, sub });
      };
      fill('hit', T.ta >= 10, (T.pct - 0.1) / 0.2, `Team Hit% ${fmtPct(T.pct, true)}`, `${oc} ${fmtPct(O.pct, true)}`);
      const pl = (n, word) => `${n} Team ${word}${+n === 1 ? '' : 's'}`;
      fill('kills', T.k > 0, T.k / (13.5 * e), pl(T.k, 'Kill'), `${oc} ${O.k}`);
      fill('blk', T.tb > 0, T.tb / (2 * e), pl(fmtHalf(T.tb), 'Block'), `${T.bs} solo · ${T.ba} assisted · ${oc} ${fmtHalf(O.tb)}`);
      fill('dig', T.dig > 0, T.dig / (14 * e), pl(T.dig, 'Dig'), `${oc} ${O.dig}`);
      fill('ace', T.sa > 0, T.sa / (1.5 * e), pl(T.sa, 'Ace'), `${oc} ${O.sa}`);
      if (S) fill('sethit', S.ta >= 8, (S.pct - 0.1) / 0.2, `Set ${s.set} Hit% ${fmtPct(S.pct, true)}`, `${oc} ${fmtPct(So.pct, true)} this set`);

      // Pre-match preview: no team has a stat yet, so none of the fillers above qualify. Show the everyday
      // lines at their zero values, greyed, so both team cards have lines before first serve.
      if (s.status === 'pre' && !c.length) {
        const z = (x) => fmtPct(x.ta > 0 ? x.pct : 0, true);
        c.push({ id: 'hit', dim: true, score: 0.06, big: `Team Hit% ${z(T)}`, sub: `${oc} ${z(O)}` });
        c.push({ id: 'kills', dim: true, score: 0.05, big: pl(T.k, 'Kill'), sub: `${oc} ${O.k}` });
        c.push({ id: 'blk', dim: true, score: 0.04, big: pl(fmtHalf(T.tb), 'Block'), sub: `${oc} ${fmtHalf(O.tb)}` });
      }
      return c;
    }

    function teamCards(s, side, e) {
      const c = SP === VB ? vbTeamLines(s, side, e) : BB.teamCards(ctx, s, side, e);
      const prev = mem.prevTeam[side];
      for (const x of c) if (prev.includes(x.id)) x.score += 0.2;
      c.sort((a, b) => b.score - a.score);
      // One team card per side: up to maxTeamLines notable lines; greyed fillers only top it up to minTeamLines.
      const pick = c.filter((x) => !x.dim).slice(0, cfg.maxTeamLines);
      for (const x of c) { if (pick.length >= cfg.minTeamLines) break; if (!pick.includes(x)) pick.push(x); }
      mem.prevTeam[side] = pick.map((x) => x.id);
      return pick;
    }

    // ---- player cards
    function scorePlayer(p, side, e, highs, s, sv) {
      const key = playerKey(side, p.uni);
      const N = SP.norms(p, e, s);
      let pops = cfg.pops.map((d) => {
        let sc = d.score(p, N);
        if (sc > 0 && highs[d.uses[0]] && highs[d.uses[0]].has(key)) sc += 0.25;
        return { id: d.id, name: d.name, group: d.group, uses: d.uses, score: sc, parts: d.parts(p) };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      const seen = new Set();
      pops = pops.filter((x) => (x.group ? (seen.has(x.group) ? false : seen.add(x.group)) : true));

      const badges = SP.badges(p, N);
      for (const f of SP.leadFields) if (highs[f] && highs[f].has(key)) badges.push(SP.highWord + ' ' + SP.words[f]);

      const starred = (user.stars[side] || []).some((st) => matchesStar(p, st));
      const pin = mem.pins[side];
      const pinned = !!(pin && pin.key === key && mem.rally - pin.rally <= SP.cfg.pinWindow && SP.pinWorthy(p, N, pin));
      const hold = user.held[key] && user.held[key].until > clock() ? user.held[key] : null;
      // A streak keeps a card live: a server on a run of points, or (basketball) one player scoring all of a team's points.
      let streak = null;
      if (SP === VB) {
        if (sv.side === side && sv.uni === p.uni && sv.streak >= 3) streak = { text: `On serve · ${sv.streak} straight`, stat: p.sa > 0 ? 'sa' : null };
      } else {
        const hot = BB.hotOf(ctx, side);
        if (hot && hot.key === key) streak = { text: `${hot.n} straight ${s.teams[side].code} points`, stat: 'pts' };
      }
      const serving = !!streak;
      const recent = mem.involvement.filter((x) => x.key === key && mem.rally - x.rally <= SP.cfg.recentWindow).reduce((a, x) => a + x.w, 0);
      const best = pops[0] ? pops[0].score : 0;
      const second = pops[1] ? pops[1].score : 0;
      let impact = best + 0.35 * second + 0.2 * Math.min(4, recent);
      if (mem.prevSel[side].includes(key)) impact += 0.3;
      if (serving) impact += 1.2;
      if (starred) impact += 0.35;
      if (pinned) impact += 100;
      return { key, side, p, N, pops, badges, pinned, pin: pinned ? pin : null, serving, streak, starred, impact, hold,
        activity: SP.activity(p) + 0.2 * Math.min(4, recent), eligible: pinned || serving || best >= 0.85 };
    }

    function cardFor(c, sv, teamLeads) {
      const p = c.p;
      const covered = (x, list) => list.some((y) => x.uses.every((u) => y.uses.includes(u)));
      let pops = [];
      for (const x of c.pops) {
        if (x.score < 0.8 || pops.length >= cfg.maxPops) continue;
        if (!covered(x, pops)) pops.push(x);
      }
      const force = c.pin ? c.pin.stat : (c.streak ? c.streak.stat : null);
      const raw = () => cfg.pops.map((d) => ({ id: d.id, name: d.name, uses: d.uses, score: d.score(p, c.N), parts: d.parts(p) }));
      const simplest = (a, b) => b.score - a.score || a.uses.length - b.uses.length || a.parts.length - b.parts.length;
      if (force && !pops.some((x) => x.uses.includes(force))) {
        const all = raw().filter((x) => x.uses.includes(force)).sort(simplest);
        if (all[0]) pops = [all[0]].concat(pops).slice(0, cfg.maxPops);
      }
      if (pops.length < cfg.minPops) {
        // Fewer notable options than the card should offer: add the player's strongest raw lines
        // (single stats the player actually has), shown greyed until they reach pop level.
        const MINS = SP.singleMins;
        const singles = raw().filter((x) => x.uses.length === 1 && MINS[x.uses[0]] && p[x.uses[0]] > 0 && SP.singleOk(x, p))
          .sort((a, b) => p[b.uses[0]] / MINS[b.uses[0]] - p[a.uses[0]] / MINS[a.uses[0]]);
        for (const x of singles) {
          if (pops.length >= cfg.minPops) break;
          if (!covered(x, pops)) pops.push(x);
        }
      }
      pops = pops.map((x, i) => {
        const live = !!force && x.uses.includes(force);
        return { id: x.id, name: x.name, parts: x.parts, score: x.score, best: i === 0, live, dim: !live && x.score < 0.8 };
      });
      let tag = null;
      if (c.pin) tag = { kind: 'live', text: SP.pinWhen(mem.rally - c.pin.rally) + c.pin.label };
      else if (c.serving) tag = { kind: 'serve', text: c.streak.text };
      let reason = c.badges.slice(0, 2).join(' · ');
      if (!reason) {
        const lead = SP.leadFields.find((f) => teamLeads[f] === c.key);
        if (lead) reason = 'Team leader · ' + SP.words[lead];
      }
      if (c.serving && c.pin) reason = [c.streak.text, reason].filter(Boolean).join(' · ');
      return { key: c.key, side: c.side, uni: p.uni, first: p.first, last: p.last, tag, reason, pops,
        starred: !!c.starred, impact: Math.round(c.impact * 100) / 100,
        held: c.hold ? { until: c.hold.until } : null,
        // Greyed: on the board only to fill the side's cards, not for a notable stat or a live reason.
        dim: !c.eligible && !c.hold };
    }

    function playerCards(s, side, e, highs) {
      const sv = mem.serve;
      const players = s.teams[side].players.map(SP.derive);
      const teamLeads = {};
      for (const f of SP.leadFields) {
        const top = players.slice().sort((a, b) => b[f] - a[f])[0];
        if (top && top[f] > 0) teamLeads[f] = playerKey(side, top.uni);
      }
      const pool = players.map((p) => scorePlayer(p, side, e, highs, s, sv))
        .filter((c) => !user.hidden.has(c.key))
        .filter((c) => c.pinned || c.hold || !(user.passed[c.key] > mem.rally));
      const byKey = Object.fromEntries(pool.map((c) => [c.key, c]));
      const MAX = cfg.maxCards;
      const rank = (c) => (c.eligible ? 10 + c.impact : c.activity + (c.starred ? 0.35 : 0));
      const worth = (c) => c.eligible || c.starred || c.activity > 0;
      // Incumbents: the cards shown last time that still have something to show (a pre-match preview card
      // with no stat yet drops out as soon as a real stat appears).
      const prevKeys = mem.prevSel[side].filter((k) => byKey[k] && worth(byKey[k]));
      const prevSet = new Set(prevKeys);
      const sticky = (c) => prevSet.has(c.key) && mem.rally - (mem.since[c.key] ?? -1e9) <= cfg.dwellRallies;
      // Stalest first: the card whose player's stat line changed longest ago, then the one up the longest.
      const staleness = (c) => (mem.statAt[c.key] ?? -1) * 1000 + (mem.since[c.key] ?? 0);
      const held = pool.filter((c) => c.hold).sort((a, b) => a.hold.since - b.hold.since).slice(0, MAX);
      const rotateNow = mem.rotateDue[side];
      mem.rotateDue[side] = false;
      let chosen;
      if (rotateNow || !prevKeys.length) {
        // Rotation (or the first fill): pins first, then every player with a stat who is not on the board,
        // best first, then the ones who are. So a rotation turns over all the unpinned cards whenever enough
        // other players have something to show; starred players are put back below.
        const fresh = (c) => (rotateNow && !prevSet.has(c.key) ? 1 : 0);
        const rest = pool.filter((c) => !c.hold && worth(c)).sort((a, b) => fresh(b) - fresh(a) || rank(b) - rank(a));
        chosen = held.concat(rest).slice(0, MAX);
      } else {
        // Between rotations the board holds still. Pins take slots first; then at most one card changes per
        // update: the best player not on the board replaces the stalest card, and only for a live reason
        // (named in the last play, a serving streak) or because it clearly outranks a weaker card.
        chosen = held.slice();
        for (const k of prevKeys) if (chosen.length < MAX && !chosen.some((c) => c.key === k)) chosen.push(byKey[k]);
        const inSet = new Set(chosen.map((c) => c.key));
        const isUrgent = (c) => c.pinned || c.serving || c.key === user.restore;
        const challengers = pool.filter((c) => !inSet.has(c.key) && !c.hold && worth(c))
          .sort((a, b) => (isUrgent(b) - isUrgent(a)) || rank(b) - rank(a));
        while (chosen.length < MAX && challengers.length) chosen.push(challengers.shift());
        const top = challengers[0];
        if (top && chosen.length >= MAX) {
          const urgent = isUrgent(top);
          // Live cards (named in the last play, or on a serving streak) are never the one swapped out.
          const victims = chosen.filter((c) => !c.hold && !c.pinned && !c.serving && (urgent || !sticky(c))).sort((a, b) => staleness(a) - staleness(b));
          const v = victims[0];
          if (v && (urgent || (top.eligible && (!v.eligible || rank(top) > rank(v) + 0.5)))) chosen[chosen.indexOf(v)] = top;
        }
      }
      // Impact players: at least one starred player always has a card on their side.
      const starredPool = pool.filter((c) => c.starred && !c.hold && worth(c)).sort((a, b) => rank(b) - rank(a));
      if (starredPool.length && !chosen.some((c) => c.starred)) {
        if (chosen.length < MAX) chosen.push(starredPool[0]);
        else {
          const victims = chosen.filter((c) => !c.hold && !c.pinned && !c.serving).sort((a, b) => staleness(a) - staleness(b));
          if (victims[0]) chosen[chosen.indexOf(victims[0])] = starredPool[0];
        }
      }
      // Pre-match preview (status 'pre', the page's SET 0): nobody has a stat yet, so the rules above
      // leave the side empty. Fill its slots with the roster in page order, greyed, so the layout can be
      // checked before first serve. Once the set starts this never runs: cards then come only from stats.
      if (s.status === 'pre' && chosen.length < MAX) {
        const have = new Set(chosen.map((c) => c.key));
        for (const c of pool) {
          if (chosen.length >= MAX) break;
          if (!have.has(c.key)) { chosen.push(c); have.add(c.key); }
        }
      }
      if (user.restore && user.restore.split(':')[0] === side) user.restore = null;
      const chosenKeys = new Set(chosen.map((c) => c.key));
      // Keep returning players in the slot they held, so cards don't jump around.
      const slots = new Array(MAX).fill(null);
      mem.prevSel[side].forEach((k, i) => { if (chosenKeys.has(k) && i < slots.length) slots[i] = k; });
      const placed = new Set(slots.filter(Boolean));
      for (const c of chosen) if (!placed.has(c.key)) { const i = slots.indexOf(null); slots[i] = c.key; placed.add(c.key); }
      const wasShown = new Set(mem.prevSel[side]);
      mem.prevSel[side] = slots.filter(Boolean);
      for (const k of mem.prevSel[side]) if (!wasShown.has(k)) mem.since[k] = mem.rally;
      const cards = slots.filter(Boolean).map((k) => ({ ...cardFor(byKey[k], sv, teamLeads), isNew: !wasShown.has(k) }));
      // Full roster for the list layout: the carded players first (in slot order), then the rest by rank.
      const order = new Map(mem.prevSel[side].map((k, i) => [k, i]));
      const list = pool.slice().sort((a, b) => {
        const ia = order.has(a.key) ? order.get(a.key) : 1e9, ib = order.has(b.key) ? order.get(b.key) : 1e9;
        return ia - ib || rank(b) - rank(a) || (parseInt(a.p.uni, 10) || 0) - (parseInt(b.p.uni, 10) || 0);
      }).map((c) => ({ key: c.key, uni: c.p.uni, first: c.p.first, last: c.p.last, top: order.has(c.key), starred: !!c.starred,
        held: !!c.hold, live: !!c.pinned, stats: SP.listStats(c.p) }));
      return { cards, list };
    }

    function matchHighs(s) {
      const all = [];
      for (const side of SIDES) for (const p of s.teams[side].players) all.push({ side, p: SP.derive(p) });
      const mins = SP.highMins;
      const highs = {};
      for (const f in mins) {
        const max = Math.max(0, ...all.map((x) => x.p[f]));
        highs[f] = new Set(max >= mins[f] ? all.filter((x) => x.p[f] === max).map((x) => playerKey(x.side, x.p.uni)) : []);
      }
      return highs;
    }

    // ---- alerts
    function alerts(s) {
      if (SP !== VB) return BB.alerts(ctx, s);
      const out = [];
      if (s.status === 'final') {
        const w = num(s.setsWon.home) > num(s.setsWon.away) ? 'home' : 'away';
        out.push({ kind: 'final', sev: 'info', text: `Final · ${s.teams[w].code} wins ${s.setsWon[w]}–${s.setsWon[other(w)]}` });
        return out;
      }
      const target = num(s.set) >= 5 ? 15 : 25;
      for (const side of SIDES) {
        const own = num(s.score[side]), opp = num(s.score[other(side)]);
        const setOver = own >= target && own - opp >= 2;
        if (own >= target - 1 && own - opp >= 1 && !setOver) {
          const match = num(s.setsWon[side]) >= 2;
          out.push({ kind: match ? 'match' : 'set', sev: match ? 'crit' : 'warn',
            text: `${match ? 'Match' : 'Set'} point · ${s.teams[side].code}`, sub: `${own}–${opp}` });
        }
      }
      if (mem.consoleAlert) {
        const a = mem.consoleAlert;
        const words = { timeout: 'Timeout', challenge: 'Challenge', penalty: 'Penalty', sub: 'Substitution' };
        const sev = { timeout: 'info', challenge: 'violet', penalty: 'warn', sub: 'quiet' }[a.kind];
        out.push({ kind: a.kind, sev, text: words[a.kind] + (a.side ? ' · ' + s.teams[a.side].code : ''), sub: a.text });
      }
      if (mem.setWon) {
        const w = mem.setWon;
        out.push({ kind: 'setwon', sev: 'info', text: `${s.teams[w.side].code} wins set ${w.set}`, sub: `${w.score[0]}–${w.score[1]}` });
      }
      return out;
    }

    function rotation(s) {
      const sv = mem.serve;
      const res = {};
      for (const side of SIDES) {
        const turns = sv.turns[side];
        const slots = new Array(6).fill(null);
        turns.forEach((u, i) => { slots[i % 6] = u; });
        // After winning the serve back the team has rotated: the next slot is now in P1.
        const regained = sv.side === side && !sv.uni && turns.length > 0;
        const cur = turns.length ? (regained ? turns.length % 6 : (turns.length - 1) % 6) : null;
        const nameOf = (u) => {
          const p = s.teams[side].players.find((x) => String(x.uni) === String(u));
          return p ? { uni: String(p.uni), last: p.last } : null;
        };
        // Court position k (1..6) holds rotation slot cur + (k-1). P1 = server spot.
        const court = cur === null ? null : [1, 2, 3, 4, 5, 6].map((pos) => {
          const u = slots[(cur + pos - 1) % 6];
          return { pos, player: u ? nameOf(u) : null };
        });
        const next = regained && slots[cur] ? nameOf(slots[cur]) : null;
        res[side] = { court, known: slots.filter(Boolean).length, serving: sv.side === side, predictedServer: next };
      }
      return res;
    }

    function compute() {
      const s = last;
      const e = SP.eff(s);
      const highs = matchHighs(s);
      const vb = SP === VB;
      const sv = vb ? mem.serve : freshServe();
      const serverP = sv.uni && sv.side ? s.teams[sv.side].players.find((x) => String(x.uni) === String(sv.uni)) : null;
      const rot = vb ? rotation(s) : null;
      const predicted = sv.side && !serverP ? rot[sv.side].predictedServer : null;
      const view = {
        sport: SP.id, unit: SP.unit, passText: SP.passText,
        teams: { home: { code: s.teams.home.code, name: s.teams.home.name }, away: { code: s.teams.away.code, name: s.teams.away.name } },
        set: num(s.set), score: { home: num(s.score.home), away: num(s.score.away) },
        setsWon: { home: num(s.setsWon.home), away: num(s.setsWon.away) }, status: s.status,
        serving: sv.side && s.status !== 'final' ? {
          side: sv.side, streak: sv.streak, predicted: !serverP && !!predicted,
          uni: serverP ? String(serverP.uni) : predicted ? predicted.uni : null,
          last: serverP ? serverP.last : predicted ? predicted.last : null } : null,
        alerts: alerts(s),
        plays: mem.plays.slice(-6).reverse().map((p) => ({ text: p.text, score: p.score, alert: !!p.alert })),
        teamCards: {}, playerCards: {}, players: {}, rotation: rot,
        layout: { cards: cfg.maxCards },
        hidden: [...user.hidden].map((k) => {
          const [side, uni] = k.split(':');
          const p = s.teams[side].players.find((x) => String(x.uni) === uni);
          return { key: k, side, uni, last: p ? p.last : '#' + uni };
        }),
        // Players skipped with Pass and still skipped, so the board can offer an Undo.
        passed: Object.keys(user.passed).filter((k) => user.passed[k] > mem.rally && !user.hidden.has(k)).map((k) => {
          const [side, uni] = k.split(':');
          const p = s.teams[side] && s.teams[side].players.find((x) => String(x.uni) === uni);
          return { key: k, side, uni, last: p ? p.last : '#' + uni, rallies: user.passed[k] - mem.rally };
        }),
        effSets: Math.round(e * 100) / 100,
      };
      if (!vb) Object.assign(view, BB.header(ctx, s));
      for (const side of SIDES) {
        view.teamCards[side] = teamCards(s, side, e);
        const pc = playerCards(s, side, e, highs);
        view.playerCards[side] = pc.cards;
        view.players[side] = pc.list;
      }
      if (!vb) mem.bb.view = view;
      return view;
    }

    return {
      reset,
      update(snapshot, lines) {
        snapshot = cleanSnapshot(snapshot);
        const sp = snapshot.sport === 'bb' && BBS ? BBS : VB;
        if (sp !== SP) { setSport(sp); reset(); }
        const index = buildNameIndex(snapshot);
        if (SP !== VB) {
          snapshot = { ...snapshot, set: num(snapshot.period), setsWon: { home: 0, away: 0 } };
          const changed = BB.track(ctx, snapshot);
          // Only the game clock moved: keep every card exactly where it is and refresh the header.
          if (!changed && !(lines && lines.length) && mem.bb.view && last) {
            last = snapshot;
            mem.bb.view = { ...mem.bb.view, ...BB.header(ctx, snapshot), alerts: BB.alerts(ctx, snapshot) };
            return mem.bb.view;
          }
          ingest(lines || [], snapshot, index, null);
          trackStats(snapshot);
          last = snapshot;
          return compute();
        }
        const totals = { home: teamTotals(snapshot.teams.home), away: teamTotals(snapshot.teams.away) };
        if (!mem.setStart && num(snapshot.score.home) + num(snapshot.score.away) === 0) mem.setStart = totals;
        const pointSide = trackScore(snapshot, totals);
        mem.prevTotals = totals;
        ingest(lines || [], snapshot, index, pointSide);
        trackStats(snapshot);
        mem.setsWon = { home: num(snapshot.setsWon.home), away: num(snapshot.setsWon.away) };
        last = snapshot;
        return compute();
      },
      view() { return last ? compute() : null; },
      get sport() { return SP.id; },
      // Layout: how many player cards each side shows (3 or 5). The list layout highlights that many rows.
      setCards(n) { cfg.maxCards = n === 5 ? 5 : 3; },
      // Auto-rotate: the next compute swaps the non-pinned cards for the best players not yet on the board.
      rotate() { mem.rotateDue = { home: true, away: true }; },
      pass(key) { delete user.held[key]; user.passed[key] = mem.rally + cfg.passRallies; if (mem.pins.home && mem.pins.home.key === key) mem.pins.home = null; if (mem.pins.away && mem.pins.away.key === key) mem.pins.away = null; },
      unpass(key) { delete user.passed[key]; user.restore = key; },
      hide(key) { delete user.held[key]; user.hidden.add(key); },
      // Pin button: keep a player's card on the board (live-updating) for holdMs, or until pinned again.
      // Each side holds at most maxCards pins; pinning one more releases that side's oldest.
      toggleHold(key) {
        const now = clock();
        if (user.held[key] && user.held[key].until > now) { delete user.held[key]; return false; }
        const side = String(key).split(':')[0];
        const mine = Object.keys(user.held).filter((k) => k.split(':')[0] === side && user.held[k].until > now)
          .sort((a, b) => user.held[a].since - user.held[b].since);
        while (mine.length >= cfg.maxCards) delete user.held[mine.shift()];
        delete user.passed[key];
        user.held[key] = { since: now, until: now + cfg.holdMs };
        return true;
      },
      // Drops pins whose time is up. Returns true when one did, so the page knows to redraw.
      expireHolds() {
        const now = clock();
        let gone = false;
        for (const k of Object.keys(user.held)) if (user.held[k].until <= now) { delete user.held[k]; gone = true; }
        return gone;
      },
      unhide(key) { user.hidden.delete(key); },
      get hiddenKeys() { return [...user.hidden]; },
      setHidden(keys) { user.hidden = new Set(keys || []); },
      setStars(stars) { user.stars = { home: (stars && stars.home) || [], away: (stars && stars.away) || [] }; },
    };
  }

  const api = { create, parsePlay, buildNameIndex, fmtPct, vbDerive, VB_POPS, swapSides, matchesStar, normName, basketball: BB };
  root.PopEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(SPB);

/*
 * BoardView: draws an engine view into a container (a page, or a shadow root
 * inside the StatBroadcast tab). No data logic here.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Jersey numbers sit on the team colour: dark ink on a light colour, white on a dark one.
  function inkFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return '#0c1014';
    const n = parseInt(m[1], 16);
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
    return lum > 0.179 ? '#0c1014' : '#ffffff';
  }

  // Stats the list layout can show, by engine field. The label is what the graphics software calls it.
  const LIST_STATS = [
    { id: 'k', label: 'Kills', l: 'K' }, { id: 'dig', label: 'Digs', l: 'DIG' }, { id: 'tb', label: 'Blocks', l: 'BLK' },
    { id: 'a', label: 'Assists', l: 'AST' }, { id: 'sa', label: 'Aces', l: 'ACE' }, { id: 'pts', label: 'Points', l: 'PTS' },
    { id: 'pct', label: 'Hit %', l: 'HIT' }, { id: 'ta', label: 'Attempts', l: 'TA' }, { id: 'e', label: 'Errors', l: 'E' },
  ];
  const LIST_STATS_BB = [
    { id: 'pts', label: 'Points', l: 'PTS' }, { id: 'reb', label: 'Rebounds', l: 'REB' }, { id: 'ast', label: 'Assists', l: 'AST' },
    { id: 'stl', label: 'Steals', l: 'STL' }, { id: 'blk', label: 'Blocks', l: 'BLK' }, { id: 'fg', label: 'Field goals', l: 'FG' },
    { id: 'tp', label: '3-pointers', l: '3PT' }, { id: 'ft', label: 'Free throws', l: 'FT' }, { id: 'pf', label: 'Fouls', l: 'PF' },
    { id: 'to', label: 'Turnovers', l: 'TO' }, { id: 'min', label: 'Minutes', l: 'MIN' },
  ];
  // Per sport: the stats on offer, the two shown by default, and where the choice is saved.
  const LIST = {
    vb: { stats: LIST_STATS, def: ['k', 'dig'], key: 'liststats' },
    bb: { stats: LIST_STATS_BB, def: ['pts', 'reb'], key: 'liststats:bb' },
  };
  const listFor = (sport) => LIST[sport] || LIST.vb;

  const ROTATE_OPTIONS = [[0, 'Off'], [15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '1 min'], [90, '1½ min'], [120, '2 min'],
    [180, '3 min'], [240, '4 min'], [300, '5 min'], [420, '7 min'], [600, '10 min']];

  // The board controls (card layout, list stats, auto-rotate), shared by the board page and the in-tab overlay.
  // opts.get/set read and write the three settings ('layout', 'liststats', 'rotate'); opts.onChange runs after a change.
  function mountControls(host, opts) {
    opts = opts || {};
    const get = (k, d) => (opts.get ? opts.get(k, d) : d), set = (k, v) => { if (opts.set) opts.set(k, v); };
    const settings = { sport: 'vb', layout: String(get('layout', '3')), listStats: null, rotate: +get('rotate', 0) || 0 };
    if (!['3', '5', 'all'].includes(settings.layout)) settings.layout = '3';
    // The list layout's two stats are remembered per sport.
    function loadListStats() {
      const L = listFor(settings.sport);
      const v = get(L.key, L.def);
      settings.listStats = Array.isArray(v) && v.length === 2 && v.every((id) => L.stats.some((x) => x.id === id)) ? v : L.def.slice();
    }
    loadListStats();
    if (!ROTATE_OPTIONS.some((o) => o[0] === settings.rotate)) settings.rotate = 0;
    const statOpts = () => listFor(settings.sport).stats.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
    const statSel = (id, label) => `<select id="${id}" aria-label="${label}">${statOpts()}</select>`;
    host.innerHTML = `
      <span class="ctl">Cards <span class="seg" id="layoutseg" role="group" aria-label="Player card layout"><button type="button" data-layout="3">3 per team</button><button type="button" data-layout="5">5 per team</button><button type="button" data-layout="all">All players</button></span></span>
      <span class="ctl" id="liststats">Show ${statSel('statA', 'First stat')} &amp; ${statSel('statB', 'Second stat')}</span>
      <span class="ctl">Rotate <select id="rotate" aria-label="Auto-rotate cards" title="Swap the unpinned cards for other players this often">${ROTATE_OPTIONS.map((o) => `<option value="${o[0]}">${esc(o[1])}</option>`).join('')}</select><span class="count" id="rotatecount"></span></span>`;
    const $ = (sel) => host.querySelector(sel);
    function paint() {
      host.querySelectorAll('button[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === settings.layout)));
      $('#liststats').hidden = settings.layout !== 'all';
      $('#statA').value = settings.listStats[0]; $('#statB').value = settings.listStats[1];
      $('#rotate').value = String(settings.rotate);
    }
    const changed = (what) => { paint(); if (opts.onChange) opts.onChange(settings, what); };
    host.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-layout]');
      if (!b) return;
      settings.layout = b.dataset.layout; set('layout', settings.layout); changed('layout');
    });
    const onStats = () => { settings.listStats = [$('#statA').value, $('#statB').value]; set(listFor(settings.sport).key, settings.listStats); changed('liststats'); };
    $('#statA').addEventListener('change', onStats);
    $('#statB').addEventListener('change', onStats);
    $('#rotate').addEventListener('change', () => { settings.rotate = +$('#rotate').value || 0; set('rotate', settings.rotate); changed('rotate'); });
    paint();
    return {
      settings,
      setCountdown(text) { $('#rotatecount').textContent = text || ''; },
      // Switch the stat choices to another sport's. Returns true when the sport changed.
      setSport(sport) {
        sport = LIST[sport] ? sport : 'vb';
        if (sport === settings.sport) return false;
        settings.sport = sport;
        loadListStats();
        $('#statA').innerHTML = statOpts(); $('#statB').innerHTML = statOpts();
        paint();
        return true;
      },
    };
  }

  // Copy a line to the clipboard: the async API first, a hidden textarea when that is blocked.
  function copyText(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      } catch (e) { /* nothing more to try */ }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  function mountBoard(host, handlers) {
    handlers = handlers || {};
    let tab = 'plays';
    let lastView = null;
    // The line copied most recently, so its "Copied" mark survives a re-render for a moment.
    let copied = { text: null, until: 0 };
    // Layout: 'cards' (3 or 5 per side, from the view) or 'list' (every player, two stats, top rows highlighted).
    let layout = 'cards', listStats = ['k', 'dig'];
    // Last value drawn for each stat on each card, so a number that just changed can flash.
    let lastVals = new Map(), lastAlertKey = '';
    host.innerHTML = `
      <div class="board">
        <section class="q q-game" aria-label="Game"></section>
        <section class="q q-team" aria-label="Team pops"></section>
        <section class="q q-home side-home" aria-label="Home players"></section>
        <section class="q q-away side-away" aria-label="Away players"></section>
      </div>
      <div class="foot"></div>
      <input type="color" class="colorpick" tabindex="-1" aria-hidden="true">`;
    const $ = (sel) => host.querySelector(sel);
    const regions = { game: $('.q-game'), team: $('.q-team'), home: $('.q-home'), away: $('.q-away'), foot: $('.foot') };
    // Team colours. A swatch is a button when the host can set colours; clicking it opens the browser's
    // colour picker. The input lives outside the regions, so a re-render never closes the picker mid-choice.
    const boardEl = $('.board'), colorInput = $('.colorpick');
    let colors = { home: null, away: null }, pickSide = null;
    const swatch = (side, code) => (handlers.color
      ? `<button type="button" class="swatch pick ${side}" data-act="color" data-side="${side}" title="Set the ${esc(code)} colour" aria-label="Set the ${esc(code)} team colour"></button>`
      : `<span class="swatch ${side}"></span>`);
    colorInput.addEventListener('input', () => { if (pickSide && handlers.color) handlers.color(pickSide, colorInput.value); });
    function setColors(c) {
      colors = { home: (c && c.home) || null, away: (c && c.away) || null };
      for (const side of ['home', 'away']) {
        const v = colors[side];
        if (v) { boardEl.style.setProperty('--' + side, v); boardEl.style.setProperty('--' + side + '-ink', inkFor(v)); }
        else { boardEl.style.removeProperty('--' + side); boardEl.style.removeProperty('--' + side + '-ink'); }
      }
    }

    host.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b) {
        // Click a pop line or a team line to copy it, ready to paste.
        const row = ev.target.closest('[data-copy]');
        if (row && host.contains(row)) {
          copyText(row.dataset.copy);
          copied = { text: row.dataset.copy, until: Date.now() + 1500 };
          host.querySelectorAll('.copied').forEach((el) => el.classList.remove('copied'));
          row.classList.add('copied');
          if (handlers.copied) handlers.copied(row.dataset.copy);
        }
        return;
      }
      const act = b.dataset.act;
      if (act === 'tab') { tab = b.dataset.tab; if (lastView) drawGame(lastView); return; }
      if (act === 'color') {
        pickSide = b.dataset.side;
        colorInput.value = colors[pickSide] || getComputedStyle(boardEl).getPropertyValue('--' + pickSide).trim() || '#888888';
        colorInput.click();
        return;
      }
      if (handlers[act]) handlers[act](b.dataset.key);
    });

    // A value that changed since the last draw gets the .tick flash, so "12 K" becoming "13 K" is seen, not read.
    function partsHTML(parts, slot, vals) {
      return parts.map((p) => {
        const id = slot + '|' + p.l;
        const was = lastVals.get(id);
        vals.set(id, p.v);
        const tick = was !== undefined && was !== p.v ? ' tick' : '';
        return `<span class="pv${tick}"><span class="v">${esc(p.v)}</span><span class="l">${esc(p.l)}</span></span>`;
      }).join('');
    }

    const minsLeft = (ms) => Math.max(1, Math.round((ms - Date.now()) / 60000));
    // What a click copies: "GREENY · Attacks & Blocks · 12 K · .350 HIT · 3 BLK".
    const popLine = (c, p) => `${String(c.last).toUpperCase()} · ${p.name} · ${p.parts.map((x) => x.v + ' ' + x.l).join(' · ')}`;
    const isCopied = (text) => copied.text === text && Date.now() < copied.until;

    let passText = 'Skip this player for the next 10 rallies';
    function playerCard(c, vals) {
      const live = c.tag && c.tag.kind === 'live';
      const tag = c.tag ? (live ? `<span class="livedot">${esc(c.tag.text)}</span>` : `<span class="tag-serve">${esc(c.tag.text)}</span>`) : '';
      const reason = c.reason ? `<span>${esc(c.reason)}</span>` : '';
      const starBtn = handlers.star
        ? `<button class="abtn star${c.starred ? ' on' : ''}" data-act="star" data-key="${esc(c.key)}" aria-pressed="${c.starred}" title="${c.starred ? 'Remove from impact players' : 'Star as impact player'}" aria-label="Impact player">★</button>` : '';
      const pinBtn = handlers.hold
        ? `<button class="abtn pin${c.held ? ' on' : ''}" data-act="hold" data-key="${esc(c.key)}" aria-pressed="${!!c.held}" title="${c.held ? `Pinned for ${minsLeft(c.held.until)} min more · click to unpin` : 'Keep on the board for 10 min'}">${c.held ? '● Pinned' : 'Pin'}</button>` : '';
      const pops = c.pops.length
        ? c.pops.map((p) => {
          const line = popLine(c, p);
          return `<li class="pop${p.best ? ' best' : ''}${p.live ? ' live' : ''}${p.dim ? ' dim' : ''}${isCopied(line) ? ' copied' : ''}" data-copy="${esc(line)}" title="Click to copy"><span class="pname">${esc(p.name)}</span><span class="pvals">${partsHTML(p.parts, c.key + '|' + p.id, vals)}</span></li>`;
        }).join('')
        : '<li class="pop none">No stats yet</li>';
      return `<article class="pcard${live ? ' is-live' : ''}${c.isNew ? ' is-new' : ''}${c.starred ? ' is-star' : ''}${c.held ? ' is-held' : ''}${c.dim ? ' is-dim' : ''}" data-key="${esc(c.key)}">
        <div class="phead">
          <div class="jersey" aria-label="Number ${esc(c.uni)}">${esc(c.uni)}</div>
          <div class="who"><div class="last">${esc(c.last)}</div><div class="meta">${tag}${reason}<span>${esc(c.first)}</span></div></div>
          <div class="acts">${pinBtn}${starBtn}
            <button class="abtn" data-act="pass" data-key="${esc(c.key)}" title="${esc(passText)}">Pass</button>
            <button class="abtn hide" data-act="hide" data-key="${esc(c.key)}" title="Hide this player for the rest of the match">Hide</button>
          </div>
        </div>
        <ol class="pops">${pops}</ol>
      </article>`;
    }

    // List layout: every player on the side, two chosen stats, the carded players highlighted on top.
    function playerList(v, side, vals) {
      const defs = listFor(v.sport).stats;
      const cols = listStats.map((id, i) => defs.find((x) => x.id === id) || defs[i]);
      const rows = v.players[side].map((r) => {
        const cells = cols.map((c) => {
          const id = r.key + '|list|' + c.id, val = r.stats[c.id];
          const was = lastVals.get(id); vals.set(id, val);
          return `<span class="pv${was !== undefined && was !== val ? ' tick' : ''}"><span class="v">${esc(val)}</span><span class="l">${esc(c.l)}</span></span>`;
        }).join('');
        const pinBtn = handlers.hold ? `<button class="abtn pin${r.held ? ' on' : ''}" data-act="hold" data-key="${esc(r.key)}" aria-pressed="${r.held}" title="${r.held ? 'Click to unpin' : 'Keep on the board for 10 min'}">${r.held ? '●' : 'Pin'}</button>` : '';
        return `<li class="prow${r.top ? ' is-top' : ''}${r.live ? ' is-live' : ''}${r.starred ? ' is-star' : ''}${r.held ? ' is-held' : ''}" data-key="${esc(r.key)}">
          <span class="jersey">${esc(r.uni)}</span><span class="last">${esc(r.last)}${r.starred ? ' <span class="impact">★</span>' : ''}</span>
          <span class="pvals">${cells}</span>${pinBtn}</li>`;
      }).join('');
      return `<ol class="plist">${rows || `<li class="empty">No ${esc(v.teams[side].code)} players listed yet.</li>`}</ol>`;
    }

    function drawPlayers(v, side, vals) {
      const t = v.teams[side];
      const cards = v.playerCards[side];
      const want = v.layout ? v.layout.cards : 3;
      let body;
      if (layout === 'list') body = playerList(v, side, vals);
      else {
        const empty = cards.length < want ? `<div class="empty">${cards.length ? 'No other' : 'No'} ${esc(t.code)} player has a stat yet.</div>` : '';
        body = `<div class="pstack">${cards.map((c) => playerCard(c, vals)).join('')}${empty}</div>`;
      }
      regions[side].innerHTML = `<div class="eyebrow">${swatch(side, t.code)}${esc(t.name || t.code)}</div>${body}`;
    }

    function drawTeam(v) {
      const col = (side) => {
        const t = v.teams[side];
        const lines = v.teamCards[side];
        const body = lines.length
          ? `<div class="tcard">${lines.map((c) => `<div class="tline${c.live ? ' is-live' : ''}${c.dim ? ' is-dim' : ''}${isCopied(c.big) ? ' copied' : ''}" data-copy="${esc(c.big)}" title="Click to copy"><div class="big">${esc(c.big)}</div><div class="sub">${c.live ? '<span class="livedot">Live</span> ' : ''}${esc(c.sub || '')}</div></div>`).join('')}</div>`
          : `<div class="empty">No ${esc(t.code)} team stats yet.</div>`;
        return `<div class="tcol side-${side}"><div class="eyebrow">${swatch(side, t.code)}${esc(t.code)}</div>${body}</div>`;
      };
      regions.team.innerHTML = `<div class="eyebrow">Team pops</div><div class="tcols">${col('home')}${col('away')}</div>`;
    }

    function court(v, side) {
      const r = v.rotation[side];
      const t = v.teams[side];
      if (!r.court) return `<div class="court"><h4>${swatch(side, t.code)}${esc(t.code)}</h4><p class="note">Fills in once ${esc(t.code)} serves.</p></div>`;
      const at = (pos) => r.court.find((x) => x.pos === pos);
      const cell = (pos) => {
        const x = at(pos);
        const srv = pos === 1 && r.serving;
        return `<div class="cell${srv ? ' srv' : ''}${x.player ? '' : ' unknown'}"><div class="pos">P${pos}${srv ? ' · serving' : ''}</div><div class="nm">${x.player ? '#' + esc(x.player.uni) + ' ' + esc(x.player.last) : '—'}</div></div>`;
      };
      return `<div class="court"><h4>${swatch(side, t.code)}${esc(t.code)}</h4>
        <div class="grid"><div class="net" aria-hidden="true"></div>${cell(4)}${cell(3)}${cell(2)}${cell(5)}${cell(6)}${cell(1)}</div></div>`;
    }

    // Basketball's second tab: each team's leaders in points, rebounds and assists.
    function leadersPanel(v) {
      const col = (side) => `<div class="court"><h4>${swatch(side, v.teams[side].code)}${esc(v.teams[side].code)}</h4>
        <ul class="leaders">${(v.leaders[side] || []).map((x) => `<li><span class="lv">${esc(x.v)}</span><span class="ll">${esc(x.l)}</span><span class="ln">${x.last ? '#' + esc(x.uni) + ' ' + esc(x.last) : '—'}</span></li>`).join('')}</ul></div>`;
      return `<div class="courts">${col('home')}${col('away')}</div>`;
    }

    function drawGame(v) {
      lastView = v;
      const bb = v.sport === 'bb';
      const sv = v.serving;
      const serveLine = sv ? `<span class="ball" style="background:var(--${sv.side})"></span>${esc(v.teams[sv.side].code)} serving${sv.last ? ` · <b>#${esc(sv.uni)} ${esc(sv.last)}</b>${sv.predicted ? ' · next' : ''}` : ''}${sv.streak >= 2 ? ` · ${sv.streak} straight` : ''}` : '';
      // An alert that just appeared (or changed) pulses once, so it registers while the eye is on the cards.
      const alertKey = v.alerts.map((a) => a.kind + a.text).join('|');
      const fresh = alertKey && alertKey !== lastAlertKey;
      lastAlertKey = alertKey;
      const alerts = v.alerts.map((a) => `<div class="alert ${a.sev}${fresh ? ' is-new' : ''}" role="status"><strong>${esc(a.text)}</strong>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}</div>`).join('');
      const plays = v.plays;
      const lastPlay = plays.find((p) => !p.alert) || plays[0];
      const sc = (p) => (p.score ? `${p.score.home}–${p.score.away}` : '');
      const playsPanel = `<p class="lastplay">${lastPlay ? esc(lastPlay.text) : 'No plays yet.'}</p>
        <ul class="recent">${plays.filter((p) => p !== lastPlay).slice(0, 3).map((p) => `<li class="${p.alert ? 'is-alert' : ''}"><span class="sc">${sc(p)}</span><span>${esc(p.text)}</span></li>`).join('')}</ul>`;
      const rotPanel = bb ? '' : `<div class="courts">${court(v, 'home')}${court(v, 'away')}</div>
        <p class="note">From the serve order. Liberos not tracked.</p>`;
      let status = v.status === 'final' ? 'Final' : v.status === 'pre' ? 'Pregame' : `Set ${v.set}`;
      // Beside each team code: sets won (volleyball) or team fouls (basketball; amber once the other team is in the bonus).
      let box = (side) => `<span class="sl-sets" title="Sets won">${v.setsWon[side]}<small>sets</small></span>`;
      let infoLine = serveLine;
      if (bb) {
        status = esc(v.period.label) + (v.period.clock ? ` · <span class="sl-clock">${esc(v.period.clock)}</span>` : '');
        box = (side) => {
          const f = v.fouls[side];
          const tip = f.exact ? `Team fouls this ${v.period.word}${f.bonus ? ' · ' + v.teams[side === 'home' ? 'away' : 'home'].code + ' in the ' + f.bonus.toLowerCase() : ''}` : 'Team fouls, whole game (the reader started partway through)';
          return `<span class="sl-sets${f.bonus ? ' bonus' : ''}" title="${esc(tip)}">${f.n}<small>${f.exact ? 'fouls' : 'pf'}</small></span>`;
        };
        infoLine = esc(v.info || '');
      }
      regions.game.innerHTML = `<div class="eyebrow">Game</div>
        <div class="scoreline">
          <div class="sl-team home"><span class="sl-code">${esc(v.teams.home.code)}</span>${box('home')}</div>
          <div class="sl-pts">${v.score.home}–${v.score.away}<small>${status}</small></div>
          <div class="sl-team away">${box('away')}<span class="sl-code">${esc(v.teams.away.code)}</span></div>
        </div>
        <div class="serve">${infoLine}</div>
        ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-act="tab" data-tab="plays" aria-selected="${tab === 'plays'}">Last play</button>
          <button class="tab" role="tab" data-act="tab" data-tab="rot" aria-selected="${tab === 'rot'}">${bb ? 'Leaders' : 'Rotation'}</button>
        </div>
        ${tab === 'plays' ? playsPanel : bb ? leadersPanel(v) : rotPanel}`;
    }

    function drawFoot(v) {
      const unit = v.unit || ['rally', 'rallies'];
      const passed = (v.passed || []).map((h) => `<span class="chip passed" title="Back in ${h.rallies} ${h.rallies === 1 ? unit[0] : unit[1]}">#${esc(h.uni)} ${esc(h.last)}<button data-act="unpass" data-key="${esc(h.key)}">Undo</button></span>`).join('');
      const chips = v.hidden.map((h) => `<span class="chip">#${esc(h.uni)} ${esc(h.last)}<button data-act="unhide" data-key="${esc(h.key)}">Show</button></span>`).join('');
      regions.foot.innerHTML = (passed ? `<span>Passed:</span>${passed}` : '') + (chips ? `<span>Hidden:</span>${chips}` : '') + (handlers.footNote ? `<span>${handlers.footNote}</span>` : '');
    }

    return {
      render(v) {
        if (!v) return;
        const vals = new Map();
        passText = v.passText || passText;
        boardEl.classList.toggle('sport-bb', v.sport === 'bb');
        boardEl.classList.toggle('cards-5', layout !== 'list' && !!v.layout && v.layout.cards === 5);
        boardEl.classList.toggle('layout-list', layout === 'list');
        drawGame(v); drawTeam(v); drawPlayers(v, 'home', vals); drawPlayers(v, 'away', vals); drawFoot(v);
        lastVals = vals;
      },
      // Redraw only the game panel (the basketball clock ticks every second; the cards stay put).
      renderGame(v) { if (v) drawGame(v); },
      setColors,
      // layout: 'cards' or 'list'. stats: the two list-layout stat ids (see LIST_STATS).
      setLayout(l, stats) {
        layout = l === 'list' ? 'list' : 'cards';
        if (Array.isArray(stats) && stats.length === 2) listStats = stats.slice();
      },
      // Freshness: 'quiet' (no change for a while) or 'stale' (a long time) tints the board; '' clears it.
      setFreshness(f) { boardEl.classList.toggle('is-quiet', f === 'quiet'); boardEl.classList.toggle('is-stale', f === 'stale'); },
    };
  }

  root.BoardView = { mountBoard, mountControls, copyText, esc, LIST_STATS, LIST_STATS_BB, ROTATE_OPTIONS };
})(SPB);

/*
 * Impact players: star store (per team, saved in this browser) and the roster
 * picker panel. MSU picks are saved under one key so they carry over to every
 * match; opponents are saved by their team code.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PE = () => root.PopEngine;

  function isMSU(team) {
    if (!team) return false;
    return /^(MSU|MTST|MONTST|MONT ST)$/i.test(String(team.code || '').trim()) || /montana st(\.|ate)/i.test(String(team.name || ''));
  }
  const teamKey = (team) => (isMSU(team) ? 'MSU' : String((team && (team.code || team.name)) || '?').trim().toUpperCase());

  function createStarStore(prefix) {
    const mem = {};
    const k = (tk) => (prefix || 'spb:stars:') + tk;
    return {
      get(tk) {
        try { const v = localStorage.getItem(k(tk)); if (v != null) return JSON.parse(v) || []; } catch (e) { /* storage blocked */ }
        return mem[tk] || [];
      },
      set(tk, list) {
        mem[tk] = list;
        try { localStorage.setItem(k(tk), JSON.stringify(list)); } catch (e) { /* kept in memory only */ }
      },
      has(tk, p) { return this.get(tk).some((st) => PE().matchesStar(p, st)); },
      toggle(tk, p) {
        const list = this.get(tk).slice();
        const i = list.findIndex((st) => PE().matchesStar(p, st));
        if (i >= 0) list.splice(i, 1);
        else list.push({ uni: String(p.uni), last: p.last || '', first: p.first || '' });
        this.set(tk, list);
        return list;
      },
    };
  }

  // Merge the live roster with a bundled one (adds positions and players the page hasn't listed yet).
  function mergeRoster(live, bundled) {
    const out = (live || []).map((p) => ({ uni: String(p.uni), last: p.last, first: p.first || '', pos: '' }));
    for (const b of bundled || []) {
      const hit = out.find((p) => PE().matchesStar(p, b));
      if (hit) { hit.pos = hit.pos || b.pos || ''; if (!hit.first) hit.first = b.first; }
      else out.push({ uni: String(b.uni), last: b.last, first: b.first, pos: b.pos || '', notListed: (live || []).length > 0 });
    }
    return out.sort((a, b) => (parseInt(a.uni, 10) || 0) - (parseInt(b.uni, 10) || 0));
  }

  function mountPicker(host, handlers) {
    let model = null;
    host.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b || !model) return;
      if (b.dataset.act === 'pk-toggle') {
        const col = model.cols[+b.dataset.col];
        const p = col.players[+b.dataset.i];
        if (p && handlers.toggle) handlers.toggle(col, p);
      } else if (b.dataset.act === 'pk-close' && handlers.close) handlers.close();
    });

    function colHTML(col, ci) {
      const chips = col.players.map((p, i) => {
        const on = col.starred(p);
        return `<button class="pk-chip${on ? ' on' : ''}${p.notListed ? ' faint' : ''}" data-act="pk-toggle" data-col="${ci}" data-i="${i}" aria-pressed="${on}" title="${p.notListed ? 'On the roster, not on this page yet' : ''}">
          <span class="pk-star" aria-hidden="true">${on ? '★' : '☆'}</span><span class="pk-num">${esc(p.uni)}</span><span class="pk-name">${esc(p.last)}</span>${p.pos ? `<span class="pk-pos">${esc(p.pos)}</span>` : ''}</button>`;
      }).join('');
      const count = col.players.filter(col.starred).length;
      return `<div class="pk-col side-${col.side}">
        <div class="eyebrow"><span class="swatch"></span>${esc(col.title)}<span class="pk-count">${count ? count + ' starred' : ''}</span></div>
        ${col.players.length ? `<div class="pk-list">${chips}</div>` : `<p class="note">${esc(col.note || 'Roster appears once the stats page lists it.')}</p>`}
      </div>`;
    }

    return {
      render(m) {
        model = m;
        host.innerHTML = `<div class="picker">
          <div class="pk-head"><div><b>Impact players</b><p class="note">Star the players you pop most. A starred player always keeps a card. MSU stars carry over to every match.</p></div>
          <button class="tbtn" data-act="pk-close">Done</button></div>
          <div class="pk-cols">${m.cols.map(colHTML).join('')}</div></div>`;
      },
    };
  }

  root.ImpactPicker = { isMSU, teamKey, createStarStore, mergeRoster, mountPicker };
})(SPB);

/*
 * Reader: runs inside the StatBroadcast tab (started by the bookmark, a console
 * paste, Tampermonkey, or the practice page). It reads only what that page
 * shows, then hands it to the Stat Pop Board window on this computer through
 * window.postMessage. It makes no network requests of its own.
 *
 *   - score, set (or period and clock) and team codes from the tab title
 *     ("UI 18, MSU 24 - SET 3", "UM 31, MSU 38 - 2nd 12:34")
 *   - player and team rows from tables whose headers look like a volleyball or a basketball box;
 *     which of the two it finds decides the sport
 *   - new play-by-play / console sentences that name a rostered player
 */
function startReader(SPB) {
  const PE = SPB.PopEngine, BV = SPB.BoardView, IP = SPB.ImpactPicker;
  const VERSION = SPB.version;
  const INSTANCE = Math.random().toString(36).slice(2, 10);
  const BOARD_ORIGIN = SPB.origin;
  const eventId = new URLSearchParams(location.search).get('id') || (/practice-bb/.test(location.pathname) ? 'practice-bb' : /practice/.test(location.pathname) ? 'practice' : 'page');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('spb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('spb:' + k, JSON.stringify(v)); } catch (e) { /* settings just won't persist */ } },
  };
  function applyStyles(root, cssText) {
    try {
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
        const sh = new CSSStyleSheet(); sh.replaceSync(cssText); root.adoptedStyleSheets = [sh]; return;
      }
    } catch (e) { /* fall through to a style element */ }
    const st = document.createElement('style'); st.textContent = cssText; root.appendChild(st);
  }

  // ---------------------------------------------------------- page reading

  // StatBroadcast prefixes the tab title with "[Paused]" once it has stopped refreshing the page
  // (seen 2026-10-17). That is a state flag, not part of a team code: strip any leading [tag] before
  // parsing, or it lands in the visitor's code and rekeys stars and colours for as long as it lasts.
  const titlePaused = (t) => /^\s*\[paused\]/i.test(String(t || ''));
  function parseTitle(t) {
    const m = String(t || '').replace(/^\s*\[[^\]]*\]\s*/, '').match(/^\s*([^,]*?)\s*(\d+)?\s*,\s*(.*?)\s*(\d+)?\s+-\s+(.*?)\s*$/);
    if (!m) return null;
    const status = m[5];
    const setM = status.match(/set\s*(\d+)/i);
    return {
      vis: { code: m[1].trim(), score: m[2] == null ? 0 : +m[2] },
      home: { code: m[3].trim(), score: m[4] == null ? 0 : +m[4] },
      final: /final/i.test(status), set: setM ? +setM[1] : null, raw: status, paused: titlePaused(t),
    };
  }

  // Basketball: the part of the title after the dash ("2nd 12:34", "1st Half", "Q3 4:10", "Halftime",
  // "End of 1st", "OT 2:05", "Final/OT"). The real wording has not been seen yet (first basketball game:
  // 2026-11-15), so every piece is optional and the engine copes with whatever is missing.
  // period: 1.. in regulation; ot: overtime number; periods: 2 or 4 when the wording says, else 0.
  function parseBBStatus(raw) {
    const t = String(raw || '');
    const cm = t.match(/(\d{1,2}:\d{2}(?:\.\d)?)/) || t.match(/(?:^|\s)(:?\d{1,2}\.\d)(?=\s|$)/);
    const out = { clock: cm ? cm[1] : null, final: /final/i.test(t), period: 0, ot: 0, periods: 0, intermission: /\bend\b|half\s*-?\s*time|intermission|\bbreak\b/i.test(t), halftime: false };
    const noClock = cm ? t.replace(cm[1], ' ') : t;
    const q = noClock.match(/\bQ(?:TR|UARTER)?\.?\s*([1-4])\b/i) || noClock.match(/\b([1-4])(?:st|nd|rd|th)\s+(?:q|qtr|quarter)/i);
    const half = noClock.match(/\b(1st|2nd|first|second)\s+half\b/i) || noClock.match(/\bH(?:ALF)?\s*([12])\b/i);
    const ot = noClock.match(/\b(\d)?\s*OT\s*(\d)?\b/i) || noClock.match(/overtime/i);
    const ord = noClock.match(/\b([1-4])(?:st|nd|rd|th)\b/i) || noClock.match(/\b(?:period|per|prd)\.?\s*([1-4])\b/i);
    if (q) { out.period = +q[1]; out.periods = 4; }
    else if (half) { out.period = /^(1|1st|first)$/i.test(half[1]) ? 1 : 2; out.periods = 2; }
    else if (ot && !out.final) out.ot = +(ot[1] || ot[2] || 1);
    else if (ord) { out.period = +ord[1]; if (out.period > 2) out.periods = 4; }
    else if (/half\s*-?\s*time|^\s*half\s*$/i.test(noClock)) { out.halftime = true; out.intermission = true; }
    if (out.final && /OT/i.test(t)) out.ot = +((t.match(/(\d)\s*OT/i) || [])[1] || 1);
    return out;
  }

  // Column abbreviations. The live StatBroadcast volleyball box (first seen 2026-10-17,
  // SUU at MSU, event 670274) uses S # PLAYER K E TA HIT% AS SA DG BL -- so AS, DG and BL
  // are the real page's spellings for assists, digs and blocks. Without them looksVolleyball
  // counted only one extra column and rejected both box-score tables.
  // BL is a combined block count; it maps to bs so tb comes out right. The SOLO/AST split
  // on a card is therefore not meaningful on pages that use BL.
  const HMAP = {
    '#': 'uni', 'NO': 'uni', 'NO.': 'uni', 'NUM': 'uni',
    'PLAYER': 'name', 'NAME': 'name', 'ATHLETE': 'name',
    'SP': 'sp', 'S': 'sp', 'K': 'k', 'KILLS': 'k', 'E': 'e', 'TA': 'ta', 'TOT': 'ta', 'ATT': 'ta',
    'PCT': 'pct', 'PCT.': 'pct', 'HIT%': 'pct', 'A': 'a', 'AS': 'a', 'AST': 'a', 'ASST': 'a',
    'SA': 'sa', 'SE': 'se', 'RE': 're', 'DIG': 'dig', 'DG': 'dig', 'DIGS': 'dig', 'BS': 'bs', 'BA': 'ba', 'BL': 'bs',
    'BE': 'be', 'BHE': 'bhe', 'PTS': 'pts', 'DHB': 'dhb',
  };
  const cellText = (c) => (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
  const ours = (el) => !!(el && el.closest && el.closest('#spb-host, #spb-dock'));

  function expandRow(tr) {
    const out = [];
    for (const c of tr.cells) { const span = Math.max(1, +c.colSpan || 1); for (let i = 0; i < span; i++) out.push(c); }
    return out;
  }
  function headerMap(table, keyOf) {
    let best = null;
    for (const tr of [...table.rows].slice(0, 4)) {
      const map = {}; let hits = 0;
      expandRow(tr).forEach((c, i) => {
        const key = keyOf(cellText(c).toUpperCase());
        if (!key) return;
        if (key === 'e' && map.e != null) { map.setE = i; return; }
        if (map[key] == null) { map[key] = i; hits++; }
      });
      if (!best || hits > best.hits) best = { tr, map, hits };
    }
    return best;
  }
  function looksVolleyball(map) {
    const extra = ['sa', 'dig', 'bs', 'ba', 'a', 're'].filter((k) => map[k] != null).length;
    return map.k != null && (map.ta != null || map.pct != null) && extra >= 2;
  }
  // Summary rows that sit in or beside a box score: team, totals, and team-by-set rows ("Set 1", "Match").
  // Seen as player cards on the live page on 2026-10-17, so they are rejected by label as well as by table.
  const NON_PLAYER = /^(sets?|game|match|totals?|team|tm|opp(onent)?s?|bench|starters|reserves|technical|coach|dnp|did not play|1st half|2nd half|half|quarter|period|ot)\b|^\d+(st|nd|rd|th)?(\s+(sets?|half|quarter|qtr|period))?$/i;

  // Basketball box columns. Written for both the StatCrew box (## Player FG-FGA 3FG-FGA FT-FTA OFF DEF TOT
  // PF TP A TO BLK S MIN) and the shorter live layout (# PLAYER MIN FG 3PT FT ORB-DRB REB PF A TO BLK STL PTS).
  // fg, tp, ft and od are "made-attempted" (or off-def) cells such as "5-11".
  function bbKey(h) {
    h = h.replace(/\s+/g, '').replace(/\.$/, '');
    if (/^(#|##|NO|NUM)$/.test(h)) return 'uni';
    if (/^(PLAYERS?|NAME|ATHLETE)$/.test(h)) return 'name';
    if (/^(MIN|MINS|MP)$/.test(h)) return 'min';
    if (/%|PCT/.test(h)) return null;
    if (h === 'FGM') return 'fgm';
    if (h === 'FGA') return 'fga';
    if (/^(3PM|3FGM|3PTM)$/.test(h)) return 'tpm';
    if (/^(3PA|3FGA|3PTA)$/.test(h)) return 'tpa';
    if (h === 'FTM') return 'ftm';
    if (h === 'FTA') return 'fta';
    if (/^FG(M?[-\/](FG)?A)?$/.test(h)) return 'fg';
    if (/^3-?(PT|FG|P)?(FG)?(M?[-\/](3P|3PT|FG)?A)?$/.test(h) || h === '3PTFG') return 'tp';
    if (/^FT(M?[-\/](FT)?A)?$/.test(h)) return 'ft';
    if (/^(OREB|OFF|OR|ORB)$/.test(h)) return 'oreb';
    if (/^(DREB|DEF|DR|DRB)$/.test(h)) return 'dreb';
    if (/^(REB|REBS|TOT|TR|TRB|RB)$/.test(h)) return 'reb';
    if (/^(ORB|OR|OREB|OFF|O)[-\/](DRB|DR|DREB|DEF|D)$/.test(h)) return 'od';
    if (/^(A|AST|AS|ASST)$/.test(h)) return 'ast';
    if (/^(TO|TOV|TOS)$/.test(h)) return 'to';
    if (/^(BLK|BLKS|BK|BL|BS)$/.test(h)) return 'blk';
    if (/^(STL|STLS|ST)$/.test(h)) return 'stl';
    if (/^(PF|F|FLS|FOULS)$/.test(h)) return 'pf';
    if (/^(PTS|TP|POINTS)$/.test(h)) return 'pts';
    if (/^(S|GS)$/.test(h)) return 'sflag';
    return null;
  }
  // Each sport: how to read a header cell, whether a header row is that sport's player box, and how to
  // turn a row's cells into a stat line.
  const READ = {
    vb: {
      keyOf: (h) => HMAP[h],
      looks: looksVolleyball,
      stats(cells, map) {
        const val = (k) => (map[k] == null || !cells[map[k]] ? 0 : parseFloat(cellText(cells[map[k]]).replace(/[^\d.-]/g, '')) || 0);
        const stats = {};
        for (const k of ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be']) stats[k] = val(k);
        return stats;
      },
    },
    bb: {
      keyOf: bbKey,
      looks: (map) => map.pts != null && (map.fg != null || map.fgm != null) && (map.reb != null || map.oreb != null || map.od != null || map.ast != null),
      // Only the columns the table has are returned, so a short on-court table merged over the full box
      // cannot zero a stat it does not list.
      stats(cells, map) {
        const txt = (k) => (map[k] == null || !cells[map[k]] ? '' : cellText(cells[map[k]]));
        const n = (k) => parseFloat(txt(k).replace(/[^\d.]/g, '')) || 0;
        const pair = (k) => { const m = txt(k).match(/(\d+)\s*[-\/]\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };
        const o = {};
        for (const [k, m, a] of [['fg', 'fgm', 'fga'], ['tp', 'tpm', 'tpa'], ['ft', 'ftm', 'fta'], ['od', 'oreb', 'dreb']]) {
          const pr = pair(k);
          if (pr) { o[m] = pr[0]; o[a] = pr[1]; }
          else if (map[k] != null && map[m] == null) o[m] = n(k);
          if (map[m] != null) o[m] = n(m);
          if (map[a] != null) o[a] = n(a);
        }
        for (const k of ['reb', 'ast', 'to', 'blk', 'stl', 'pf', 'pts']) if (map[k] != null) o[k] = n(k);
        if (map.stl == null && map.sflag != null && /^\d+$/.test(txt('sflag'))) o.stl = +txt('sflag');
        if (map.reb == null && (o.oreb != null || o.dreb != null)) o.reb = (o.oreb || 0) + (o.dreb || 0);
        if (map.min != null) o.min = parseInt(txt('min'), 10) || 0;
        return o;
      },
    },
  };

  function splitName(raw) {
    let s = raw.replace(/\*/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().replace(/^\d+\s+/, '');
    if (s.includes(',')) { const [last, first] = s.split(',').map((x) => x.trim()); return { last, first: first || '' }; }
    const parts = s.split(' ');
    return parts.length === 1 ? { last: parts[0], first: '' } : { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }
  function contextBits(el) {
    const bits = [];
    if (el.caption) bits.push(cellText(el.caption));
    let node = el;
    for (let up = 0; up < 4 && node; up++) {
      let sib = node.previousElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
        const t = cellText(sib);
        if (t && t.length < 120) bits.push(t);
      }
      node = node.parentElement;
    }
    return bits;
  }
  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentions = (text, w) => !!w && new RegExp('(?<![A-Za-z0-9])' + escRe(w) + '(?![A-Za-z0-9])', 'i').test(text);

  function teamNames() {
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5')) {
      if (ours(h)) continue;
      const m = cellText(h).match(/^(.+?)\s+(?:at|vs\.?)\s+(.+)$/i);
      if (m && m[1].length < 40 && m[2].length < 40) return { vis: m[1], home: m[2] };
    }
    return { vis: null, home: null };
  }

  const ignoredTables = [];
  function readTables(title, names, sport) {
    const R = READ[sport];
    const found = [];
    ignoredTables.length = 0;
    for (const table of document.querySelectorAll('table')) {
      if (ours(table)) continue;
      const hm = headerMap(table, R.keyOf);
      if (!hm || !R.looks(hm.map)) continue;
      const bits = contextBits(table);
      if (/season|career|cumulative/i.test(bits.slice(0, 2).join(' '))) continue;
      // A player box has a jersey or a name column. Team-by-set, by-period and comparison tables have the
      // stat columns but neither, and their rows ("Set 1", "Match", "1st Half") would otherwise read as players.
      if (hm.map.uni == null && hm.map.name == null) {
        if (ignoredTables.length < 4) ignoredTables.push({ headers: Object.keys(hm.map).join(' '), rows: table.rows.length, context: bits.join(' | ').slice(0, 100) });
        continue;
      }
      const players = [], skipped = [];
      let totals = null;
      const rows = [...table.rows];
      for (const tr of rows.slice(rows.indexOf(hm.tr) + 1)) {
        const cells = expandRow(tr);
        const lead = cells.slice(0, 3).map(cellText).join(' ');
        const stats = R.stats(cells, hm.map);
        if (/^\s*(team\s+)?totals?\b/i.test(lead) || /\btotals?\b/i.test(cells.slice(0, 2).map(cellText).join(' '))) { totals = stats; continue; }
        if (/^\s*(tm|team)\b/i.test(lead)) continue;
        const nameCell = hm.map.name != null ? cells[hm.map.name] : cells.find((x) => /[A-Za-z]{2}/.test(cellText(x)));
        const raw = nameCell ? cellText(nameCell) : '';
        // The jersey comes from the # column, or leads the name ("12 Smith"). Never from another cell:
        // a stat value there would key a summary row as a player.
        const um = (hm.map.uni != null && cells[hm.map.uni] ? cellText(cells[hm.map.uni]) : '').match(/^#?(\d{1,2})(?!\d)/)
          || raw.match(/^(\d{1,2})\s/);
        const uni = um ? um[1] : '';
        const nm = splitName(raw);
        if (!uni || !raw || NON_PLAYER.test(raw.replace(/^[^A-Za-z0-9]+/, '')) || !/\p{L}/u.test(nm.last)) {
          if (raw && skipped.length < 6) skipped.push(raw.slice(0, 30));
          continue;
        }
        players.push({ uni, first: nm.first, last: nm.last, ...stats });
      }
      if (!players.length) continue;
      let side = null;
      for (const b of bits) {
        const h = (title && mentions(b, title.home.code)) || mentions(b, names.home);
        const v = (title && mentions(b, title.vis.code)) || mentions(b, names.vis);
        if (h && !v) { side = 'home'; break; }
        if (v && !h) { side = 'vis'; break; }
      }
      found.push({ table, side, players, totals, skipped, headers: Object.keys(hm.map), ctx: bits.join(' | ').slice(0, 140) });
    }
    const unassigned = found.filter((f) => !f.side);
    if (unassigned.length) {
      const taken = new Set(found.map((f) => f.side).filter(Boolean));
      const order = ['vis', 'home'].filter((s) => !taken.has(s));
      unassigned.forEach((f, i) => { f.side = order[i] || null; });
    }
    return found;
  }

  function readSetsWon(title) {
    if (!title) return null;
    for (const table of document.querySelectorAll('table')) {
      if (ours(table)) continue;
      const head = table.rows[0] ? expandRow(table.rows[0]).map(cellText) : [];
      if (!(head.includes('1') && head.includes('2') && head.includes('3'))) continue;
      const setCols = head.map((h, i) => (/^[1-5]$/.test(h) ? i : -1)).filter((i) => i >= 0);
      const body = [...table.rows].slice(1, 3).map((tr) => expandRow(tr));
      if (body.length !== 2) continue;
      const is = (code, r) => code && new RegExp('\\b' + escRe(code) + '\\b', 'i').test(cellText(r[0]));
      const sides = body.map((r) => (is(title.home.code, r) ? 'home' : is(title.vis.code, r) ? 'vis' : null));
      if (!sides[0] || !sides[1] || sides[0] === sides[1]) continue;
      const won = { vis: 0, home: 0 };
      const current = title.set || 99;
      for (const ci of setCols) {
        if (!title.final && +head[ci] >= current) continue;
        const a = parseInt(cellText(body[0][ci]), 10), b = parseInt(cellText(body[1][ci]), 10);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
        won[a > b ? sides[0] : sides[1]] += 1;
      }
      return won;
    }
    return null;
  }

  // ---------------------------------------------------------- play lines

  const ACTION = /\b(kill|ace|block|dig|attack error|service error|serve|assist|point|wins|timeout|time-out|challenge|review|substitution|subs?:|card|penalty|good!?|made|makes|miss(ed|es)?|rebound|steal|turnover|turnovr|foul|dunk|lay-?up|jumper|jump shot|3[- ]?pt(r|\.)?|three|free throw|ft shot)\b/i;
  const ALERT = /\b(time[- ]?out|challenge|video review|red card|yellow card|penalty|sanction|technical|flagrant)\b/i;
  const seen = new Set();
  const statTables = new WeakSet();
  const lineLog = [];
  let lineSeq = 0, rosterWords = [], primed = false;

  function playLike(text) {
    if (text.length < 8 || text.length > 240) return false;
    if (ALERT.test(text)) return true;
    if (!ACTION.test(text)) return false;
    const low = text.toLowerCase();
    return rosterWords.some((w) => low.includes(w));
  }
  function lineFrom(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || ours(el)) return null;
    const tbl = el.closest('table');
    if (tbl && statTables.has(tbl)) return null;
    // A play sentence may be split across inline tags: climb a few levels for the whole line.
    for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 240) return null;
      if (text && playLike(text)) return text;
    }
    return null;
  }
  // A few lines at once = new plays (repeats allowed: back-to-back aces read the same).
  // Many at once = the page redrew its list, so only never-seen lines count.
  function recordBatch(texts) {
    const uniq = [...new Set(texts)];
    const fresh = uniq.length > 3 ? uniq.filter((t) => !seen.has(t)) : uniq;
    const now = Date.now();
    for (const t of fresh) {
      const last = lineLog[lineLog.length - 1];
      if (last && last.text === t && now - last.at < 3000) continue;
      lineLog.push({ id: ++lineSeq, text: t, at: now });
    }
    uniq.forEach((t) => seen.add(t));
    if (lineLog.length > 60) lineLog.splice(0, lineLog.length - 60);
  }
  function prime() {
    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length) continue;
      const t = lineFrom(el);
      if (t) seen.add(t);
    }
    primed = true;
  }

  // ---------------------------------------------------------- reading a snapshot

  let trackedSets = { vis: 0, home: 0 }, lastTitle = null;
  const diag = { version: VERSION, eventId, notes: [] };
  // Basketball: 2 halves or 4 quarters, remembered once the page gives it away.
  let bbPeriods = 0;

  // A line score: a small table whose header counts periods (1 2, or 1 2 3 4) above one row per team.
  // Returns how many periods it lists, or 0.
  function lineScorePeriods(title) {
    for (const table of document.querySelectorAll('table')) {
      if (ours(table) || statTables.has(table) || table.rows.length < 3 || table.rows.length > 4) continue;
      const head = expandRow(table.rows[0]).map(cellText);
      const nums = head.filter((h) => /^[1-4]$/.test(h));
      if (nums.length < 2 || head.includes('5') || nums.join('') !== '1234'.slice(0, nums.length)) continue;
      const body = [...table.rows].slice(1, 3).map((tr) => cellText(expandRow(tr)[0] || tr));
      const is = (code, text) => !!code && mentions(text, code);
      if (body.length === 2 && (is(title.home.code, body[0]) || is(title.home.code, body[1])) && (is(title.vis.code, body[0]) || is(title.vis.code, body[1]))) return nums.length;
    }
    return 0;
  }

  // What every table on the page is headed, for Reader check's Copy for Claude: it is how the reader gets
  // fitted to a layout it has not met. Refreshed every few seconds, not on every change.
  let pageTables = [], pageTablesAt = 0;
  function describeTables() {
    if (Date.now() - pageTablesAt < 5000) return pageTables;
    pageTablesAt = Date.now();
    pageTables = [];
    for (const table of document.querySelectorAll('table')) {
      if (ours(table) || !table.rows.length) continue;
      if (pageTables.length >= 14) break;
      pageTables.push({ head: expandRow(table.rows[0]).map(cellText).join(' | ').slice(0, 140),
        row2: table.rows[1] ? expandRow(table.rows[1]).map(cellText).join(' | ').slice(0, 140) : '', rows: table.rows.length, id: table.id || '', cls: String(table.className || '').slice(0, 40) });
    }
    return pageTables;
  }

  function snapshotFromPage() {
    let title = parseTitle(document.title);
    const names = teamNames();
    const bothSides = (ts) => ts.some((t) => t.side === 'vis') && ts.some((t) => t.side === 'home');
    // The sport is whichever box score the page shows: volleyball columns or basketball columns.
    let sport = 'vb';
    let tables = readTables(title, names, 'vb');
    if (!tables.length) {
      const bbt = readTables(title, names, 'bb');
      if (bbt.length) { tables = bbt; sport = 'bb'; }
    }
    tables.forEach((t) => statTables.add(t.table));
    diag.title = document.title;
    diag.parsedTitle = title;
    diag.paused = titlePaused(document.title);
    diag.names = names;
    diag.sport = tables.length ? sport : null;
    diag.tables = tables.map((t) => ({ side: t.side, players: t.players.length, totals: !!t.totals, headers: t.headers.join(' '), skipped: t.skipped, context: t.ctx }));
    diag.ignoredTables = ignoredTables.slice();
    diag.pageTables = describeTables();
    // Basketball safety net: if the tab title is not in the form this reader knows, take the score from
    // the box score itself (each team's points) and the names from the page heading. The period and clock
    // are then unknown, and the engine estimates how far along the game is from the score.
    if (!title && sport === 'bb' && bothSides(tables)) {
      const pts = (side) => {
        const ts = tables.filter((t) => t.side === side);
        const tot = ts.map((t) => t.totals && t.totals.pts).find((v) => v != null);
        return tot != null ? tot : Math.max(0, ...ts.map((t) => t.players.reduce((a, p) => a + (p.pts || 0), 0)));
      };
      const code = (name, d) => (name ? String(name).trim().slice(0, 12) : d);
      title = { vis: { code: code(names.vis, 'AWAY'), score: pts('vis') }, home: { code: code(names.home, 'HOME'), score: pts('home') },
        final: false, set: null, raw: '', paused: false, fromBox: true };
      diag.parsedTitle = title;
    }
    if (!title) return { error: 'Waiting for the score in the tab title (accept the terms on the stats page if you haven’t).' };
    if (!bothSides(tables)) {
      return { error: 'Waiting for both teams’ box-score tables. Switch the stats page to its box score view.' };
    }
    const mergeSide = (side) => {
      const map = new Map(); let totals = null;
      for (const t of tables.filter((x) => x.side === side)) {
        for (const p of t.players) map.set(p.uni, { ...(map.get(p.uni) || {}), ...p });
        if (t.totals) totals = { ...(totals || {}), ...t.totals };
      }
      return { code: title[side].code, name: (side === 'home' ? names.home : names.vis) || title[side].code, players: [...map.values()], totals };
    };
    rosterWords = tables.flatMap((t) => t.players.map((p) => p.last.toLowerCase())).filter((w) => w.length > 2);
    if (sport === 'bb') {
      const st = parseBBStatus(title.raw);
      if (st.periods) bbPeriods = st.periods;
      else if (!bbPeriods) { const n = lineScorePeriods(title); bbPeriods = n === 2 || n === 4 ? n : 0; }
      const P = bbPeriods || 2;
      let period = st.ot ? P + st.ot : st.period;
      if (st.halftime) period = P / 2;
      const teams = { home: mergeSide('home'), away: mergeSide('vis') };
      const any = [teams.home, teams.away].some((t) => t.players.some((p) => (p.pts || 0) + (p.fga || 0) + (p.reb || 0) + (p.pf || 0) + (p.min || 0) > 0));
      const pre = !st.final && title.home.score + title.vis.score === 0 && !any;
      diag.status = { ...st, periods: bbPeriods };
      return {
        sport: 'bb', status: st.final ? 'final' : pre ? 'pre' : 'live', period: period || 0, periods: bbPeriods, clock: st.clock,
        intermission: !st.final && st.intermission, rawStatus: title.raw, set: period || 0,
        score: { home: title.home.score, away: title.vis.score }, setsWon: { home: 0, away: 0 }, teams,
      };
    }
    if (lastTitle && title.set && lastTitle.set && title.set > lastTitle.set) {
      trackedSets[lastTitle.home.score > lastTitle.vis.score ? 'home' : 'vis'] += 1;
    }
    lastTitle = title;
    const sw = readSetsWon(title) || trackedSets;
    const merge = mergeSide;
    return {
      sport: 'vb', status: title.final ? 'final' : (title.set || 0) === 0 ? 'pre' : 'live', set: title.set || 1,
      score: { home: title.home.score, away: title.vis.score },
      setsWon: { home: sw.home || 0, away: sw.vis || 0 },
      teams: { home: merge('home'), away: merge('vis') },
    };
  }

  // ---------------------------------------------------------- dock (small bar, bottom-right)

  const dockHost = document.createElement('div');
  dockHost.id = 'spb-dock';
  dockHost.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483646;';
  document.documentElement.appendChild(dockHost);
  const dock = dockHost.attachShadow({ mode: 'open' });
  dock.innerHTML = `<div class="d" role="status"><span class="dot" id="dot"></span><span class="t" id="dt"><b>Pop board</b> · starting…</span>
    <button class="primary" id="openwin">Open board</button><button id="here">Show here</button><button class="x" id="min" title="Shrink this bar" aria-label="Shrink">–</button></div>`;
  applyStyles(dock, `
    .d { display:flex; align-items:center; gap:8px; background:#161c22; color:#edf1f4; border:1px solid #29323c; border-radius:8px; padding:6px 6px 6px 10px; font:500 13px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.35); max-width:min(620px, calc(100vw - 24px)); }
    .dot { width:9px; height:9px; border-radius:50%; flex:none; background:#f3a93c; }
    .dot.ok { background:#3ccf7a; } .dot.err { background:#ff4b3e; }
    .t { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .t b { font-weight:700; letter-spacing:.04em; }
    button { font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif; border-radius:6px; border:1px solid #3a4652; background:#1c242c; color:#edf1f4; padding:5px 10px; cursor:pointer; white-space:nowrap; }
    button.primary { background:#ff4b3e; border-color:#ff4b3e; color:#fff; }
    button:focus-visible { outline:2px solid #6fb4ff; outline-offset:2px; }
    .x { background:none; border:0; color:#a5b1bc; padding:4px 7px; }
    .d.small .t, .d.small #openwin, .d.small #here { display:none; }`);
  const D = (id) => dock.getElementById(id);
  D('min').addEventListener('click', () => {
    const small = D('dot').parentElement.classList.toggle('small');
    D('min').textContent = small ? 'Pop board' : '–';
  });

  // ---------------------------------------------------------- in-tab board (fallback)

  let host = null, shadow = null, board = null, inTabView = null, swapped = !!store.get('swap', false);
  let eng = PE.create(), engLineId = 0, lastHash = '', lastChange = Date.now();
  eng.setHidden(store.get('hidden:' + eventId, []));
  const saveHidden = () => store.set('hidden:' + eventId, eng.hiddenKeys);
  const overlayOpen = () => !!host && host.style.display !== 'none';

  function buildOverlay() {
    if (host) return;
    const fl = document.createElement('link');
    fl.rel = 'stylesheet'; fl.href = SPB.fontsHref;
    document.head.appendChild(fl);
    host = document.createElement('div');
    host.id = 'spb-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `${SPB.cssHref ? `<link rel="stylesheet" href="${SPB.cssHref}">` : ''}<div class="spb-root"><div class="app">
      <header class="bar">
        <div class="brand"><b>Stat Pop Board</b><span class="mode live">&#9679; Live</span></div>
        <span class="matchline" id="status">Reading this page…</span>
        <div class="transport">
          <button class="tbtn" id="swap">Swap sides</button>
          <button class="tbtn" id="close">Back to stats page</button>
        </div>
      </header>
      <div class="ctlbar" id="ctl" aria-label="Board controls"></div>
      <div id="board"></div></div></div>`;
    applyStyles(shadow, '[hidden]{display:none!important}.spb-root{height:100%;overflow:auto;background:var(--ground,#0f1317);color:var(--ink,#edf1f4);font-family:var(--font-body,system-ui,sans-serif);font-size:15px;line-height:1.35}');
    const $ = (id) => shadow.getElementById(id);
    $('close').addEventListener('click', () => setOpen(false));
    $('swap').addEventListener('click', () => { swapped = !swapped; store.set('swap', swapped); resetEngine(); tick(true); });
    ctl = BV.mountControls($('ctl'), {
      get: (k, d) => store.get(k, d), set: (k, v) => store.set(k, v),
      onChange: (s, what) => { if (what === 'rotate') lastRotateAt = Date.now(); applyLayout(); inTabView = eng.view(); if (inTabView) board.render(inTabView); },
    });
    board = BV.mountBoard($('board'), {
      pass: (k) => { eng.pass(k); board.render(eng.view()); },
      unpass: (k) => { eng.unpass(k); board.render(eng.view()); },
      hold: (k) => { eng.toggleHold(k); board.render(eng.view()); },
      hide: (k) => { eng.hide(k); saveHidden(); board.render(eng.view()); },
      unhide: (k) => { eng.unhide(k); saveHidden(); board.render(eng.view()); },
      color: (side, hex) => { const t = teamAt(side); if (!t) return; store.set(colorKey(t), hex); applyColors(); send(true); },
    });
    applyColors();
    applyLayout();
  }
  // The overlay's own copy of the board settings (this tab's storage, so they are separate from the board window's).
  let ctl = null, lastRotateAt = Date.now(), lastClock;
  function applyLayout() {
    if (!ctl) return;
    if (state.raw) ctl.setSport(state.raw.sport);
    eng.setCards(ctl.settings.layout === '5' ? 5 : 3);
    board.setLayout(ctl.settings.layout === 'all' ? 'list' : 'cards', ctl.settings.listStats);
  }
  setInterval(() => {
    if (!ctl || !state.ok) return;
    const rot = ctl.settings.rotate;
    ctl.setCountdown(rot ? `next in ${Math.max(0, Math.round((rot * 1000 - (Date.now() - lastRotateAt)) / 1000))} s` : '');
    if (rot && Date.now() - lastRotateAt >= rot * 1000) {
      eng.rotate(); lastRotateAt = Date.now();
      inTabView = eng.view();
      if (overlayOpen() && inTabView) board.render(inTabView);
    }
  }, 1000);
  function setOpen(open) {
    if (open) buildOverlay();
    if (host) host.style.display = open ? '' : 'none';
    store.set('mode', open ? 'here' : null);
    D('here').textContent = open ? 'Hide board' : 'Show here';
    if (open && inTabView) board.render(inTabView);
  }
  function resetEngine() {
    eng = PE.create(); eng.setHidden(store.get('hidden:' + eventId, [])); lastHash = ''; engLineId = lineSeq;
    applyLayout(); lastRotateAt = Date.now();
  }
  D('here').addEventListener('click', () => setOpen(!overlayOpen()));
  document.addEventListener('keydown', (e) => {
    if (e.key === '`' && !(e.target.closest && e.target.closest('input, textarea, select'))) setOpen(!overlayOpen());
  });

  // ---------------------------------------------------------- link to the board window

  let boardWin = null, lastAckAt = 0, sendSeq = 0, lastSentAt = 0, lastSentHash = '', bridgeNote = '';
  const linked = () => Date.now() - lastAckAt < 8000;
  const target = () => {
    if (!BOARD_ORIGIN) return null;
    if (boardWin && !boardWin.closed) return boardWin;
    if (window.opener && !window.opener.closed) return window.opener; // the board may have opened this tab
    return null;
  };

  function openBoard() {
    if (!BOARD_ORIGIN) { bridgeNote = 'board address unknown; start the reader from the setup page'; updateDock(); return; }
    const t = target();
    if (t && linked()) { try { t.focus(); } catch (e) { /* focus is best effort */ } send(true); return; }
    const w = window.open(BOARD_ORIGIN + '/?from=stats', 'stat-pop-board', 'popup,width=1440,height=900');
    if (!w) { bridgeNote = 'pop-up blocked: allow pop-ups for this site, then click Open board'; updateDock(); return; }
    boardWin = w;
    bridgeNote = 'opening board…';
    updateDock();
    setTimeout(() => {
      if (!linked()) { bridgeNote = w.closed ? 'this page blocked the board link; use Show here' : 'board hasn’t answered yet'; updateDock(); }
    }, 6000);
  }
  D('openwin').addEventListener('click', openBoard);

  window.addEventListener('message', (e) => {
    if (!BOARD_ORIGIN || e.origin !== BOARD_ORIGIN) return;
    const d = e.data;
    if (!d || d.spb !== 1) return;
    if (d.type === 'hello' || d.type === 'ack') {
      const was = linked();
      boardWin = e.source; lastAckAt = Date.now(); bridgeNote = '';
      if (d.colors) adoptColors(d.colors);
      if (d.type === 'hello') send(true);
      if (!was) updateDock();
    }
  });

  let state = { ok: false, kind: 'wait', error: 'Starting…', raw: null };
  // Team colours, keyed by team so they match the board window whichever way either tab is swapped.
  // They ride on the state message (to the board) and the ack (from it); each side keeps its own copy.
  const teamAt = (side) => state.raw && state.raw.teams[swapped ? (side === 'home' ? 'away' : 'home') : side];
  const colorKey = (t) => 'color:' + IP.teamKey(t);
  function applyColors() {
    if (!board) return;
    const h = teamAt('home'), a = teamAt('away');
    board.setColors(h && a ? { home: store.get(colorKey(h), null), away: store.get(colorKey(a), null) } : null);
  }
  function teamColors() {
    const out = {};
    if (!state.raw) return out;
    for (const t of [state.raw.teams.home, state.raw.teams.away]) { const v = store.get(colorKey(t), null); if (v) out[IP.teamKey(t)] = v; }
    return out;
  }
  function adoptColors(c) {
    // Store what the other tab knows, then apply regardless: a colour can be stored but not yet painted.
    for (const tk in c || {}) if (/^#[0-9a-f]{6}$/i.test(c[tk]) && store.get('color:' + tk, null) !== c[tk]) store.set('color:' + tk, c[tk]);
    applyColors();
  }
  function diagSummary() {
    return { version: VERSION, eventId, url: location.href.split('#')[0], title: diag.title, parsedTitle: diag.parsedTitle,
      names: diag.names, sport: diag.sport, status: diag.status, tables: diag.tables, ignoredTables: diag.ignoredTables, pageTables: diag.pageTables,
      error: state.error, linesCaptured: lineSeq, paused: !!diag.paused };
  }
  function send(force) {
    const t = target();
    if (!t) return;
    const h = JSON.stringify([state.raw, lineSeq, state.error]);
    if (!force && h === lastSentHash && Date.now() - lastSentAt < 2000) return;
    const msg = { spb: 1, type: 'state', v: VERSION, inst: INSTANCE, eventId, seq: ++sendSeq, sentAt: Date.now(),
      ok: state.ok, kind: state.kind, error: state.error, snap: state.raw, lines: lineLog.slice(-12), diag: diagSummary(), colors: teamColors() };
    try { t.postMessage(msg, BOARD_ORIGIN); lastSentAt = Date.now(); lastSentHash = h; } catch (e) { bridgeNote = 'could not reach the board: ' + e.message; }
  }

  function updateDock() {
    const dot = D('dot');
    dot.className = 'dot ' + (state.ok ? (diag.paused ? '' : 'ok') : state.kind === 'err' ? 'err' : '');
    let text;
    if (state.ok) {
      const s = state.raw;
      text = diag.paused ? 'paused · click the page to resume'
        : `${s.teams.home.players.length} + ${s.teams.away.players.length} players`;
    } else text = state.error;
    const link = linked() ? ' · board linked' : bridgeNote ? ' · ' + bridgeNote : '';
    D('dt').innerHTML = '';
    const b = document.createElement('b'); b.textContent = 'Pop board';
    D('dt').append(b, ' · ' + text + link);
    D('dt').title = text + link;
    D('openwin').textContent = 'Open board';
  }

  // ---------------------------------------------------------- loop

  let autoOpened = false;
  function tick(force) {
    let snap;
    try { snap = snapshotFromPage(); } catch (e) { snap = { error: 'Reader error: ' + e.message, crash: true }; }
    if (snap.error) {
      state = { ok: false, kind: snap.crash ? 'err' : 'wait', error: snap.error, raw: null };
    } else {
      state = { ok: true, kind: 'ok', error: null, raw: snap };
      if (!primed) prime();
      if (!autoOpened) { autoOpened = true; if (store.get('mode') === 'here') setOpen(true); }
      const fresh = lineLog.filter((l) => l.id > engLineId);
      engLineId = lineSeq;
      const hash = JSON.stringify([snap.sport, snap.status, snap.set, snap.intermission, snap.score, snap.setsWon, snap.teams.home.players, snap.teams.away.players]);
      if (force || hash !== lastHash || fresh.length) {
        lastHash = hash; lastChange = Date.now();
        if (ctl && ctl.setSport(snap.sport)) applyLayout();
        inTabView = eng.update(PE.swapSides(snap, swapped), fresh.map((l) => l.text).slice(snap.sport === 'bb' ? -6 : -3));
        if (overlayOpen()) { applyColors(); board.render(inTabView); }
      } else if (snap.clock !== lastClock) {
        // Only the game clock moved: refresh the game panel, leave the cards alone.
        inTabView = eng.update(PE.swapSides(snap, swapped), []);
        if (overlayOpen()) board.renderGame(inTabView);
      } else if (eng.expireHolds()) {
        inTabView = eng.view();
        if (overlayOpen()) board.render(inTabView);
      }
      lastClock = snap.clock;
      if (overlayOpen()) {
        const age = Math.round((Date.now() - lastChange) / 1000);
        shadow.getElementById('status').textContent = (diag.paused ? 'StatBroadcast paused · click its page to resume' : 'Reading this page') + ` · last change ${age}s ago`;
      }
    }
    updateDock();
    send(false);
  }

  let debounce = null;
  new MutationObserver((muts) => {
    if (primed) {
      const texts = [];
      for (const m of muts) {
        if (m.type === 'characterData') { const t = lineFrom(m.target); if (t) texts.push(t); }
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) { const t = lineFrom(n); if (t) texts.push(t); }
          else if (n.nodeType === 1 && !ours(n) && n.id !== 'spb-host' && n.id !== 'spb-dock') {
            const leaves = n.children.length ? n.querySelectorAll('*') : [n];
            for (const leaf of leaves) { if (leaf.children.length) continue; const t = lineFrom(leaf); if (t) texts.push(t); }
          }
        }
      }
      if (texts.length) recordBatch(texts);
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => tick(false), 100);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });

  // If the board opened this tab, say hello so it knows the reader is running.
  if (BOARD_ORIGIN && window.opener) {
    try { window.opener.postMessage({ spb: 1, type: 'reader-hello', inst: INSTANCE }, BOARD_ORIGIN); } catch (e) { /* opener is another site */ }
  }
  setInterval(() => tick(false), 2000);
  tick(true);
  return { show() { dockHost.style.display = ''; D('dot').parentElement.classList.remove('small'); D('min').textContent = '–'; } };
}

window.SPB = SPB;
if (!window.__spbNoReader) { var r = startReader(SPB); SPB.show = r.show; }
})();
