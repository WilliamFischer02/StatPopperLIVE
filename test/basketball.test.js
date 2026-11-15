// Run the engine through the made-up basketball game (src/bb-sim.js), in halves and in quarters,
// print a few moments, and check the board rules for basketball.
const assert = require('assert');
const { create, basketball: BB, buildNameIndex } = require('../src/engine.js');
const { createGame } = require('../src/bb-sim.js');
const { createReplay } = require('../src/replay.js');
const fs = require('fs');
const path = require('path');

function show(v, title) {
  console.log(`\n=== ${title} | ${v.period.label}${v.period.clock ? ' ' + v.period.clock : ''} | ${v.info}`);
  for (const a of v.alerts) console.log('  ALERT', a.sev, a.text, a.sub || '');
  for (const side of ['home', 'away']) {
    console.log(`  ${v.teams[side].code} (${v.fouls[side].n} fouls${v.fouls[side].bonus ? ', ' + v.fouls[side].bonus : ''}) team: ` + v.teamCards[side].map((c) => `[${c.dim ? '~' : ''}${c.big} | ${c.sub}]`).join(' '));
    for (const c of v.playerCards[side]) {
      console.log(`    ${c.dim ? '~' : ''}#${c.uni} ${c.last} ${c.tag ? '<' + c.tag.text + '> ' : ''}${c.reason ? '(' + c.reason + ') ' : ''}:: `
        + c.pops.map((p) => `${p.live ? '*' : ''}${p.dim ? '~' : ''}${p.name}: ${p.parts.map((x) => x.v + ' ' + x.l).join(' ')}`).join(' || '));
    }
  }
}

const POP_NAMES = new Set(BB.POPS.map((p) => p.name));
for (const periods of [2, 4]) {
  const g = createGame({ periods });
  const eng = create({ now: () => 0 });
  const labels = new Set(), alertKinds = new Set();
  let churn = 0, prev = null, sawRun = false, sawLive = false, sawBonus = false, sawHot = false, maxMs = 0;
  for (let n = 0; n <= g.total; n++) {
    const snap = g.snapshot(n);
    const before = prev;
    const t0 = process.hrtime.bigint();
    const v = eng.update(snap, g.linesAt(n));
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
    assert.strictEqual(v.sport, 'bb');
    labels.add(v.period.label);
    v.alerts.forEach((a) => alertKinds.add(a.kind));
    if (n % 45 === 20 || n === g.total) show(v, `${periods === 4 ? 'Quarters' : 'Halves'}, step ${n}`);
    for (const side of ['home', 'away']) {
      const cards = v.playerCards[side];
      if (snap.status === 'pre') {
        assert.strictEqual(cards.length, 3, `step ${n} ${side}: preview cards`);
        assert.ok(cards.every((c) => c.dim && c.pops.length === 0), `step ${n}: preview cards are greyed and empty`);
      } else {
        const active = snap.teams[side].players.filter((p) => p.pts + p.reb + p.ast + p.stl + p.blk > 0).length;
        assert.strictEqual(cards.length, Math.min(3, active), `step ${n} ${side}: ${cards.length} cards, ${active} players with a stat`);
        for (const c of cards) {
          assert.ok(c.pops.length >= 1 && c.pops.length <= 3, `step ${n} ${c.last}: ${c.pops.length} options`);
          for (const p of c.pops) assert.ok(POP_NAMES.has(p.name), `step ${n}: "${p.name}" is a basketball pop`);
        }
      }
      for (const c of cards) if (c.dim) assert.ok(!c.held && !(c.tag && c.tag.kind === 'live'), `step ${n} ${c.last}: greyed card is live`);
      if (cards.some((c) => c.tag && c.tag.kind === 'live')) sawLive = true;
      if (cards.some((c) => c.tag && /straight .* points/.test(c.tag.text)) || cards.some((c) => /straight .* points/.test(c.reason || ''))) sawHot = true;
      const tc = v.teamCards[side];
      assert.ok(tc.length <= 5, `step ${n} ${side}: ${tc.length} team lines`);
      if (n > 15) assert.ok(tc.length >= 3, `step ${n} ${side}: ${tc.length} team lines`);
      const firstDim = tc.findIndex((c) => c.dim);
      if (firstDim >= 0) assert.ok(tc.slice(firstDim).every((c) => c.dim), `step ${n} ${side}: filler above a notable team line`);
      if (tc.some((c) => /Run$/.test(c.big))) sawRun = true;
      if (tc.some((c) => /^In the (Double )?Bonus/.test(c.big))) sawBonus = true;
      const list = v.players[side];
      assert.strictEqual(list.length, snap.teams[side].players.length, 'the list has every player');
      assert.ok(cards.every((c, i) => list[i] && list[i].key === c.key && list[i].top), `step ${n} ${side}: list leads with the cards`);
      assert.ok('pts' in list[0].stats && 'reb' in list[0].stats && /^\d+-\d+$/.test(list[0].stats.fg), 'list rows carry basketball stats');
      // The board holds still: at most one card changes per update per side.
      if (before && snap.status !== 'pre' && n > 12) {
        const changed = cards.filter((c) => !before[side].includes(c.key)).length;
        assert.ok(changed <= 1, `step ${n} ${side}: ${changed} cards changed in one update`);
      }
    }
    const keys = { home: v.playerCards.home.map((c) => c.key), away: v.playerCards.away.map((c) => c.key) };
    if (prev && JSON.stringify(keys) !== JSON.stringify(prev)) churn++;
    prev = keys;
    // Team fouls reset each half or quarter, and the box in the score line shows this period's count.
    assert.ok(v.fouls.home.exact && v.fouls.away.exact, 'fouls are exact when read from tip-off');
    const limit = periods === 4 ? 5 : 7;
    for (const side of ['home', 'away']) assert.strictEqual(!!v.fouls[side].bonus, v.fouls[side].n >= limit, `step ${n}: bonus at ${limit} team fouls (${v.fouls[side].n})`);
  }
  const want = periods === 4 ? ['Pregame', 'Q1', 'Q2', 'Halftime', 'Q3', 'Q4'] : ['Pregame', '1st Half', 'Halftime', '2nd Half'];
  for (const l of want) assert.ok(labels.has(l), `${periods} periods: saw "${l}" (${[...labels].join(', ')})`);
  assert.ok([...labels].some((l) => /^Final/.test(l)), 'saw Final');
  assert.ok(alertKinds.has('final') && alertKinds.has('break') && alertKinds.has('timeout'), `alerts seen: ${[...alertKinds].join(', ')}`);
  assert.ok(sawRun, 'a scoring run shows on a team card');
  assert.ok(sawLive, 'a player card goes live after a play');
  assert.ok(sawBonus, 'the bonus shows on a team card');
  if (periods === 2) assert.ok(alertKinds.has('foul'), 'foul trouble alert seen');
  console.log(`\n${periods} periods: ${g.total} steps, card set changed on ${churn}, slowest update ${maxMs.toFixed(2)} ms, hot hand seen: ${sawHot}`);
  assert.ok(churn < g.total * 0.6, `cards change on fewer than 60% of steps (${churn} of ${g.total})`);
}

const g = createGame({});
const mid = g.find((st) => st.period === 2 && st.clock < 900);

// The clock running by itself never moves a card or counts as a play.
{
  const e = create({ now: () => 0 });
  for (let n = 0; n <= mid; n++) e.update(g.snapshot(n), g.linesAt(n));
  const a = e.update(g.snapshot(mid), []);
  const key = a.playerCards.home[0].key;
  e.pass(key);
  const left = e.view().passed[0].rallies;
  const cardsBefore = JSON.stringify([e.view().playerCards, e.view().teamCards]);
  let v;
  for (const clock of ['14:50', '14:49', '14:48', '14:47']) v = e.update({ ...g.snapshot(mid), clock }, []);
  assert.strictEqual(v.period.clock, '14:47', 'the clock on the board follows the page');
  assert.strictEqual(JSON.stringify([v.playerCards, v.teamCards]), cardsBefore, 'a clock-only update leaves every card alone');
  assert.strictEqual(e.view().passed[0].rallies, left, 'a clock-only update is not a play');
  assert.strictEqual(left, 25, 'Pass skips a player for 25 plays');
}

// Without any play-by-play lines the board still reacts: the box-score change itself marks who just did something.
{
  const e = create({ now: () => 0 });
  let live = 0;
  for (let n = 0; n <= g.total; n++) {
    const v = e.update(g.snapshot(n), []);
    if (['home', 'away'].some((s) => v.playerCards[s].some((c) => c.tag && c.tag.kind === 'live'))) live++;
  }
  assert.ok(live > 20, `box-score changes alone make cards live (${live} steps)`);
}

// A reader that starts partway through a half cannot know that half's team fouls: no bonus is claimed.
{
  const e = create({ now: () => 0 });
  let v = e.update(g.snapshot(mid), []);
  assert.ok(!v.fouls.home.exact && !v.fouls.home.bonus && !v.teamCards.home.some((c) => /Bonus/.test(c.big)), 'no bonus from a mid-half start');
  for (let n = mid + 1; n <= g.total; n++) v = e.update(g.snapshot(n), g.linesAt(n));
  assert.ok(!v.fouls.home.exact, 'still whole-game fouls at the end');
}

// Late and close: the alert needs a clock, the last period and a one-possession margin.
{
  const e = create({ now: () => 0 });
  const s = g.snapshot(mid);
  e.update(s, []);
  let v = e.update({ ...s, clock: '1:12', score: { home: 70, away: 68 } }, []);
  assert.ok(v.alerts.some((a) => a.kind === 'close' && a.sev === 'crit' && /One-possession/.test(a.text)), 'one-possession alert in the last two minutes');
  v = e.update({ ...s, clock: '1:10', score: { home: 70, away: 62 } }, []);
  assert.ok(!v.alerts.some((a) => a.kind === 'close'), 'no alert at eight points');
  v = e.update({ ...s, clock: null, period: 0, score: { home: 70, away: 69 } }, []);
  assert.ok(!v.alerts.some((a) => a.kind === 'close') && v.period.clock === '', 'no clock, no late-game alert');
}

// Play lines, both wordings.
{
  const s = g.snapshot(mid);
  const idx = buildNameIndex(s);
  const eng = require('../src/engine.js');
  // namesIn and teamIn are the engine's own; reach them through a parse of a known line.
  const parse = (text) => {
    let out = null;
    const tools = { namesIn: (t, index) => index.filter((x) => x.pats.some((re) => re.test(t))).map((x) => ({ side: x.side, uni: x.uni })), teamIn: () => null };
    out = BB.parsePlay(text, s, idx, tools);
    return out;
  };
  void eng;
  const cases = [
    ['GOOD! 3 PTR by ALDER,JONAH', 'three', 'home:3', true],
    ['GOOD! DUNK by EVERLY,OWEN', 'dunk', 'home:32', true],
    ['MISSED JUMPER by BRANDT,MARCUS', 'miss', 'home:11', false],
    ['REBOUND (OFF) by CASTELLAN,ELI', 'oreb', 'home:21', true],
    ['STEAL by BRANDT,MARCUS', 'steal', 'home:11', true],
    ['GOOD! FT SHOT by ALDER,JONAH', 'ft', 'home:3', true],
    ['Theo Marsh made 3-pt. jump shot (assist by Cal Reyes)', 'three', 'away:1', true],
    ['Bo Tanager missed layup', 'miss', 'away:15', false],
    ['Defensive rebound by Rowan Whitlock', 'rebound', 'away:34', true],
    ['Block by Bo Tanager', 'block', 'away:15', true],
    ['Turnover by Cal Reyes', 'turnover', 'away:4', false],
    ['Foul on Ike Vance', 'foul', 'away:22', false],
  ];
  for (const [text, act, who, positive] of cases) {
    const p = parse(text);
    assert.strictEqual(p.act, act, text);
    assert.strictEqual(p.actor && p.actor.side + ':' + p.actor.uni, who, text);
    assert.strictEqual(p.positive, positive, text);
  }
  assert.strictEqual(parse('Theo Marsh made 3-pt. jump shot (assist by Cal Reyes)').assister.uni, '4', 'assist credited');
  assert.strictEqual(parse('TIMEOUT MEDIA').alert.kind, 'timeout');
  assert.strictEqual(parse('TIMEOUT 30sec by MSU').alert.kind, 'timeout');
  assert.strictEqual(parse('Technical foul on Ike Vance').alert.kind, 'penalty');
}

// Game time: from the clock when there is one, from the score when there is not.
{
  const base = { sport: 'bb', status: 'live', score: { home: 30, away: 30 }, periods: 2 };
  assert.strictEqual(BB.elapsed({ ...base, period: 1, clock: '12:00' }), 480);
  assert.strictEqual(BB.elapsed({ ...base, period: 2, clock: '5:30' }), 1200 + 870);
  assert.strictEqual(BB.elapsed({ ...base, periods: 4, period: 3, clock: '10:00' }), 1200);
  assert.strictEqual(BB.elapsed({ ...base, period: 3, clock: '2:00' }), 2400 + 180, 'overtime is five minutes');
  assert.strictEqual(BB.clockSecs('45.3'), 45);
  assert.strictEqual(BB.clockSecs(''), null);
  const est = BB.elapsed({ ...base, period: 0, clock: null });
  assert.ok(est > 900 && est < 1100, `no period or clock: estimated from the score (${est})`);
  assert.strictEqual(BB.periodLabel({ ...base, period: 1, intermission: true }), 'Halftime');
  assert.strictEqual(BB.periodLabel({ ...base, periods: 4, period: 2, intermission: true }), 'Halftime');
  assert.strictEqual(BB.periodLabel({ ...base, periods: 4, period: 3, intermission: true }), 'End of Q3');
  assert.strictEqual(BB.periodLabel({ ...base, period: 3 }), 'OT');
  assert.strictEqual(BB.periodLabel({ ...base, period: 4 }), '2OT');
  // Points are worked out from makes when the box has no points column.
  assert.strictEqual(BB.derive({ uni: '1', fgm: 5, tpm: 2, ftm: 3 }).pts, 15);
}

// Summary rows that slip past a reader never become cards.
{
  const e = create({ now: () => 0 });
  const s = g.snapshot(mid);
  const junk = (uni, last) => ({ uni, first: '', last, min: 0, fgm: 30, fga: 60, tpm: 9, tpa: 20, ftm: 12, fta: 15, oreb: 9, dreb: 25, reb: 34, ast: 18, stl: 7, blk: 4, to: 10, pf: 15, pts: 81 });
  s.teams.home = { ...s.teams.home, totals: null, players: s.teams.home.players.concat([junk('', 'TEAM'), junk('1', 'Totals'), junk('2', 'Game')]) };
  const v = e.update(s, []);
  const shown = v.playerCards.home.map((c) => c.last).concat(v.players.home.map((r) => r.last));
  assert.ok(!shown.some((x) => /^(team|totals|game)$/i.test(x)), 'summary rows are not players: ' + shown.join(','));
}

// One engine, two sports: the sport comes from the snapshot, and a change starts the board over.
{
  const rp = createReplay(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/replay-msu-idaho.json'))));
  const e = create({ now: () => 0 });
  let v = e.update(g.snapshot(mid), []);
  assert.strictEqual(v.sport, 'bb');
  assert.strictEqual(e.sport, 'bb');
  v = e.update(rp.snapshot(60), []);
  assert.strictEqual(v.sport, 'vb');
  assert.ok(v.rotation && v.playerCards.home.every((c) => c.pops.every((p) => !POP_NAMES.has(p.name) || ['Points', 'Assists', 'Blocks'].includes(p.name))), 'volleyball pops after the switch');
  v = e.update(g.snapshot(mid), []);
  assert.strictEqual(v.sport, 'bb');
  assert.ok(v.rotation === null && v.serving === null && v.leaders.home.length === 3, 'basketball view has leaders, no rotation or server');
}

console.log('\nAll basketball checks passed');
