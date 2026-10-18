/* Stat Pop Board 0.3.5: reads only the page you have open and shares it with the board window on this computer. */
(function () {
'use strict';
if (window.SPB && window.SPB.version) { if (!window.__spbNoReader && window.SPB.show) window.SPB.show(); return; }
var cs = document.currentScript;
var SPB = { version: "0.3.5" };
SPB.origin = window.__spbOrigin || (cs && cs.src ? new URL(cs.src, location.href).origin : null) || "https://stat-pop-board.vercel.app";
SPB.cssHref = SPB.origin ? SPB.origin + '/assets/board.css?v=0.3.5' : null;
SPB.fontsHref = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap";
SPB.rosters = { msuVolleyball: [{"uni":"2","first":"Lauren","last":"Greeny","pos":"OH"},{"uni":"5","first":"Keely","last":"Culler","pos":"OH"},{"uni":"6","first":"Teagan","last":"Jaynes","pos":"S"},{"uni":"7","first":"Lauren","last":"Schloe","pos":"MB/OPP"},{"uni":"9","first":"Maggie","last":"Rhew","pos":"S/DS"},{"uni":"11","first":"Elli","last":"Esko","pos":"OH"},{"uni":"12","first":"Afton","last":"Thomsen","pos":"L/DS"},{"uni":"13","first":"Jolene","last":"Green Ewen","pos":"MB"},{"uni":"14","first":"Taylor","last":"McDonald","pos":"MH/OPP"},{"uni":"15","first":"Teya","last":"Yeomans","pos":"OH"},{"uni":"16","first":"Haven","last":"Rich","pos":"L/DS"},{"uni":"17","first":"Alice","last":"Steman","pos":"MB"},{"uni":"18","first":"Karli","last":"Heidemann","pos":"OH"},{"uni":"22","first":"Joelie","last":"Spelts","pos":"MB"},{"uni":"23","first":"Elli","last":"Tufto","pos":"OH"},{"uni":"45","first":"Nicolette","last":"Noble","pos":"L/DS"}] };
/*
 * PopEngine: turns a stats snapshot + new play-console lines into a small set of
 * pop-ready cards. Pure logic, no DOM. Runs in the browser and in Node (tests).
 *
 * Snapshot contract (what any page reader must produce):
 *   { sport:'vb', status:'pre'|'live'|'final', set:Number,
 *     score:{home,away}, setsWon:{home,away},
 *     teams:{ home:{code,name,players:[P], totals?:T}, away:{...} } }
 *   P = { uni, first, last, k, e, ta, a, sa, se, re, dig, bs, ba, be }
 */
(function (root) {
  'use strict';

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
      setsWon: { home: s.setsWon.away, away: s.setsWon.home },
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

  function create(opts) {
    opts = opts || {};
    const clock = opts.now || (() => Date.now());
    // minPops: options per player card, filling with greyed lines if needed. holdMs: how long Pin keeps a card.
    // dwellRallies: a card that just arrived gets a stickiness bonus for this many rallies, so cards don't flicker.
    const cfg = { pops: VB_POPS, maxCards: 3, maxPops: 3, minPops: 2, maxTeamCards: 2, passRallies: 10,
      holdMs: 10 * 60 * 1000, dwellRallies: 4 };
    // held: cards William pinned with the Pin button, key -> { since, until } in clock ms.
    const user = { hidden: new Set(), passed: {}, stars: { home: [], away: [] }, held: {} };
    let mem, last;
    const freshServe = () => ({ side: null, uni: null, streak: 0, turns: { home: [], away: [] }, lastTurnSide: null });

    function reset() {
      mem = {
        rally: 0, set: null, lastScore: null, setsWon: { home: 0, away: 0 },
        points: [], plays: [], involvement: [], pins: { home: null, away: null },
        serve: freshServe(),
        prevSel: { home: [], away: [] }, prevTeam: { home: [], away: [] }, since: {},
        consoleAlert: null, setWon: null,
        prevTotals: null, setStart: null, finishedSet: null,
      };
      user.passed = {};
      last = null;
    }
    reset();

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
        const play = parsePlay(text, snapshot, index);
        play.rally = mem.rally;
        play.score = mem.lastScore ? { home: mem.lastScore.home, away: mem.lastScore.away } : null;
        mem.plays.push(play);
        if (play.alert) mem.consoleAlert = { ...play.alert, text: text, rally: mem.rally };
        if (play.positive && play.actor) {
          const a = play.actor;
          mem.pins[a.side] = { key: playerKey(a.side, a.uni), stat: ACT_STAT[play.act], label: ACT_LABEL[play.act], rally: mem.rally };
          mem.involvement.push({ rally: mem.rally, key: playerKey(a.side, a.uni), w: play.act === 'dig' ? 0.5 : 1 });
          for (const b of play.blockers.slice(1)) mem.involvement.push({ rally: mem.rally, key: playerKey(b.side, b.uni), w: 1 });
        }
        if (play.server || play.act) pointPlay = play;
      }
      if (mem.plays.length > 60) mem.plays.splice(0, mem.plays.length - 60);
      trackServe(pointPlay, pointSide);
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

    function teamCards(s, side, e) {
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

      // Pre-match preview: no team has a stat yet, so none of the fillers above qualify. Show the two
      // everyday lines at their zero values, greyed, so both team columns have cards before first serve.
      if (s.status === 'pre' && !c.length) {
        const z = (x) => fmtPct(x.ta > 0 ? x.pct : 0, true);
        c.push({ id: 'hit', dim: true, score: 0.06, big: `Team Hit% ${z(T)}`, sub: `${oc} ${z(O)}` });
        c.push({ id: 'kills', dim: true, score: 0.05, big: pl(T.k, 'Kill'), sub: `${oc} ${O.k}` });
      }
      const prev = mem.prevTeam[side];
      for (const x of c) if (prev.includes(x.id)) x.score += 0.2;
      c.sort((a, b) => b.score - a.score);
      const pick = c.slice(0, cfg.maxTeamCards);
      mem.prevTeam[side] = pick.map((x) => x.id);
      return pick;
    }

    // ---- player cards
    function scorePlayer(p, side, e, highs, s, sv) {
      const key = playerKey(side, p.uni);
      const N = vbNorms(p, e);
      let pops = cfg.pops.map((d) => {
        let sc = d.score(p, N);
        if (sc > 0 && highs[d.uses[0]] && highs[d.uses[0]].has(key)) sc += 0.25;
        return { id: d.id, name: d.name, group: d.group, uses: d.uses, score: sc, parts: d.parts(p) };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      const seen = new Set();
      pops = pops.filter((x) => (x.group ? (seen.has(x.group) ? false : seen.add(x.group)) : true));

      const badges = [];
      if (p.k >= 8 && p.e === 0) badges.push('0 errors');
      const dd = ['k', 'dig', 'a'].filter((f) => p[f] >= 10);
      if (dd.length >= 2) badges.push('Double-double');
      for (const f of ['k', 'dig', 'a', 'tb', 'sa']) if (highs[f] && highs[f].has(key)) badges.push('Match-high ' + STAT_WORDS[f]);

      const starred = (user.stars[side] || []).some((st) => matchesStar(p, st));
      const pin = mem.pins[side];
      const pinned = !!(pin && pin.key === key && mem.rally - pin.rally <= 1);
      const hold = user.held[key] && user.held[key].until > clock() ? user.held[key] : null;
      const serving = sv.side === side && sv.uni === p.uni && sv.streak >= 3;
      const recent = mem.involvement.filter((x) => x.key === key && mem.rally - x.rally <= 12).reduce((a, x) => a + x.w, 0);
      const best = pops[0] ? pops[0].score : 0;
      const second = pops[1] ? pops[1].score : 0;
      let impact = best + 0.35 * second + 0.2 * Math.min(4, recent);
      if (mem.prevSel[side].includes(key)) impact += 0.3;
      if (serving) impact += 1.2;
      if (starred) impact += 0.35;
      if (pinned) impact += 100;
      return { key, side, p, N, pops, badges, pinned, pin: pinned ? pin : null, serving, starred, impact, hold,
        activity: activityOf(p) + 0.2 * Math.min(4, recent), eligible: pinned || serving || best >= 0.85 };
    }

    function cardFor(c, sv, teamLeads) {
      const p = c.p;
      const covered = (x, list) => list.some((y) => x.uses.every((u) => y.uses.includes(u)));
      let pops = [];
      for (const x of c.pops) {
        if (x.score < 0.8 || pops.length >= cfg.maxPops) continue;
        if (!covered(x, pops)) pops.push(x);
      }
      const force = c.pin ? c.pin.stat : (c.serving && p.sa > 0 ? 'sa' : null);
      const raw = () => cfg.pops.map((d) => ({ id: d.id, name: d.name, uses: d.uses, score: d.score(p, c.N), parts: d.parts(p) }));
      const simplest = (a, b) => b.score - a.score || a.uses.length - b.uses.length || a.parts.length - b.parts.length;
      if (force && !pops.some((x) => x.uses.includes(force))) {
        const all = raw().filter((x) => x.uses.includes(force)).sort(simplest);
        if (all[0]) pops = [all[0]].concat(pops).slice(0, cfg.maxPops);
      }
      if (pops.length < cfg.minPops) {
        // Fewer notable options than the card should offer: add the player's strongest raw lines
        // (single stats the player actually has), shown greyed until they reach pop level.
        const MINS = { k: 4, dig: 5, a: 10, tb: 2, sa: 1, pts: 8 };
        const singles = raw().filter((x) => x.uses.length === 1 && x.id !== 'atk' && MINS[x.uses[0]] && p[x.uses[0]] > 0
            && (x.id !== 'pts' || [p.k, p.sa, p.tb].filter((v) => v > 0).length >= 2))
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
      if (c.pin) tag = { kind: 'live', text: (mem.rally - c.pin.rally === 0 ? 'Just now · ' : 'Last rally · ') + c.pin.label };
      else if (c.serving) tag = { kind: 'serve', text: `On serve · ${sv.streak} straight` };
      let reason = c.badges.slice(0, 2).join(' · ');
      if (!reason) {
        const lead = ['k', 'dig', 'a', 'tb', 'sa'].find((f) => teamLeads[f] === c.key);
        if (lead) reason = 'Team leader · ' + STAT_WORDS[lead];
      }
      if (c.serving && c.pin) reason = [`On serve · ${sv.streak} straight`, reason].filter(Boolean).join(' · ');
      return { key: c.key, side: c.side, uni: p.uni, first: p.first, last: p.last, tag, reason, pops,
        starred: !!c.starred, impact: Math.round(c.impact * 100) / 100,
        held: c.hold ? { until: c.hold.until } : null,
        // Greyed: on the board only to fill the side's cards, not for a notable stat or a live reason.
        dim: !c.eligible && !c.hold };
    }

    function playerCards(s, side, e, highs) {
      const sv = mem.serve;
      const players = s.teams[side].players.map(vbDerive);
      const teamLeads = {};
      for (const f of ['k', 'dig', 'a', 'tb', 'sa']) {
        const top = players.slice().sort((a, b) => b[f] - a[f])[0];
        if (top && top[f] > 0) teamLeads[f] = playerKey(side, top.uni);
      }
      const pool = players.map((p) => scorePlayer(p, side, e, highs, s, sv))
        .filter((c) => !user.hidden.has(c.key))
        .filter((c) => c.pinned || c.hold || !(user.passed[c.key] > mem.rally));
      // Order: cards William pinned, then notable or live cards by impact, then the most active of the
      // rest (greyed) so the side always has its full set. A card that just arrived is sticky for a few rallies.
      const prevKeys = new Set(mem.prevSel[side]);
      const sticky = (c) => (prevKeys.has(c.key) && mem.rally - (mem.since[c.key] ?? -1e9) <= cfg.dwellRallies ? 1.5 : 0);
      const rank = (c) => (c.eligible ? 10 + c.impact : c.activity + (prevKeys.has(c.key) ? 0.5 : 0) + (c.starred ? 0.35 : 0)) + sticky(c);
      const held = pool.filter((c) => c.hold).sort((a, b) => a.hold.since - b.hold.since).slice(0, cfg.maxCards);
      const rest = pool.filter((c) => !c.hold && (c.eligible || c.starred || c.activity > 0)).sort((a, b) => rank(b) - rank(a));
      const chosen = held.concat(rest).slice(0, cfg.maxCards);
      // Impact players: at least one starred player always has a card on their side.
      const starredPool = rest.filter((c) => c.starred);
      if (starredPool.length && !chosen.some((c) => c.starred)) {
        if (chosen.length < cfg.maxCards) chosen.push(starredPool[0]);
        else {
          let idx = -1;
          for (let i = chosen.length - 1; i >= 0; i--) if (!chosen[i].pinned && !chosen[i].hold) { idx = i; break; }
          if (idx >= 0) chosen[idx] = starredPool[0];
        }
      }
      // Pre-match preview (status 'pre', the page's SET 0): nobody has a stat yet, so the rules above
      // leave the side empty. Fill its slots with the roster in page order, greyed, so the layout can be
      // checked before first serve. Once the set starts this never runs: cards then come only from stats.
      if (s.status === 'pre' && chosen.length < cfg.maxCards) {
        const have = new Set(chosen.map((c) => c.key));
        for (const c of pool) {
          if (chosen.length >= cfg.maxCards) break;
          if (!have.has(c.key)) { chosen.push(c); have.add(c.key); }
        }
      }
      const chosenKeys = new Set(chosen.map((c) => c.key));
      // Keep returning players in the slot they held, so cards don't jump around.
      const slots = new Array(cfg.maxCards).fill(null);
      mem.prevSel[side].forEach((k, i) => { if (chosenKeys.has(k) && i < slots.length) slots[i] = k; });
      const placed = new Set(slots.filter(Boolean));
      for (const c of chosen) if (!placed.has(c.key)) { const i = slots.indexOf(null); slots[i] = c.key; placed.add(c.key); }
      const prevSet = new Set(mem.prevSel[side]);
      mem.prevSel[side] = slots.filter(Boolean);
      for (const k of mem.prevSel[side]) if (!prevSet.has(k)) mem.since[k] = mem.rally;
      const byKey = Object.fromEntries(chosen.map((c) => [c.key, c]));
      return slots.filter(Boolean).map((k) => ({ ...cardFor(byKey[k], sv, teamLeads), isNew: !prevSet.has(k) }));
    }

    function matchHighs(s) {
      const all = [];
      for (const side of SIDES) for (const p of s.teams[side].players) all.push({ side, p: vbDerive(p) });
      const mins = { k: 5, dig: 6, a: 12, tb: 3, sa: 2 };
      const highs = {};
      for (const f in mins) {
        const max = Math.max(0, ...all.map((x) => x.p[f]));
        highs[f] = new Set(max >= mins[f] ? all.filter((x) => x.p[f] === max).map((x) => playerKey(x.side, x.p.uni)) : []);
      }
      return highs;
    }

    // ---- alerts
    function alerts(s) {
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
      const e = vbEffSets(s);
      const highs = matchHighs(s);
      const sv = mem.serve;
      const serverP = sv.uni && sv.side ? s.teams[sv.side].players.find((x) => String(x.uni) === String(sv.uni)) : null;
      const rot = rotation(s);
      const predicted = sv.side && !serverP ? rot[sv.side].predictedServer : null;
      const view = {
        teams: { home: { code: s.teams.home.code, name: s.teams.home.name }, away: { code: s.teams.away.code, name: s.teams.away.name } },
        set: num(s.set), score: { home: num(s.score.home), away: num(s.score.away) },
        setsWon: { home: num(s.setsWon.home), away: num(s.setsWon.away) }, status: s.status,
        serving: sv.side && s.status !== 'final' ? {
          side: sv.side, streak: sv.streak, predicted: !serverP && !!predicted,
          uni: serverP ? String(serverP.uni) : predicted ? predicted.uni : null,
          last: serverP ? serverP.last : predicted ? predicted.last : null } : null,
        alerts: alerts(s),
        plays: mem.plays.slice(-6).reverse().map((p) => ({ text: p.text, score: p.score, alert: !!p.alert })),
        teamCards: {}, playerCards: {}, rotation: rot,
        hidden: [...user.hidden].map((k) => {
          const [side, uni] = k.split(':');
          const p = s.teams[side].players.find((x) => String(x.uni) === uni);
          return { key: k, side, uni, last: p ? p.last : '#' + uni };
        }),
        effSets: Math.round(e * 100) / 100,
      };
      for (const side of SIDES) {
        view.teamCards[side] = teamCards(s, side, e);
        view.playerCards[side] = playerCards(s, side, e, highs);
      }
      return view;
    }

    return {
      reset,
      update(snapshot, lines) {
        const index = buildNameIndex(snapshot);
        const totals = { home: teamTotals(snapshot.teams.home), away: teamTotals(snapshot.teams.away) };
        if (!mem.setStart && num(snapshot.score.home) + num(snapshot.score.away) === 0) mem.setStart = totals;
        const pointSide = trackScore(snapshot, totals);
        mem.prevTotals = totals;
        ingest(lines || [], snapshot, index, pointSide);
        mem.setsWon = { home: num(snapshot.setsWon.home), away: num(snapshot.setsWon.away) };
        last = snapshot;
        return compute();
      },
      view() { return last ? compute() : null; },
      pass(key) { delete user.held[key]; user.passed[key] = mem.rally + cfg.passRallies; if (mem.pins.home && mem.pins.home.key === key) mem.pins.home = null; if (mem.pins.away && mem.pins.away.key === key) mem.pins.away = null; },
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

  const api = { create, parsePlay, buildNameIndex, fmtPct, vbDerive, VB_POPS, swapSides, matchesStar, normName };
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

  function mountBoard(host, handlers) {
    handlers = handlers || {};
    let tab = 'plays';
    let lastView = null;
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
      if (!b) return;
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

    function partsHTML(parts) {
      return parts.map((p) => `<span class="pv"><span class="v">${esc(p.v)}</span><span class="l">${esc(p.l)}</span></span>`).join('');
    }

    const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    function playerCard(c) {
      const live = c.tag && c.tag.kind === 'live';
      const tag = c.tag ? (live ? `<span class="livedot">${esc(c.tag.text)}</span>` : `<span class="tag-serve">${esc(c.tag.text)}</span>`) : '';
      const reason = c.reason ? `<span>${esc(c.reason)}</span>` : '';
      const star = c.starred ? '<span class="impact">★ Impact</span>' : '';
      const held = c.held ? `<span class="held">Pinned · until ${esc(clockTime(c.held.until))}</span>` : '';
      const starBtn = handlers.star
        ? `<button class="abtn star${c.starred ? ' on' : ''}" data-act="star" data-key="${esc(c.key)}" aria-pressed="${c.starred}" title="${c.starred ? 'Remove from impact players' : 'Make an impact player'}" aria-label="Impact player">★</button>` : '';
      const pinBtn = handlers.hold
        ? `<button class="abtn pin${c.held ? ' on' : ''}" data-act="hold" data-key="${esc(c.key)}" aria-pressed="${!!c.held}" title="${c.held ? 'Let this card go' : 'Keep this card on the board for 10 minutes'}">${c.held ? 'Unpin' : 'Pin'}</button>` : '';
      const pops = c.pops.length
        ? c.pops.map((p) => `<li class="pop${p.best ? ' best' : ''}${p.live ? ' live' : ''}${p.dim ? ' dim' : ''}"><span class="pname">${esc(p.name)}</span><span class="pvals">${partsHTML(p.parts)}</span></li>`).join('')
        : '<li class="pop none">No stats yet</li>';
      return `<article class="pcard${live ? ' is-live' : ''}${c.isNew ? ' is-new' : ''}${c.starred ? ' is-star' : ''}${c.held ? ' is-held' : ''}${c.dim ? ' is-dim' : ''}" data-key="${esc(c.key)}">
        <div class="phead">
          <div class="jersey" aria-label="Number ${esc(c.uni)}">${esc(c.uni)}</div>
          <div class="who"><div class="last">${esc(c.last)}</div><div class="meta"><span>${esc(c.first)}</span>${held}${star}${tag}${reason}</div></div>
          <div class="acts">${pinBtn}${starBtn}
            <button class="abtn" data-act="pass" data-key="${esc(c.key)}" title="Skip this player for the next 10 rallies">Pass</button>
            <button class="abtn" data-act="hide" data-key="${esc(c.key)}" title="Hide this player for the rest of the match">Hide</button>
          </div>
        </div>
        <ol class="pops">${pops}</ol>
      </article>`;
    }

    function drawPlayers(v, side) {
      const t = v.teams[side];
      const cards = v.playerCards[side];
      const empty = cards.length < 3
        ? `<div class="empty">${cards.length ? 'No other' : 'No'} ${esc(t.code)} player has a stat yet.</div>` : '';
      regions[side].innerHTML = `<div class="eyebrow">${swatch(side, t.code)}${esc(t.name || t.code)} players</div>
        <div class="pstack">${cards.map(playerCard).join('')}${empty}</div>`;
    }

    function drawTeam(v) {
      const col = (side) => {
        const t = v.teams[side];
        const cards = v.teamCards[side];
        const body = cards.length
          ? cards.map((c) => `<div class="tcard${c.live ? ' is-live' : ''}${c.dim ? ' is-dim' : ''}"><div class="big">${esc(c.big)}</div><div class="sub">${c.live ? '<span class="livedot">Live</span> ' : ''}${esc(c.sub || '')}</div></div>`).join('')
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

    function drawGame(v) {
      lastView = v;
      const sv = v.serving;
      const serveLine = sv ? `<span class="ball" style="background:var(--${sv.side})"></span>${esc(v.teams[sv.side].code)} serving${sv.last ? ` · <b>#${esc(sv.uni)} ${esc(sv.last)}</b>${sv.predicted ? ' (next up)' : ''}` : ''}${sv.streak >= 2 ? ` · ${sv.streak} straight` : ''}` : '';
      const alerts = v.alerts.map((a) => `<div class="alert ${a.sev}" role="status"><strong>${esc(a.text)}</strong>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}</div>`).join('');
      const plays = v.plays;
      const lastPlay = plays.find((p) => !p.alert) || plays[0];
      const sc = (p) => (p.score ? `${p.score.home}–${p.score.away}` : '');
      const playsPanel = `<p class="lastplay">${lastPlay ? esc(lastPlay.text) : 'Waiting for the first play.'}</p>
        <ul class="recent">${plays.filter((p) => p !== lastPlay).slice(0, 3).map((p) => `<li class="${p.alert ? 'is-alert' : ''}"><span class="sc">${sc(p)}</span><span>${esc(p.text)}</span></li>`).join('')}</ul>`;
      const rotPanel = `<div class="courts">${court(v, 'home')}${court(v, 'away')}</div>
        <p class="note">Built from the serve order. A serving sub shows in her slot; liberos aren't tracked.</p>`;
      const status = v.status === 'final' ? 'Final' : v.status === 'pre' ? 'Pregame' : `Set ${v.set}`;
      regions.game.innerHTML = `<div class="eyebrow">Game</div>
        <div class="scoreline">
          <div class="sl-team home"><span class="sl-code">${esc(v.teams.home.code)}</span><span class="sl-sets" title="Sets won">${v.setsWon.home}</span></div>
          <div class="sl-pts">${v.score.home}–${v.score.away}<small>${status}</small></div>
          <div class="sl-team away"><span class="sl-sets" title="Sets won">${v.setsWon.away}</span><span class="sl-code">${esc(v.teams.away.code)}</span></div>
        </div>
        <div class="serve">${serveLine}</div>
        ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-act="tab" data-tab="plays" aria-selected="${tab === 'plays'}">Last play</button>
          <button class="tab" role="tab" data-act="tab" data-tab="rot" aria-selected="${tab === 'rot'}">Rotation</button>
        </div>
        ${tab === 'plays' ? playsPanel : rotPanel}`;
    }

    function drawFoot(v) {
      const chips = v.hidden.map((h) => `<span class="chip">#${esc(h.uni)} ${esc(h.last)}<button data-act="unhide" data-key="${esc(h.key)}">Show</button></span>`).join('');
      regions.foot.innerHTML = (chips ? `<span>Hidden:</span>${chips}` : '') + (handlers.footNote ? `<span>${handlers.footNote}</span>` : '');
    }

    return {
      render(v) {
        if (!v) return;
        drawGame(v); drawTeam(v); drawPlayers(v, 'home'); drawPlayers(v, 'away'); drawFoot(v);
      },
      setColors,
    };
  }

  root.BoardView = { mountBoard, esc };
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
        return `<button class="pk-chip${on ? ' on' : ''}${p.notListed ? ' faint' : ''}" data-act="pk-toggle" data-col="${ci}" data-i="${i}" aria-pressed="${on}" title="${p.notListed ? 'On the MSU roster but not listed on this stats page' : ''}">
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
          <div class="pk-head"><div><b>Impact players</b><p class="note">Star the players you build graphics for most. Each team with a star always keeps at least one starred player on the board. MSU picks carry over to every match.</p></div>
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
 *   - score, set and team codes from the tab title ("UI 18, MSU 24 - SET 3")
 *   - player and team rows from tables whose headers look like a volleyball box
 *   - new play-by-play / console sentences that name a rostered player
 */
function startReader(SPB) {
  const PE = SPB.PopEngine, BV = SPB.BoardView, IP = SPB.ImpactPicker;
  const VERSION = SPB.version;
  const INSTANCE = Math.random().toString(36).slice(2, 10);
  const BOARD_ORIGIN = SPB.origin;
  const eventId = new URLSearchParams(location.search).get('id') || (/practice/.test(location.pathname) ? 'practice' : 'page');
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
  function headerMap(table) {
    let best = null;
    for (const tr of [...table.rows].slice(0, 4)) {
      const map = {}; let hits = 0;
      expandRow(tr).forEach((c, i) => {
        const key = HMAP[cellText(c).toUpperCase()];
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
  const looksBasketball = (table) => /\bREB\b|\bFG\b|\b3PT\b|\bFGM\b/.test(cellText(table.rows[0] || table).toUpperCase());
  // Summary rows that sit in or beside a box score: team, totals, and team-by-set rows ("Set 1", "Match").
  // Seen as player cards on the live page on 2026-10-17, so they are rejected by label as well as by table.
  const NON_PLAYER = /^(sets?|game|match|totals?|team|tm|opp(onent)?s?)\b|^\d+(st|nd|rd|th)?(\s+sets?)?$/i;

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
  function readTables(title, names) {
    const found = [];
    ignoredTables.length = 0;
    for (const table of document.querySelectorAll('table')) {
      if (ours(table)) continue;
      const hm = headerMap(table);
      if (!hm || !looksVolleyball(hm.map)) continue;
      const bits = contextBits(table);
      if (/season|career|cumulative/i.test(bits.slice(0, 2).join(' '))) continue;
      // A player box has a jersey or a name column. Team-by-set and comparison tables have volleyball
      // columns but neither, and their rows ("Set 1", "Match") would otherwise read as players.
      if (hm.map.uni == null && hm.map.name == null) {
        if (ignoredTables.length < 4) ignoredTables.push({ headers: Object.keys(hm.map).join(' '), rows: table.rows.length, context: bits.join(' | ').slice(0, 100) });
        continue;
      }
      const players = [], skipped = [];
      let totals = null;
      const rows = [...table.rows];
      for (const tr of rows.slice(rows.indexOf(hm.tr) + 1)) {
        const cells = expandRow(tr);
        const val = (k) => (hm.map[k] == null || !cells[hm.map[k]] ? 0 : parseFloat(cellText(cells[hm.map[k]]).replace(/[^\d.-]/g, '')) || 0);
        const lead = cells.slice(0, 3).map(cellText).join(' ');
        const stats = {};
        for (const k of ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be']) stats[k] = val(k);
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

  const ACTION = /\b(kill|ace|block|dig|attack error|service error|serve|assist|point|wins|timeout|time-out|challenge|review|substitution|subs?:|card|penalty)\b/i;
  const ALERT = /\b(time[- ]?out|challenge|video review|red card|yellow card|penalty|sanction)\b/i;
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

  function snapshotFromPage() {
    const title = parseTitle(document.title);
    const names = teamNames();
    const tables = readTables(title, names);
    tables.forEach((t) => statTables.add(t.table));
    diag.title = document.title;
    diag.parsedTitle = title;
    diag.paused = titlePaused(document.title);
    diag.names = names;
    diag.tables = tables.map((t) => ({ side: t.side, players: t.players.length, totals: !!t.totals, headers: t.headers.join(' '), skipped: t.skipped, context: t.ctx }));
    diag.ignoredTables = ignoredTables.slice();
    if (!title) return { error: 'Waiting for the score in the tab title (accept the terms on the stats page if you haven’t).' };
    if (!tables.some((t) => t.side === 'vis') || !tables.some((t) => t.side === 'home')) {
      const bb = [...document.querySelectorAll('table')].some(looksBasketball);
      return { error: bb ? 'This looks like a basketball page. Basketball support comes next.'
        : 'Waiting for both teams’ box-score tables. Switch the stats page to its box score view.' };
    }
    if (lastTitle && title.set && lastTitle.set && title.set > lastTitle.set) {
      trackedSets[lastTitle.home.score > lastTitle.vis.score ? 'home' : 'vis'] += 1;
    }
    lastTitle = title;
    const sw = readSetsWon(title) || trackedSets;
    const merge = (side) => {
      const map = new Map(); let totals = null;
      for (const t of tables.filter((x) => x.side === side)) {
        for (const p of t.players) map.set(p.uni, { ...(map.get(p.uni) || {}), ...p });
        if (t.totals) totals = t.totals;
      }
      return { code: title[side].code, name: (side === 'home' ? names.home : names.vis) || title[side].code, players: [...map.values()], totals };
    };
    rosterWords = tables.flatMap((t) => t.players.map((p) => p.last.toLowerCase())).filter((w) => w.length > 2);
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
        <div class="brand"><b>Stat Pop Board</b><span class="mode live">Live</span></div>
        <span class="matchline" id="status">Reading this page…</span>
        <div class="transport">
          <button class="tbtn" id="swap">Swap sides</button>
          <button class="tbtn" id="close">Back to stats page</button>
        </div>
      </header>
      <div id="board"></div></div></div>`;
    applyStyles(shadow, '[hidden]{display:none!important}.spb-root{height:100%;overflow:auto;background:var(--ground,#0f1317);color:var(--ink,#edf1f4);font-family:var(--font-body,system-ui,sans-serif);font-size:15px;line-height:1.35}');
    const $ = (id) => shadow.getElementById(id);
    $('close').addEventListener('click', () => setOpen(false));
    $('swap').addEventListener('click', () => { swapped = !swapped; store.set('swap', swapped); resetEngine(); tick(true); });
    board = BV.mountBoard($('board'), {
      pass: (k) => { eng.pass(k); board.render(eng.view()); },
      hold: (k) => { eng.toggleHold(k); board.render(eng.view()); },
      hide: (k) => { eng.hide(k); saveHidden(); board.render(eng.view()); },
      unhide: (k) => { eng.unhide(k); saveHidden(); board.render(eng.view()); },
      color: (side, hex) => { const t = teamAt(side); if (!t) return; store.set(colorKey(t), hex); applyColors(); send(true); },
    });
    applyColors();
  }
  function setOpen(open) {
    if (open) buildOverlay();
    if (host) host.style.display = open ? '' : 'none';
    store.set('mode', open ? 'here' : null);
    D('here').textContent = open ? 'Hide board' : 'Show here';
    if (open && inTabView) board.render(inTabView);
  }
  function resetEngine() {
    eng = PE.create(); eng.setHidden(store.get('hidden:' + eventId, [])); lastHash = ''; engLineId = lineSeq;
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
      names: diag.names, tables: diag.tables, ignoredTables: diag.ignoredTables, error: state.error, linesCaptured: lineSeq, paused: !!diag.paused };
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
      text = diag.paused ? 'StatBroadcast paused its updates · click into the page to resume'
        : `reading ${s.teams.home.players.length} + ${s.teams.away.players.length} players`;
    } else text = state.error;
    const link = linked() ? ' · board linked' : bridgeNote ? ' · ' + bridgeNote : '';
    D('dt').innerHTML = '';
    const b = document.createElement('b'); b.textContent = 'Pop board';
    D('dt').append(b, ' · ' + text + link);
    D('dt').title = text + link;
    D('openwin').textContent = linked() ? 'Board linked' : 'Open board';
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
      const hash = JSON.stringify([snap.set, snap.score, snap.setsWon, snap.teams.home.players, snap.teams.away.players]);
      if (force || hash !== lastHash || fresh.length) {
        lastHash = hash; lastChange = Date.now();
        inTabView = eng.update(PE.swapSides(snap, swapped), fresh.map((l) => l.text).slice(-3));
        if (overlayOpen()) { applyColors(); board.render(inTabView); }
      } else if (eng.expireHolds()) {
        inTabView = eng.view();
        if (overlayOpen()) board.render(inTabView);
      }
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
    debounce = setTimeout(() => tick(false), 250);
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
