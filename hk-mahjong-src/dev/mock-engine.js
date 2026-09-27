/* HK Mahjong — dev/mock-engine.js
 * STAND-IN for src/core/{hand,scoring,engine,ai}.js, implementing the SPEC.md §5/§6 contract exactly (same
 * shapes/field names) so the UI can be built and tested before the real back end lands, and swapped later with
 * NO UI changes. NEVER bundled into the production build (see dev/build.dev.manifest.json vs build.manifest.json).
 *
 * SIMPLIFICATIONS (documented, not a substitute for the real src/core/scoring.js):
 *  - Winning shapes supported: standard (4 sets + pair), Seven Pairs / Luxury Seven Pairs, Thirteen Orphans.
 *    NOT implemented: Knitted Tiles, Lesser/Greater Honours, Nine Gates. (Rare paths; real scoring.js adds them.)
 *  - Fan catalogue covers: selfPick/kongReplacement/doubleKong, concealed, robKong, moon, allSequences,
 *    allTriplets, dragon/smallThreeDragons/bigThreeDragons, roundWind/seatWind/smallFourWinds/bigFourWinds,
 *    mixedFlush/fullFlush, kong†, sevenPairs/luxurySevenPairs, bonus tiles (noFlowers/seatFlower/allFlowers/
 *    allSeasons), sevenFlowers/eightFlowers, and the three Blessings.
 *    NOT implemented: allConcealedTriplets, allQuadruplets, mixedTerminals/allTerminals/allHonours and their
 *    "includes/replaces" interactions. This is enough to drive realistic, varied UI states (the "replaced" list
 *    is exercised via the interactions that ARE implemented: kongReplacement/doubleKong, small/bigThreeDragons,
 *    small/bigFourWinds, fullFlush).
 *  - Per the booklet's own language, "flat" patterns (the three Blessings, Thirteen Orphans, Seven/Eight Flowers)
 *    score ONLY their own flat value — nothing else is added on top. This matches the booklet's worked examples.
 *  - AI is a simple, deterministic efficiency+safety heuristic — legal, non-degenerate, but not the fan-planning
 *    AI required of the real src/core/ai.js.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;

  // ------------------------------------------------------------------ settings

  var DEFAULT_SETTINGS = {
    minFan: 3, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0,
    optional: { kong: false, sevenPairs: true, luxurySevenPairs: true, knitted: true, lesserHonours: true, greaterHonours: true }
  };
  HKMJ.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  function mergeSettings(s) {
    s = s || {};
    var out = {
      minFan: s.minFan !== undefined ? s.minFan : DEFAULT_SETTINGS.minFan,
      payment: s.payment || DEFAULT_SETTINGS.payment,
      unit: s.unit || DEFAULT_SETTINGS.unit,
      rounds: s.rounds !== undefined ? s.rounds : DEFAULT_SETTINGS.rounds,
      aiLevel: s.aiLevel || DEFAULT_SETTINGS.aiLevel,
      startingScore: s.startingScore !== undefined ? s.startingScore : DEFAULT_SETTINGS.startingScore,
      optional: Object.assign({}, DEFAULT_SETTINGS.optional, s.optional || {})
    };
    return out;
  }

  var FEATURE_TEXT = {
    selfPick: ['Self-Pick', '自摸'], kongReplacement: ['Win by Kong Replacement', '槓上開花'],
    doubleKong: ['Double Kong Replacement', '槓上槓'], concealed: ['Concealed Hand', '門前清'],
    robKong: ['Robbing the Kong', '搶槓'], moon: ['Moon Under The Sea', '海底撈月'],
    allSequences: ['All Sequences', '平糊'], allTriplets: ['All Triplets', '對對糊'],
    dragon: ['Dragon', '三元牌'], smallThreeDragons: ['Small Three Dragons', '小三元'],
    bigThreeDragons: ['Big Three Dragons', '大三元'], roundWind: ['Round Wind', '圈風'],
    seatWind: ['Seat Wind', '門風'], smallFourWinds: ['Small Four Winds', '小四喜'],
    bigFourWinds: ['Big Four Winds', '大四喜'], mixedFlush: ['Mixed Flush', '混一色'],
    fullFlush: ['Full Flush', '清一色'], kong: ['Kong', '槓'],
    sevenPairs: ['Seven Pairs', '七對子'], luxurySevenPairs: ['Luxury Seven Pairs', '豪華七對'],
    thirteenOrphans: ['Thirteen Orphans', '十三么'], heaven: ['Blessing of Heaven', '天糊'],
    earth: ['Blessing of Earth', '地糊'], man: ['Blessing of Man', '人糊'],
    noFlowers: ['No Flowers', '無花'], seatFlower: ['Seat Flower', '正花'],
    allFlowers: ['All Flowers', '一檯花'], allSeasons: ['All Seasons', '一檯花'],
    sevenFlowers: ['Seven Flowers', '花糊'], eightFlowers: ['Eight Flowers', '大花糊']
  };
  function featureName(id) { return (FEATURE_TEXT[id] || [id, id])[0]; }
  function featureZh(id) { return (FEATURE_TEXT[id] || [id, id])[1]; }
  function item(id, fan, detail) { return { id: id, name: featureName(id), zh: featureZh(id), fan: fan, detail: detail }; }
  function replacedItem(id, fan, reason) { return { id: id, name: featureName(id), zh: featureZh(id), fan: fan, reason: reason }; }

  var POINTS_TABLE = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];
  function points(fan) { return POINTS_TABLE[Math.max(0, Math.min(13, fan | 0))]; }

  function paymentsFn(o) {
    var fan = o.fan, unit = o.unit || 'points', payment = o.payment || 'full';
    var P = unit === 'chips' ? Math.max(1, Math.min(fan, 13)) : points(fan);
    var d = [0, 0, 0, 0];
    if (o.source === 'self') {
      for (var p = 0; p < 4; p++) { if (p !== o.winner) d[p] -= P; }
      d[o.winner] += 3 * P;
    } else {
      if (payment === 'shared') {
        for (var q = 0; q < 4; q++) { if (q !== o.winner && q !== o.payer) d[q] -= P / 2; }
        d[o.payer] -= P; d[o.winner] += 2 * P;
      } else {
        d[o.payer] -= 2 * P; d[o.winner] += 2 * P;
      }
    }
    return d;
  }

  HKMJ.Scoring = { points: points, payments: paymentsFn }; // minimal — UI does not depend on this directly

  // ------------------------------------------------------------------ winning-shape decomposition

  /** All ways to split a 34-length count vector into `setsNeeded` chow/pong sets + 1 pair. */
  function decomposeStandard(counts, setsNeeded) {
    var results = [];
    function rec(k, setsLeft, sets, pairKind) {
      while (k < 34 && counts[k] === 0) k++;
      if (k === 34) { if (setsLeft === 0 && pairKind !== null) results.push({ sets: sets.slice(), pair: pairKind }); return; }
      if (setsLeft === 0) {
        if (pairKind === null && counts[k] === 2) { counts[k] -= 2; rec(k, 0, sets, k); counts[k] += 2; }
        return;
      }
      if (pairKind === null && counts[k] >= 2) { counts[k] -= 2; rec(k, setsLeft, sets, k); counts[k] += 2; }
      if (counts[k] >= 3) {
        counts[k] -= 3; sets.push({ type: 'pong', tiles: [k, k, k] });
        rec(k, setsLeft - 1, sets, pairKind);
        sets.pop(); counts[k] += 3;
      }
      if (T.isSuit(k) && T.rankOf(k) <= 7 && T.suitOf(k + 1) === T.suitOf(k) && T.suitOf(k + 2) === T.suitOf(k) && counts[k + 1] > 0 && counts[k + 2] > 0) {
        counts[k]--; counts[k + 1]--; counts[k + 2]--;
        sets.push({ type: 'chow', tiles: [k, k + 1, k + 2] });
        rec(k, setsLeft - 1, sets, pairKind);
        sets.pop(); counts[k]++; counts[k + 1]++; counts[k + 2]++;
      }
    }
    rec(0, setsNeeded, [], null);
    return results;
  }

  function findSevenPairs(hand, luxuryOn) {
    if (hand.length !== 14) return null;
    var counts = T.counts(hand);
    var pairs = 0, quadKinds = [];
    for (var k = 0; k < 34; k++) {
      var c = counts[k];
      if (c === 0) continue;
      if (c === 2) pairs++;
      else if (c === 4 && luxuryOn) { quadKinds.push(k); pairs += 2; }
      else return null;
    }
    if (pairs !== 7) return null;
    return { counts: counts, quadKinds: quadKinds };
  }

  var ORPHAN_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  function findThirteenOrphans(hand, melds) {
    if (melds.length || hand.length !== 14) return null;
    var counts = T.counts(hand);
    var extra = -1;
    for (var k = 0; k < 34; k++) {
      var need = ORPHAN_KINDS.indexOf(k) >= 0;
      if (!need) { if (counts[k] > 0) return null; continue; }
      if (counts[k] === 0) return null;
      if (counts[k] > 2) return null;
      if (counts[k] === 2) { if (extra >= 0) return null; extra = k; }
    }
    return extra >= 0 ? { pairKind: extra } : null;
  }

  function isWinningShape(hand, melds, optional) {
    if (findThirteenOrphans(hand, melds)) return true;
    if (!melds.length && optional.sevenPairs && findSevenPairs(hand, optional.luxurySevenPairs)) return true;
    var setsNeeded = 4 - melds.length;
    var counts = T.counts(hand);
    return decomposeStandard(counts, setsNeeded).length > 0;
  }

  // ------------------------------------------------------------------ groups + fan scoring

  function buildStandardGroups(decomp, melds, winTile) {
    var groups = [], placed = false;
    melds.forEach(function (m) { groups.push({ kind: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed, fromMeld: true, hasWinTile: false }); });
    decomp.sets.forEach(function (s) {
      var has = !placed && s.tiles.indexOf(winTile) >= 0;
      if (has) placed = true;
      groups.push({ kind: s.type, tiles: s.tiles.slice(), concealed: true, fromMeld: false, hasWinTile: has });
    });
    var pairHas = !placed && decomp.pair === winTile;
    groups.push({ kind: 'pair', tiles: [decomp.pair, decomp.pair], concealed: true, fromMeld: false, hasWinTile: pairHas });
    return groups;
  }

  function windSetIndex(kind) { return T.isWind(kind) ? T.windIndex(kind) : -1; }

  /** Additive Fan stack for a standard-shape decomposition (see file header for what's NOT covered). */
  function scoreStandard(decomp, ctx) {
    var groups = buildStandardGroups(decomp, ctx.melds, ctx.winTile);
    var items = [], replaced = [];
    var sets = groups.filter(function (g) { return g.kind !== 'pair'; });
    var allTiles = []; groups.forEach(function (g) { g.tiles.forEach(function (t) { allTiles.push(t); }); });
    // win action
    if (ctx.source === 'self') {
      if (ctx.kongReplacement >= 2) {
        items.push(item('doubleKong', 9));
        replaced.push(replacedItem('selfPick', 1, 'replaced by Double Kong Replacement'));
        replaced.push(replacedItem('kongReplacement', 2, 'replaced by Double Kong Replacement'));
      } else if (ctx.kongReplacement === 1) {
        items.push(item('kongReplacement', 2));
        replaced.push(replacedItem('selfPick', 1, 'replaced by Win by Kong Replacement'));
      } else {
        items.push(item('selfPick', 1));
      }
    } else if (ctx.source === 'robKong') {
      items.push(item('robKong', 1));
    }
    if (ctx.melds.every(function (m) { return m.concealed; })) items.push(item('concealed', 1));
    if (ctx.lastTile) items.push(item('moon', 1));
    // set-type
    var allChow = sets.length === 4 && sets.every(function (s) { return s.kind === 'chow'; });
    var allPongKong = sets.length === 4 && sets.every(function (s) { return s.kind === 'pong' || s.kind === 'kong'; });
    if (allChow) items.push(item('allSequences', 1));
    if (allPongKong) items.push(item('allTriplets', 3));
    // dragons
    var dragonSets = sets.filter(function (s) { return T.isDragon(s.tiles[0]); });
    if (dragonSets.length === 3) {
      items.push(item('bigThreeDragons', 8));
      replaced.push(replacedItem('dragon', dragonSets.length, 'replaced by Big Three Dragons'));
    } else if (dragonSets.length === 2 && T.isDragon(decomp.pair)) {
      items.push(item('smallThreeDragons', 5));
      replaced.push(replacedItem('dragon', dragonSets.length, 'replaced by Small Three Dragons'));
    } else if (dragonSets.length > 0) {
      dragonSets.forEach(function (s) { items.push(item('dragon', 1, T.name(s.tiles[0]))); });
    }
    // winds
    var windSets = sets.filter(function (s) { return T.isWind(s.tiles[0]); });
    if (windSets.length === 4) {
      items.push(item('bigFourWinds', 13));
      replaced.push(replacedItem('roundWind', 1, 'replaced by Big Four Winds'));
      replaced.push(replacedItem('seatWind', 1, 'replaced by Big Four Winds'));
    } else if (windSets.length === 3 && T.isWind(decomp.pair)) {
      items.push(item('smallFourWinds', 6));
      replaced.push(replacedItem('roundWind', 1, 'replaced by Small Four Winds'));
      replaced.push(replacedItem('seatWind', 1, 'replaced by Small Four Winds'));
    } else {
      windSets.forEach(function (s) {
        var wi = windSetIndex(s.tiles[0]);
        if (wi === ctx.roundWind) items.push(item('roundWind', 1));
        if (wi === ctx.seatWind) items.push(item('seatWind', 1));
      });
    }
    // flush
    var suits = {}; var hasHonour = false;
    allTiles.forEach(function (t) { if (T.isSuit(t)) suits[T.suitOf(t)] = true; else hasHonour = true; });
    var suitCount = Object.keys(suits).length;
    if (suitCount === 1) {
      if (hasHonour) items.push(item('mixedFlush', 3));
      else { items.push(item('fullFlush', 7)); replaced.push(replacedItem('mixedFlush', 3, 'replaced by Full Flush')); }
    }
    // kong †
    if (ctx.settings.optional.kong) {
      ctx.melds.forEach(function (m) { if (m.type === 'kong') items.push(item('kong', m.concealed ? 2 : 1, (m.concealed ? 'concealed' : 'open') + ' ' + T.name(m.tiles[0]))); });
    }
    pushBonusItems(items, ctx);
    return finishEvaluation(items, replaced, 'standard', groups, ctx);
  }

  function scoreSevenPairs(sp, ctx) {
    var groups = [];
    for (var k = 0; k < 34; k++) {
      var c = sp.counts[k]; if (!c) continue;
      if (c === 4) {
        groups.push({ kind: 'pair', tiles: [k, k], concealed: true, fromMeld: false, hasWinTile: k === ctx.winTile });
        groups.push({ kind: 'pair', tiles: [k, k], concealed: true, fromMeld: false, hasWinTile: false });
      } else {
        groups.push({ kind: 'pair', tiles: [k, k], concealed: true, fromMeld: false, hasWinTile: k === ctx.winTile });
      }
    }
    var items = [], replaced = [];
    items.push(item('sevenPairs', 4));
    if (sp.quadKinds.length) items.push(item('luxurySevenPairs', 2 * sp.quadKinds.length));
    if (ctx.source === 'self') items.push(item('selfPick', 1));
    else if (ctx.source === 'robKong') items.push(item('robKong', 1));
    if (ctx.lastTile) items.push(item('moon', 1));
    var suits = {}; var hasHonour = false;
    for (var k2 = 0; k2 < 34; k2++) { if (sp.counts[k2]) { if (T.isSuit(k2)) suits[T.suitOf(k2)] = true; else hasHonour = true; } }
    var suitCount = Object.keys(suits).length;
    if (suitCount === 1) { if (hasHonour) items.push(item('mixedFlush', 3)); else { items.push(item('fullFlush', 7)); replaced.push(replacedItem('mixedFlush', 3, 'replaced by Full Flush')); } }
    pushBonusItems(items, ctx);
    return finishEvaluation(items, replaced, 'sevenPairs', groups, ctx);
  }

  var FLAT_VALUE = { heaven: 13, earth: 13, man: 13, thirteenOrphans: 13 };
  function scoreFlat(id, ctx, groups, pattern) {
    var items = [item(id, FLAT_VALUE[id])];
    return finishEvaluation(items, [], pattern, groups, ctx);
  }

  function pushBonusItems(items, ctx) {
    if (!ctx.flowers.length) { items.push(item('noFlowers', 1)); return; }
    var seatNum = ctx.seatWind + 1, seatCount = 0;
    ctx.flowers.forEach(function (f) { if (T.bonusNumber(f) === seatNum) seatCount++; });
    if (seatCount) items.push(item('seatFlower', seatCount, seatCount + ' matching your seat'));
    var flowerSet = [34, 35, 36, 37].every(function (f) { return ctx.flowers.indexOf(f) >= 0; });
    var seasonSet = [38, 39, 40, 41].every(function (f) { return ctx.flowers.indexOf(f) >= 0; });
    if (flowerSet) items.push(item('allFlowers', 2));
    if (seasonSet) items.push(item('allSeasons', 2));
  }

  function finishEvaluation(items, replaced, pattern, groups, ctx) {
    items = items.filter(function (it) { return it.fan > 0; });
    var rawFan = items.reduce(function (a, b) { return a + b.fan; }, 0);
    var fan = Math.min(13, rawFan);
    var valid = (fan >= ctx.settings.minFan) || !!ctx.blessing || !!ctx.flowerWin;
    return { winning: true, valid: valid, fan: fan, rawFan: rawFan, limit: rawFan >= 13, items: items, replaced: replaced, pattern: pattern, groups: groups, points: points(fan) };
  }

  var NOT_WINNING = { winning: false, valid: false, fan: 0, rawFan: 0, limit: false, items: [], replaced: [], pattern: null, groups: [], points: points(0) };

  function evaluate(ctx) {
    if (ctx.flowerWin) {
      var n = ctx.flowers.length;
      var fan = n >= 8 ? 8 : 3;
      var items = [item(n >= 8 ? 'eightFlowers' : 'sevenFlowers', fan)];
      return finishEvaluation(items, [], 'flowers', [], ctx);
    }
    // NOTE: blessing (heaven/earth/man) must NOT bypass winning-shape detection — it only overrides the
    // resulting Fan value of a hand that is otherwise already a genuine winning shape (see findWinningBest below).
    var best = findWinningBest(ctx);
    if (!best) return NOT_WINNING;
    if (ctx.blessing) return scoreFlat(ctx.blessing, ctx, best.groups, ctx.blessing);
    return best;
  }

  function findWinningBest(ctx) {
    var best = null;
    function consider(ev) { if (!ev) return; if (!best || ev.fan > best.fan || (ev.fan === best.fan && ev.rawFan > best.rawFan)) best = ev; }
    var orphan = findThirteenOrphans(ctx.hand, ctx.melds);
    if (orphan) {
      var groups = ORPHAN_KINDS.map(function (k) { return { kind: 'single', tiles: [k], concealed: true, fromMeld: false, hasWinTile: k === ctx.winTile && k !== orphan.pairKind }; });
      groups.push({ kind: 'single', tiles: [orphan.pairKind], concealed: true, fromMeld: false, hasWinTile: orphan.pairKind === ctx.winTile });
      consider(scoreFlat('thirteenOrphans', ctx, groups, 'thirteenOrphans'));
    }
    if (!ctx.melds.length && ctx.settings.optional.sevenPairs) {
      var sp = findSevenPairs(ctx.hand, ctx.settings.optional.luxurySevenPairs);
      if (sp) consider(scoreSevenPairs(sp, ctx));
    }
    var setsNeeded = 4 - ctx.melds.length;
    var decomps = decomposeStandard(T.counts(ctx.hand), setsNeeded);
    decomps.forEach(function (d) { consider(scoreStandard(d, ctx)); });
    return best;
  }

  // ------------------------------------------------------------------ small helpers

  function cloneMeld(m) { return { type: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed, from: (m.from == null ? null : m.from), claimed: (m.claimed == null ? null : m.claimed), added: !!m.added }; }
  function removeN(arr, tile, n) { for (var i = 0; i < n; i++) { var idx = arr.indexOf(tile); if (idx < 0) throw new Error('removeN: tile ' + tile + ' missing'); arr.splice(idx, 1); } }
  function removeFromRiver(river, tile) { for (var i = river.length - 1; i >= 0; i--) { if (river[i] === tile) { river.splice(i, 1); return; } } }
  function actionsEqual(a, b) {
    if (a.type !== b.type) return false;
    if (b.tile !== undefined && a.tile !== b.tile) return false;
    if (b.tiles) { if (!a.tiles || a.tiles.length !== b.tiles.length) return false; for (var i = 0; i < b.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) return false; }
    return true;
  }
  /** Front-of-wall deal order (length 53): dealer,S,W,N x4 tiles, three times round; then 1 each; then dealer's 14th. */
  function dealOrderIndices(dealer) {
    var seq = [];
    for (var r = 0; r < 3; r++) for (var i = 0; i < 4; i++) { var pl = (dealer + i) % 4; for (var t = 0; t < 4; t++) seq.push(pl); }
    for (var i2 = 0; i2 < 4; i2++) seq.push((dealer + i2) % 4);
    seq.push(dealer);
    return seq;
  }

  // ------------------------------------------------------------------ Game

  function Game(opts) {
    opts = opts || {};
    this._settings = mergeSettings(opts.settings);
    var names = (opts.names || ['You', 'Mei', 'Wing', 'Keung']).slice(0, 4);
    while (names.length < 4) names.push('P' + names.length);
    this._names = names;
    this._humans = opts.humans || [0];
    this._rng = HKMJ.RNG(opts.seed);
    this._firstDealerOpt = opts.firstDealer;
    this._presetWalls = opts.presetWalls || null;
    this._listeners = [];
    this._started = false;
    this._scores = [0, 0, 0, 0]; this._round = 0; this._dealer = 0; this._dealerRepeat = 0; this._handNo = 0;
    this._firstDealer = 0;
    this._log = []; this._lastResult = null; this._standings = null;
    this._hands = [[], [], [], []]; this._melds = [[], [], [], []]; this._flowers = [[], [], [], []]; this._discards = [[], [], [], []];
    this._drawnTile = [null, null, null, null]; this._lastAction = [null, null, null, null];
    this._hasDrawnBefore = [false, false, false, false]; this._firstDrawFlag = [false, false, false, false];
    this._phase = 'turn'; this._turnPlayer = 0; this._afterClaim = false;
    this._wall = []; this._front = 0; this._back = 143; this._dice = [1, 1, 1];
    this._lastDiscard = null; this._claimTile = null; this._waiting = []; this._claimOptions = {}; this._votes = {};
    this._pendingAddKong = null; this._kongStreak = 0; this._finalDiscard = false;
    this._dealerActed = false; this._handDiscardCount = 0; this._anyMeldDeclaredThisHand = false;
  }

  Game.prototype.start = function () {
    if (this._started) return;
    this._started = true;
    this._round = 0; this._dealerRepeat = 0; this._handNo = 0;
    this._firstDealer = (this._firstDealerOpt !== undefined && this._firstDealerOpt !== null) ? this._firstDealerOpt : this._rng.int(4);
    this._dealer = this._firstDealer;
    this._scores = [0, 0, 0, 0].map(function () { return this._settings.startingScore; }, this);
    this._beginHand();
  };

  Game.prototype._beginHand = function () {
    this._handNo++;
    var wallSpec = this._presetWalls && this._presetWalls[this._handNo - 1];
    this._wall = wallSpec ? wallSpec.slice() : this._rng.shuffle(T.fullSet().slice());
    this._front = 0; this._back = 143;
    this._hands = [[], [], [], []]; this._melds = [[], [], [], []]; this._flowers = [[], [], [], []]; this._discards = [[], [], [], []];
    this._drawnTile = [null, null, null, null]; this._lastAction = [null, null, null, null];
    this._lastDiscard = null; this._claimTile = null; this._waiting = []; this._claimOptions = {}; this._votes = {};
    this._pendingAddKong = null; this._kongStreak = 0; this._finalDiscard = false;
    this._dealerActed = false; this._handDiscardCount = 0; this._anyMeldDeclaredThisHand = false;
    this._hasDrawnBefore = [false, false, false, false]; this._firstDrawFlag = [false, false, false, false];
    this._dice = [1 + this._rng.int(6), 1 + this._rng.int(6), 1 + this._rng.int(6)];
    this._phase = 'turn'; this._turnPlayer = this._dealer; this._afterClaim = false;
    this._lastResult = null;
    var order = dealOrderIndices(this._dealer);
    for (var i = 0; i < order.length; i++) { this._hands[order[i]].push(this._wall[this._front++]); }
    this._emit({ type: 'handStart', handNo: this._handNo, round: this._round, dealer: this._dealer, dice: this._dice });
    this._log_push('Hand ' + this._handNo + ' · ' + ['East', 'South', 'West', 'North'][this._round] + ' round · dealer ' + (this._dealer === 0 ? 'You' : this._names[this._dealer]));
    for (var s = 0; s < 4; s++) { this._settleAllBonus((this._dealer + s) % 4); if (this._phase === 'handEnd') return; }
  };

  Game.prototype._wallCount = function () { return this._back - this._front + 1; };

  Game.prototype._settleAllBonus = function (p) {
    var found = true;
    while (found) {
      found = false;
      for (var i = 0; i < this._hands[p].length; i++) {
        if (T.isBonus(this._hands[p][i])) {
          var tile = this._hands[p].splice(i, 1)[0];
          this._flowers[p].push(tile);
          this._emit({ type: 'bonus', player: p, tile: tile });
          if (this._wallCount() === 0) { this._finalizeDraw(); return; }
          this._hands[p].push(this._wall[this._back--]);
          found = true;
          break;
        }
      }
    }
  };

  Game.prototype._drawForTurn = function (p) {
    if (this._wallCount() === 0) { this._finalizeDraw(); return; }
    var isFirst = !this._hasDrawnBefore[p];
    this._hasDrawnBefore[p] = true;
    this._firstDrawFlag[p] = isFirst;
    this._hands[p].push(this._wall[this._front++]);
    this._emit({ type: 'draw', player: p, replacement: false });
    this._settleAllBonus(p);
    if (this._phase === 'handEnd') return;
    this._drawnTile[p] = this._hands[p][this._hands[p].length - 1];
  };

  /** @returns {boolean} false if the wall ran out and the hand ended in a draw. */
  Game.prototype._drawReplacement = function (p) {
    if (this._wallCount() === 0) { this._finalizeDraw(); return false; }
    this._hands[p].push(this._wall[this._back--]);
    this._emit({ type: 'draw', player: p, replacement: true });
    this._settleAllBonus(p);
    if (this._phase === 'handEnd') return false;
    this._drawnTile[p] = this._hands[p][this._hands[p].length - 1];
    return true;
  };

  Game.prototype._ctxFor = function (p, winTile, source, extra) {
    extra = extra || {};
    return {
      hand: this._hands[p].slice(), melds: this._melds[p].map(cloneMeld), winTile: winTile, source: source,
      kongReplacement: extra.kongReplacement || 0, lastTile: !!extra.lastTile,
      seatWind: (p - this._dealer + 4) % 4, roundWind: this._round,
      flowers: this._flowers[p].slice(), blessing: extra.blessing || null, flowerWin: !!extra.flowerWin,
      settings: this._settings
    };
  };

  Game.prototype._actionsForTurn = function (p) {
    var acts = [];
    var hand = this._hands[p];
    var melds = this._melds[p];
    if (!this._afterClaim) {
      var winTile = this._drawnTile[p] != null ? this._drawnTile[p] : (hand.length ? hand[hand.length - 1] : null);
      if (winTile != null) {
        var blessing = null;
        if (p === this._dealer && !this._dealerActed) blessing = 'heaven';
        else if (p !== this._dealer && this._firstDrawFlag[p] && !this._anyMeldDeclaredThisHand) blessing = 'man';
        var ev = evaluate(this._ctxFor(p, winTile, 'self', { kongReplacement: Math.min(2, this._kongStreak), lastTile: this._wallCount() === 0, blessing: blessing }));
        if (ev.valid) acts.push({ type: 'selfWin', fan: ev.fan, evaluation: ev });
      }
      if (this._flowers[p].length === 7 || this._flowers[p].length === 8) acts.push({ type: 'flowerWin' });
      if (this._wallCount() >= 1) {
        var counts = T.counts(hand);
        for (var k = 0; k < 34; k++) if (counts[k] === 4) acts.push({ type: 'concealedKong', tile: k });
        melds.forEach(function (m) { if (m.type === 'pong' && counts[m.tiles[0]] >= 1) acts.push({ type: 'addKong', tile: m.tiles[0] }); });
      }
    }
    var seen = {};
    hand.forEach(function (t) { if (!seen[t]) { seen[t] = 1; acts.push({ type: 'discard', tile: t }); } });
    return acts;
  };

  Game.prototype._computeClaimOptions = function (p, tile, from, kind, blessing) {
    var acts = [];
    var hand = this._hands[p];
    var counts = T.counts(hand);
    var ev = evaluate(this._ctxFor(p, tile, kind === 'robKong' ? 'robKong' : 'discard', { lastTile: kind === 'discard' && this._finalDiscard, blessing: blessing || null }));
    if (ev.valid) acts.push({ type: 'win', fan: ev.fan, evaluation: ev });
    if (kind === 'discard' && !this._finalDiscard) {
      if (this._wallCount() >= 1 && counts[tile] >= 3) acts.push({ type: 'kong' });
      if (counts[tile] >= 2) acts.push({ type: 'pong' });
      if (p === (from + 1) % 4 && T.isSuit(tile)) {
        var r = T.rankOf(tile);
        if (r >= 3 && counts[tile - 2] > 0 && counts[tile - 1] > 0) acts.push({ type: 'chow', tiles: T.sort([tile - 2, tile - 1, tile]) });
        if (r >= 2 && r <= 8 && counts[tile - 1] > 0 && counts[tile + 1] > 0) acts.push({ type: 'chow', tiles: T.sort([tile - 1, tile, tile + 1]) });
        if (r <= 7 && counts[tile + 1] > 0 && counts[tile + 2] > 0) acts.push({ type: 'chow', tiles: T.sort([tile, tile + 1, tile + 2]) });
      }
    }
    return acts;
  };

  Game.prototype.getActions = function (p) {
    if (this._phase === 'turn') return this._turnPlayer === p ? this._actionsForTurn(p) : [];
    if (this._phase === 'claim' || this._phase === 'robKong') return this._waiting.indexOf(p) >= 0 ? this._claimOptions[p].concat([{ type: 'pass' }]) : [];
    return [];
  };

  Game.prototype.getPending = function () {
    if (this._phase === 'handEnd') return { type: 'handEnd', result: this._lastResult };
    if (this._phase === 'gameEnd') return { type: 'gameEnd', standings: this._standings };
    if (this._phase === 'claim') return { type: 'claim', tile: this._claimTile.tile, from: this._claimTile.from, waiting: this._waiting.slice() };
    if (this._phase === 'robKong') return { type: 'robKong', tile: this._claimTile.tile, from: this._claimTile.from, waiting: this._waiting.slice() };
    return { type: 'turn', player: this._turnPlayer, afterClaim: this._afterClaim };
  };

  Game.prototype.act = function (p, action) {
    try {
      var result = this._applyAction(p, action);
      if (!result.ok) return result;
      this._autoAdvance();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  };

  Game.prototype._applyAction = function (p, action) {
    if (!action || typeof action.type !== 'string') return { ok: false, error: 'bad action' };
    if (action.type === 'pass') {
      if (this._phase !== 'claim' && this._phase !== 'robKong') return { ok: false, error: 'nothing to pass' };
      if (this._waiting.indexOf(p) < 0) return { ok: false, error: 'player ' + p + ' is not waiting' };
      this._votes[p] = { type: 'pass' };
      this._waiting.splice(this._waiting.indexOf(p), 1);
      return { ok: true };
    }
    var legal = this.getActions(p);
    var match = null;
    for (var i = 0; i < legal.length; i++) { if (actionsEqual(legal[i], action)) { match = legal[i]; break; } }
    if (!match) return { ok: false, error: 'illegal action for player ' + p + ': ' + JSON.stringify(action) };
    if (p === this._dealer) this._dealerActed = true;
    this._firstDrawFlag[p] = false;
    switch (action.type) {
      case 'discard': this._doDiscardAction(p, action.tile); return { ok: true };
      case 'selfWin': this._finalizeWin(p, match.evaluation, { source: 'self', winTile: match.evaluation && this._winTileFor(p), payer: null }); return { ok: true };
      case 'flowerWin': this._doFlowerWin(p); return { ok: true };
      case 'concealedKong': this._doConcealedKong(p, action.tile); return { ok: true };
      case 'addKong': this._doAddKong(p, action.tile); return { ok: true };
      case 'win': case 'kong': case 'pong': case 'chow':
        if (this._phase !== 'claim' && this._phase !== 'robKong') return { ok: false, error: 'no claim pending' };
        if (this._waiting.indexOf(p) < 0) return { ok: false, error: 'player ' + p + ' is not waiting' };
        this._votes[p] = match;
        this._waiting.splice(this._waiting.indexOf(p), 1);
        return { ok: true };
      default: return { ok: false, error: 'unknown action type ' + action.type };
    }
  };

  Game.prototype._winTileFor = function (p) {
    var hand = this._hands[p];
    return this._drawnTile[p] != null ? this._drawnTile[p] : (hand.length ? hand[hand.length - 1] : null);
  };

  Game.prototype._autoAdvance = function () {
    while (true) {
      if (this._phase === 'handEnd' || this._phase === 'gameEnd') return;
      if ((this._phase === 'claim' || this._phase === 'robKong') && this._waiting.length === 0) {
        if (this._phase === 'claim') this._resolveClaim(); else this._resolveRobKong();
        continue;
      }
      return;
    }
  };

  Game.prototype._findVote = function (type) {
    var found = null, votes = this._votes;
    Object.keys(votes).forEach(function (k) { if (found == null && votes[k].type === type) found = +k; });
    return found;
  };

  Game.prototype._doDiscardAction = function (p, tile) {
    var hand = this._hands[p];
    var idx = hand.indexOf(tile); if (idx < 0) throw new Error('tile not in hand');
    hand.splice(idx, 1);
    this._discards[p].push(tile);
    this._drawnTile[p] = null;
    this._lastAction[p] = null;
    this._lastDiscard = { tile: tile, from: p };
    this._handDiscardCount++;
    this._finalDiscard = (this._wallCount() === 0);
    this._emit({ type: 'discard', player: p, tile: tile });
    this._log_push((p === 0 ? 'You' : this._names[p]) + (p === 0 ? ' discard ' : ' discards ') + T.name(tile) + ' ' + T.zh(tile));
    this._openClaimAfterDiscard(tile, p);
  };

  Game.prototype._openClaimAfterDiscard = function (tile, from) {
    var isEarth = (from === this._dealer && this._handDiscardCount === 1);
    this._claimTile = { tile: tile, from: from, kind: 'discard' };
    this._waiting = []; this._claimOptions = {}; this._votes = {};
    for (var i = 1; i <= 3; i++) {
      var p = (from + i) % 4;
      var opts = this._computeClaimOptions(p, tile, from, 'discard', isEarth ? 'earth' : null);
      if (opts.length) { this._claimOptions[p] = opts; this._waiting.push(p); }
    }
    if (!this._waiting.length) { this._claimTile = null; this._advanceAfterNoClaim(from); }
    else { this._phase = 'claim'; }
  };

  Game.prototype._advanceAfterNoClaim = function (from) {
    if (this._finalDiscard) { this._finalizeDraw(); return; }
    var next = (from + 1) % 4;
    this._turnPlayer = next; this._afterClaim = false; this._kongStreak = 0;
    this._phase = 'turn';
    this._drawForTurn(next);
  };

  Game.prototype._resolveClaim = function () {
    var from = this._claimTile.from, tile = this._claimTile.tile;
    var votes = this._votes;
    var winners = Object.keys(votes).map(Number).filter(function (p) { return votes[p].type === 'win'; });
    if (winners.length) {
      winners.sort(function (a, b) { return ((a - from + 4) % 4) - ((b - from + 4) % 4); });
      var w = winners[0];
      this._claimTile = null;
      this._finalizeWin(w, votes[w].evaluation, { source: 'discard', winTile: tile, payer: from });
      return;
    }
    var kongP = this._findVote('kong'), pongP = this._findVote('pong');
    if (kongP != null || pongP != null) { this._applyClaimedMeld(kongP != null ? kongP : pongP, kongP != null ? 'kong' : 'pong', tile, from); return; }
    var chowP = this._findVote('chow');
    if (chowP != null) { this._applyClaimedMeld(chowP, 'chow', tile, from, votes[chowP].tiles); return; }
    this._claimTile = null;
    this._advanceAfterNoClaim(from);
  };

  Game.prototype._applyClaimedMeld = function (p, type, tile, from, chowTiles) {
    var hand = this._hands[p];
    var meld;
    if (type === 'pong') { removeN(hand, tile, 2); meld = { type: 'pong', tiles: [tile, tile, tile], concealed: false, from: from, claimed: tile, added: false }; }
    else if (type === 'kong') { removeN(hand, tile, 3); meld = { type: 'kong', tiles: [tile, tile, tile, tile], concealed: false, from: from, claimed: tile, added: false }; }
    else {
      var rem = chowTiles.slice(); rem.splice(rem.indexOf(tile), 1);
      rem.forEach(function (t) { removeN(hand, t, 1); });
      meld = { type: 'chow', tiles: T.sort(chowTiles), concealed: false, from: from, claimed: tile, added: false };
    }
    this._melds[p].push(meld);
    this._anyMeldDeclaredThisHand = true;
    this._lastAction[p] = type;
    removeFromRiver(this._discards[from], tile);
    this._claimTile = null;
    this._phase = 'turn';
    this._emit({ type: 'claim', player: p, claim: type, tile: tile, from: from });
    this._log_push((p === 0 ? 'You' : this._names[p]) + ' ' + (type === 'kong' ? (p === 0 ? 'kong' : 'kongs') : (type === 'pong' ? (p === 0 ? 'pong' : 'pongs') : (p === 0 ? 'chow' : 'chows'))) + ' ' + T.name(tile));
    this._kongStreak = 0;
    this._turnPlayer = p;
    if (type === 'kong') { this._afterClaim = false; if (!this._drawReplacement(p)) return; this._kongStreak = 1; }
    else { this._afterClaim = true; }
  };

  Game.prototype._doConcealedKong = function (p, tile) {
    removeN(this._hands[p], tile, 4);
    this._melds[p].push({ type: 'kong', tiles: [tile, tile, tile, tile], concealed: true, from: null, claimed: null, added: false });
    this._lastAction[p] = 'concealedKong';
    this._emit({ type: 'concealedKong', player: p, tile: tile });
    this._log_push((p === 0 ? 'You' : this._names[p]) + ' declare' + (p === 0 ? '' : 's') + ' a concealed Kong of ' + T.name(tile));
    this._kongStreak++;
    this._afterClaim = false;
    this._drawReplacement(p);
  };

  Game.prototype._doAddKong = function (p, tile) {
    var meldIdx = -1;
    this._melds[p].forEach(function (m, i) { if (m.type === 'pong' && m.tiles[0] === tile) meldIdx = i; });
    removeN(this._hands[p], tile, 1);
    this._pendingAddKong = { player: p, tile: tile, meldIndex: meldIdx };
    this._claimTile = { tile: tile, from: p, kind: 'robKong' };
    this._waiting = []; this._claimOptions = {}; this._votes = {};
    for (var i = 1; i <= 3; i++) {
      var q = (p + i) % 4;
      var opts = this._computeClaimOptions(q, tile, p, 'robKong', null);
      if (opts.length) { this._claimOptions[q] = opts; this._waiting.push(q); }
    }
    if (!this._waiting.length) { this._claimTile = null; this._completeAddKong(); }
    else { this._phase = 'robKong'; }
  };

  Game.prototype._completeAddKong = function () {
    var info = this._pendingAddKong; this._pendingAddKong = null;
    var m = this._melds[info.player][info.meldIndex];
    m.tiles = [info.tile, info.tile, info.tile, info.tile]; m.type = 'kong'; m.added = true;
    this._lastAction[info.player] = 'addKong';
    this._phase = 'turn';
    this._emit({ type: 'addKong', player: info.player, tile: info.tile });
    this._log_push((info.player === 0 ? 'You' : this._names[info.player]) + ' upgrade' + (info.player === 0 ? '' : 's') + ' to a Kong of ' + T.name(info.tile));
    this._kongStreak++;
    this._turnPlayer = info.player; this._afterClaim = false;
    this._drawReplacement(info.player);
  };

  Game.prototype._resolveRobKong = function () {
    var info = this._pendingAddKong;
    var votes = this._votes;
    var winners = Object.keys(votes).map(Number).filter(function (p) { return votes[p].type === 'win'; });
    if (winners.length) {
      winners.sort(function (a, b) { return ((a - info.player + 4) % 4) - ((b - info.player + 4) % 4); });
      var w = winners[0];
      this._pendingAddKong = null; this._claimTile = null;
      this._finalizeWin(w, votes[w].evaluation, { source: 'robKong', winTile: info.tile, payer: info.player });
      return;
    }
    this._claimTile = null;
    this._completeAddKong();
  };

  Game.prototype._doFlowerWin = function (p) {
    var ev = evaluate(this._ctxFor(p, null, 'self', { flowerWin: true }));
    this._finalizeWin(p, ev, { source: 'flowers', winTile: null, payer: null });
  };

  Game.prototype._finalizeWin = function (winner, evaluation, info) {
    var payer = info.payer;
    var d = (info.source === 'self' || info.source === 'flowers')
      ? paymentsFn({ fan: evaluation.fan, winner: winner, source: 'self' })
      : paymentsFn({ fan: evaluation.fan, winner: winner, source: info.source, payer: payer, payment: this._settings.payment, unit: this._settings.unit });
    var scoresAfter = this._scores.map(function (s, i) { return s + d[i]; });
    this._scores = scoresAfter;
    this._lastAction[winner] = (info.source === 'self' ? 'selfWin' : (info.source === 'flowers' ? 'flowerWin' : 'win'));
    var dealerStays = (winner === this._dealer);
    var nextDealer = dealerStays ? this._dealer : (this._dealer + 1) % 4;
    var nextRound = this._round;
    if (!dealerStays && nextDealer === this._firstDealer) nextRound = this._round + 1;
    var gameOver = nextRound >= this._settings.rounds || this._handNo >= 300;
    var result = {
      type: 'win', handNo: this._handNo, round: this._round, dealer: this._dealer, winner: winner, payer: (payer == null ? null : payer),
      source: info.source, winTile: info.winTile, evaluation: evaluation, payments: d, scoresAfter: scoresAfter,
      hands: this._snapshotHands(), dealerStays: dealerStays, nextDealer: nextDealer, nextRound: nextRound, gameOver: gameOver
    };
    this._lastResult = result;
    this._phase = 'handEnd';
    this._emit({ type: 'win', player: winner, result: result });
    this._log_push(this._describeWin(winner, info, evaluation));
    this._emit({ type: 'handEnd', result: result });
  };

  Game.prototype._describeWin = function (winner, info, ev) {
    var who = winner === 0 ? 'You' : this._names[winner];
    var verb = winner === 0 ? 'win' : 'wins';
    var how;
    if (info.source === 'flowers') how = 'with a Flower hand';
    else if (info.source === 'self') how = 'by Self-Pick';
    else if (info.source === 'robKong') how = 'by Robbing the Kong';
    else how = 'on ' + (info.payer === 0 ? 'your' : (this._names[info.payer] + "'s")) + ' discard';
    return who + ' ' + verb + ' ' + how + ' — ' + ev.fan + ' Fan!';
  };

  Game.prototype._snapshotHands = function () {
    var out = [];
    for (var p = 0; p < 4; p++) out.push({ hand: T.sort(this._hands[p]), melds: this._melds[p].map(cloneMeld), flowers: this._flowers[p].slice().sort(function (a, b) { return a - b; }) });
    return out;
  };

  Game.prototype._finalizeDraw = function () {
    var gameOver = this._round >= this._settings.rounds || this._handNo >= 300;
    var result = {
      type: 'draw', handNo: this._handNo, round: this._round, dealer: this._dealer, winner: null, payer: null, source: null,
      winTile: null, evaluation: null, payments: [0, 0, 0, 0], scoresAfter: this._scores.slice(),
      hands: this._snapshotHands(), dealerStays: true, nextDealer: this._dealer, nextRound: this._round, gameOver: gameOver
    };
    this._lastResult = result;
    this._phase = 'handEnd';
    this._emit({ type: 'drawGame', result: result });
    this._log_push('Draw 流局 — the wall is exhausted.');
    this._emit({ type: 'handEnd', result: result });
  };

  Game.prototype._finishGame = function () {
    this._phase = 'gameEnd';
    var standings = this._scores.map(function (s, i) { return { index: i, name: this._names[i], score: s, rank: 0 }; }, this);
    standings.sort(function (a, b) { return b.score - a.score; });
    standings.forEach(function (s, i) { s.rank = i + 1; });
    this._standings = standings;
    this._emit({ type: 'gameEnd', standings: standings });
    this._log_push('Game over.');
  };

  Game.prototype.nextHand = function () {
    if (this._phase !== 'handEnd') return { ok: false, error: 'not at hand end' };
    var res = this._lastResult;
    if (res.gameOver) { this._finishGame(); return { ok: true }; }
    this._dealer = res.nextDealer;
    this._dealerRepeat = res.dealerStays ? this._dealerRepeat + 1 : 0;
    this._round = res.nextRound;
    this._beginHand();
    return { ok: true };
  };

  Game.prototype.on = function (fn) {
    this._listeners.push(fn);
    var self = this;
    return function () { var idx = self._listeners.indexOf(fn); if (idx >= 0) self._listeners.splice(idx, 1); };
  };
  Game.prototype._emit = function (evt) {
    this._listeners.slice().forEach(function (fn) { try { fn(evt); } catch (e) { if (typeof console !== 'undefined') console.error('HKMJ listener error', e); } });
  };
  Game.prototype._log_push = function (line) {
    this._log.push(line);
    if (this._log.length > 200) this._log.splice(0, this._log.length - 200);
  };

  // ------------------------------------------------------------------ view / hints

  Game.prototype.getView = function (viewer, opts) {
    opts = opts || {};
    var revealAll = !!opts.revealAll || this._phase === 'handEnd' || this._phase === 'gameEnd';
    var players = [];
    for (var p = 0; p < 4; p++) {
      var showHand = (p === viewer) || revealAll;
      players.push({
        index: p, name: this._names[p], isHuman: this._humans.indexOf(p) >= 0,
        seatWind: (p - this._dealer + 4) % 4, isDealer: p === this._dealer, score: this._scores[p],
        handCount: this._hands[p].length,
        hand: showHand ? T.sort(this._hands[p]) : null,
        drawn: (p === viewer && this._drawnTile[p] != null) ? this._drawnTile[p] : null,
        melds: this._melds[p].map(cloneMeld),
        flowers: this._flowers[p].slice().sort(function (a, b) { return a - b; }),
        discards: this._discards[p].slice(),
        lastAction: this._lastAction[p] || null
      });
    }
    return {
      viewer: viewer, handNo: this._handNo, round: this._round, dealer: this._dealer, firstDealer: this._firstDealer,
      dealerRepeat: this._dealerRepeat, dice: this._dice.slice(), wallCount: this._wallCount(),
      phase: this._phase, turn: this._turnPlayer, pending: this.getPending(), actions: this.getActions(viewer),
      blockedWin: this._computeBlockedWin(viewer), lastDiscard: this._lastDiscard, claimTile: this._claimTile,
      players: players, settings: this._settings,
      result: (this._phase === 'handEnd' || this._phase === 'gameEnd') ? this._lastResult : null,
      standings: this._phase === 'gameEnd' ? this._standings : null,
      log: this._log.slice(-60)
    };
  };

  Game.prototype._computeBlockedWin = function (viewer) {
    if (this._phase === 'turn' && this._turnPlayer === viewer && !this._afterClaim) {
      var winTile = this._winTileFor(viewer);
      if (winTile != null) {
        var ev = evaluate(this._ctxFor(viewer, winTile, 'self', { kongReplacement: Math.min(2, this._kongStreak), lastTile: this._wallCount() === 0 }));
        if (ev.winning && !ev.valid) return { fan: ev.fan, minFan: this._settings.minFan };
      }
    }
    if ((this._phase === 'claim' || this._phase === 'robKong') && this._waiting.indexOf(viewer) >= 0) {
      var opts = this._claimOptions[viewer] || [];
      var hasWin = opts.some(function (a) { return a.type === 'win'; });
      if (!hasWin) {
        var ev2 = evaluate(this._ctxFor(viewer, this._claimTile.tile, this._phase === 'robKong' ? 'robKong' : 'discard', { lastTile: this._phase === 'claim' && this._finalDiscard }));
        if (ev2.winning && !ev2.valid) return { fan: ev2.fan, minFan: this._settings.minFan };
      }
    }
    return null;
  };

  Game.prototype.getHints = function (p) {
    var hand = this._hands[p].slice();
    var drawn = (this._turnPlayer === p && this._phase === 'turn' && this._drawnTile[p] != null) ? this._drawnTile[p] : null;
    var base = hand.slice();
    if (drawn != null) { var di = base.indexOf(drawn); if (di >= 0) base.splice(di, 1); }
    var melds = this._melds[p];
    var optional = this._settings.optional;
    var seatWind = (p - this._dealer + 4) % 4;
    var waits = [];
    for (var k = 0; k < 34; k++) {
      var candidate = base.concat([k]);
      if (isWinningShape(candidate, melds, optional)) {
        var ev = evaluate({
          hand: candidate, melds: melds.map(cloneMeld), winTile: k, source: 'self', kongReplacement: 0, lastTile: false,
          seatWind: seatWind, roundWind: this._round, flowers: this._flowers[p].slice(), blessing: null, flowerWin: false, settings: this._settings
        });
        waits.push({ tile: k, left: this._unseenCount(p, k), fan: ev.fan, valid: ev.valid });
      }
    }
    var shanten = waits.length > 0 ? 0 : this._estimateShanten(base, melds);
    return { shanten: shanten, waits: waits, blockedWin: this._computeBlockedWin(p) };
  };

  Game.prototype._unseenCount = function (p, k) {
    var count = 0;
    this._hands[p].forEach(function (t) { if (t === k) count++; });
    for (var q = 0; q < 4; q++) {
      this._melds[q].forEach(function (m) { m.tiles.forEach(function (t) { if (t === k) count++; }); });
      this._discards[q].forEach(function (t) { if (t === k) count++; });
    }
    var left = 4 - count;
    return left < 0 ? 0 : left;
  };

  Game.prototype._estimateShanten = function (base, melds) {
    var optional = this._settings.optional;
    for (var i = 0; i < base.length; i++) {
      var rest = base.slice(0, i).concat(base.slice(i + 1));
      for (var k = 0; k < 34; k++) { if (isWinningShape(rest.concat([k]), melds, optional)) return 1; }
    }
    return 2;
  };

  // ------------------------------------------------------------------ persistence

  Game.prototype.serialize = function () {
    var s = {};
    ['_settings', '_names', '_humans', '_firstDealerOpt', '_presetWalls', '_started', '_scores', '_round', '_dealer',
      '_dealerRepeat', '_handNo', '_firstDealer', '_hands', '_melds', '_flowers', '_discards', '_drawnTile', '_lastAction',
      '_hasDrawnBefore', '_firstDrawFlag', '_phase', '_turnPlayer', '_afterClaim', '_wall', '_front', '_back', '_dice',
      '_lastDiscard', '_claimTile', '_waiting', '_claimOptions', '_votes', '_pendingAddKong', '_kongStreak',
      '_finalDiscard', '_dealerActed', '_handDiscardCount', '_anyMeldDeclaredThisHand', '_log', '_lastResult', '_standings'
    ].forEach(function (k) { s[k.slice(1)] = this[k]; }, this);
    s.rngState = this._rng.getState();
    return JSON.stringify(s);
  };

  Game.deserialize = function (json) {
    var s = typeof json === 'string' ? JSON.parse(json) : json;
    var g = new Game({ settings: s.settings, names: s.names, humans: s.humans, firstDealer: s.firstDealerOpt, presetWalls: s.presetWalls });
    Object.keys(s).forEach(function (k) {
      if (k === 'rngState' || k === 'settings' || k === 'names' || k === 'humans' || k === 'firstDealerOpt' || k === 'presetWalls') return;
      g['_' + k] = s[k];
    });
    g._rng = HKMJ.RNG.fromState(s.rngState);
    return g;
  };

  /** Test helper (SPEC §5.1). Assumes dealer 0 — pair with `firstDealer:0` when constructing the Game. */
  Game.buildWall = function (spec, rng) {
    spec = spec || {};
    rng = rng || HKMJ.RNG();
    var wall = new Array(144).fill(null);
    var usedCount = new Array(42).fill(0);
    function place(idx, kind) { wall[idx] = kind; usedCount[kind]++; }
    var order = dealOrderIndices(0);
    var ptr = [0, 0, 0, 0];
    var hands = spec.hands || [[], [], [], []];
    var front = 0;
    order.forEach(function (pl) {
      var tiles = hands[pl] || [];
      if (ptr[pl] >= tiles.length) throw new Error('buildWall: not enough tiles specified for hand ' + pl);
      place(front++, tiles[ptr[pl]++]);
    });
    (spec.draws || []).forEach(function (k) { place(front++, k); });
    var back = 143;
    (spec.replacements || []).forEach(function (k) { place(back--, k); });
    var totalCount = new Array(42).fill(0);
    T.fullSet().forEach(function (k) { totalCount[k]++; });
    var leftover = [];
    for (var k = 0; k < 42; k++) { for (var c = usedCount[k]; c < totalCount[k]; c++) leftover.push(k); }
    rng.shuffle(leftover);
    var li = 0;
    for (var idx = front; idx <= back; idx++) wall[idx] = leftover[li++];
    return wall;
  };

  HKMJ.Game = Game;

  // ------------------------------------------------------------------ AI

  function findFirst(arr, pred) { for (var i = 0; i < arr.length; i++) if (pred(arr[i])) return arr[i]; return null; }
  function isWinType(a) { return a.type === 'win' || a.type === 'selfWin' || a.type === 'flowerWin'; }
  function countExposedMelds(view) { return view.players[view.viewer].melds.filter(function (m) { return !m.concealed; }).length; }

  function tileUsefulness(kind, counts) {
    if (T.isHonour(kind)) return counts[kind] >= 2 ? 6 : 1;
    var r = T.rankOf(kind), s = T.suitOf(kind);
    var score = counts[kind] * 3;
    for (var d = -2; d <= 2; d++) {
      if (d === 0) continue;
      var rr = r + d;
      if (rr >= 1 && rr <= 9) score += (counts[T.tileOf(s, rr)] || 0) * (Math.abs(d) === 1 ? 2 : 1);
    }
    return score;
  }
  function safetyBonus(kind, view) {
    var n = 0;
    view.players.forEach(function (pl) {
      (pl.discards || []).forEach(function (t) { if (t === kind) n++; });
      (pl.melds || []).forEach(function (m) { m.tiles.forEach(function (t) { if (t === kind) n++; }); });
    });
    return n;
  }

  function decideClaim(view, actions, level) {
    var kong = findFirst(actions, function (a) { return a.type === 'kong'; });
    if (kong) return kong;
    var pong = findFirst(actions, function (a) { return a.type === 'pong'; });
    if (pong) {
      if (level === 'easy' || countExposedMelds(view) <= 1) return pong;
      return pong; // simplified: still claim (real ai.js should weigh the plan more carefully)
    }
    var chow = findFirst(actions, function (a) { return a.type === 'chow'; });
    if (chow && (level === 'easy' || countExposedMelds(view) <= 1)) return chow;
    return findFirst(actions, function (a) { return a.type === 'pass'; }) || actions[0];
  }

  function decideTurn(view, actions, level) {
    var kongAct = findFirst(actions, function (a) { return a.type === 'concealedKong' || a.type === 'addKong'; });
    if (kongAct) return kongAct;
    var discards = actions.filter(function (a) { return a.type === 'discard'; });
    if (!discards.length) return actions[0];
    var me = view.players[view.viewer];
    var counts = T.counts(me.hand || []);
    var best = null, bestScore = Infinity;
    discards.forEach(function (a) {
      var score = tileUsefulness(a.tile, counts);
      if (level !== 'easy') score -= safetyBonus(a.tile, view) * 1.5;
      if (score < bestScore) { bestScore = score; best = a; }
    });
    return best || discards[0];
  }

  HKMJ.AI = {
    decide: function (view, actions, opts) {
      opts = opts || {};
      try {
        if (!actions || !actions.length) return { type: 'pass' };
        var win = findFirst(actions, isWinType);
        if (win) return win;
        if (actions.length === 1) return actions[0];
        var isClaim = actions.some(function (a) { return a.type === 'pass'; }) && actions.some(function (a) { return a.type === 'pong' || a.type === 'kong' || a.type === 'chow'; });
        return isClaim ? decideClaim(view, actions, opts.level || 'normal') : decideTurn(view, actions, opts.level || 'normal');
      } catch (e) {
        if (typeof console !== 'undefined') console.error('HKMJ.AI.decide error', e);
        var fb = actions && (findFirst(actions, function (a) { return a.type === 'pass'; }) || findFirst(actions, function (a) { return a.type === 'discard'; }) || actions[0]);
        return fb || { type: 'pass' };
      }
    },
    suggest: function (view, actions) {
      try {
        if (!actions || !actions.length) return { action: { type: 'pass' }, reason: 'Nothing to do right now.' };
        var win = findFirst(actions, isWinType);
        if (win) return { action: win, reason: 'You have a valid winning hand — take it.' };
        var isClaim = actions.some(function (a) { return a.type === 'pass'; }) && actions.some(function (a) { return a.type === 'pong' || a.type === 'kong' || a.type === 'chow'; });
        if (isClaim) {
          var c = decideClaim(view, actions, 'hard');
          return { action: c, reason: c.type === 'pass' ? 'Claiming would not clearly help your hand toward the minimum Fan.' : 'Claiming this keeps your plan on track.' };
        }
        var t = decideTurn(view, actions, 'hard');
        return { action: t, reason: t.type === 'discard' ? 'A safer, less useful tile to let go of.' : 'Recommended.' };
      } catch (e) {
        if (typeof console !== 'undefined') console.error('HKMJ.AI.suggest error', e);
        return { action: actions[0], reason: 'Fallback suggestion.' };
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
