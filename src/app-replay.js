/* Replay page: steps the engine through a finished match rally by rally, with impact picks. */
(function () {
  'use strict';
  const SPB = window.SPB, PE = SPB.PopEngine, BV = SPB.BoardView, IP = SPB.ImpactPicker;
  const rp = window.ReplayAdapter.createReplay(window.REPLAY_DATA);
  const stars = IP.createStarStore('spb:replay-stars:');
  const eng = PE.create();
  const $ = (id) => document.getElementById(id);
  let pos = -1, view = null, timer = null, pickerOpen = false;

  const board = BV.mountBoard($('board'), {
    pass: (k) => { eng.pass(k); redraw(); },
    hold: (k) => { eng.toggleHold(k); redraw(); },
    hide: (k) => { eng.hide(k); redraw(); },
    unhide: (k) => { eng.unhide(k); redraw(); },
    star: (k) => {
      const [side, uni] = k.split(':');
      const s = rp.snapshot(Math.max(0, pos));
      const p = s.teams[side].players.find((x) => String(x.uni) === uni);
      if (p) { stars.toggle(IP.teamKey(s.teams[side]), p); applyStars(); redraw(); }
    },
    footNote: 'Replay data: kills, errors, aces, blocks and assists are exact from the play-by-play. Attempts are matched to each set’s box score; digs are spread evenly.',
  });
  function applyStars() {
    const s = rp.snapshot(0);
    eng.setStars({ home: stars.get(IP.teamKey(s.teams.home)), away: stars.get(IP.teamKey(s.teams.away)) });
  }
  function redraw() { view = eng.view(); board.render(view); if (pickerOpen) renderPicker(); }

  const picker = IP.mountPicker($('picker'), {
    toggle(col, p) { stars.toggle(col.teamKey, p); applyStars(); redraw(); renderPicker(); },
    close() { pickerOpen = false; $('picker').hidden = true; $('starsbtn').setAttribute('aria-pressed', 'false'); },
  });
  function renderPicker() {
    const s = rp.snapshot(0);
    const col = (side) => {
      const t = s.teams[side], tk = IP.teamKey(t);
      return { side, title: t.name, teamKey: tk, players: IP.mergeRoster(t.players, IP.isMSU(t) ? SPB.rosters.msuVolleyball : []), starred: (p) => stars.has(tk, p) };
    };
    picker.render({ cols: [col('home'), col('away')] });
  }
  $('starsbtn').addEventListener('click', () => {
    pickerOpen = !pickerOpen;
    $('picker').hidden = !pickerOpen;
    $('starsbtn').setAttribute('aria-pressed', String(pickerOpen));
    if (pickerOpen) renderPicker();
  });

  function goTo(n) {
    n = Math.max(0, Math.min(rp.total, n));
    if (n < pos || pos < 0) { eng.reset(); pos = -1; }
    applyStars();
    for (let i = pos + 1; i <= n; i++) view = eng.update(rp.snapshot(i), rp.linesAt(i));
    pos = n;
    board.render(view);
    $('scrub').value = String(n);
    $('where').textContent = rp.label(n);
    if (n >= rp.total) stop();
  }
  function stop() { clearInterval(timer); timer = null; $('play').setAttribute('aria-pressed', 'false'); $('play').textContent = 'Play'; }
  function play() {
    if (pos >= rp.total) goTo(0);
    clearInterval(timer);
    timer = setInterval(() => goTo(pos + 1), +$('speed').value);
    $('play').setAttribute('aria-pressed', 'true'); $('play').textContent = 'Pause';
  }

  $('scrub').max = String(rp.total);
  $('play').addEventListener('click', () => (timer ? stop() : play()));
  $('back').addEventListener('click', () => { stop(); goTo(pos - 1); });
  $('fwd').addEventListener('click', () => { stop(); goTo(pos + 1); });
  $('scrub').addEventListener('input', (e) => { stop(); goTo(+e.target.value); });
  $('speed').addEventListener('change', () => { if (timer) play(); });
  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => { stop(); goTo(rp.setStarts[+b.dataset.jump - 1] + 1); }));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); timer ? stop() : play(); }
    else if (e.key === 'ArrowRight') { stop(); goTo(pos + 1); }
    else if (e.key === 'ArrowLeft') { stop(); goTo(pos - 1); }
  });

  goTo(rp.findScore(3, 18, 9) || 0);
})();
