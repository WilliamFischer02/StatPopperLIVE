/* Live board page: links to the stats tab, runs the engine, impact picker, reader check. */
(function () {
  'use strict';
  const SPB = window.SPB, PE = SPB.PopEngine, BV = SPB.BoardView, IP = SPB.ImpactPicker;
  const esc = BV.esc;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('spb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('spb:' + k, JSON.stringify(v)); } catch (e) { /* not saved */ } },
  };
  const stars = IP.createStarStore('spb:stars:');
  const MSU_ROSTER = SPB.rosters.msuVolleyball;
  const okOrigin = (o) => {
    try { const u = new URL(o); return u.origin === location.origin || (u.protocol === 'https:' && /(^|\.)statbroadcast\.com$/.test(u.hostname)); } catch (e) { return false; }
  };

  let eng = PE.create(), eventId = null, inst = null, lastLineId = 0, lastHash = '', view = null;
  let last = null, lastAt = 0, lastChangeAt = 0, msgs = 0, lastGood = null;
  let statsWin = null, openedEvent = null, swapped = !!store.get('swap', false);
  let pickerOpen = false, checkOpen = false, startForced = false;

  // ---------------------------------------------------------- board + stars

  const board = BV.mountBoard($('board'), {
    pass: (k) => { eng.pass(k); rerender(); },
    hold: (k) => { eng.toggleHold(k); rerender(); },
    hide: (k) => { eng.hide(k); store.set('hidden:' + eventId, eng.hiddenKeys); rerender(); },
    unhide: (k) => { eng.unhide(k); store.set('hidden:' + eventId, eng.hiddenKeys); rerender(); },
    star: (k) => {
      const [side, uni] = k.split(':');
      const snap = oriented();
      const p = snap && snap.teams[side].players.find((x) => String(x.uni) === uni);
      if (p) { stars.toggle(IP.teamKey(snap.teams[side]), p); applyStars(); rerender(); }
    },
  });
  const oriented = () => (lastGood ? PE.swapSides(lastGood, swapped) : null);
  function applyStars() {
    const s = oriented();
    if (!s) return;
    eng.setStars({ home: stars.get(IP.teamKey(s.teams.home)), away: stars.get(IP.teamKey(s.teams.away)) });
  }
  function rerender() {
    if (!lastGood) { renderPicker(); return; }
    view = eng.view();
    board.render(view);
    renderPicker();
  }
  function resetEngine() {
    eng = PE.create();
    eng.setHidden(store.get('hidden:' + eventId, []));
    lastHash = ''; view = null;
  }

  // ---------------------------------------------------------- picker

  const picker = IP.mountPicker($('picker'), {
    toggle(col, p) { stars.toggle(col.teamKey, p); applyStars(); rerender(); },
    close() { pickerOpen = false; paint(); },
  });
  function renderPicker() {
    const s = oriented();
    const col = (side) => {
      const t = s.teams[side];
      const tk = IP.teamKey(t);
      const players = IP.mergeRoster(t.players, IP.isMSU(t) ? MSU_ROSTER : []);
      return { side, title: t.name || t.code, teamKey: tk, players, starred: (p) => stars.has(tk, p) };
    };
    let cols;
    if (s) cols = [col('home'), col('away')];
    else {
      cols = [
        { side: 'home', title: 'Montana St.', teamKey: 'MSU', players: IP.mergeRoster([], MSU_ROSTER), starred: (p) => stars.has('MSU', p) },
        { side: 'away', title: 'Opponent', teamKey: '?', players: [], starred: () => false, note: 'The opponent’s roster appears once the stats page lists it, usually shortly before first serve.' },
      ];
    }
    picker.render({ cols });
  }

  // ---------------------------------------------------------- linking

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.spb !== 1 || !okOrigin(e.origin)) return;
    if (d.type === 'reader-hello') { try { e.source.postMessage({ spb: 1, type: 'hello' }, e.origin); } catch (err) { /* tab went away */ } return; }
    if (d.type !== 'state') return;
    try { e.source.postMessage({ spb: 1, type: 'ack', seq: d.seq }, e.origin); } catch (err) { /* tab went away */ }
    handleState(d);
  });
  function hello() {
    const msg = { spb: 1, type: 'hello' };
    if (window.opener) { try { window.opener.postMessage(msg, '*'); } catch (e) { /* not linkable */ } }
    if (statsWin && !statsWin.closed) { try { statsWin.postMessage(msg, '*'); } catch (e) { /* not linkable */ } }
  }
  setInterval(() => { if (Date.now() - lastAt > 6000) hello(); }, 3000);
  hello();

  function handleState(d) {
    msgs++; lastAt = Date.now(); last = d;
    if (d.eventId !== eventId) {
      eventId = d.eventId; inst = null; lastGood = null; resetEngine();
    }
    if (d.inst !== inst) {
      // A fresh reader (new page or reload): only its newest line is "live".
      inst = d.inst;
      const ids = (d.lines || []).map((l) => l.id);
      lastLineId = ids.length ? Math.max(...ids) - 1 : 0;
    }
    if (d.ok && d.snap) {
      const firstGood = !lastGood;
      lastGood = d.snap;
      const lines = (d.lines || []).filter((l) => l.id > lastLineId);
      if (d.lines && d.lines.length) lastLineId = Math.max(lastLineId, ...d.lines.map((l) => l.id));
      const h = JSON.stringify(d.snap);
      if (h !== lastHash || lines.length) {
        lastHash = h; lastChangeAt = Date.now();
        applyStars();
        view = eng.update(PE.swapSides(d.snap, swapped), lines.map((l) => l.text).slice(-3));
        board.render(view);
        if (firstGood) { remember(d); renderPicker(); }
        else if (pickerOpen) renderPicker();
      }
    }
    paint();
  }

  // ---------------------------------------------------------- opening a stats page

  function normalizeLink(v) {
    v = String(v || '').trim();
    if (!v) return null;
    if (/^\d{4,8}$/.test(v)) return 'https://stats.statbroadcast.com/broadcast/?id=' + v;
    if (/^practice(\?\S*)?$/i.test(v)) return location.origin + '/' + v;
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
      if (/(^|\.)statbroadcast\.com$/.test(u.hostname) || u.origin === location.origin) { u.protocol = 'https:'; return u.href; }
    } catch (e) { /* not a URL */ }
    return null;
  }
  const eventOf = (href) => { try { return new URL(href).searchParams.get('id') || (/practice/.test(href) ? 'practice' : null); } catch (e) { return null; } };

  function openStats(href) {
    statsWin = window.open(href, 'spb-stats');
    if (!statsWin) { $('feedhint').textContent = 'Your browser blocked the new tab. Allow pop-ups for this site, then try again.'; $('feedhint').className = 'hint bad'; return; }
    openedEvent = eventOf(href);
    startForced = false;
    $('feedhint').textContent = 'Stats page opened. Accept & Continue there, then start the reader if it isn’t automatic.';
    $('feedhint').className = 'hint';
    const rec = store.get('recent', []).filter((r) => r.href !== href);
    rec.unshift({ href, label: rec.find((r) => r.href === href)?.label || (openedEvent === 'practice' ? 'Practice page' : 'Event ' + openedEvent) });
    store.set('recent', rec.slice(0, 5));
    renderRecent();
    paint();
  }
  $('feedform').addEventListener('submit', (e) => {
    e.preventDefault();
    const href = normalizeLink($('feed').value);
    if (!href) { $('feedhint').textContent = 'That doesn’t look like a StatBroadcast link. Paste the address of the game’s stats page, or just its event number.'; $('feedhint').className = 'hint bad'; return; }
    openStats(href);
  });
  $('practice').addEventListener('click', () => openStats(location.origin + '/practice'));

  function remember(d) {
    const s = d.snap;
    const label = `${s.teams.away.code} at ${s.teams.home.code}`;
    const href = d.diag && d.diag.url;
    if (!href) return;
    const rec = store.get('recent', []).filter((r) => r.href !== href);
    rec.unshift({ href, label: d.eventId === 'practice' ? 'Practice page' : label });
    store.set('recent', rec.slice(0, 5));
    renderRecent();
  }
  function renderRecent() {
    const rec = store.get('recent', []);
    $('recentlinks').innerHTML = rec.length ? '<span>Recent:</span>' + rec.map((r, i) => `<button type="button" data-i="${i}" title="${esc(r.href)}">${esc(r.label)}</button>`).join('') : '';
  }
  $('recentlinks').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const r = store.get('recent', [])[+b.dataset.i];
    if (r) openStats(r.href);
  });

  // ---------------------------------------------------------- header + status

  $('starsbtn').addEventListener('click', () => { pickerOpen = !pickerOpen; renderPicker(); paint(); });
  $('checkbtn').addEventListener('click', () => { checkOpen = !checkOpen; paint(); });
  $('swap').addEventListener('click', () => {
    swapped = !swapped; store.set('swap', swapped);
    resetEngine();
    if (lastGood) { applyStars(); view = eng.update(PE.swapSides(lastGood, swapped), []); board.render(view); }
    renderPicker(); paint();
  });
  $('fs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => { $('fs').textContent = 'Press F11'; });
  });
  $('newlink').addEventListener('click', () => { startForced = true; paint(); $('feed').focus(); });

  const secs = (ms) => Math.max(0, Math.round(ms / 1000));
  function paint() {
    const now = Date.now();
    const age = last ? now - lastAt : Infinity;
    let mode = 'Waiting', cls = 'wait', conn;
    if (!last) {
      conn = statsWin && !statsWin.closed ? 'Stats page opened · waiting for its reader to start' : 'Not linked to a stats page yet';
    } else if (age > 20000) {
      mode = 'Stale'; conn = `No word from the stats tab for ${secs(age)} s. Is it still open?`;
    } else if (!last.ok) {
      mode = 'Linked'; cls = 'link'; conn = 'Stats tab linked · ' + (last.error || 'waiting for stats');
    } else {
      mode = 'Live'; cls = 'live';
      const s = last.snap;
      conn = `${s.teams.away.code} at ${s.teams.home.code} · ${last.eventId === 'practice' ? 'practice page' : 'event ' + last.eventId} · last stat change ${secs(now - lastChangeAt)} s ago`;
    }
    $('mode').textContent = mode;
    $('mode').className = 'mode ' + cls;
    $('conn').textContent = conn;
    $('starsbtn').setAttribute('aria-pressed', String(pickerOpen));
    $('checkbtn').setAttribute('aria-pressed', String(checkOpen));
    $('picker').hidden = !pickerOpen;
    $('board').hidden = !view;
    $('start').hidden = !!view && !startForced;
    $('newlink').hidden = !view || startForced;
    // Notices
    const notes = [];
    if (view && last && !last.ok && age < 20000) notes.push('The stats page isn’t showing its box score right now. The board is holding the last numbers it saw. ' + (last.error || ''));
    if (last && openedEvent && last.eventId !== openedEvent && last.eventId !== 'page') notes.push(`The linked stats tab is on event ${last.eventId}, not the one you opened (${openedEvent}).`);
    const readerVersion = last && last.diag && last.diag.version;
    if (readerVersion && readerVersion !== SPB.version) notes.push(`The stats tab is running reader ${readerVersion}, but this board is ${SPB.version}. Reload the stats page and start the reader again. With Tampermonkey: open its menu, click Check for userscript updates, then reload the stats page.`);
    $('notice').hidden = !notes.length;
    $('notice').textContent = notes.join(' ');
    if (view) {
      const s = view.score, t = view.teams;
      document.title = `${t.home.code} ${s.home}–${s.away} ${t.away.code} · Pop Board`;
    } else document.title = 'Stat Pop Board';
    renderCheck();
  }
  setInterval(() => { if (eng.expireHolds()) rerender(); paint(); }, 1000);

  function renderCheck() {
    $('check').hidden = !checkOpen;
    if (!checkOpen) return;
    if (!last) {
      $('check').innerHTML = '<h3>Reader check</h3><p class="note">Nothing from a stats tab yet. Open a stats page from this board, accept its terms, and start the reader there.</p>';
      return;
    }
    const d = last.diag || {}, s = last.snap;
    const tables = (d.tables || []).map((t) => `${t.side === 'home' ? 'Home' : 'Visitor'}: ${t.players} players${t.totals ? ' + totals row' : ''}`).join(' · ') || '<span class="bad">none found</span>';
    const score = s ? `${s.teams.home.code} ${s.score.home} – ${s.score.away} ${s.teams.away.code} · ${s.status === 'final' ? 'Final' : 'Set ' + s.set} · sets ${s.setsWon.home}–${s.setsWon.away}` : '<span class="bad">not read</span>';
    const lines = (last.lines || []).slice(-3).reverse().map((l) => `<div><code>${esc(l.text)}</code></div>`).join('') || '<span class="bad">none yet (they appear as plays happen)</span>';
    $('check').innerHTML = `<h3>Reader check</h3>
      <p class="note">Compare these with the stats page. If they match, the board is reading it correctly.</p>
      <dl class="kv">
        <dt>Status</dt><dd>${last.ok ? '<span class="ok">Reading OK</span>' : '<span class="bad">' + esc(last.error || 'Waiting') + '</span>'}</dd>
        <dt>Tab title</dt><dd><code>${esc(d.title || '')}</code></dd>
        <dt>Score read</dt><dd>${score}</dd>
        <dt>Tables found</dt><dd>${tables}</dd>
        <dt>Plays captured</dt><dd>${d.linesCaptured || 0} since the reader started${lines}</dd>
        <dt>Link</dt><dd>${msgs} updates received · last ${secs(Date.now() - lastAt)} s ago · reader ${esc(d.version || '?')} · ${esc(d.url || '')}</dd>
      </dl>
      <div class="row"><button class="tbtn" id="copycheck" type="button">Copy for Claude</button><span id="copied" class="copied"></span></div>`;
    $('copycheck').addEventListener('click', () => {
      const text = JSON.stringify({ diag: d, snap: s, lines: last.lines, error: last.error }, null, 2);
      navigator.clipboard.writeText(text).then(() => { $('copied').textContent = 'Copied'; }, () => { $('copied').textContent = 'Copy blocked: select the text above instead'; });
    });
  }

  // Start
  const fromStats = new URLSearchParams(location.search).get('from') === 'stats';
  if (fromStats) $('feedhint').textContent = 'Opened from the stats tab · linking…';
  renderRecent();
  renderPicker();
  paint();
})();
