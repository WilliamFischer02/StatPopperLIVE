/*
 * BoardView: draws an engine view into a container (a page, or a shadow root
 * inside the StatBroadcast tab). No data logic here.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Jersey numbers sit on the team colour: dark ink on a light colour, white on a dark one.
  function inkFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return '#0c1014';
    const n = parseInt(m[1], 16);
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
    return lum > 0.179 ? '#0c1014' : '#ffffff';
  }

  // Stats the list layout can show, by engine field. The label is what the graphics software calls it.
  const LIST_STATS = [
    { id: 'k', label: 'Kills', l: 'K' }, { id: 'dig', label: 'Digs', l: 'DIG' }, { id: 'tb', label: 'Blocks', l: 'BLK' },
    { id: 'a', label: 'Assists', l: 'AST' }, { id: 'sa', label: 'Aces', l: 'ACE' }, { id: 'pts', label: 'Points', l: 'PTS' },
    { id: 'pct', label: 'Hit %', l: 'HIT' }, { id: 'ta', label: 'Attempts', l: 'TA' }, { id: 'e', label: 'Errors', l: 'E' },
  ];

  function mountBoard(host, handlers) {
    handlers = handlers || {};
    let tab = 'plays';
    let lastView = null;
    // Layout: 'cards' (3 or 5 per side, from the view) or 'list' (every player, two stats, top rows highlighted).
    let layout = 'cards', listStats = ['k', 'dig'];
    // Last value drawn for each stat on each card, so a number that just changed can flash.
    let lastVals = new Map(), lastAlertKey = '';
    host.innerHTML = `
      <div class="board">
        <section class="q q-game" aria-label="Game"></section>
        <section class="q q-team" aria-label="Team pops"></section>
        <section class="q q-home side-home" aria-label="Home players"></section>
        <section class="q q-away side-away" aria-label="Away players"></section>
      </div>
      <div class="foot"></div>
      <input type="color" class="colorpick" tabindex="-1" aria-hidden="true">`;
    const $ = (sel) => host.querySelector(sel);
    const regions = { game: $('.q-game'), team: $('.q-team'), home: $('.q-home'), away: $('.q-away'), foot: $('.foot') };
    // Team colours. A swatch is a button when the host can set colours; clicking it opens the browser's
    // colour picker. The input lives outside the regions, so a re-render never closes the picker mid-choice.
    const boardEl = $('.board'), colorInput = $('.colorpick');
    let colors = { home: null, away: null }, pickSide = null;
    const swatch = (side, code) => (handlers.color
      ? `<button type="button" class="swatch pick ${side}" data-act="color" data-side="${side}" title="Set the ${esc(code)} colour" aria-label="Set the ${esc(code)} team colour"></button>`
      : `<span class="swatch ${side}"></span>`);
    colorInput.addEventListener('input', () => { if (pickSide && handlers.color) handlers.color(pickSide, colorInput.value); });
    function setColors(c) {
      colors = { home: (c && c.home) || null, away: (c && c.away) || null };
      for (const side of ['home', 'away']) {
        const v = colors[side];
        if (v) { boardEl.style.setProperty('--' + side, v); boardEl.style.setProperty('--' + side + '-ink', inkFor(v)); }
        else { boardEl.style.removeProperty('--' + side); boardEl.style.removeProperty('--' + side + '-ink'); }
      }
    }

    host.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'tab') { tab = b.dataset.tab; if (lastView) drawGame(lastView); return; }
      if (act === 'color') {
        pickSide = b.dataset.side;
        colorInput.value = colors[pickSide] || getComputedStyle(boardEl).getPropertyValue('--' + pickSide).trim() || '#888888';
        colorInput.click();
        return;
      }
      if (handlers[act]) handlers[act](b.dataset.key);
    });

    // A value that changed since the last draw gets the .tick flash, so "12 K" becoming "13 K" is seen, not read.
    function partsHTML(parts, slot, vals) {
      return parts.map((p) => {
        const id = slot + '|' + p.l;
        const was = lastVals.get(id);
        vals.set(id, p.v);
        const tick = was !== undefined && was !== p.v ? ' tick' : '';
        return `<span class="pv${tick}"><span class="v">${esc(p.v)}</span><span class="l">${esc(p.l)}</span></span>`;
      }).join('');
    }

    const minsLeft = (ms) => Math.max(1, Math.round((ms - Date.now()) / 60000));

    function playerCard(c, vals) {
      const live = c.tag && c.tag.kind === 'live';
      const tag = c.tag ? (live ? `<span class="livedot">${esc(c.tag.text)}</span>` : `<span class="tag-serve">${esc(c.tag.text)}</span>`) : '';
      const reason = c.reason ? `<span>${esc(c.reason)}</span>` : '';
      const starBtn = handlers.star
        ? `<button class="abtn star${c.starred ? ' on' : ''}" data-act="star" data-key="${esc(c.key)}" aria-pressed="${c.starred}" title="${c.starred ? 'Remove from impact players' : 'Star as impact player'}" aria-label="Impact player">★</button>` : '';
      const pinBtn = handlers.hold
        ? `<button class="abtn pin${c.held ? ' on' : ''}" data-act="hold" data-key="${esc(c.key)}" aria-pressed="${!!c.held}" title="${c.held ? `Pinned for ${minsLeft(c.held.until)} min more · click to unpin` : 'Keep on the board for 10 min'}">${c.held ? '● Pinned' : 'Pin'}</button>` : '';
      const pops = c.pops.length
        ? c.pops.map((p) => `<li class="pop${p.best ? ' best' : ''}${p.live ? ' live' : ''}${p.dim ? ' dim' : ''}"><span class="pname">${esc(p.name)}</span><span class="pvals">${partsHTML(p.parts, c.key + '|' + p.id, vals)}</span></li>`).join('')
        : '<li class="pop none">No stats yet</li>';
      return `<article class="pcard${live ? ' is-live' : ''}${c.isNew ? ' is-new' : ''}${c.starred ? ' is-star' : ''}${c.held ? ' is-held' : ''}${c.dim ? ' is-dim' : ''}" data-key="${esc(c.key)}">
        <div class="phead">
          <div class="jersey" aria-label="Number ${esc(c.uni)}">${esc(c.uni)}</div>
          <div class="who"><div class="last">${esc(c.last)}</div><div class="meta">${tag}${reason}<span>${esc(c.first)}</span></div></div>
          <div class="acts">${pinBtn}${starBtn}
            <button class="abtn" data-act="pass" data-key="${esc(c.key)}" title="Skip this player for the next 10 rallies">Pass</button>
            <button class="abtn hide" data-act="hide" data-key="${esc(c.key)}" title="Hide this player for the rest of the match">Hide</button>
          </div>
        </div>
        <ol class="pops">${pops}</ol>
      </article>`;
    }

    // List layout: every player on the side, two chosen stats, the carded players highlighted on top.
    function playerList(v, side, vals) {
      const cols = listStats.map((id) => LIST_STATS.find((x) => x.id === id) || LIST_STATS[0]);
      const rows = v.players[side].map((r) => {
        const cells = cols.map((c) => {
          const id = r.key + '|list|' + c.id, val = r.stats[c.id];
          const was = lastVals.get(id); vals.set(id, val);
          return `<span class="pv${was !== undefined && was !== val ? ' tick' : ''}"><span class="v">${esc(val)}</span><span class="l">${esc(c.l)}</span></span>`;
        }).join('');
        const pinBtn = handlers.hold ? `<button class="abtn pin${r.held ? ' on' : ''}" data-act="hold" data-key="${esc(r.key)}" aria-pressed="${r.held}" title="${r.held ? 'Click to unpin' : 'Keep on the board for 10 min'}">${r.held ? '●' : 'Pin'}</button>` : '';
        return `<li class="prow${r.top ? ' is-top' : ''}${r.live ? ' is-live' : ''}${r.starred ? ' is-star' : ''}${r.held ? ' is-held' : ''}" data-key="${esc(r.key)}">
          <span class="jersey">${esc(r.uni)}</span><span class="last">${esc(r.last)}${r.starred ? ' <span class="impact">★</span>' : ''}</span>
          <span class="pvals">${cells}</span>${pinBtn}</li>`;
      }).join('');
      return `<ol class="plist">${rows || `<li class="empty">No ${esc(v.teams[side].code)} players listed yet.</li>`}</ol>`;
    }

    function drawPlayers(v, side, vals) {
      const t = v.teams[side];
      const cards = v.playerCards[side];
      const want = v.layout ? v.layout.cards : 3;
      let body;
      if (layout === 'list') body = playerList(v, side, vals);
      else {
        const empty = cards.length < want ? `<div class="empty">${cards.length ? 'No other' : 'No'} ${esc(t.code)} player has a stat yet.</div>` : '';
        body = `<div class="pstack">${cards.map((c) => playerCard(c, vals)).join('')}${empty}</div>`;
      }
      regions[side].innerHTML = `<div class="eyebrow">${swatch(side, t.code)}${esc(t.name || t.code)}</div>${body}`;
    }

    function drawTeam(v) {
      const col = (side) => {
        const t = v.teams[side];
        const lines = v.teamCards[side];
        const body = lines.length
          ? `<div class="tcard">${lines.map((c) => `<div class="tline${c.live ? ' is-live' : ''}${c.dim ? ' is-dim' : ''}"><div class="big">${esc(c.big)}</div><div class="sub">${c.live ? '<span class="livedot">Live</span> ' : ''}${esc(c.sub || '')}</div></div>`).join('')}</div>`
          : `<div class="empty">No ${esc(t.code)} team stats yet.</div>`;
        return `<div class="tcol side-${side}"><div class="eyebrow">${swatch(side, t.code)}${esc(t.code)}</div>${body}</div>`;
      };
      regions.team.innerHTML = `<div class="eyebrow">Team pops</div><div class="tcols">${col('home')}${col('away')}</div>`;
    }

    function court(v, side) {
      const r = v.rotation[side];
      const t = v.teams[side];
      if (!r.court) return `<div class="court"><h4>${swatch(side, t.code)}${esc(t.code)}</h4><p class="note">Fills in once ${esc(t.code)} serves.</p></div>`;
      const at = (pos) => r.court.find((x) => x.pos === pos);
      const cell = (pos) => {
        const x = at(pos);
        const srv = pos === 1 && r.serving;
        return `<div class="cell${srv ? ' srv' : ''}${x.player ? '' : ' unknown'}"><div class="pos">P${pos}${srv ? ' · serving' : ''}</div><div class="nm">${x.player ? '#' + esc(x.player.uni) + ' ' + esc(x.player.last) : '—'}</div></div>`;
      };
      return `<div class="court"><h4>${swatch(side, t.code)}${esc(t.code)}</h4>
        <div class="grid"><div class="net" aria-hidden="true"></div>${cell(4)}${cell(3)}${cell(2)}${cell(5)}${cell(6)}${cell(1)}</div></div>`;
    }

    function drawGame(v) {
      lastView = v;
      const sv = v.serving;
      const serveLine = sv ? `<span class="ball" style="background:var(--${sv.side})"></span>${esc(v.teams[sv.side].code)} serving${sv.last ? ` · <b>#${esc(sv.uni)} ${esc(sv.last)}</b>${sv.predicted ? ' · next' : ''}` : ''}${sv.streak >= 2 ? ` · ${sv.streak} straight` : ''}` : '';
      // An alert that just appeared (or changed) pulses once, so it registers while the eye is on the cards.
      const alertKey = v.alerts.map((a) => a.kind + a.text).join('|');
      const fresh = alertKey && alertKey !== lastAlertKey;
      lastAlertKey = alertKey;
      const alerts = v.alerts.map((a) => `<div class="alert ${a.sev}${fresh ? ' is-new' : ''}" role="status"><strong>${esc(a.text)}</strong>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}</div>`).join('');
      const plays = v.plays;
      const lastPlay = plays.find((p) => !p.alert) || plays[0];
      const sc = (p) => (p.score ? `${p.score.home}–${p.score.away}` : '');
      const playsPanel = `<p class="lastplay">${lastPlay ? esc(lastPlay.text) : 'No plays yet.'}</p>
        <ul class="recent">${plays.filter((p) => p !== lastPlay).slice(0, 3).map((p) => `<li class="${p.alert ? 'is-alert' : ''}"><span class="sc">${sc(p)}</span><span>${esc(p.text)}</span></li>`).join('')}</ul>`;
      const rotPanel = `<div class="courts">${court(v, 'home')}${court(v, 'away')}</div>
        <p class="note">From the serve order. Liberos not tracked.</p>`;
      const status = v.status === 'final' ? 'Final' : v.status === 'pre' ? 'Pregame' : `Set ${v.set}`;
      regions.game.innerHTML = `<div class="eyebrow">Game</div>
        <div class="scoreline">
          <div class="sl-team home"><span class="sl-code">${esc(v.teams.home.code)}</span><span class="sl-sets" title="Sets won">${v.setsWon.home}<small>sets</small></span></div>
          <div class="sl-pts">${v.score.home}–${v.score.away}<small>${status}</small></div>
          <div class="sl-team away"><span class="sl-sets" title="Sets won">${v.setsWon.away}<small>sets</small></span><span class="sl-code">${esc(v.teams.away.code)}</span></div>
        </div>
        <div class="serve">${serveLine}</div>
        ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-act="tab" data-tab="plays" aria-selected="${tab === 'plays'}">Last play</button>
          <button class="tab" role="tab" data-act="tab" data-tab="rot" aria-selected="${tab === 'rot'}">Rotation</button>
        </div>
        ${tab === 'plays' ? playsPanel : rotPanel}`;
    }

    function drawFoot(v) {
      const chips = v.hidden.map((h) => `<span class="chip">#${esc(h.uni)} ${esc(h.last)}<button data-act="unhide" data-key="${esc(h.key)}">Show</button></span>`).join('');
      regions.foot.innerHTML = (chips ? `<span>Hidden:</span>${chips}` : '') + (handlers.footNote ? `<span>${handlers.footNote}</span>` : '');
    }

    return {
      render(v) {
        if (!v) return;
        const vals = new Map();
        boardEl.classList.toggle('cards-5', layout !== 'list' && !!v.layout && v.layout.cards === 5);
        boardEl.classList.toggle('layout-list', layout === 'list');
        drawGame(v); drawTeam(v); drawPlayers(v, 'home', vals); drawPlayers(v, 'away', vals); drawFoot(v);
        lastVals = vals;
      },
      setColors,
      // layout: 'cards' or 'list'. stats: the two list-layout stat ids (see LIST_STATS).
      setLayout(l, stats) {
        layout = l === 'list' ? 'list' : 'cards';
        if (Array.isArray(stats) && stats.length === 2) listStats = stats.slice();
      },
      // Freshness: 'quiet' (no change for a while) or 'stale' (a long time) tints the board; '' clears it.
      setFreshness(f) { boardEl.classList.toggle('is-quiet', f === 'quiet'); boardEl.classList.toggle('is-stale', f === 'stale'); },
    };
  }

  root.BoardView = { mountBoard, esc, LIST_STATS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
