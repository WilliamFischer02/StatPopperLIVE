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

  function mountBoard(host, handlers) {
    handlers = handlers || {};
    let tab = 'plays';
    let lastView = null;
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

    function partsHTML(parts) {
      return parts.map((p) => `<span class="pv"><span class="v">${esc(p.v)}</span><span class="l">${esc(p.l)}</span></span>`).join('');
    }

    const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    function playerCard(c) {
      const live = c.tag && c.tag.kind === 'live';
      const tag = c.tag ? (live ? `<span class="livedot">${esc(c.tag.text)}</span>` : `<span class="tag-serve">${esc(c.tag.text)}</span>`) : '';
      const reason = c.reason ? `<span>${esc(c.reason)}</span>` : '';
      const star = c.starred ? '<span class="impact">★ Impact</span>' : '';
      const held = c.held ? `<span class="held">Pinned · until ${esc(clockTime(c.held.until))}</span>` : '';
      const starBtn = handlers.star
        ? `<button class="abtn star${c.starred ? ' on' : ''}" data-act="star" data-key="${esc(c.key)}" aria-pressed="${c.starred}" title="${c.starred ? 'Remove from impact players' : 'Make an impact player'}" aria-label="Impact player">★</button>` : '';
      const pinBtn = handlers.hold
        ? `<button class="abtn pin${c.held ? ' on' : ''}" data-act="hold" data-key="${esc(c.key)}" aria-pressed="${!!c.held}" title="${c.held ? 'Let this card go' : 'Keep this card on the board for 10 minutes'}">${c.held ? 'Unpin' : 'Pin'}</button>` : '';
      const pops = c.pops.length
        ? c.pops.map((p) => `<li class="pop${p.best ? ' best' : ''}${p.live ? ' live' : ''}${p.dim ? ' dim' : ''}"><span class="pname">${esc(p.name)}</span><span class="pvals">${partsHTML(p.parts)}</span></li>`).join('')
        : '<li class="pop none">No stats yet</li>';
      return `<article class="pcard${live ? ' is-live' : ''}${c.isNew ? ' is-new' : ''}${c.starred ? ' is-star' : ''}${c.held ? ' is-held' : ''}${c.dim ? ' is-dim' : ''}" data-key="${esc(c.key)}">
        <div class="phead">
          <div class="jersey" aria-label="Number ${esc(c.uni)}">${esc(c.uni)}</div>
          <div class="who"><div class="last">${esc(c.last)}</div><div class="meta"><span>${esc(c.first)}</span>${held}${star}${tag}${reason}</div></div>
          <div class="acts">${pinBtn}${starBtn}
            <button class="abtn" data-act="pass" data-key="${esc(c.key)}" title="Skip this player for the next 10 rallies">Pass</button>
            <button class="abtn" data-act="hide" data-key="${esc(c.key)}" title="Hide this player for the rest of the match">Hide</button>
          </div>
        </div>
        <ol class="pops">${pops}</ol>
      </article>`;
    }

    function drawPlayers(v, side) {
      const t = v.teams[side];
      const cards = v.playerCards[side];
      const empty = cards.length < 3
        ? `<div class="empty">${cards.length ? 'No other' : 'No'} ${esc(t.code)} player has a stat yet.</div>` : '';
      regions[side].innerHTML = `<div class="eyebrow">${swatch(side, t.code)}${esc(t.name || t.code)} players</div>
        <div class="pstack">${cards.map(playerCard).join('')}${empty}</div>`;
    }

    function drawTeam(v) {
      const col = (side) => {
        const t = v.teams[side];
        const cards = v.teamCards[side];
        const body = cards.length
          ? cards.map((c) => `<div class="tcard${c.live ? ' is-live' : ''}${c.dim ? ' is-dim' : ''}"><div class="big">${esc(c.big)}</div><div class="sub">${c.live ? '<span class="livedot">Live</span> ' : ''}${esc(c.sub || '')}</div></div>`).join('')
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
      const serveLine = sv ? `<span class="ball" style="background:var(--${sv.side})"></span>${esc(v.teams[sv.side].code)} serving${sv.last ? ` · <b>#${esc(sv.uni)} ${esc(sv.last)}</b>${sv.predicted ? ' (next up)' : ''}` : ''}${sv.streak >= 2 ? ` · ${sv.streak} straight` : ''}` : '';
      const alerts = v.alerts.map((a) => `<div class="alert ${a.sev}" role="status"><strong>${esc(a.text)}</strong>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}</div>`).join('');
      const plays = v.plays;
      const lastPlay = plays.find((p) => !p.alert) || plays[0];
      const sc = (p) => (p.score ? `${p.score.home}–${p.score.away}` : '');
      const playsPanel = `<p class="lastplay">${lastPlay ? esc(lastPlay.text) : 'Waiting for the first play.'}</p>
        <ul class="recent">${plays.filter((p) => p !== lastPlay).slice(0, 3).map((p) => `<li class="${p.alert ? 'is-alert' : ''}"><span class="sc">${sc(p)}</span><span>${esc(p.text)}</span></li>`).join('')}</ul>`;
      const rotPanel = `<div class="courts">${court(v, 'home')}${court(v, 'away')}</div>
        <p class="note">Built from the serve order. A serving sub shows in her slot; liberos aren't tracked.</p>`;
      const status = v.status === 'final' ? 'Final' : v.status === 'pre' ? 'Pregame' : `Set ${v.set}`;
      regions.game.innerHTML = `<div class="eyebrow">Game</div>
        <div class="scoreline">
          <div class="sl-team home"><span class="sl-code">${esc(v.teams.home.code)}</span><span class="sl-sets" title="Sets won">${v.setsWon.home}</span></div>
          <div class="sl-pts">${v.score.home}–${v.score.away}<small>${status}</small></div>
          <div class="sl-team away"><span class="sl-sets" title="Sets won">${v.setsWon.away}</span><span class="sl-code">${esc(v.teams.away.code)}</span></div>
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
        drawGame(v); drawTeam(v); drawPlayers(v, 'home'); drawPlayers(v, 'away'); drawFoot(v);
      },
      setColors,
    };
  }

  root.BoardView = { mountBoard, esc };
})(typeof globalThis !== 'undefined' ? globalThis : this);
