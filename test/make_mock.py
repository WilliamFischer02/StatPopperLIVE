"""Write a mock StatBroadcast-style page that replays Oct 1 through tables, title and a console line."""
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
data = (ROOT / "data" / "replay-msu-idaho.json").read_text()
replay = (ROOT / "src" / "replay.js").read_text()
page = f"""<!doctype html><html><head><meta charset="utf-8"><title>, - SET 0</title></head>
<body style="font:12px Arial;background:#fff;color:#000">
<h4>Idaho at Montana St.</h4>
<div id="console" style="border:1px solid #999;padding:4px;margin:6px 0">Waiting</div>
<table id="line" border="1"><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>
<tr><td>UI</td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>MSU</td><td></td><td></td><td></td><td></td><td></td></tr></table>
<h5>Idaho</h5><table id="t-away" border="1"></table>
<h5>Montana St.</h5><table id="t-home" border="1"></table>
<script>window.REPLAY_DATA = {data};</script>
<script>{replay}</script>
<script>
const rp = ReplayAdapter.createReplay(window.REPLAY_DATA);
const H = ['#','Player','K','E','TA','PCT','A','SA','SE','RE','DIG','BS','BA','BE'];
function table(t) {{
  const row = (p) => '<tr><td>' + p.uni + '</td><td>' + p.last + ', ' + p.first + '</td><td>' + [p.k,p.e,p.ta,(p.ta?((p.k-p.e)/p.ta).toFixed(3):'.000'),p.a,p.sa,p.se,p.re,p.dig,p.bs,p.ba,p.be].join('</td><td>') + '</td></tr>';
  const T = t.totals;
  return '<thead><tr><th>' + H.join('</th><th>') + '</th></tr></thead><tbody>' + t.players.map(row).join('') +
    '<tr><td></td><td>Totals</td><td>' + [T.k,T.e,T.ta,'',T.a,T.sa,T.se,T.re,T.dig,T.bs,T.ba,T.be].join('</td><td>') + '</td></tr></tbody>';
}}
const setScores = {{}};
window.showRally = function (n) {{
  const s = rp.snapshot(n);
  document.title = (n === rp.total ? 'UI ' + s.setsWon.away + ', MSU ' + s.setsWon.home + ' - FINAL' : 'UI ' + s.score.away + ', MSU ' + s.score.home + ' - SET ' + s.set);
  for (const r of window.REPLAY_DATA.rallies.slice(0, n)) setScores[r.set] = [r.ui, r.msu];
  setScores[s.set] = [s.score.away, s.score.home];
  const rows = document.querySelectorAll('#line tr');
  for (const k in setScores) {{ rows[1].cells[+k].textContent = setScores[k][0]; rows[2].cells[+k].textContent = setScores[k][1]; }}
  document.getElementById('t-home').innerHTML = table(s.teams.home);
  document.getElementById('t-away').innerHTML = table(s.teams.away);
  const lines = rp.linesAt(n);
  if (lines.length) document.getElementById('console').textContent = lines[0];
}};
window.showRally(0);
</script></body></html>"""
(ROOT / "test" / "mock-statbroadcast.html").write_text(page)
print("wrote test/mock-statbroadcast.html")
