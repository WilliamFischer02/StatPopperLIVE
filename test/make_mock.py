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
