/* Practice page: a stand-in stats page that replays MSU vs Idaho so the reader and board can be tested without a live game. */
(function () {
  'use strict';
  const rp = window.ReplayAdapter.createReplay(window.REPLAY_DATA);
  const $ = (id) => document.getElementById(id);
  const H = ['#', 'Player', 'K', 'E', 'TA', 'PCT', 'A', 'SA', 'SE', 'RE', 'DIG', 'BS', 'BA', 'BE'];
  const td = (v) => `<td>${v}</td>`;
  let n = 0, timer = null;

  function table(t) {
    const pct = (p) => (p.ta ? ((p.k - p.e) / p.ta).toFixed(3).replace(/^0/, '').replace(/^-0/, '-') : '.000');
    const row = (p) => `<tr>${td(p.uni)}${td(p.last + ', ' + p.first)}${[p.k, p.e, p.ta, pct(p), p.a, p.sa, p.se, p.re, p.dig, p.bs, p.ba, p.be].map(td).join('')}</tr>`;
    const T = t.totals;
    return `<thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${t.players.map(row).join('')}
      <tr class="tot">${td('')}${td('Totals')}${[T.k, T.e, T.ta, pct(T), T.a, T.sa, T.se, T.re, T.dig, T.bs, T.ba, T.be].map(td).join('')}</tr></tbody>`;
  }
  function show(i) {
    n = Math.max(0, Math.min(rp.total, i));
    const s = rp.snapshot(n);
    document.title = n === rp.total ? `UI ${s.setsWon.away}, MSU ${s.setsWon.home} - FINAL` : `UI ${s.score.away}, MSU ${s.score.home} - SET ${s.set}`;
    const sets = {};
    for (const r of window.REPLAY_DATA.rallies.slice(0, n)) sets[r.set] = [r.ui, r.msu];
    const rows = document.querySelectorAll('#line tr');
    for (let k = 1; k <= 5; k++) { rows[1].cells[k].textContent = sets[k] ? sets[k][0] : ''; rows[2].cells[k].textContent = sets[k] ? sets[k][1] : ''; }
    $('t-home').innerHTML = table(s.teams.home);
    $('t-away').innerHTML = table(s.teams.away);
    const lines = rp.linesAt(n);
    if (lines.length) {
      $('console').textContent = lines[0];
      const li = document.createElement('li');
      li.textContent = lines[0];
      $('pbp').prepend(li);
      while ($('pbp').children.length > 8) $('pbp').lastElementChild.remove();
    }
    $('where').textContent = rp.label(n);
    if (n >= rp.total) stop();
  }
  function stop() { clearInterval(timer); timer = null; $('play').textContent = 'Play'; }
  function play() { clearInterval(timer); timer = setInterval(() => show(n + 1), +$('speed').value); $('play').textContent = 'Pause'; }
  $('play').addEventListener('click', () => (timer ? stop() : play()));
  $('speed').addEventListener('change', () => { if (timer) play(); });
  $('restart').addEventListener('click', () => { stop(); $('pbp').innerHTML = ''; show(rp.findScore(3, 12, 9) - 1); play(); });
  $('fwd').addEventListener('click', () => { stop(); show(n + 1); });
  window.practice = { show, rp };

  // Opens on set 3, a few rallies before MSU's 5-0 run, and starts playing.
  show(rp.findScore(3, 12, 9) - 1);
  if (new URLSearchParams(location.search).get('paused') !== '1') play();
})();
