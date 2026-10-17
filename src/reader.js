/*
 * Reader: runs inside the StatBroadcast tab (started by the bookmark, a console
 * paste, Tampermonkey, or the practice page). It reads only what that page
 * shows, then hands it to the Stat Pop Board window on this computer through
 * window.postMessage. It makes no network requests of its own.
 *
 *   - score, set and team codes from the tab title ("UI 18, MSU 24 - SET 3")
 *   - player and team rows from tables whose headers look like a volleyball box
 *   - new play-by-play / console sentences that name a rostered player
 */
function startReader(SPB) {
  const PE = SPB.PopEngine, BV = SPB.BoardView;
  const VERSION = SPB.version;
  const INSTANCE = Math.random().toString(36).slice(2, 10);
  const BOARD_ORIGIN = SPB.origin;
  const eventId = new URLSearchParams(location.search).get('id') || (/practice/.test(location.pathname) ? 'practice' : 'page');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('spb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('spb:' + k, JSON.stringify(v)); } catch (e) { /* settings just won't persist */ } },
  };
  function applyStyles(root, cssText) {
    try {
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
        const sh = new CSSStyleSheet(); sh.replaceSync(cssText); root.adoptedStyleSheets = [sh]; return;
      }
    } catch (e) { /* fall through to a style element */ }
    const st = document.createElement('style'); st.textContent = cssText; root.appendChild(st);
  }

  // ---------------------------------------------------------- page reading

  function parseTitle(t) {
    const m = String(t || '').match(/^\s*([^,]*?)\s*(\d+)?\s*,\s*(.*?)\s*(\d+)?\s+-\s+(.*?)\s*$/);
    if (!m) return null;
    const status = m[5];
    const setM = status.match(/set\s*(\d+)/i);
    return {
      vis: { code: m[1].trim(), score: m[2] == null ? 0 : +m[2] },
      home: { code: m[3].trim(), score: m[4] == null ? 0 : +m[4] },
      final: /final/i.test(status), set: setM ? +setM[1] : null, raw: status,
    };
  }

  const HMAP = {
    '#': 'uni', 'NO': 'uni', 'NO.': 'uni', 'NUM': 'uni',
    'PLAYER': 'name', 'NAME': 'name', 'ATHLETE': 'name',
    'SP': 'sp', 'S': 'sp', 'K': 'k', 'KILLS': 'k', 'E': 'e', 'TA': 'ta', 'TOT': 'ta', 'ATT': 'ta',
    'PCT': 'pct', 'PCT.': 'pct', 'HIT%': 'pct', 'A': 'a', 'AST': 'a', 'ASST': 'a',
    'SA': 'sa', 'SE': 'se', 'RE': 're', 'DIG': 'dig', 'DIGS': 'dig', 'BS': 'bs', 'BA': 'ba',
    'BE': 'be', 'BHE': 'bhe', 'PTS': 'pts', 'DHB': 'dhb',
  };
  const cellText = (c) => (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
  const ours = (el) => !!(el && el.closest && el.closest('#spb-host, #spb-dock'));

  function expandRow(tr) {
    const out = [];
    for (const c of tr.cells) { const span = Math.max(1, +c.colSpan || 1); for (let i = 0; i < span; i++) out.push(c); }
    return out;
  }
  function headerMap(table) {
    let best = null;
    for (const tr of [...table.rows].slice(0, 4)) {
      const map = {}; let hits = 0;
      expandRow(tr).forEach((c, i) => {
        const key = HMAP[cellText(c).toUpperCase()];
        if (!key) return;
        if (key === 'e' && map.e != null) { map.setE = i; return; }
        if (map[key] == null) { map[key] = i; hits++; }
      });
      if (!best || hits > best.hits) best = { tr, map, hits };
    }
    return best;
  }
  function looksVolleyball(map) {
    const extra = ['sa', 'dig', 'bs', 'ba', 'a', 're'].filter((k) => map[k] != null).length;
    return map.k != null && (map.ta != null || map.pct != null) && extra >= 2;
  }
  const looksBasketball = (table) => /\bREB\b|\bFG\b|\b3PT\b|\bFGM\b/.test(cellText(table.rows[0] || table).toUpperCase());

  function splitName(raw) {
    let s = raw.replace(/\*/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().replace(/^\d+\s+/, '');
    if (s.includes(',')) { const [last, first] = s.split(',').map((x) => x.trim()); return { last, first: first || '' }; }
    const parts = s.split(' ');
    return parts.length === 1 ? { last: parts[0], first: '' } : { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }
  function contextBits(el) {
    const bits = [];
    if (el.caption) bits.push(cellText(el.caption));
    let node = el;
    for (let up = 0; up < 4 && node; up++) {
      let sib = node.previousElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
        const t = cellText(sib);
        if (t && t.length < 120) bits.push(t);
      }
      node = node.parentElement;
    }
    return bits;
  }
  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentions = (text, w) => !!w && new RegExp('(?<![A-Za-z0-9])' + escRe(w) + '(?![A-Za-z0-9])', 'i').test(text);

  function teamNames() {
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5')) {
      if (ours(h)) continue;
      const m = cellText(h).match(/^(.+?)\s+(?:at|vs\.?)\s+(.+)$/i);
      if (m && m[1].length < 40 && m[2].length < 40) return { vis: m[1], home: m[2] };
    }
    return { vis: null, home: null };
  }

  function readTables(title, names) {
    const found = [];
    for (const table of document.querySelectorAll('table')) {
      if (ours(table)) continue;
      const hm = headerMap(table);
      if (!hm || !looksVolleyball(hm.map)) continue;
      const bits = contextBits(table);
      if (/season|career|cumulative/i.test(bits.slice(0, 2).join(' '))) continue;
      const players = [];
      let totals = null;
      const rows = [...table.rows];
      for (const tr of rows.slice(rows.indexOf(hm.tr) + 1)) {
        const cells = expandRow(tr);
        const val = (k) => (hm.map[k] == null || !cells[hm.map[k]] ? 0 : parseFloat(cellText(cells[hm.map[k]]).replace(/[^\d.-]/g, '')) || 0);
        const lead = cells.slice(0, 3).map(cellText).join(' ');
        const stats = {};
        for (const k of ['k', 'e', 'ta', 'a', 'sa', 'se', 're', 'dig', 'bs', 'ba', 'be']) stats[k] = val(k);
        if (/^\s*(team\s+)?totals?\b/i.test(lead) || /\btotals?\b/i.test(cells.slice(0, 2).map(cellText).join(' '))) { totals = stats; continue; }
        if (/^\s*(tm|team)\b/i.test(lead)) continue;
        let uni = hm.map.uni != null && cells[hm.map.uni] ? cellText(cells[hm.map.uni]) : null;
        if (!uni || !/^\d{1,2}$/.test(uni)) { const c = cells.find((x) => /^\d{1,2}$/.test(cellText(x))); uni = c ? cellText(c) : null; }
        const nameCell = hm.map.name != null ? cells[hm.map.name] : cells.find((x) => /[A-Za-z]{2}/.test(cellText(x)));
        if (!uni || !nameCell) continue;
        const nm = splitName(cellText(nameCell));
        if (!nm.last) continue;
        players.push({ uni, first: nm.first, last: nm.last, ...stats });
      }
      if (!players.length) continue;
      let side = null;
      for (const b of bits) {
        const h = (title && mentions(b, title.home.code)) || mentions(b, names.home);
        const v = (title && mentions(b, title.vis.code)) || mentions(b, names.vis);
        if (h && !v) { side = 'home'; break; }
        if (v && !h) { side = 'vis'; break; }
      }
      found.push({ table, side, players, totals, headers: Object.keys(hm.map), ctx: bits.join(' | ').slice(0, 140) });
    }
    const unassigned = found.filter((f) => !f.side);
    if (unassigned.length) {
      const taken = new Set(found.map((f) => f.side).filter(Boolean));
      const order = ['vis', 'home'].filter((s) => !taken.has(s));
      unassigned.forEach((f, i) => { f.side = order[i] || null; });
    }
    return found;
  }

  function readSetsWon(title) {
    if (!title) return null;
    for (const table of document.querySelectorAll('table')) {
      if (ours(table)) continue;
      const head = table.rows[0] ? expandRow(table.rows[0]).map(cellText) : [];
      if (!(head.includes('1') && head.includes('2') && head.includes('3'))) continue;
      const setCols = head.map((h, i) => (/^[1-5]$/.test(h) ? i : -1)).filter((i) => i >= 0);
      const body = [...table.rows].slice(1, 3).map((tr) => expandRow(tr));
      if (body.length !== 2) continue;
      const is = (code, r) => code && new RegExp('\\b' + escRe(code) + '\\b', 'i').test(cellText(r[0]));
      const sides = body.map((r) => (is(title.home.code, r) ? 'home' : is(title.vis.code, r) ? 'vis' : null));
      if (!sides[0] || !sides[1] || sides[0] === sides[1]) continue;
      const won = { vis: 0, home: 0 };
      const current = title.set || 99;
      for (const ci of setCols) {
        if (!title.final && +head[ci] >= current) continue;
        const a = parseInt(cellText(body[0][ci]), 10), b = parseInt(cellText(body[1][ci]), 10);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
        won[a > b ? sides[0] : sides[1]] += 1;
      }
      return won;
    }
    return null;
  }

  // ---------------------------------------------------------- play lines

  const ACTION = /\b(kill|ace|block|dig|attack error|service error|serve|assist|point|wins|timeout|time-out|challenge|review|substitution|subs?:|card|penalty)\b/i;
  const ALERT = /\b(time[- ]?out|challenge|video review|red card|yellow card|penalty|sanction)\b/i;
  const seen = new Set();
  const statTables = new WeakSet();
  const lineLog = [];
  let lineSeq = 0, rosterWords = [], primed = false;

  function playLike(text) {
    if (text.length < 8 || text.length > 240) return false;
    if (ALERT.test(text)) return true;
    if (!ACTION.test(text)) return false;
    const low = text.toLowerCase();
    return rosterWords.some((w) => low.includes(w));
  }
  function lineFrom(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || ours(el)) return null;
    const tbl = el.closest('table');
    if (tbl && statTables.has(tbl)) return null;
    // A play sentence may be split across inline tags: climb a few levels for the whole line.
    for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 240) return null;
      if (text && playLike(text)) return text;
    }
    return null;
  }
  // A few lines at once = new plays (repeats allowed: back-to-back aces read the same).
  // Many at once = the page redrew its list, so only never-seen lines count.
  function recordBatch(texts) {
    const uniq = [...new Set(texts)];
    const fresh = uniq.length > 3 ? uniq.filter((t) => !seen.has(t)) : uniq;
    const now = Date.now();
    for (const t of fresh) {
      const last = lineLog[lineLog.length - 1];
      if (last && last.text === t && now - last.at < 3000) continue;
      lineLog.push({ id: ++lineSeq, text: t, at: now });
    }
    uniq.forEach((t) => seen.add(t));
    if (lineLog.length > 60) lineLog.splice(0, lineLog.length - 60);
  }
  function prime() {
    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length) continue;
      const t = lineFrom(el);
      if (t) seen.add(t);
    }
    primed = true;
  }

  // ---------------------------------------------------------- reading a snapshot

  let trackedSets = { vis: 0, home: 0 }, lastTitle = null;
  const diag = { version: VERSION, eventId, notes: [] };

  function snapshotFromPage() {
    const title = parseTitle(document.title);
    const names = teamNames();
    const tables = readTables(title, names);
    tables.forEach((t) => statTables.add(t.table));
    diag.title = document.title;
    diag.parsedTitle = title;
    diag.names = names;
    diag.tables = tables.map((t) => ({ side: t.side, players: t.players.length, totals: !!t.totals, headers: t.headers.join(' '), context: t.ctx }));
    if (!title) return { error: 'Waiting for the score in the tab title (accept the terms on the stats page if you haven’t).' };
    if (!tables.some((t) => t.side === 'vis') || !tables.some((t) => t.side === 'home')) {
      const bb = [...document.querySelectorAll('table')].some(looksBasketball);
      return { error: bb ? 'This looks like a basketball page. Basketball support comes next.'
        : 'Waiting for both teams’ box-score tables. Switch the stats page to its box score view.' };
    }
    if (lastTitle && title.set && lastTitle.set && title.set > lastTitle.set) {
      trackedSets[lastTitle.home.score > lastTitle.vis.score ? 'home' : 'vis'] += 1;
    }
    lastTitle = title;
    const sw = readSetsWon(title) || trackedSets;
    const merge = (side) => {
      const map = new Map(); let totals = null;
      for (const t of tables.filter((x) => x.side === side)) {
        for (const p of t.players) map.set(p.uni, { ...(map.get(p.uni) || {}), ...p });
        if (t.totals) totals = t.totals;
      }
      return { code: title[side].code, name: (side === 'home' ? names.home : names.vis) || title[side].code, players: [...map.values()], totals };
    };
    rosterWords = tables.flatMap((t) => t.players.map((p) => p.last.toLowerCase())).filter((w) => w.length > 2);
    return {
      sport: 'vb', status: title.final ? 'final' : (title.set || 0) === 0 ? 'pre' : 'live', set: title.set || 1,
      score: { home: title.home.score, away: title.vis.score },
      setsWon: { home: sw.home || 0, away: sw.vis || 0 },
      teams: { home: merge('home'), away: merge('vis') },
    };
  }

  // ---------------------------------------------------------- dock (small bar, bottom-right)

  const dockHost = document.createElement('div');
  dockHost.id = 'spb-dock';
  dockHost.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483646;';
  document.documentElement.appendChild(dockHost);
  const dock = dockHost.attachShadow({ mode: 'open' });
  dock.innerHTML = `<div class="d" role="status"><span class="dot" id="dot"></span><span class="t" id="dt"><b>Pop board</b> · starting…</span>
    <button class="primary" id="openwin">Open board</button><button id="here">Show here</button><button class="x" id="min" title="Shrink this bar" aria-label="Shrink">–</button></div>`;
  applyStyles(dock, `
    .d { display:flex; align-items:center; gap:8px; background:#161c22; color:#edf1f4; border:1px solid #29323c; border-radius:8px; padding:6px 6px 6px 10px; font:500 13px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.35); max-width:min(620px, calc(100vw - 24px)); }
    .dot { width:9px; height:9px; border-radius:50%; flex:none; background:#f3a93c; }
    .dot.ok { background:#3ccf7a; } .dot.err { background:#ff4b3e; }
    .t { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .t b { font-weight:700; letter-spacing:.04em; }
    button { font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif; border-radius:6px; border:1px solid #3a4652; background:#1c242c; color:#edf1f4; padding:5px 10px; cursor:pointer; white-space:nowrap; }
    button.primary { background:#ff4b3e; border-color:#ff4b3e; color:#fff; }
    button:focus-visible { outline:2px solid #6fb4ff; outline-offset:2px; }
    .x { background:none; border:0; color:#a5b1bc; padding:4px 7px; }
    .d.small .t, .d.small #openwin, .d.small #here { display:none; }`);
  const D = (id) => dock.getElementById(id);
  D('min').addEventListener('click', () => {
    const small = D('dot').parentElement.classList.toggle('small');
    D('min').textContent = small ? 'Pop board' : '–';
  });

  // ---------------------------------------------------------- in-tab board (fallback)

  let host = null, shadow = null, board = null, inTabView = null, swapped = !!store.get('swap', false);
  let eng = PE.create(), engLineId = 0, lastHash = '', lastChange = Date.now();
  eng.setHidden(store.get('hidden:' + eventId, []));
  const saveHidden = () => store.set('hidden:' + eventId, eng.hiddenKeys);
  const overlayOpen = () => !!host && host.style.display !== 'none';

  function buildOverlay() {
    if (host) return;
    const fl = document.createElement('link');
    fl.rel = 'stylesheet'; fl.href = SPB.fontsHref;
    document.head.appendChild(fl);
    host = document.createElement('div');
    host.id = 'spb-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `${SPB.cssHref ? `<link rel="stylesheet" href="${SPB.cssHref}">` : ''}<div class="spb-root"><div class="app">
      <header class="bar">
        <div class="brand"><b>Stat Pop Board</b><span class="mode live">Live</span></div>
        <span class="matchline" id="status">Reading this page…</span>
        <div class="transport">
          <button class="tbtn" id="swap">Swap sides</button>
          <button class="tbtn" id="close">Back to stats page</button>
        </div>
      </header>
      <div id="board"></div></div></div>`;
    applyStyles(shadow, '[hidden]{display:none!important}.spb-root{height:100%;overflow:auto;background:var(--ground,#0f1317);color:var(--ink,#edf1f4);font-family:var(--font-body,system-ui,sans-serif);font-size:15px;line-height:1.35}');
    const $ = (id) => shadow.getElementById(id);
    $('close').addEventListener('click', () => setOpen(false));
    $('swap').addEventListener('click', () => { swapped = !swapped; store.set('swap', swapped); resetEngine(); tick(true); });
    board = BV.mountBoard($('board'), {
      pass: (k) => { eng.pass(k); board.render(eng.view()); },
      hold: (k) => { eng.toggleHold(k); board.render(eng.view()); },
      hide: (k) => { eng.hide(k); saveHidden(); board.render(eng.view()); },
      unhide: (k) => { eng.unhide(k); saveHidden(); board.render(eng.view()); },
    });
  }
  function setOpen(open) {
    if (open) buildOverlay();
    if (host) host.style.display = open ? '' : 'none';
    store.set('mode', open ? 'here' : null);
    D('here').textContent = open ? 'Hide board' : 'Show here';
    if (open && inTabView) board.render(inTabView);
  }
  function resetEngine() {
    eng = PE.create(); eng.setHidden(store.get('hidden:' + eventId, [])); lastHash = ''; engLineId = lineSeq;
  }
  D('here').addEventListener('click', () => setOpen(!overlayOpen()));
  document.addEventListener('keydown', (e) => {
    if (e.key === '`' && !(e.target.closest && e.target.closest('input, textarea, select'))) setOpen(!overlayOpen());
  });

  // ---------------------------------------------------------- link to the board window

  let boardWin = null, lastAckAt = 0, sendSeq = 0, lastSentAt = 0, lastSentHash = '', bridgeNote = '';
  const linked = () => Date.now() - lastAckAt < 8000;
  const target = () => {
    if (!BOARD_ORIGIN) return null;
    if (boardWin && !boardWin.closed) return boardWin;
    if (window.opener && !window.opener.closed) return window.opener; // the board may have opened this tab
    return null;
  };

  function openBoard() {
    if (!BOARD_ORIGIN) { bridgeNote = 'board address unknown; start the reader from the setup page'; updateDock(); return; }
    const t = target();
    if (t && linked()) { try { t.focus(); } catch (e) { /* focus is best effort */ } send(true); return; }
    const w = window.open(BOARD_ORIGIN + '/?from=stats', 'stat-pop-board', 'popup,width=1440,height=900');
    if (!w) { bridgeNote = 'pop-up blocked: allow pop-ups for this site, then click Open board'; updateDock(); return; }
    boardWin = w;
    bridgeNote = 'opening board…';
    updateDock();
    setTimeout(() => {
      if (!linked()) { bridgeNote = w.closed ? 'this page blocked the board link; use Show here' : 'board hasn’t answered yet'; updateDock(); }
    }, 6000);
  }
  D('openwin').addEventListener('click', openBoard);

  window.addEventListener('message', (e) => {
    if (!BOARD_ORIGIN || e.origin !== BOARD_ORIGIN) return;
    const d = e.data;
    if (!d || d.spb !== 1) return;
    if (d.type === 'hello' || d.type === 'ack') {
      const was = linked();
      boardWin = e.source; lastAckAt = Date.now(); bridgeNote = '';
      if (d.type === 'hello') send(true);
      if (!was) updateDock();
    }
  });

  let state = { ok: false, kind: 'wait', error: 'Starting…', raw: null };
  function diagSummary() {
    return { version: VERSION, eventId, url: location.href.split('#')[0], title: diag.title, parsedTitle: diag.parsedTitle,
      names: diag.names, tables: diag.tables, error: state.error, linesCaptured: lineSeq };
  }
  function send(force) {
    const t = target();
    if (!t) return;
    const h = JSON.stringify([state.raw, lineSeq, state.error]);
    if (!force && h === lastSentHash && Date.now() - lastSentAt < 2000) return;
    const msg = { spb: 1, type: 'state', v: VERSION, inst: INSTANCE, eventId, seq: ++sendSeq, sentAt: Date.now(),
      ok: state.ok, kind: state.kind, error: state.error, snap: state.raw, lines: lineLog.slice(-12), diag: diagSummary() };
    try { t.postMessage(msg, BOARD_ORIGIN); lastSentAt = Date.now(); lastSentHash = h; } catch (e) { bridgeNote = 'could not reach the board: ' + e.message; }
  }

  function updateDock() {
    const dot = D('dot');
    dot.className = 'dot ' + (state.ok ? 'ok' : state.kind === 'err' ? 'err' : '');
    let text;
    if (state.ok) {
      const s = state.raw;
      text = `reading ${s.teams.home.players.length} + ${s.teams.away.players.length} players`;
    } else text = state.error;
    const link = linked() ? ' · board linked' : bridgeNote ? ' · ' + bridgeNote : '';
    D('dt').innerHTML = '';
    const b = document.createElement('b'); b.textContent = 'Pop board';
    D('dt').append(b, ' · ' + text + link);
    D('dt').title = text + link;
    D('openwin').textContent = linked() ? 'Board linked' : 'Open board';
  }

  // ---------------------------------------------------------- loop

  let autoOpened = false;
  function tick(force) {
    let snap;
    try { snap = snapshotFromPage(); } catch (e) { snap = { error: 'Reader error: ' + e.message, crash: true }; }
    if (snap.error) {
      state = { ok: false, kind: snap.crash ? 'err' : 'wait', error: snap.error, raw: null };
    } else {
      state = { ok: true, kind: 'ok', error: null, raw: snap };
      if (!primed) prime();
      if (!autoOpened) { autoOpened = true; if (store.get('mode') === 'here') setOpen(true); }
      const fresh = lineLog.filter((l) => l.id > engLineId);
      engLineId = lineSeq;
      const hash = JSON.stringify([snap.set, snap.score, snap.setsWon, snap.teams.home.players, snap.teams.away.players]);
      if (force || hash !== lastHash || fresh.length) {
        lastHash = hash; lastChange = Date.now();
        inTabView = eng.update(PE.swapSides(snap, swapped), fresh.map((l) => l.text).slice(-3));
        if (overlayOpen()) board.render(inTabView);
      } else if (eng.expireHolds()) {
        inTabView = eng.view();
        if (overlayOpen()) board.render(inTabView);
      }
      if (overlayOpen()) {
        const age = Math.round((Date.now() - lastChange) / 1000);
        shadow.getElementById('status').textContent = `Reading this page · last change ${age}s ago`;
      }
    }
    updateDock();
    send(false);
  }

  let debounce = null;
  new MutationObserver((muts) => {
    if (primed) {
      const texts = [];
      for (const m of muts) {
        if (m.type === 'characterData') { const t = lineFrom(m.target); if (t) texts.push(t); }
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) { const t = lineFrom(n); if (t) texts.push(t); }
          else if (n.nodeType === 1 && !ours(n) && n.id !== 'spb-host' && n.id !== 'spb-dock') {
            const leaves = n.children.length ? n.querySelectorAll('*') : [n];
            for (const leaf of leaves) { if (leaf.children.length) continue; const t = lineFrom(leaf); if (t) texts.push(t); }
          }
        }
      }
      if (texts.length) recordBatch(texts);
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => tick(false), 250);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });

  // If the board opened this tab, say hello so it knows the reader is running.
  if (BOARD_ORIGIN && window.opener) {
    try { window.opener.postMessage({ spb: 1, type: 'reader-hello', inst: INSTANCE }, BOARD_ORIGIN); } catch (e) { /* opener is another site */ }
  }
  setInterval(() => tick(false), 2000);
  tick(true);
  return { show() { dockHost.style.display = ''; D('dot').parentElement.classList.remove('small'); D('min').textContent = '–'; } };
}
