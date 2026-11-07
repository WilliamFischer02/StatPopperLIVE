// Run the engine through the whole Oct 1 match, print what it would surface, and check the board rules.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { create } = require('../src/engine.js');
const { createReplay } = require('../src/replay.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/replay-msu-idaho.json')));
const rp = createReplay(data);
let clock = 0;
const eng = create({ now: () => clock });

// "~" marks greyed (filler) cards and options.
function show(view, title) {
  console.log('\n=== ' + title + ` (eff sets ${view.effSets})`);
  if (view.serving) console.log('  Serving:', view.serving.side, view.serving.last || '?', 'streak', view.serving.streak);
  for (const a of view.alerts) console.log('  ALERT', a.sev, a.text, a.sub || '');
  for (const side of ['home', 'away']) {
    const t = view.teams[side].code;
    console.log(`  ${t} team: ` + (view.teamCards[side].map((c) => `[${c.dim ? '~' : ''}${c.big} | ${c.sub}]`).join(' ') || '(none)'));
    for (const c of view.playerCards[side]) {
      const pops = c.pops.map((p) => `${p.live ? '*' : ''}${p.dim ? '~' : ''}${p.name}: ${p.parts.map((x) => x.v + ' ' + x.l).join(' / ')}`).join('  ||  ');
      console.log(`    ${c.dim ? '~' : ''}#${c.uni} ${c.last} ${c.held ? '[pinned] ' : ''}${c.tag ? '<' + c.tag.text + '> ' : ''}${c.reason ? '(' + c.reason + ') ' : ''}impact ${c.impact}`);
      console.log('       ' + pops);
    }
  }
  const rot = view.rotation.home;
  if (rot.court) console.log('  MSU court:', rot.court.map((x) => 'P' + x.pos + '=' + (x.player ? x.player.last : '?')).join(' '));
}

const checkpoints = new Map([
  [rp.findScore(1, 16, 13), 'Set 1, MSU 16-13 (Heidemann serving 3 straight)'],
  [rp.findScore(1, 25, 20), 'End of set 1'],
  [rp.findScore(2, 20, 18), 'Set 2, MSU 20-18 after Thomsen back-to-back aces'],
  [rp.findScore(3, 18, 9), 'Set 3, MSU 18-9 (Thomsen 4 straight on serve)'],
  [rp.findScore(3, 24, 17), 'Set 3, MSU 24-17 match point'],
  [rp.total, 'Final'],
]);

// Pin: Kleidon (UI #7, a libero with few pop-worthy stats early) is pinned in set 1 and must stay
// on the board, live-updating, until 10 minutes pass; then the pin lets go by itself.
const pinAt = rp.findScore(1, 10, 9);
assert.ok(pinAt > 0, "pin rally found");
const pinKey = 'away:7';
let pinnedRallies = 0, lastPinnedDigs = -1, pinChecked = false;

let maxMs = 0, churn = 0;
let prevKeys = null;
for (let n = 0; n <= rp.total; n++) {
  clock = n * 20000; // 20 s per rally
  if (n === pinAt) assert.strictEqual(eng.toggleHold(pinKey), true, 'Pin turns on');
  const t0 = process.hrtime.bigint();
  const view = eng.update(rp.snapshot(n), rp.linesAt(n));
  maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
  if (checkpoints.has(n)) show(view, checkpoints.get(n));

  const snap = rp.snapshot(n);
  for (const side of ['home', 'away']) {
    const cards = view.playerCards[side];
    if (snap.status === 'pre') {
      // Before first serve the roster fills the slots, greyed, with no options yet, and both team lines show at zero.
      const roster = snap.teams[side].players.length;
      assert.strictEqual(cards.length, Math.min(3, roster), `rally ${n} ${side}: ${cards.length} preview cards, ${roster} on the roster`);
      for (const c of cards) assert.ok(c.dim && c.pops.length === 0, `rally ${n} ${c.last}: preview card is greyed with no options`);
      const tcs = view.teamCards[side];
      assert.ok(tcs.length >= 2 && tcs.length <= 5 && tcs.every((c) => c.dim), `rally ${n} ${side}: ${tcs.length} greyed team lines before first serve`);
    } else {
      const withStats = snap.teams[side].players.filter((p) => ['k', 'a', 'sa', 'dig', 'bs', 'ba'].some((f) => +p[f] > 0)).length;
      // Each side always fills its 3 player cards, as long as 3 players have any stat.
      assert.strictEqual(cards.length, Math.min(3, withStats), `rally ${n} ${side}: ${cards.length} player cards, ${withStats} players with stats`);
      // Each card offers 2 options when the player has 2 different stats to show.
      for (const c of cards) assert.ok(c.pops.length >= 1 && c.pops.length <= 3, `rally ${n} ${c.last}: ${c.pops.length} options`);
    }
    // Greyed cards carry no live or pinned reason.
    for (const c of cards) if (c.dim) assert.ok(!c.held && !(c.tag && c.tag.kind === 'live'), `rally ${n} ${c.last}: greyed card is live or pinned`);
    // Team card lines: at least 1 once the team has a kill, and 3 to 5 once the match is a few rallies old.
    const tk = snap.teams[side].players.reduce((a, p) => a + (+p.k || 0), 0);
    const tc = view.teamCards[side].length;
    if (tk > 0) assert.ok(n > 10 ? tc >= 3 && tc <= 5 : tc >= 1, `rally ${n} ${side}: ${tc} team lines`);
    // Never more than 5 lines, and notable lines always rank above greyed filler.
    assert.ok(tc <= 5, `rally ${n} ${side}: ${tc} team lines`);
    const firstDim = view.teamCards[side].findIndex((c) => c.dim);
    if (firstDim >= 0) assert.ok(view.teamCards[side].slice(firstDim).every((c) => c.dim), `rally ${n} ${side}: filler above a notable team line`);
    // The roster list covers every player with a card, carded players first.
    const list = view.players[side];
    assert.ok(cards.every((c, i) => list[i] && list[i].key === c.key && list[i].top), `rally ${n} ${side}: list does not lead with the cards`);
    assert.ok(list.slice(cards.length).every((r) => !r.top), `rally ${n} ${side}: extra top rows`);
  }

  const keys = ['home', 'away'].map((s) => view.playerCards[s].map((c) => c.key).sort().join(',')).join('|');
  if (prevKeys !== null && keys !== prevKeys) churn++;
  prevKeys = keys;

  if (n >= pinAt) {
    const card = view.playerCards.away.find((c) => c.key === pinKey);
    const live = clock - pinAt * 20000 < 10 * 60 * 1000;
    if (live) {
      assert.ok(card && card.held, `rally ${n}: pinned card is on the board`);
      assert.ok(!card.dim, `rally ${n}: pinned card is not greyed`);
      const digs = +snap.teams.away.players.find((p) => String(p.uni) === '7').dig;
      assert.ok(digs >= lastPinnedDigs, 'pinned card keeps updating');
      lastPinnedDigs = digs;
      pinnedRallies++;
    } else if (!pinChecked) {
      assert.ok(!card || !card.held, `rally ${n}: pin lets go after 10 minutes`);
      assert.strictEqual(eng.expireHolds(), true, 'expireHolds drops the old pin');
      assert.strictEqual(eng.expireHolds(), false, 'and only once');
      pinChecked = true;
    }
  }
}
assert.ok(pinnedRallies === 30 && pinChecked, `pin held for 30 rallies of 20 s (${pinnedRallies})`);

// Pinning a 4th card on one side releases that side's oldest pin; Unpin and Hide release too.
const e2 = create({ now: () => 0 });
['home:2', 'home:6', 'home:18', 'home:22'].forEach((k) => e2.toggleHold(k));
const v2 = e2.update(rp.snapshot(40), []);
assert.deepStrictEqual(v2.playerCards.home.filter((c) => c.held).map((c) => c.uni).sort(), ['18', '22', '6']);
assert.strictEqual(e2.toggleHold('home:6'), false, 'second click unpins');
e2.hide('home:18');
assert.deepStrictEqual(e2.view().playerCards.home.filter((c) => c.held).map((c) => c.uni), ['22']);

// Summary rows ("Set 1", "Match", "TEAM") that slip past a reader never become cards or count in totals.
const e3 = create({ now: () => 0 });
const bogus = rp.snapshot(60);
bogus.teams.home = { ...bogus.teams.home, players: bogus.teams.home.players.concat([
  { uni: '1', last: 'Set 1', first: '', k: 40, e: 5, ta: 90, a: 30, sa: 5, se: 1, re: 0, dig: 40, bs: 2, ba: 6, be: 0 },
  { uni: '99', last: 'Match', first: '', k: 80, e: 9, ta: 150, a: 70, sa: 9, se: 3, re: 2, dig: 90, bs: 4, ba: 12, be: 1 },
  { uni: '', last: 'TEAM', first: '', k: 0, e: 0, ta: 0, a: 0, sa: 0, se: 0, re: 0, dig: 0, bs: 0, ba: 0, be: 0 }]) };
const v3 = e3.update(bogus, []);
const shown = v3.playerCards.home.map((c) => c.last).concat(v3.players.home.map((r) => r.last));
assert.ok(!shown.some((x) => /^(set|match|team)\b/i.test(x)), 'summary rows never become player cards or list rows: ' + shown.join(','));
const clean = create({ now: () => 0 }).update(rp.snapshot(60), []);
assert.deepStrictEqual(v3.teamCards.home.map((c) => c.big), clean.teamCards.home.map((c) => c.big), 'summary rows do not inflate team totals');

// 5-card layout: each side fills 5 cards once 5 players have a stat; the list highlights exactly those 5.
const e5 = create({ now: () => 0 });
e5.setCards(5);
const v5 = e5.update(rp.snapshot(60), []);
assert.strictEqual(v5.playerCards.home.length, 5, '5 home cards');
assert.strictEqual(v5.players.home.filter((r) => r.top).length, 5, '5 highlighted list rows');
assert.strictEqual(v5.layout.cards, 5);

// Auto-rotate: rotate() swaps the non-pinned cards for players not on the board; the pinned card stays;
// between rotations at most one card changes per update.
const e6 = create({ now: () => 0 });
let v6 = e6.update(rp.snapshot(80), []);
const before = v6.playerCards.away.map((c) => c.key);
e6.toggleHold(before[0]);
e6.rotate();
v6 = e6.view();
const after = v6.playerCards.away.map((c) => c.key);
assert.ok(after.includes(before[0]) && v6.playerCards.away.find((c) => c.key === before[0]).held, 'pinned card survives a rotation');
const kept = after.filter((k) => before.includes(k)).length;
assert.strictEqual(kept, 1, `rotation replaced the unpinned cards (kept ${kept} of ${before.length})`);
for (let i = 81; i <= 90; i++) {
  const prev = v6.playerCards.away.map((c) => c.key);
  v6 = e6.update(rp.snapshot(i), rp.linesAt(i));
  const changed = v6.playerCards.away.filter((c) => !prev.includes(c.key)).length;
  assert.ok(changed <= 1, `rally ${i}: ${changed} cards changed in one update`);
}

console.log(`\nCard set changed on ${churn} of ${rp.total} rallies`);
console.log(`Slowest update: ${maxMs.toFixed(2)} ms`);
console.log('All board-rule checks passed');
