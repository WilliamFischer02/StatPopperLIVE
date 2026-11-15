"""Write a mock StatBroadcast-style page that replays Oct 1 through tables, title and a console line.

MSU's box uses the live page's column names (S # PLAYER K E TA HIT% AS SA DG BL, seen 2026-10-17) with a
TEAM row; Idaho's keeps the classic StatCrew names. Each side also gets a team-by-set table (Set 1, Set 2,
... Match) like the live page's, which the reader must not mistake for players."""
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
data = (ROOT / "data" / "replay-msu-idaho.json").read_text(encoding="utf-8")
replay = (ROOT / "src" / "replay.js").read_text(encoding="utf-8")
page = f"""<!doctype html><html><head><meta charset="utf-8"><title>, - SET 0</title></head>
<body style="font:12px Arial;background:#fff;color:#000">
<h4>Idaho at Montana St.</h4>
<div id="console" style="border:1px solid #999;padding:4px;margin:6px 0">Waiting</div>
<table id="line" border="1"><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>
<tr><td>UI</td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>MSU</td><td></td><td></td><td></td><td></td><td></td></tr></table>
<h5>Idaho</h5><table id="t-away" border="1"></table><table id="s-away" border="1"></table>
<h5>Montana St.</h5><table id="t-home" border="1"></table><table id="s-home" border="1"></table>
<script>window.REPLAY_DATA = {data};</script>
<script>{replay}</script>
<script>
const rp = ReplayAdapter.createReplay(window.REPLAY_DATA);
const H = ['#','Player','K','E','TA','PCT','A','SA','SE','RE','DIG','BS','BA','BE'];
const HL = ['S','#','PLAYER','K','E','TA','HIT%','AS','SA','DG','BL'];
const pct = (k, e, ta) => (ta ? ((k - e) / ta).toFixed(3) : '.000');
const tr = (cells) => '<tr><td>' + cells.join('</td><td>') + '</td></tr>';
function table(t) {{
  const row = (p) => tr([p.uni, p.last + ', ' + p.first, p.k, p.e, p.ta, pct(p.k, p.e, p.ta), p.a, p.sa, p.se, p.re, p.dig, p.bs, p.ba, p.be]);
  const T = t.totals;
  return '<thead><tr><th>' + H.join('</th><th>') + '</th></tr></thead><tbody>' + t.players.map(row).join('') +
    tr(['', 'Totals', T.k, T.e, T.ta, '', T.a, T.sa, T.se, T.re, T.dig, T.bs, T.ba, T.be]) + '</tbody>';
}}
// The live page's layout: starter mark, real column names, combined blocks (BL), a TEAM row before Totals.
function liveTable(t) {{
  const bl = (x) => x.bs + x.ba;
  const row = (p, i) => tr([i < 6 ? '*' : '', p.uni, p.last + ', ' + p.first, p.k, p.e, p.ta, pct(p.k, p.e, p.ta), p.a, p.sa, p.dig, bl(p)]);
  const T = t.totals;
  return '<thead><tr><th>' + HL.join('</th><th>') + '</th></tr></thead><tbody>' + t.players.map(row).join('') +
    tr(['', '', 'TEAM', 0, 0, 0, '', 0, 0, 0, 0]) +
    tr(['', '', 'Totals', T.k, T.e, T.ta, pct(T.k, T.e, T.ta), T.a, T.sa, T.dig, bl(T)]) + '</tbody>';
}}
// Team stats by set, one row per set played plus the match: no # or PLAYER column.
function bySet(n, side) {{
  const ends = [0];
  window.REPLAY_DATA.rallies.slice(0, n).forEach((r, i) => {{ ends[r.set] = i + 1; }});
  const at = (i) => rp.snapshot(i).teams[side].totals;
  const rows = [];
  for (let j = 1; j < ends.length; j++) {{
    const a = at(ends[j - 1] || 0), b = at(ends[j]);
    const d = {{}}; for (const k in b) d[k] = b[k] - (a[k] || 0);
    rows.push(['Set ' + j, d.k, d.e, d.ta, pct(d.k, d.e, d.ta), d.a, d.sa, d.dig, d.bs + d.ba]);
  }}
  const T = at(n);
  if (n) rows.push(['Match', T.k, T.e, T.ta, pct(T.k, T.e, T.ta), T.a, T.sa, T.dig, T.bs + T.ba]);
  return '<tr><th>Set</th><th>K</th><th>E</th><th>TA</th><th>HIT%</th><th>AS</th><th>SA</th><th>DG</th><th>BL</th></tr>' + rows.map(tr).join('');
}}
const setScores = {{}};
window.showRally = function (n) {{
  const s = rp.snapshot(n);
  document.title = (n === rp.total ? 'UI ' + s.setsWon.away + ', MSU ' + s.setsWon.home + ' - FINAL' : 'UI ' + s.score.away + ', MSU ' + s.score.home + ' - SET ' + s.set);
  for (const r of window.REPLAY_DATA.rallies.slice(0, n)) setScores[r.set] = [r.ui, r.msu];
  setScores[s.set] = [s.score.away, s.score.home];
  const rows = document.querySelectorAll('#line tr');
  for (const k in setScores) {{ rows[1].cells[+k].textContent = setScores[k][0]; rows[2].cells[+k].textContent = setScores[k][1]; }}
  document.getElementById('t-home').innerHTML = liveTable(s.teams.home);
  document.getElementById('t-away').innerHTML = table(s.teams.away);
  document.getElementById('s-home').innerHTML = bySet(n, 'home');
  document.getElementById('s-away').innerHTML = bySet(n, 'away');
  const lines = rp.linesAt(n);
  if (lines.length) document.getElementById('console').textContent = lines[0];
}};
window.showRally(0);
</script></body></html>"""
(ROOT / "test" / "mock-statbroadcast.html").write_text(page, encoding="utf-8", newline="\n")
print("wrote test/mock-statbroadcast.html")

# ---------------------------------------------------------------- basketball
# A made-up game (src/bb-sim.js). The real StatBroadcast basketball page had not been seen when this was
# written, so the layout is a guess that covers both likely box styles: the home box uses a short live
# layout (made-attempted cells, ORB-DRB) with TEAM and Totals rows; the away box uses the classic StatCrew
# columns (FG-FGA ... OFF DEF TOT PF TP A TO BLK S MIN). Each side also gets a by-period team table with
# no # or Player column, which the reader must not mistake for players.
sim = (ROOT / "src" / "bb-sim.js").read_text(encoding="utf-8")
bb_page = f"""<!doctype html><html><head><meta charset="utf-8"><title>, - </title></head>
<body style="font:12px Arial;background:#fff;color:#000">
<h4>Ridgeline at Montana St.</h4>
<div id="console" style="border:1px solid #999;padding:4px;margin:6px 0">Waiting</div>
<table id="line" border="1"><tr><th></th><th>1</th><th>2</th><th>T</th></tr>
<tr><td>RDG</td><td></td><td></td><td></td></tr><tr><td>MSU</td><td></td><td></td><td></td></tr></table>
<h5>Ridgeline</h5><table id="t-away" border="1"></table><table id="s-away" border="1"></table>
<h5>Montana St.</h5><table id="t-home" border="1"></table><table id="s-home" border="1"></table>
<ol id="pbp" reversed></ol>
<script>{sim}</script>
<script>
const g = BBSim.createGame({{}});
const tr = (cells) => '<tr><td>' + cells.join('</td><td>') + '</td></tr>';
const th = (cells) => '<thead><tr><th>' + cells.join('</th><th>') + '</th></tr></thead>';
const m = (a, b) => a + '-' + b;
// Short live layout.
function liveTable(t) {{
  const H = ['#', 'PLAYER', 'MIN', 'FG', '3PT', 'FT', 'ORB-DRB', 'REB', 'PF', 'A', 'TO', 'BLK', 'STL', 'PTS'];
  const row = (p) => tr([p.uni, p.last + ', ' + p.first, p.min, m(p.fgm, p.fga), m(p.tpm, p.tpa), m(p.ftm, p.fta), m(p.oreb, p.dreb), p.reb, p.pf, p.ast, p.to, p.blk, p.stl, p.pts]);
  const T = t.totals;
  return th(H) + '<tbody>' + t.players.map(row).join('') + tr(['', 'TEAM', '', '', '', '', '0-0', 0, '', '', 0, '', '', '']) +
    tr(['', 'Totals', '', m(T.fgm, T.fga), m(T.tpm, T.tpa), m(T.ftm, T.fta), m(T.oreb, T.dreb), T.reb, T.pf, T.ast, T.to, T.blk, T.stl, T.pts]) + '</tbody>';
}}
// Classic StatCrew layout.
function crewTable(t) {{
  const H = ['##', 'Player', 'FG-FGA', '3FG-FGA', 'FT-FTA', 'OFF', 'DEF', 'TOT', 'PF', 'TP', 'A', 'TO', 'BLK', 'S', 'MIN'];
  const row = (p) => tr([p.uni, p.last.toUpperCase() + ',' + p.first.toUpperCase(), m(p.fgm, p.fga), m(p.tpm, p.tpa), m(p.ftm, p.fta), p.oreb, p.dreb, p.reb, p.pf, p.pts, p.ast, p.to, p.blk, p.stl, p.min]);
  const T = t.totals;
  return th(H) + '<tbody>' + t.players.map(row).join('') + tr(['', 'TEAM', '', '', '', 0, 0, 0, '', '', '', 0, '', '', '']) +
    tr(['', 'Totals', m(T.fgm, T.fga), m(T.tpm, T.tpa), m(T.ftm, T.fta), T.oreb, T.dreb, T.reb, T.pf, T.pts, T.ast, T.to, T.blk, T.stl, '']) + '</tbody>';
}}
// Team stats by period: no # or Player column.
function byPeriod(s, side) {{
  const T = s.teams[side].totals;
  const rows = [['1st Half', m(T.fgm, T.fga), m(T.tpm, T.tpa), m(T.ftm, T.fta), T.reb, T.ast, T.to, T.pts], ['Game', m(T.fgm, T.fga), m(T.tpm, T.tpa), m(T.ftm, T.fta), T.reb, T.ast, T.to, T.pts]];
  return '<tr><th>Period</th><th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>A</th><th>TO</th><th>PTS</th></tr>' + rows.map(tr).join('');
}}
window.showStep = function (n) {{
  const s = g.snapshot(n);
  document.title = g.title(n);
  const by = g.byPeriod(n), rows = document.querySelectorAll('#line tr');
  for (let k = 1; k <= 2; k++) {{ rows[1].cells[k].textContent = by.away[k - 1] == null ? '' : by.away[k - 1]; rows[2].cells[k].textContent = by.home[k - 1] == null ? '' : by.home[k - 1]; }}
  rows[1].cells[3].textContent = s.score.away; rows[2].cells[3].textContent = s.score.home;
  document.getElementById('t-home').innerHTML = liveTable(s.teams.home);
  document.getElementById('t-away').innerHTML = crewTable(s.teams.away);
  document.getElementById('s-home').innerHTML = byPeriod(s, 'home');
  document.getElementById('s-away').innerHTML = byPeriod(s, 'away');
  const lines = g.linesAt(n);
  if (lines.length) document.getElementById('console').textContent = lines[lines.length - 1];
  for (const text of lines) {{ const li = document.createElement('li'); li.textContent = text; document.getElementById('pbp').prepend(li); }}
  while (document.getElementById('pbp').children.length > 10) document.getElementById('pbp').lastElementChild.remove();
}};
window.showStep(0);
</script></body></html>"""
(ROOT / "test" / "mock-statbroadcast-bb.html").write_text(bb_page, encoding="utf-8", newline="\n")
print("wrote test/mock-statbroadcast-bb.html")
