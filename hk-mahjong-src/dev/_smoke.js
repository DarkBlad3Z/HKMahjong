/* Throwaway smoke test for dev/mock-engine.js — not part of the manifest, delete when done iterating. */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'src/core/tiles.js'));
require(path.join(ROOT, 'src/core/rng.js'));
require(path.join(ROOT, 'dev/mock-engine.js'));
var HKMJ = globalThis.HKMJ;
var T = HKMJ.Tiles;

function playGames(n, seedBase) {
  var wins = 0, draws = 0, hands = 0, errors = [];
  for (var s = 0; s < n; s++) {
    var g = new HKMJ.Game({ seed: seedBase + s, names: ['You', 'Mei', 'Wing', 'Keung'], humans: [] });
    g.start();
    var guard = 0;
    while (true) {
      guard++;
      if (guard > 20000) { errors.push('seed ' + (seedBase + s) + ': stuck (guard hit)'); break; }
      var pending = g.getPending();
      if (pending.type === 'gameEnd') break;
      if (pending.type === 'handEnd') {
        hands++;
        if (pending.result.type === 'win') wins++; else draws++;
        var r = g.nextHand();
        if (!r.ok) { errors.push('seed ' + (seedBase + s) + ': nextHand failed ' + r.error); break; }
        continue;
      }
      if (pending.type === 'turn') {
        var view = g.getView(pending.player);
        var actions = g.getActions(pending.player);
        if (!actions.length) { errors.push('seed ' + (seedBase + s) + ': turn player has no actions'); break; }
        var act = HKMJ.AI.decide(view, actions, { level: 'normal' });
        var res = g.act(pending.player, act);
        if (!res.ok) { errors.push('seed ' + (seedBase + s) + ': act failed ' + res.error + ' action=' + JSON.stringify(act)); break; }
        continue;
      }
      if (pending.type === 'claim' || pending.type === 'robKong') {
        var waiting = pending.waiting.slice();
        var ok = true;
        waiting.forEach(function (p) {
          var v = g.getView(p);
          var a2 = g.getActions(p);
          var act2 = HKMJ.AI.decide(v, a2, { level: 'normal' });
          var res2 = g.act(p, act2);
          if (!res2.ok) { errors.push('seed ' + (seedBase + s) + ': claim act failed ' + res2.error + ' action=' + JSON.stringify(act2)); ok = false; }
        });
        if (!ok) break;
        continue;
      }
      errors.push('seed ' + (seedBase + s) + ': unknown pending type ' + pending.type);
      break;
    }
    // invariant: tile conservation
    var view0 = g.getView(0, { revealAll: true });
    var all = [];
    view0.players.forEach(function (pl) { all = all.concat(pl.hand || []); pl.melds.forEach(function (m) { all = all.concat(m.tiles); }); all = all.concat(pl.flowers); all = all.concat(pl.discards); });
    // add remaining wall
    // (wall isn't exposed by view; trust internal accounting via score sum instead)
    var scoreSum = view0.players.reduce(function (a, pl) { return a + pl.score; }, 0);
    if (scoreSum !== 0) errors.push('seed ' + (seedBase + s) + ': scores do not sum to 0 (got ' + scoreSum + ')');
  }
  return { wins: wins, draws: draws, hands: hands, errors: errors };
}

var out = playGames(30, 1000);
console.log(JSON.stringify({ wins: out.wins, draws: out.draws, hands: out.hands, errorCount: out.errors.length }, null, 2));
out.errors.slice(0, 20).forEach(function (e) { console.log('ERROR: ' + e); });
process.exit(out.errors.length ? 1 : 0);
