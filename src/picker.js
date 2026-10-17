/*
 * Impact players: star store (per team, saved in this browser) and the roster
 * picker panel. MSU picks are saved under one key so they carry over to every
 * match; opponents are saved by their team code.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PE = () => root.PopEngine;

  function isMSU(team) {
    if (!team) return false;
    return /^(MSU|MTST|MONTST|MONT ST)$/i.test(String(team.code || '').trim()) || /montana st(\.|ate)/i.test(String(team.name || ''));
  }
  const teamKey = (team) => (isMSU(team) ? 'MSU' : String((team && (team.code || team.name)) || '?').trim().toUpperCase());

  function createStarStore(prefix) {
    const mem = {};
    const k = (tk) => (prefix || 'spb:stars:') + tk;
    return {
      get(tk) {
        try { const v = localStorage.getItem(k(tk)); if (v != null) return JSON.parse(v) || []; } catch (e) { /* storage blocked */ }
        return mem[tk] || [];
      },
      set(tk, list) {
        mem[tk] = list;
        try { localStorage.setItem(k(tk), JSON.stringify(list)); } catch (e) { /* kept in memory only */ }
      },
      has(tk, p) { return this.get(tk).some((st) => PE().matchesStar(p, st)); },
      toggle(tk, p) {
        const list = this.get(tk).slice();
        const i = list.findIndex((st) => PE().matchesStar(p, st));
        if (i >= 0) list.splice(i, 1);
        else list.push({ uni: String(p.uni), last: p.last || '', first: p.first || '' });
        this.set(tk, list);
        return list;
      },
    };
  }

  // Merge the live roster with a bundled one (adds positions and players the page hasn't listed yet).
  function mergeRoster(live, bundled) {
    const out = (live || []).map((p) => ({ uni: String(p.uni), last: p.last, first: p.first || '', pos: '' }));
    for (const b of bundled || []) {
      const hit = out.find((p) => PE().matchesStar(p, b));
      if (hit) { hit.pos = hit.pos || b.pos || ''; if (!hit.first) hit.first = b.first; }
      else out.push({ uni: String(b.uni), last: b.last, first: b.first, pos: b.pos || '', notListed: (live || []).length > 0 });
    }
    return out.sort((a, b) => (parseInt(a.uni, 10) || 0) - (parseInt(b.uni, 10) || 0));
  }

  function mountPicker(host, handlers) {
    let model = null;
    host.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b || !model) return;
      if (b.dataset.act === 'pk-toggle') {
        const col = model.cols[+b.dataset.col];
        const p = col.players[+b.dataset.i];
        if (p && handlers.toggle) handlers.toggle(col, p);
      } else if (b.dataset.act === 'pk-close' && handlers.close) handlers.close();
    });

    function colHTML(col, ci) {
      const chips = col.players.map((p, i) => {
        const on = col.starred(p);
        return `<button class="pk-chip${on ? ' on' : ''}${p.notListed ? ' faint' : ''}" data-act="pk-toggle" data-col="${ci}" data-i="${i}" aria-pressed="${on}" title="${p.notListed ? 'On the MSU roster but not listed on this stats page' : ''}">
          <span class="pk-star" aria-hidden="true">${on ? '★' : '☆'}</span><span class="pk-num">${esc(p.uni)}</span><span class="pk-name">${esc(p.last)}</span>${p.pos ? `<span class="pk-pos">${esc(p.pos)}</span>` : ''}</button>`;
      }).join('');
      const count = col.players.filter(col.starred).length;
      return `<div class="pk-col side-${col.side}">
        <div class="eyebrow"><span class="swatch"></span>${esc(col.title)}<span class="pk-count">${count ? count + ' starred' : ''}</span></div>
        ${col.players.length ? `<div class="pk-list">${chips}</div>` : `<p class="note">${esc(col.note || 'Roster appears once the stats page lists it.')}</p>`}
      </div>`;
    }

    return {
      render(m) {
        model = m;
        host.innerHTML = `<div class="picker">
          <div class="pk-head"><div><b>Impact players</b><p class="note">Star the players you build graphics for most. Each team with a star always keeps at least one starred player on the board. MSU picks carry over to every match.</p></div>
          <button class="tbtn" data-act="pk-close">Done</button></div>
          <div class="pk-cols">${m.cols.map(colHTML).join('')}</div></div>`;
      },
    };
  }

  root.ImpactPicker = { isMSU, teamKey, createStarStore, mergeRoster, mountPicker };
})(typeof globalThis !== 'undefined' ? globalThis : this);
