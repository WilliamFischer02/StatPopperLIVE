/*
 * Replay adapter: rebuilds what the stats page would show after any rally of a
 * finished match. Kills, errors, aces, blocks, assists and reception errors are
 * exact from the play-by-play; total attempts and digs are spread evenly across
 * the match because play-by-play text doesn't record them.
 */
(function (root) {
  'use strict';

  const CREDIT = { kill: 'k', assist: 'a', attackError: 'e', ace: 'sa', receptionError: 're',
    serviceError: 'se', blockSolo: 'bs', blockAssist: 'ba', blockError: 'be' };

  function createReplay(data) {
    const side = { [data.match.home.code]: 'home', [data.match.away.code]: 'away' };
    const R = data.rallies;
    const total = R.length;
    const lastOfSet = {}, firstOfSet = {};
    R.forEach((r, i) => { lastOfSet[r.set] = i; if (!(r.set in firstOfSet)) firstOfSet[r.set] = i; });

    // Attack attempts that didn't end the rally (dug or kept in play) aren't in
    // play-by-play. Spread each set's share (box score set TA minus kills and
    // errors) across that set's rallies, split between players by their final share.
    const codes = [data.match.home.code, data.match.away.code];
    const extraBySet = {}, share = {};
    for (const code of codes) {
      extraBySet[code] = {};
      for (const set in lastOfSet) {
        let term = 0;
        for (let i = firstOfSet[set]; i <= lastOfSet[set]; i++) {
          for (const a of R[i].acts) if (a.team === code && (a.t === 'kill' || a.t === 'attackError')) term++;
        }
        const setTA = data.match.setTA ? data.match.setTA[code][set - 1] : null;
        extraBySet[code][set] = setTA == null ? null : Math.max(0, setTA - term);
      }
      const fin = data.finals[code];
      const extras = Object.fromEntries(Object.keys(fin).map((u) => [u, Math.max(0, fin[u].ta - fin[u].k - fin[u].e)]));
      const sum = Object.values(extras).reduce((a, b) => a + b, 0) || 1;
      share[code] = Object.fromEntries(Object.keys(extras).map((u) => [u, extras[u] / sum]));
    }
    function extraSoFar(code, n) {
      let x = 0;
      for (const set in lastOfSet) {
        const ex = extraBySet[code][set];
        if (ex == null) return null;
        const a = firstOfSet[set], b = lastOfSet[set];
        if (n > b) x += ex;
        else if (n > a) x += ex * (n - a) / (b - a + 1);
      }
      return x;
    }

    function snapshot(n) {
      const counts = {};
      for (let i = 0; i < n; i++) {
        for (const a of R[i].acts) {
          const f = CREDIT[a.t];
          if (!f) continue;
          const key = a.team + ':' + a.uni;
          counts[key] = counts[key] || {};
          counts[key][f] = (counts[key][f] || 0) + 1;
        }
      }
      const frac = n / total;
      const teams = {};
      for (const code of [data.match.home.code, data.match.away.code]) {
        teams[side[code]] = {
          code, name: code === data.match.home.code ? data.match.home.name : data.match.away.name,
          players: data.roster[code].map((p) => {
            const c = counts[code + ':' + p.uni] || {};
            const fin = data.finals[code][String(p.uni)];
            const k = c.k || 0, e = c.e || 0;
            const ex = extraSoFar(code, n);
            const extra = ex == null ? Math.max(0, fin.ta - fin.k - fin.e) * frac : ex * share[code][String(p.uni)];
            return { uni: p.uni, first: p.first, last: p.last, k, e,
              ta: k + e + Math.round(extra), a: c.a || 0, sa: c.sa || 0, se: c.se || 0,
              re: c.re || 0, dig: Math.round(fin.dig * frac), bs: c.bs || 0, ba: c.ba || 0, be: c.be || 0 };
          }),
        };
        // Team row, like the stats page's Totals line: exact set-level attempts.
        const t = teams[side[code]], tot = {};
        for (const f of ['k', 'e', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be']) tot[f] = t.players.reduce((a, q) => a + q[f], 0);
        const ex = extraSoFar(code, n);
        tot.ta = tot.k + tot.e + Math.round(ex == null ? t.players.reduce((a, q) => a + q.ta - q.k - q.e, 0) : ex);
        t.totals = tot;
      }
      const setsWon = { home: 0, away: 0 };
      for (const s in lastOfSet) {
        const i = lastOfSet[s];
        if (i < n) setsWon[R[i].msu > R[i].ui === (side.MSU === 'home') ? 'home' : 'away'] += 1;
      }
      let set = 1, score = { home: 0, away: 0 };
      if (n > 0) {
        const r = R[n - 1];
        set = r.set;
        const sc = { MSU: r.msu, UI: r.ui };
        score = { home: sc[data.match.home.code], away: sc[data.match.away.code] };
      }
      return { sport: 'vb', status: n === 0 ? 'pre' : n === total ? 'final' : 'live', set, score, setsWon, teams };
    }

    function linesAt(n) {
      const out = [];
      if (n > 0) out.push(R[n - 1].text);
      for (const ev of data.events) if (ev.after === n) out.push(ev.text);
      return out;
    }

    function label(n) {
      if (n === 0) return 'Before first serve';
      const r = R[n - 1];
      const sc = { MSU: r.msu, UI: r.ui };
      return `Set ${r.set} · ${data.match.home.code} ${sc[data.match.home.code]}–${sc[data.match.away.code]} ${data.match.away.code}`;
    }

    function findScore(set, home, away) {
      for (let i = 0; i < total; i++) {
        const r = R[i], sc = { MSU: r.msu, UI: r.ui };
        if (r.set === set && sc[data.match.home.code] === home && sc[data.match.away.code] === away) return i + 1;
      }
      return 0;
    }

    const setStarts = Object.keys(lastOfSet).map((s) => R.findIndex((r) => r.set === +s));

    return { total, snapshot, linesAt, label, findScore, setStarts, match: data.match };
  }

  root.ReplayAdapter = { createReplay };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ReplayAdapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
