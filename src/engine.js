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

  function create(opts) {
    opts = opts || {};
    const cfg = { pops: VB_POPS, maxCards: 3, maxPops: 3, maxTeamCards: 2, passRallies: 10 };
    const user = { hidden: new Set(), passed: {}, stars: { home: [], away: [] } };
    let mem, last;
    const freshServe = () => ({ side: null, uni: null, streak: 0, turns: { home: [], away: [] }, lastTurnSide: null });

    function reset() {
      mem = {
        rally: 0, set: null, lastScore: null, setsWon: { home: 0, away: 0 },
        points: [], plays: [], involvement: [], pins: { home: null, away: null },
        serve: freshServe(),
        prevSel: { home: [], away: [] }, prevTeam: { home: [], away: [] },
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
      if (mem.setStart && !(fs && fs.set === num(s.set))) {
        const S = diffTotals(T, mem.setStart[side]), So = diffTotals(O, mem.setStart[other(side)]);
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
      const serving = sv.side === side && sv.uni === p.uni && sv.streak >= 3;
      const recent = mem.involvement.filter((x) => x.key === key && mem.rally - x.rally <= 12).reduce((a, x) => a + x.w, 0);
      const best = pops[0] ? pops[0].score : 0;
      const second = pops[1] ? pops[1].score : 0;
      let impact = best + 0.35 * second + 0.2 * Math.min(4, recent);
      if (mem.prevSel[side].includes(key)) impact += 0.3;
      if (serving) impact += 1.2;
      if (starred) impact += 0.35;
      if (pinned) impact += 100;
      return { key, side, p, N, pops, badges, pinned, pin: pinned ? pin : null, serving, starred, impact,
        eligible: pinned || serving || best >= 0.85 };
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
      if (!pops.length) {
        // On the board for a live reason but nothing is notable yet: show the strongest raw line.
        const MINS = { k: 4, dig: 5, a: 10, tb: 2, sa: 1 };
        const singles = raw().filter((x) => x.uses.length === 1 && MINS[x.uses[0]] && p[x.uses[0]] > 0)
          .sort((a, b) => p[b.uses[0]] / MINS[b.uses[0]] - p[a.uses[0]] / MINS[a.uses[0]]);
        if (singles[0]) pops = [singles[0]];
      }
      pops = pops.map((x, i) => ({ id: x.id, name: x.name, parts: x.parts, score: x.score, best: i === 0,
        live: !!force && x.uses.includes(force) }));
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
        starred: !!c.starred, impact: Math.round(c.impact * 100) / 100 };
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
        .filter((c) => c.pinned || !(user.passed[c.key] > mem.rally))
        .sort((a, b) => b.impact - a.impact);
      const chosen = pool.filter((c) => c.eligible).slice(0, cfg.maxCards);
      // Impact players: at least one starred player always has a card on their side.
      const starredPool = pool.filter((c) => c.starred);
      if (starredPool.length && !chosen.some((c) => c.starred)) {
        if (chosen.length < cfg.maxCards) chosen.push(starredPool[0]);
        else {
          let idx = -1;
          for (let i = chosen.length - 1; i >= 0; i--) if (!chosen[i].pinned) { idx = i; break; }
          if (idx >= 0) chosen[idx] = starredPool[0];
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
      pass(key) { user.passed[key] = mem.rally + cfg.passRallies; if (mem.pins.home && mem.pins.home.key === key) mem.pins.home = null; if (mem.pins.away && mem.pins.away.key === key) mem.pins.away = null; },
      hide(key) { user.hidden.add(key); },
      unhide(key) { user.hidden.delete(key); },
      get hiddenKeys() { return [...user.hidden]; },
      setHidden(keys) { user.hidden = new Set(keys || []); },
      setStars(stars) { user.stars = { home: (stars && stars.home) || [], away: (stars && stars.away) || [] }; },
    };
  }

  const api = { create, parsePlay, buildNameIndex, fmtPct, vbDerive, VB_POPS, swapSides, matchesStar, normName };
  root.PopEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
