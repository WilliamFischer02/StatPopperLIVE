/* Basketball practice page: a stand-in stats page that plays a made-up game (BBSim) so the reader and board can be tested without a live one. */
(function () {
  'use strict';
  const quarters = new URLSearchParams(location.search).get('periods') === '4';
  const g = window.BBSim.createGame({ periods: quarters ? 4 : 2 });
  const $ = (id) => document.getElementById(id);
  const H = ['#', 'Player', 'MIN', 'FG', '3PT', 'FT', 'ORB-DRB', 'REB', 'PF', 'A', 'TO', 'BLK', 'STL', 'PTS'];
  const td = (v) => `<td>${v}</td>`;
  let n = 0, timer = null;

  function table(t) {
    const cells = (p) => [p.min, p.fgm + '-' + p.fga, p.tpm + '-' + p.tpa, p.ftm + '-' + p.fta, p.oreb + '-' + p.dreb, p.reb, p.pf, p.ast, p.to, p.blk, p.stl, p.pts];
    const row = (p) => `<tr>${td(p.uni)}${td(p.last + ', ' + p.first)}${cells(p).map(td).join('')}</tr>`;
    const T = { ...t.totals, min: '' };
    return `<thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${t.players.map(row).join('')}
      <tr class="tot">${td('')}${td('Totals')}${cells(T).map(td).join('')}</tr></tbody>`;
  }
  function show(i) {
    n = Math.max(0, Math.min(g.total, i));
    const s = g.snapshot(n);
    document.title = g.title(n);
    const by = g.byPeriod(n);
    const rows = document.querySelectorAll('#line tr');
    for (let k = 1; k <= g.periods; k++) {
      rows[1].cells[k].textContent = by.away[k - 1] == null ? '' : by.away[k - 1];
      rows[2].cells[k].textContent = by.home[k - 1] == null ? '' : by.home[k - 1];
    }
    rows[1].cells[g.periods + 1].textContent = s.score.away;
    rows[2].cells[g.periods + 1].textContent = s.score.home;
    $('t-home').innerHTML = table(s.teams.home);
    $('t-away').innerHTML = table(s.teams.away);
    const lines = g.linesAt(n);
    if (lines.length) $('console').textContent = lines[lines.length - 1];
    for (const text of lines) {
      const li = document.createElement('li');
      li.textContent = text;
      $('pbp').prepend(li);
    }
    while ($('pbp').children.length > 10) $('pbp').lastElementChild.remove();
    $('where').textContent = g.label(n);
    if (n >= g.total) stop();
  }
  function stop() { clearInterval(timer); timer = null; $('play').textContent = 'Play'; }
  function play() { clearInterval(timer); timer = setInterval(() => show(n + 1), +$('speed').value); $('play').textContent = 'Pause'; }
  // Opens a few minutes into the last period, just before the home side's run.
  const startAt = () => Math.max(1, g.find((st) => st.period === g.periods && st.clock < (g.periods === 4 ? 520 : 1040)) - 1);
  $('play').addEventListener('click', () => (timer ? stop() : play()));
  $('speed').addEventListener('change', () => { if (timer) play(); });
  $('restart').addEventListener('click', () => { stop(); $('pbp').innerHTML = ''; show(startAt()); play(); });
  $('tip').addEventListener('click', () => { stop(); $('pbp').innerHTML = ''; show(0); play(); });
  $('fwd').addEventListener('click', () => { stop(); show(n + 1); });
  window.practice = { show, g };

  // The line score's header: one column per period, then the total.
  $('line').rows[0].innerHTML = '<th></th>' + Array.from({ length: g.periods }, (_, k) => `<th>${k + 1}</th>`).join('') + '<th>T</th>';
  for (const r of [1, 2]) $('line').rows[r].innerHTML = `<td>${r === 1 ? g.teams.away.code : g.teams.home.code}</td>` + '<td></td>'.repeat(g.periods + 1);
  show(startAt());
  if (new URLSearchParams(location.search).get('paused') !== '1') play();
})();
