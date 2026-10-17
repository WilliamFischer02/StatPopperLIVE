/*
 * Builds REPLAY_DATA in the browser from the plain play-by-play text and the
 * final box score (same rules as tools/build_replay.py, checked against it).
 * Rally line: SERVING_TEAM|play text|IDAHO-MSU score. SUB lines are console-only.
 */
(function (root) {
  'use strict';
  const FIELDS = ['k', 'e', 'ta', 'a', 'setE', 'sa', 'se', 'bs', 'ba', 'be', 'dig', 're'];

  function build(src) {
    const roster = {}, who = {};
    for (const team in src.box) {
      roster[team] = src.box[team].map((r) => ({ uni: r[0], last: r[1], first: r[2] }));
      for (const r of src.box[team]) who[r[1] + ', ' + r[2]] = [team, r[0]];
    }
    const find = (name) => {
      const w = who[name.trim()];
      if (!w) throw new Error('Unknown player: ' + name);
      return w;
    };
    const other = (t) => (t === 'MSU' ? 'UI' : 'MSU');
    const rallies = [], events = [];
    let set = 0, prev = [0, 0];
    for (const raw of src.pbp.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#SET')) { set = +line.split(' ')[1]; prev = [0, 0]; continue; }
      const parts = line.split('|');
      if (parts[0] === 'SUB') { events.push({ type: 'console', set, after: rallies.length, text: parts[1] }); continue; }
      const [serveTeam, text, score] = parts;
      const [ui, msu] = score.split('-').map(Number);
      const winner = ui > prev[0] ? 'UI' : 'MSU';
      prev = [ui, msu];
      const server = text.match(/\[([^\]]+)\]/)[1];
      const [, sUni] = find(server);
      const body = text.slice(text.indexOf(']') + 1).trim();
      const acts = [];
      let m;
      if ((m = body.match(/^Kill by ([^(,.]+, [^(,.]+?)(?: \(from ([^)]+)\))?(?:, block error by ([^.]+))?\.$/))) {
        const [kt, ku] = find(m[1]);
        acts.push({ t: 'kill', team: kt, uni: ku });
        if (m[2]) { const [at, au] = find(m[2]); if (at === kt) acts.push({ t: 'assist', team: at, uni: au }); }
        if (m[3]) { const [bt, bu] = find(m[3]); acts.push({ t: 'blockError', team: bt, uni: bu }); }
      } else if ((m = body.match(/^Attack error by ([^(.]+, [^(.]+?)(?: \((from|block by) ([^)]+)\))?\.$/))) {
        const [et, eu] = find(m[1]);
        acts.push({ t: 'attackError', team: et, uni: eu });
        if (m[2] === 'block by') {
          const bl = m[3].split(';').map(find);
          for (const [bt, bu] of bl) acts.push({ t: bl.length === 1 ? 'blockSolo' : 'blockAssist', team: bt, uni: bu });
        }
      } else if ((m = body.match(/^Service ace \(([^)]+)\)\.$/))) {
        const [rt, ru] = find(m[1]);
        acts.push({ t: 'ace', team: serveTeam, uni: sUni }, { t: 'receptionError', team: rt, uni: ru });
      } else if (body === 'Service error.') {
        acts.push({ t: 'serviceError', team: serveTeam, uni: sUni });
      } else if ((m = body.match(/^Bad set by ([^.]+)\.$/))) {
        const [bt, bu] = find(m[1]);
        acts.push({ t: 'setError', team: bt, uni: bu });
      }
      rallies.push({ set, serveTeam, server: sUni, text, ui, msu, winner, acts });
    }
    const finals = {};
    for (const team in src.box) {
      finals[team] = {};
      for (const r of src.box[team]) finals[team][String(r[0])] = Object.fromEntries(FIELDS.map((f, i) => [f, r[3 + i]]));
    }
    return { match: src.match, roster, finals, rallies, events };
  }

  root.ReplayParse = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ReplayParse;
})(typeof globalThis !== 'undefined' ? globalThis : this);
