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

window.REPLAY_DATA=ReplayParse.build({
match:{"date":"2026-10-01","venue":"Shroyer Gym, Bozeman, MT","sport":"vb","home":{"code":"MSU","name":"Montana St."},"away":{"code":"UI","name":"Idaho"},"source":"https://msubobcats.com/boxscore.aspx?id=7757","setTA":{"MSU":[32,30,36],"UI":[38,27,34]}},
box:{
"MSU":[
[18,"Heidemann","Karli",11,3,27,1,0,0,0,0,0,0,7,0],
[22,"Spelts","Joelie",11,0,13,0,0,0,1,0,1,0,2,0],
[12,"Thomsen","Afton",0,0,0,1,0,3,0,0,0,0,1,1],
[45,"Noble","Nicolette",0,0,0,1,1,0,1,0,0,0,9,1],
[7,"Schloe","Lauren",1,0,3,0,0,0,0,1,2,0,0,0],
[6,"Jaynes","Teagan",5,0,10,30,0,3,0,0,2,0,7,0],
[2,"Greeny","Lauren",3,3,17,2,0,0,4,0,1,0,5,0],
[5,"Culler","Keely",0,0,0,0,0,1,3,0,0,0,1,0],
[23,"Tufto","Elli",2,5,13,0,0,0,0,1,0,0,2,0],
[11,"Esko","Elli",5,2,11,0,0,0,0,0,0,0,1,0],
[16,"Rich","Haven",0,0,0,0,0,0,0,0,0,0,0,0],
[17,"Steman","Alice",0,0,0,0,0,0,0,0,0,0,0,0],
[13,"Green Ewen","Jolene",1,1,3,0,0,0,0,0,0,0,0,0],
[14,"McDonald","Taylor",0,0,1,0,0,0,0,0,0,0,1,0]],
"UI":[
[16,"Prisby","Anika",3,0,8,0,0,0,0,0,0,1,2,0],
[2,"Armstrong","Alaina",5,6,22,0,0,0,2,0,0,0,5,2],
[11,"Makaula","Koen",5,0,9,0,0,0,0,0,1,0,1,0],
[1,"Wakatake","Kailee",0,0,0,0,0,0,2,0,0,0,1,0],
[7,"Kleidon","Keira",0,0,0,5,0,0,0,0,0,0,11,2],
[9,"Greer","Kiana",16,6,32,0,0,0,2,0,0,0,10,2],
[21,"Krakoczki","Csenge",0,2,2,30,0,1,3,0,0,0,5,0],
[5,"Sullivan","Sarah",0,0,4,0,0,1,0,0,0,0,7,1],
[8,"Danielson","Sophie",2,2,5,0,0,0,0,0,0,0,0,0],
[12,"Trefren","Kyriah",0,0,0,1,0,0,0,0,0,0,1,0],
[3,"Ryan","Lucy",3,2,11,0,0,0,2,0,1,0,0,0],
[6,"Smith","Gabrielle",0,0,0,0,0,0,0,0,0,0,0,0],
[13,"Ferrin","Allie",2,0,6,0,0,0,0,0,0,0,1,0]]},
pbp:`#SET 1
UI|[Greer, Kiana] Kill by Spelts, Joelie (from Jaynes, Teagan).|0-1
MSU|[Spelts, Joelie] Kill by Armstrong, Alaina (from Krakoczki, Csenge).|1-1
UI|[Makaula, Koen] Attack error by Heidemann, Karli (from Jaynes, Teagan).|2-1
UI|[Makaula, Koen] Kill by Heidemann, Karli (from Jaynes, Teagan), block error by Prisby, Anika.|2-2
MSU|[Jaynes, Teagan] Attack error by Ryan, Lucy (from Krakoczki, Csenge).|2-3
MSU|[Jaynes, Teagan] Service ace (Greer, Kiana).|2-4
MSU|[Jaynes, Teagan] Kill by Ryan, Lucy (from Kleidon, Keira).|3-4
UI|[Ryan, Lucy] Service error.|3-5
SUB|MSU subs: Tufto, Elli.
MSU|[Heidemann, Karli] Bad set by Noble, Nicolette.|4-5
UI|[Armstrong, Alaina] Service error.|4-6
MSU|[Noble, Nicolette] Attack error by Greer, Kiana (from Krakoczki, Csenge).|4-7
MSU|[Noble, Nicolette] Kill by Spelts, Joelie.|4-8
SUB|UI subs: Sullivan, Sarah.
MSU|[Noble, Nicolette] Attack error by Tufto, Elli (from Jaynes, Teagan).|5-8
UI|[Kleidon, Keira] Kill by Spelts, Joelie (from Jaynes, Teagan).|5-9
MSU|[Greeny, Lauren] Kill by Greer, Kiana (from Krakoczki, Csenge).|6-9
UI|[Krakoczki, Csenge] Kill by Ryan, Lucy (from Kleidon, Keira).|7-9
UI|[Krakoczki, Csenge] Kill by Greer, Kiana (from Kleidon, Keira).|8-9
UI|[Krakoczki, Csenge] Attack error by Tufto, Elli (from Noble, Nicolette).|9-9
UI|[Krakoczki, Csenge] Service error.|9-10
MSU|[Thomsen, Afton] Kill by Greer, Kiana (from Krakoczki, Csenge).|10-10
UI|[Greer, Kiana] Kill by Armstrong, Alaina (from Krakoczki, Csenge).|11-10
UI|[Greer, Kiana] Service error.|11-11
MSU|[Spelts, Joelie] Attack error by Greeny, Lauren (from Jaynes, Teagan).|12-11
UI|[Makaula, Koen] Kill by Heidemann, Karli (from Jaynes, Teagan).|12-12
MSU|[Jaynes, Teagan] Kill by Armstrong, Alaina (from Krakoczki, Csenge).|13-12
UI|[Ryan, Lucy] Service error.|13-13
MSU|[Heidemann, Karli] Kill by Greeny, Lauren (from Jaynes, Teagan).|13-14
MSU|[Heidemann, Karli] Attack error by Armstrong, Alaina (from Kleidon, Keira).|13-15
MSU|[Heidemann, Karli] Attack error by Armstrong, Alaina (from Krakoczki, Csenge).|13-16
MSU|[Heidemann, Karli] Kill by Prisby, Anika (from Krakoczki, Csenge).|14-16
SUB|UI subs: Wakatake, Kailee.
UI|[Wakatake, Kailee] Attack error by Tufto, Elli (from Jaynes, Teagan).|15-16
UI|[Wakatake, Kailee] Kill by Greer, Kiana (from Krakoczki, Csenge).|16-16
UI|[Wakatake, Kailee] Kill by Tufto, Elli (from Jaynes, Teagan).|16-17
MSU|[Noble, Nicolette] Kill by Greer, Kiana (from Krakoczki, Csenge).|17-17
UI|[Kleidon, Keira] Kill by Spelts, Joelie (from Jaynes, Teagan).|17-18
MSU|[Greeny, Lauren] Kill by Spelts, Joelie (from Jaynes, Teagan).|17-19
MSU|[Greeny, Lauren] Attack error by Krakoczki, Csenge (block by Tufto, Elli).|17-20
MSU|[Greeny, Lauren] Service error.|18-20
UI|[Krakoczki, Csenge] Kill by Spelts, Joelie (from Jaynes, Teagan).|18-21
MSU|[Thomsen, Afton] Attack error by Greer, Kiana (from Makaula, Koen).|18-22
MSU|[Thomsen, Afton] Kill by Greer, Kiana (from Krakoczki, Csenge).|19-22
UI|[Greer, Kiana] Service error.|19-23
SUB|MSU subs: Culler, Keely.
MSU|[Culler, Keely] Service error.|20-23
UI|[Makaula, Koen] Kill by Jaynes, Teagan (from Noble, Nicolette).|20-24
MSU|[Jaynes, Teagan] Kill by Heidemann, Karli (from Jaynes, Teagan).|20-25
#SET 2
MSU|[Thomsen, Afton] Kill by Spelts, Joelie (from Jaynes, Teagan).|0-1
MSU|[Thomsen, Afton] Kill by Greer, Kiana (from Krakoczki, Csenge).|1-1
UI|[Makaula, Koen] Kill by Heidemann, Karli (from Jaynes, Teagan).|1-2
MSU|[Spelts, Joelie] Kill by Prisby, Anika (from Krakoczki, Csenge).|2-2
SUB|UI subs: Sullivan, Sarah.
UI|[Sullivan, Sarah] Service ace (Thomsen, Afton).|3-2
UI|[Sullivan, Sarah] Kill by Jaynes, Teagan (from Thomsen, Afton).|3-3
MSU|[Jaynes, Teagan] Attack error by Armstrong, Alaina (from Kleidon, Keira).|3-4
MSU|[Jaynes, Teagan] Kill by Armstrong, Alaina (from Krakoczki, Csenge).|4-4
SUB|UI subs: Wakatake, Kailee.
UI|[Wakatake, Kailee] Kill by Heidemann, Karli (from Krakoczki, Csenge).|4-5
SUB|MSU subs: Tufto, Elli.
MSU|[Heidemann, Karli] Kill by Greer, Kiana (from Kleidon, Keira).|5-5
UI|[Kleidon, Keira] Attack error by Greer, Kiana (from Armstrong, Alaina).|5-6
MSU|[Noble, Nicolette] Kill by Greer, Kiana (from Krakoczki, Csenge).|6-6
UI|[Krakoczki, Csenge] Attack error by Tufto, Elli (block by Makaula, Koen; Ryan, Lucy).|7-6
UI|[Krakoczki, Csenge] Service error.|7-7
MSU|[Greeny, Lauren] Kill by Ryan, Lucy (from Krakoczki, Csenge).|8-7
UI|[Greer, Kiana] Kill by Jaynes, Teagan (from Heidemann, Karli).|8-8
MSU|[Thomsen, Afton] Kill by Makaula, Koen (from Krakoczki, Csenge).|9-8
UI|[Makaula, Koen] Attack error by Armstrong, Alaina (from Krakoczki, Csenge).|9-9
MSU|[Spelts, Joelie] Attack error by Ryan, Lucy (from Krakoczki, Csenge).|9-10
MSU|[Spelts, Joelie] Service error.|10-10
UI|[Sullivan, Sarah] Attack error by Heidemann, Karli (from Jaynes, Teagan).|11-10
UI|[Sullivan, Sarah] Kill by Heidemann, Karli (from Jaynes, Teagan).|11-11
MSU|[Jaynes, Teagan] Attack error by Armstrong, Alaina (block by Schloe, Lauren).|11-12
MSU|[Jaynes, Teagan] Kill by Armstrong, Alaina (from Krakoczki, Csenge).|12-12
UI|[Wakatake, Kailee] Service error.|12-13
MSU|[Heidemann, Karli] Kill by Schloe, Lauren (from Jaynes, Teagan).|12-14
MSU|[Heidemann, Karli] Kill by Tufto, Elli.|12-15
MSU|[Heidemann, Karli] Kill by Greer, Kiana (from Krakoczki, Csenge).|13-15
UI|[Kleidon, Keira] Kill by Greeny, Lauren (from Jaynes, Teagan).|13-16
MSU|[Noble, Nicolette] Kill by Makaula, Koen (from Krakoczki, Csenge).|14-16
UI|[Krakoczki, Csenge] Attack error by Greeny, Lauren (from Jaynes, Teagan).|15-16
UI|[Krakoczki, Csenge] Service ace (Noble, Nicolette).|16-16
UI|[Krakoczki, Csenge] Attack error by Tufto, Elli (from Jaynes, Teagan).|17-16
SUB|MSU subs: Esko, Elli.
UI|[Krakoczki, Csenge] Kill by Spelts, Joelie (from Jaynes, Teagan).|17-17
MSU|[Greeny, Lauren] Service error.|18-17
UI|[Greer, Kiana] Kill by Esko, Elli (from Jaynes, Teagan).|18-18
MSU|[Thomsen, Afton] Service ace (Greer, Kiana).|18-19
MSU|[Thomsen, Afton] Service ace (Kleidon, Keira).|18-20
SUB|UI subs: Trefren, Kyriah.
MSU|[Thomsen, Afton] Kill by Makaula, Koen (from Krakoczki, Csenge).|19-20
UI|[Makaula, Koen] Kill by Heidemann, Karli (from Jaynes, Teagan).|19-21
SUB|MSU subs: McDonald, Taylor.
MSU|[Spelts, Joelie] Kill by Heidemann, Karli (from Greeny, Lauren).|19-22
SUB|UI subs: Danielson, Sophie.
MSU|[Spelts, Joelie] Kill by Danielson, Sophie (from Krakoczki, Csenge).|20-22
UI|[Sullivan, Sarah] Kill by Jaynes, Teagan (from Greeny, Lauren).|20-23
MSU|[Jaynes, Teagan] Kill by Greeny, Lauren (from Jaynes, Teagan).|20-24
MSU|[Jaynes, Teagan] Kill by Prisby, Anika (from Krakoczki, Csenge).|21-24
UI|[Wakatake, Kailee] Kill by Greer, Kiana (from Krakoczki, Csenge).|22-24
UI|[Wakatake, Kailee] Service error.|22-25
#SET 3
UI|[Armstrong, Alaina] Service error.|0-1
MSU|[Spelts, Joelie] Attack error by Greer, Kiana (block by Jaynes, Teagan; Schloe, Lauren).|0-2
MSU|[Spelts, Joelie] Kill by Jaynes, Teagan.|0-3
SUB|MSU subs: Culler, Keely.
MSU|[Culler, Keely] Service ace (Kleidon, Keira).|0-4
MSU|[Culler, Keely] Attack error by Greer, Kiana (from Krakoczki, Csenge).|0-5
MSU|[Culler, Keely] Service error.|1-5
UI|[Kleidon, Keira] Kill by Greer, Kiana (from Kleidon, Keira).|2-5
UI|[Kleidon, Keira] Kill by Makaula, Koen (from Krakoczki, Csenge).|3-5
UI|[Kleidon, Keira] Attack error by Greer, Kiana (from Krakoczki, Csenge).|3-6
MSU|[Jaynes, Teagan] Service ace (Armstrong, Alaina).|3-7
MSU|[Jaynes, Teagan] Service ace (Armstrong, Alaina).|3-8
MSU|[Jaynes, Teagan] Kill by Greer, Kiana (from Krakoczki, Csenge).|4-8
SUB|UI subs: Danielson, Sophie.
UI|[Krakoczki, Csenge] Attack error by Heidemann, Karli (from Jaynes, Teagan).|5-8
UI|[Krakoczki, Csenge] Attack error by Danielson, Sophie (block by Schloe, Lauren; Greeny, Lauren).|5-9
SUB|MSU subs: Esko, Elli.
MSU|[Heidemann, Karli] Attack error by Esko, Elli (from Noble, Nicolette).|6-9
SUB|MSU subs: Steman, Alice.
UI|[Greer, Kiana] Kill by Esko, Elli (from Jaynes, Teagan).|6-10
MSU|[Noble, Nicolette] Attack error by Danielson, Sophie (from Krakoczki, Csenge).|6-11
MSU|[Noble, Nicolette] Kill by Spelts, Joelie (from Jaynes, Teagan).|6-12
MSU|[Noble, Nicolette] Service error.|7-12
UI|[Makaula, Koen] Kill by Esko, Elli (from Jaynes, Teagan).|7-13
MSU|[Greeny, Lauren] Service error.|8-13
UI|[Sullivan, Sarah] Attack error by Esko, Elli (from Jaynes, Teagan).|9-13
UI|[Sullivan, Sarah] Kill by Spelts, Joelie (from Jaynes, Teagan).|9-14
MSU|[Thomsen, Afton] Attack error by Armstrong, Alaina (block by Spelts, Joelie; Jaynes, Teagan).|9-15
SUB|UI subs: Ferrin, Allie.
MSU|[Thomsen, Afton] Service ace (Sullivan, Sarah).|9-16
MSU|[Thomsen, Afton] Kill by Heidemann, Karli (from Jaynes, Teagan).|9-17
MSU|[Thomsen, Afton] Kill by Spelts, Joelie (from Jaynes, Teagan).|9-18
SUB|UI subs: Smith, Gabrielle.
SUB|MSU subs: Green Ewen, Jolene.
MSU|[Thomsen, Afton] Kill by Greer, Kiana (from Krakoczki, Csenge).|10-18
SUB|UI subs: Wakatake, Kailee.
UI|[Wakatake, Kailee] Kill by Green Ewen, Jolene (from Jaynes, Teagan).|10-19
MSU|[Culler, Keely] Service error.|11-19
UI|[Kleidon, Keira] Kill by Greer, Kiana (from Krakoczki, Csenge).|12-19
UI|[Kleidon, Keira] Kill by Heidemann, Karli (from Jaynes, Teagan).|12-20
MSU|[Jaynes, Teagan] Kill by Makaula, Koen (from Krakoczki, Csenge).|13-20
UI|[Krakoczki, Csenge] Service error.|13-21
MSU|[Heidemann, Karli] Kill by Danielson, Sophie (from Krakoczki, Csenge).|14-21
UI|[Greer, Kiana] Attack error by Krakoczki, Csenge.|14-22
SUB|MSU subs: Rich, Haven.
SUB|UI subs: Trefren, Kyriah.
MSU|[Noble, Nicolette] Kill by Ferrin, Allie (from Trefren, Kyriah).|15-22
UI|[Makaula, Koen] Attack error by Green Ewen, Jolene (from Jaynes, Teagan).|16-22
UI|[Makaula, Koen] Kill by Esko, Elli (from Jaynes, Teagan).|16-23
MSU|[Greeny, Lauren] Service error.|17-23
UI|[Sullivan, Sarah] Kill by Esko, Elli (from Jaynes, Teagan).|17-24
MSU|[Thomsen, Afton] Kill by Ferrin, Allie (from Krakoczki, Csenge).|18-24
UI|[Wakatake, Kailee] Attack error by Greeny, Lauren (from Thomsen, Afton).|19-24
UI|[Wakatake, Kailee] Kill by Greer, Kiana (from Krakoczki, Csenge).|20-24
UI|[Wakatake, Kailee] Kill by Heidemann, Karli (from Jaynes, Teagan).|20-25`});
