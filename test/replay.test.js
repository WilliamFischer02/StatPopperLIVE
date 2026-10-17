// Run the engine through the whole Oct 1 match and print what it would surface.
const fs = require('fs');
const path = require('path');
const { create } = require('../src/engine.js');
const { createReplay } = require('../src/replay.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/replay-msu-idaho.json')));
const rp = createReplay(data);
const eng = create();

function show(view, title) {
  console.log('\n=== ' + title + ` (eff sets ${view.effSets})`);
  if (view.serving) console.log('  Serving:', view.serving.side, view.serving.last || '?', 'streak', view.serving.streak);
  for (const a of view.alerts) console.log('  ALERT', a.sev, a.text, a.sub || '');
  for (const side of ['home', 'away']) {
    const t = view.teams[side].code;
    console.log(`  ${t} team: ` + (view.teamCards[side].map((c) => `[${c.big} | ${c.sub}]`).join(' ') || '(none)'));
    for (const c of view.playerCards[side]) {
      const pops = c.pops.map((p) => `${p.live ? '*' : ''}${p.name}: ${p.parts.map((x) => x.v + ' ' + x.l).join(' / ')}`).join('  ||  ');
      console.log(`    #${c.uni} ${c.last} ${c.tag ? '<' + c.tag.text + '> ' : ''}${c.reason ? '(' + c.reason + ') ' : ''}impact ${c.impact}`);
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

let maxMs = 0;
for (let n = 0; n <= rp.total; n++) {
  const t0 = process.hrtime.bigint();
  const view = eng.update(rp.snapshot(n), rp.linesAt(n));
  maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
  if (checkpoints.has(n)) show(view, checkpoints.get(n));
}
console.log(`\nSlowest update: ${maxMs.toFixed(2)} ms`);
