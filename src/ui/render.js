/* HK Mahjong — src/ui/render.js
 * HKMJ.UI.render*: PURE functions (view/state -> HTML string). No `document`, no `window`, no timers — safe to
 * run and unit-test in plain Node (see UI_SPEC.md §7 / tests/ui_render.test.js). app.js owns all DOM mounting
 * and event wiring; it re-renders by setting innerHTML from these functions and uses event delegation with
 * `data-action` (+ `data-*`) attributes, which this file documents inline where each is produced.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;

  // ------------------------------------------------------------------ small utils

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function signed(n) { return (n > 0 ? '+' : '') + n; }
  var SEAT_ZH = ['東', '南', '西', '北']; // 東南西北
  var SEAT_EN = ['East', 'South', 'West', 'North'];
  var ROUND_ZH = ['東風', '南風', '西風', '北風'];

  function j(o) { return esc(JSON.stringify(o)); }

  // ------------------------------------------------------------------ tile markup
  // Every tile carries a human-readable title/aria-label (accessibility, UI_SPEC §6).

  function tileLabel(kind) { return T.name(kind) + ' ' + T.zh(kind); }

  function tileMarkup(tag, kind, opts) {
    opts = opts || {};
    var art = HKMJ.TileArt;
    var back = !!opts.back;
    var label = back ? 'Face-down tile' : tileLabel(kind);
    var classes = ['tile'];
    if (opts.size) classes.push('tile-' + opts.size);
    if (opts.extraClass) classes.push(opts.extraClass);
    if (back) classes.push('tile-back');
    var attrs = ' class="' + classes.join(' ') + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"';
    if (opts.attrs) attrs += ' ' + opts.attrs;
    var id = back ? art.BACK_ID : art.symbolId(kind);
    var inner = '<svg class="tile-svg" viewBox="0 0 60 80" aria-hidden="true" focusable="false"><use href="#' + id + '"></use></svg>';
    if (opts.marker) inner += '<span class="tile-marker ' + opts.marker + '" aria-hidden="true"></span>';
    return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
  }
  function tileSpan(kind, opts) { return tileMarkup('span', kind, opts); }
  function tileButton(kind, opts) {
    opts = opts || {};
    opts.attrs = 'type="button" tabindex="0" ' + (opts.attrs || '');
    return tileMarkup('button', kind, opts);
  }
  /** The booklet's red-triangle winning-tile marker (UI_SPEC §2/§5). */
  function winMarker(kind, opts) { opts = opts || {}; opts.marker = 'win-triangle'; return tileSpan(kind, opts); }

  function tileRow(kinds, opts) {
    opts = opts || {};
    return '<span class="tile-row">' + kinds.map(function (k) { return tileSpan(k, opts); }).join('') + '</span>';
  }

  // ------------------------------------------------------------------ meld / flower / river fragments

  function meldMarkup(meld, opts) {
    opts = opts || {};
    var size = opts.size || 'meld';
    var tiles = meld.tiles;
    var body;
    if (meld.type === 'kong' && meld.concealed) {
      body = [tileSpan(tiles[0], { size: size, back: true }), tileSpan(tiles[1], { size: size }), tileSpan(tiles[2], { size: size }), tileSpan(tiles[3], { size: size, back: true })].join('');
    } else {
      body = tiles.map(function (t) { return tileSpan(t, { size: size }); }).join('');
    }
    var cls = 'meld meld-' + meld.type + (meld.added ? ' meld-added' : '');
    return '<span class="' + cls + '">' + body + '</span>';
  }
  function meldsMarkup(melds, opts) {
    if (!melds || !melds.length) return '';
    return '<span class="melds">' + melds.map(function (m) { return meldMarkup(m, opts); }).join('') + '</span>';
  }
  function flowersMarkup(flowers) {
    if (!flowers || !flowers.length) return '';
    return '<span class="flowers">' + flowers.map(function (k) { return tileSpan(k, { size: 'flower' }); }).join('') + '</span>';
  }
  function riverMarkup(discards, opts) {
    opts = opts || {};
    var latestIdx = opts.highlightLast ? discards.length - 1 : -1;
    var pulsing = opts.pulseLast;
    var cls = 'river' + (opts.zone ? ' river-' + opts.zone : '');
    var out = '<div class="' + cls + '">';
    discards.forEach(function (t, i) {
      var extra = i === latestIdx ? ' river-latest' + (pulsing ? ' river-pulse' : '') : '';
      out += tileSpan(t, { size: 'river', extraClass: extra.trim() });
    });
    out += '</div>';
    return out;
  }

  // ------------------------------------------------------------------ name plate

  function namePlate(p, view, extraClass) {
    var thinking = p._thinking ? '<span class="thinking" aria-hidden="true"><span></span><span></span><span></span></span>' : '';
    var dealer = p.isDealer ? '<span class="badge-dealer" title="Dealer">莊</span>' : '';
    var seatCircle = '<span class="seat-wind-circle" title="Seat wind: ' + esc(SEAT_EN[p.seatWind]) + '">' + SEAT_ZH[p.seatWind] + '</span>';
    var lastAct = p.lastAction ? '<span class="last-action">' + describeLastAction(p.lastAction) + '</span>' : '';
    var cls = 'name-plate' + (extraClass ? ' ' + extraClass : '') + (p.index === view.turn ? ' is-turn' : '');
    return '<div class="' + cls + '">' +
      seatCircle + '<span class="player-name">' + esc(p.index === 0 ? (p.name || 'You') : p.name) + '</span>' + dealer +
      '<span class="score">' + p.score + '</span>' + thinking + lastAct + '</div>';
  }
  function describeLastAction(a) {
    var map = { chow: '上 Chow', pong: '碰 Pong', kong: '槓 Kong', concealedKong: '暗槓', addKong: '加槓', win: '食糊', selfWin: '自摸', flowerWin: '花糊' };
    return map[a] || '';
  }

  // ------------------------------------------------------------------ centre plate

  // Screen position -> player index: 0 bottom (you), 1 right, 2 top, 3 left (SPEC.md §2.1).
  var PLATE_SIDES = [{ side: 'bottom', player: 0 }, { side: 'right', player: 1 }, { side: 'top', player: 2 }, { side: 'left', player: 3 }];
  function centrePlate(view) {
    var dice = (view.dice || []).map(function (d) { return '<span class="die">' + d + '</span>'; }).join('');
    var repeat = view.dealerRepeat > 0 ? '<div class="repeat-count">連莊 x' + view.dealerRepeat + '</div>' : '';
    var winds = PLATE_SIDES.map(function (s) {
      var pl = view.players[s.player];
      var glow = pl.index === view.turn ? ' is-turn' : '';
      return '<span class="plate-wind plate-wind-' + s.side + glow + '" title="Seat wind: ' + esc(SEAT_EN[pl.seatWind]) + '">' + SEAT_ZH[pl.seatWind] + '</span>';
    }).join('');
    return '<div class="centre-plate">' +
      '<div class="plate-round">' + ROUND_ZH[view.round] + ' ' + SEAT_EN[view.round] + ' Round</div>' +
      '<div class="plate-hand">Hand ' + view.handNo + '</div>' +
      '<div class="plate-wall">Wall ' + view.wallCount + '</div>' +
      '<div class="plate-dice">' + dice + '</div>' +
      repeat + winds +
      '</div>';
  }

  // ------------------------------------------------------------------ action bar (data-action="act" data-type=... [data-tile=] [data-tiles=])

  var ACTION_LABEL = {
    win: ['食糊', 'Win'], selfWin: ['自摸', 'Self-Pick'], flowerWin: ['花糊', 'Flower Win'],
    kong: ['槓', 'Kong'], concealedKong: ['槓', 'Kong'], addKong: ['槓', 'Kong'],
    pong: ['碰', 'Pong'], chow: ['上', 'Chow'], pass: ['過', 'Pass']
  };

  function actButton(action, opts) {
    opts = opts || {};
    var label = ACTION_LABEL[action.type] || [action.type, action.type];
    var extra = opts.extraClass ? ' ' + opts.extraClass : '';
    var fan = (action.fan !== undefined) ? ' <span class="fan-badge">' + action.fan + ' Fan</span>' : '';
    var data = 'data-action="act" data-type="' + esc(action.type) + '"';
    if (action.tile !== undefined) data += ' data-tile="' + action.tile + '"';
    if (action.tiles) data += ' data-tiles="' + j(action.tiles) + '"';
    var hint = opts.hinted ? ' hint-suggested' : '';
    var cls = 'btn btn-action btn-' + action.type + extra + hint;
    var title = action.type === 'chow' && action.tiles ? ' title="' + esc(action.tiles.map(tileLabel).join(' ')) + '"' : '';
    return '<button type="button" class="' + cls + '" ' + data + title + '>' + label[0] + ' <span class="en">' + label[1] + '</span>' + fan + '</button>';
  }

  /** During claim/robKong, a short label + the claimable tile at the LEFT end of the action bar (UI_SPEC §6/§3 fix). */
  function claimInfo(view) {
    if (view.phase !== 'claim' && view.phase !== 'robKong') return '';
    var ct = view.claimTile;
    if (!ct) return '';
    var fromYou = ct.from === 0;
    var fromName = fromYou ? 'You' : view.players[ct.from].name;
    var text = (view.phase === 'robKong')
      ? (fromName + (fromYou ? ' add' : ' adds') + ' a Kong — rob it?')
      : (fromName + (fromYou ? ' discard' : ' discards'));
    return '<div class="claim-info">' + tileSpan(ct.tile, { size: 'claim' }) + '<span class="claim-info-label">' + esc(text) + '</span></div>';
  }

  /** Groups actions for the bar: single button per type, except chow/kong with >1 option become a picker trigger. */
  function actionBar(view, ui) {
    var actions = view.actions || [];
    if (!actions.length) return '';
    var hinted = ui.hintSuggestion && ui.hintSuggestion.action;
    function isHinted(a) { return hinted && hinted.type === a.type && hinted.tile === a.tile && (!a.tiles || JSON.stringify(a.tiles) === JSON.stringify(hinted.tiles)); }
    var byType = {};
    actions.forEach(function (a) { (byType[a.type] = byType[a.type] || []).push(a); });
    var out = [];
    ['selfWin', 'win', 'flowerWin'].forEach(function (t) { if (byType[t]) out.push(actButton(byType[t][0], { hinted: isHinted(byType[t][0]) })); });
    ['kong', 'concealedKong', 'addKong'].forEach(function (t) {
      if (!byType[t]) return;
      if (byType[t].length === 1) out.push(actButton(byType[t][0], { hinted: isHinted(byType[t][0]) }));
      else out.push('<button type="button" class="btn btn-action btn-kong" data-action="open-picker" data-picker="kong">槓 <span class="en">Kong</span> …</button>');
    });
    if (byType.pong) out.push(actButton(byType.pong[0], { hinted: isHinted(byType.pong[0]) }));
    if (byType.chow) {
      if (byType.chow.length === 1) out.push(actButton(byType.chow[0], { hinted: isHinted(byType.chow[0]) }));
      else out.push('<button type="button" class="btn btn-action btn-chow" data-action="open-picker" data-picker="chow">上 <span class="en">Chow</span> …</button>');
    }
    if (view.actions.some(function (a) { return a.type === 'discard'; })) {
      out.push('<button type="button" class="btn btn-discard" data-action="discard-selected">打 <span class="en">Discard</span></button>');
    }
    if (byType.pass) out.push(actButton(byType.pass[0]));
    return '<div class="action-bar">' + claimInfo(view) + out.join('') + '</div>';
  }

  function pickerOverlay(ui) {
    if (!ui.picker) return '';
    var opts = ui.picker.options || [];
    var title = ui.picker.kind === 'chow' ? 'Choose a Chow 上' : 'Choose a Kong 槓';
    var rows = opts.map(function (a, i) {
      var tiles = a.tiles || [a.tile];
      return '<button type="button" class="picker-option" data-action="pick-option" data-index="' + i + '">' + tiles.map(function (t) { return tileSpan(t, { size: 'picker' }); }).join('') + '</button>';
    }).join('');
    return '<div class="picker-overlay"><div class="picker-box"><div class="picker-title">' + title + '</div><div class="picker-rows">' + rows + '</div>' +
      '<button type="button" class="btn btn-small" data-action="close-picker">Cancel</button></div></div>';
  }

  // ------------------------------------------------------------------ hint panel + toast + callouts

  var SHANTEN_ZH = ['', '一向聽', '二向聽', '三向聽', '四向聽', '五向聽', '六向聽'];
  function hintPanel(ui) {
    var info = ui.hintInfo;
    var sug = ui.hintSuggestion;
    var sugHtml = (sug && sug.reason) ? '<div class="hint-suggestion"><span class="hint-badge">提示</span>' + esc(sug.reason) + '</div>' : '';
    if (!info) return sugHtml ? '<div class="hint-panel">' + sugHtml + '</div>' : '';
    if (!info.waits || !info.waits.length) {
      var s = info.shanten, txt;
      if (s == null || s < 0) txt = 'Not ready yet.';
      else if (s === 0) txt = 'One good discard from ready 聽.';
      else txt = s + ' tile' + (s > 1 ? 's' : '') + ' from ready · ' + (SHANTEN_ZH[s] || (s + '向聽'));
      return '<div class="hint-panel' + (sugHtml ? '' : ' hint-panel-empty') + '">' + sugHtml + '<div class="hint-status">' + esc(txt) + '</div></div>';
    }
    var rows = info.waits.slice().sort(function (a, b) { return a.tile - b.tile; }).map(function (w) {
      // fan/valid = winning on a discard; selfFan/selfValid = by Self-Pick (engine getHints)
      var cls = (w.valid || w.selfValid) ? '' : ' wait-invalid';
      var note;
      if (w.valid) note = w.fan + ' Fan' + (w.selfValid && w.selfFan > w.fan ? ' · ' + w.selfFan + ' self-pick' : '');
      else if (w.selfValid) note = 'Self-pick only — ' + w.selfFan + ' Fan';
      else note = w.fan + ' Fan — below minimum';
      if (!w.left) { cls += ' wait-dead'; note += ' · none left'; }
      return '<div class="wait-row' + cls + '">' + tileSpan(w.tile, { size: 'wait' }) + '<span class="wait-left">' + w.left + ' left</span><span class="wait-fan">' + note + '</span></div>';
    }).join('');
    return '<div class="hint-panel">' + sugHtml + '<div class="hint-title">聽 Ready — waiting on</div>' + rows + '</div>';
  }

  function toastMarkup(view, ui) {
    var pieces = [];
    if (view.blockedWin) pieces.push('Winning shape, but only ' + view.blockedWin.fan + ' Fan — this table needs ' + view.blockedWin.minFan + '.');
    if (ui.toast) pieces.push(ui.toast.text);
    if (!pieces.length) return '';
    return '<div class="toast">' + pieces.map(function (t) { return '<div class="toast-line">' + esc(t) + '</div>'; }).join('') + '</div>';
  }

  // Screen position -> player index (matches PLATE_SIDES / RIVER_ZONE below): 0 bottom, 1 right, 2 top, 3 left.
  var SEAT_POS = ['bottom', 'right', 'top', 'left'];
  function calloutsMarkup(callouts) {
    if (!callouts || !callouts.length) return '';
    return callouts.map(function (c) {
      // The animation lives on an inner <span> so it never fights the outer element's positioning transform (fix B.7).
      return '<div class="callout callout-pos-' + SEAT_POS[c.player] + '" data-callout-id="' + c.id + '"><span class="callout-inner">' + esc(c.text) + '</span></div>';
    }).join('');
  }

  // ------------------------------------------------------------------ seats

  /** You (bottom, player 0): one centred hand/melds row, a name plate anchored bottom-left, flowers above it (fix B.2). */
  function youBlock(view, ui) {
    var me = view.players[0];
    var hand = me.hand || [];
    var drawn = me.drawn;
    var rest = hand.slice();
    if (drawn != null) { var di = rest.indexOf(drawn); if (di >= 0) rest.splice(di, 1); }
    var display = rest.concat(drawn != null ? [drawn] : []);
    var canAct = (view.actions || []).some(function (a) { return a.type === 'discard'; });
    var hintedDiscard = (ui.hintSuggestion && ui.hintSuggestion.action && ui.hintSuggestion.action.type === 'discard') ? ui.hintSuggestion.action.tile : null;
    var hintedIndex = hintedDiscard == null ? -1 : display.lastIndexOf(hintedDiscard);   // highlight exactly one tile
    var tiles = display.map(function (k, i) {
      var classes = [];
      if (drawn != null && i === display.length - 1) classes.push('tile-drawn');
      if (ui.selectedIndex === i) classes.push('tile-selected');
      if (i === hintedIndex) classes.push('hint-suggested');
      var attrs = 'data-action="tile-click" data-index="' + i + '" data-tile="' + k + '"';
      return tileButton(k, { size: 'hand', extraClass: classes.join(' '), attrs: attrs });
    }).join('');
    var handClass = 'hand-tiles' + (canAct ? ' interactive' : '');
    var row = '<div class="you-row"><div class="' + handClass + '" data-role="hand">' + tiles + '</div>' +
      meldsMarkup(me.melds, { size: 'meld-you' }) + '</div>';
    var plate = namePlate(me, view, 'you-plate');
    var flowers = (me.flowers && me.flowers.length) ? '<div class="you-flowers">' + flowersMarkup(me.flowers) + '</div>' : '';
    return row + plate + flowers;
  }

  function oppHandBacks(player, size) {
    var backs = '';
    for (var i = 0; i < player.handCount; i++) backs += tileSpan(0, { size: size, back: true });
    return backs;
  }

  /** Top (player 2): one centred row — name plate, flowers, hidden hand, melds, all facing the human (fix B.3). */
  function topBlock(player, view, ui) {
    player._thinking = !!(ui.aiThinking && ui.aiThinking[player.index]);
    return '<div class="seat-top-row">' + namePlate(player, view) + flowersMarkup(player.flowers) +
      '<div class="opp-hand">' + oppHandBacks(player, 'opphand') + '</div>' +
      meldsMarkup(player.melds, { size: 'meld-opp' }) + '</div>';
  }

  /** Left (player 3): column of name plate + flowers, then a row of [vertical hand stack][vertical meld list] (fix B.4). */
  function leftBlock(player, view, ui) {
    player._thinking = !!(ui.aiThinking && ui.aiThinking[player.index]);
    var hand = '<div class="side-hand">' + oppHandBacks(player, 'sidehand') + '</div>';
    return '<div class="seat-left-col">' + namePlate(player, view) + flowersMarkup(player.flowers) +
      '<div class="side-hand-row">' + hand + meldsMarkup(player.melds, { size: 'meld-opp' }) + '</div></div>';
  }

  /** Right (player 1): mirror of the left seat — hand stack on the outer edge, melds toward the centre (fix B.4). */
  function rightBlock(player, view, ui) {
    player._thinking = !!(ui.aiThinking && ui.aiThinking[player.index]);
    var hand = '<div class="side-hand">' + oppHandBacks(player, 'sidehand') + '</div>';
    return '<div class="seat-right-col">' + namePlate(player, view) + flowersMarkup(player.flowers) +
      '<div class="side-hand-row">' + meldsMarkup(player.melds, { size: 'meld-opp' }) + hand + '</div></div>';
  }

  // ------------------------------------------------------------------ sidebar

  function rankOf(players, index) {
    var sorted = players.slice().sort(function (a, b) { return b.score - a.score; });
    for (var i = 0; i < sorted.length; i++) if (sorted[i].index === index) return i + 1;
    return index + 1;
  }
  function scoreboard(view) {
    var rows = view.players.map(function (p) {
      return '<div class="score-row' + (p.index === 0 ? ' is-you' : '') + '">' +
        '<span class="sb-rank">#' + rankOf(view.players, p.index) + '</span>' +
        '<span class="seat-wind-circle small">' + SEAT_ZH[p.seatWind] + '</span>' +
        '<span class="sb-name">' + esc(p.index === 0 ? (p.name || 'You') : p.name) + '</span>' +
        (p.isDealer ? '<span class="badge-dealer small" title="Dealer">莊</span>' : '') +
        '<span class="sb-score">' + p.score + '</span></div>';
    }).join('');
    return '<div class="scoreboard">' + rows + '</div>';
  }
  function sidebarButtons(view, ui) {
    var soundOn = !(ui && ui.soundOn === false);
    return '<div class="sidebar-buttons">' +
      '<button type="button" class="btn" data-action="open-rules">牌例 <span class="en">Rules</span></button>' +
      '<button type="button" class="btn" data-action="open-settings">設定 <span class="en">Settings</span></button>' +
      '<button type="button" class="btn" data-action="request-new-game">新局 <span class="en">New Game</span></button>' +
      '<button type="button" class="btn btn-hint" data-action="hint-button">提示 <span class="en">Hint</span></button>' +
      '<button type="button" class="btn btn-sound' + (soundOn ? '' : ' is-off') + '" data-action="toggle-sound" title="Toggle sound" aria-pressed="' + soundOn + '">' +
      '聲 <span class="en">Sound ' + (soundOn ? 'on' : 'off') + '</span></button>' +
      '</div>';
  }
  function logPanel(log) {
    var lines = (log || []).map(function (line) {
      var cls = /wins?\b/i.test(line) ? 'log-win' : (/pongs?|kongs?|chows?/i.test(line) ? 'log-claim' : '');
      return '<div class="log-line' + (cls ? ' ' + cls : '') + '">' + esc(line) + '</div>';
    }).join('');
    return '<div class="log-panel" data-role="log">' + lines + '</div>';
  }

  // ------------------------------------------------------------------ table screen

  // Screen position -> player index for river zones (matches PLATE_SIDES / SEAT_POS): 0 bottom, 1 right, 2 top, 3 left.
  var RIVER_ZONE = ['bottom', 'right', 'top', 'left'];
  function renderTable(view, ui) {
    ui = ui || {};
    var lastFrom = view.lastDiscard ? view.lastDiscard.from : -1;
    var youCanClaim = view.phase === 'claim' && (view.actions || []).some(function (a) { return a.type !== 'pass'; });
    function riverFor(idx) {
      return riverMarkup(view.players[idx].discards, {
        zone: RIVER_ZONE[idx], highlightLast: idx === lastFrom, pulseLast: idx === lastFrom && youCanClaim
      });
    }

    // Every block below is absolutely positioned inside .felt (UI_SPEC fix B); river zones sit in front of each seat.
    var blocks = centrePlate(view) +
      youBlock(view, ui) +
      topBlock(view.players[2], view, ui) +
      leftBlock(view.players[3], view, ui) +
      rightBlock(view.players[1], view, ui) +
      riverFor(0) + riverFor(1) + riverFor(2) + riverFor(3) +
      actionBar(view, ui);

    var felt = '<div class="felt">' + blocks + '</div>';
    var sidebar = '<div class="sidebar">' + scoreboard(view) + sidebarButtons(view, ui) + hintPanel(ui) + logPanel(view.log) + '</div>';
    // Overlays live inside .canvas-scale (as .felt's siblings) so they scale with the canvas (fix A); toast/callouts
    // are sized to the felt's own box via .felt-overlays so their "centred over the felt" positions stay correct.
    var overlays = '<div class="felt-overlays">' + toastMarkup(view, ui) + calloutsMarkup(ui.callouts) + '</div>' + pickerOverlay(ui);
    return '<div class="table-screen"><div class="canvas-outer"><div class="canvas-scale">' + felt + sidebar + overlays + '</div></div></div>';
  }

  // ------------------------------------------------------------------ start screen

  function renderStart(ctx) {
    ctx = ctx || {};
    return '<div class="screen start-screen"><div class="start-card">' +
      '<h1 class="cjk-title">香港麻雀</h1>' +
      '<h2 class="en-title">Hong Kong Mahjong</h2>' +
      '<p class="subtitle">Scored by the HK Mahjong Scoring Sheet v1.0</p>' +
      '<div class="start-buttons">' +
      '<button type="button" class="btn btn-brass" data-action="request-new-game">New Game 新局</button>' +
      (ctx.saveExists ? '<button type="button" class="btn" data-action="continue-game">Continue 繼續</button>' : '') +
      '<button type="button" class="btn" data-action="open-rules">Rules 牌例</button>' +
      '<button type="button" class="btn" data-action="open-settings">Settings 設定</button>' +
      '</div></div></div>';
  }

  // ------------------------------------------------------------------ settings modal (data-field="a.b" on inputs)

  function settingsRow(label, input) { return '<label class="settings-row"><span class="settings-label">' + label + '</span>' + input + '</label>'; }
  function textInput(field, value) { return '<input type="text" data-field="' + field + '" value="' + esc(value) + '" maxlength="16"/>'; }
  function selectInput(field, value, options) {
    return '<select data-field="' + field + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function checkboxInput(field, checked) { return '<input type="checkbox" data-field="' + field + '"' + (checked ? ' checked' : '') + '/>'; }
  function numberSelect(field, value, min, max) { var opts = []; for (var i = min; i <= max; i++) opts.push([i, String(i)]); return selectInput(field, value, opts); }

  var OPTIONAL_LABELS = {
    kong: 'Kong 槓', sevenPairs: 'Seven Pairs 七對子', luxurySevenPairs: 'Luxury Seven Pairs 豪華七對',
    knitted: 'Knitted Tiles 組合龍', lesserHonours: 'Lesser Honours 全不靠', greaterHonours: 'Greater Honours 七星不靠'
  };
  var OPTIONAL_KEYS = ['kong', 'sevenPairs', 'luxurySevenPairs', 'knitted', 'lesserHonours', 'greaterHonours'];

  function renderSettingsModal(modal) {
    var d = modal.draft;
    var rows = settingsRow('Your name 姓名', textInput('name', d.name)) +
      settingsRow('Minimum Fan 最低番', numberSelect('minFan', d.minFan, 0, 5)) +
      settingsRow('Payment 賠法', selectInput('payment', d.payment, [['full', 'Discarder pays all 全銃'], ['shared', 'Shared (older tables)']])) +
      settingsRow('Unit 單位', selectInput('unit', d.unit, [['points', 'Points'], ['chips', 'Chips (Fan count)']])) +
      settingsRow('Game length 局數', selectInput('rounds', d.rounds, [[4, 'Full game (4 rounds)'], [1, 'East round only']])) +
      settingsRow('Computer level 電腦難度', selectInput('aiLevel', d.aiLevel, [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])) +
      settingsRow('Speed 速度', selectInput('speed', d.speed, [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['fast', 'Fast']])) +
      settingsRow('Hints 提示', checkboxInput('hints', d.hints)) +
      settingsRow('Sound 音效', checkboxInput('sound', d.sound));
    var toggles = OPTIONAL_KEYS.map(function (k) { return settingsRow(OPTIONAL_LABELS[k] + ' †', checkboxInput('optional.' + k, d.optional[k])); }).join('');
    var restartNotice = modal.confirmingRestart
      ? '<div class="settings-confirm"><p>Table-rule changes only take effect in a new game.</p>' +
        '<button type="button" class="btn" data-action="settings-keep-playing">Keep Playing</button>' +
        '<button type="button" class="btn btn-brass" data-action="settings-restart-now">Restart Now</button></div>'
      : '';
    var primaryLabel = modal.forNewGame ? 'Start Game 開局' : 'Save 儲存';
    return '<div class="modal-overlay"><div class="modal settings-modal" data-role="settings-modal">' +
      '<div class="modal-head"><h2 class="modal-title">Settings 設定</h2>' + (modal.forNewGame ? '' : '<button type="button" class="btn btn-icon" data-action="close-modal">✕</button>') + '</div>' +
      '<p class="settings-note">Agree these before the first deal — the booklet’s † hands vary by table.</p>' +
      '<div class="settings-rows">' + rows + '</div>' +
      '<div class="settings-rows settings-optional"><div class="settings-subhead">Table rules †</div>' + toggles + '</div>' +
      restartNotice +
      '<div class="modal-actions">' + (modal.forNewGame ? '' : '<button type="button" class="btn" data-action="settings-cancel">Cancel</button>') +
      '<button type="button" class="btn btn-brass" data-action="settings-save">' + primaryLabel + '</button>' +
      '</div></div></div>';
  }

  // ------------------------------------------------------------------ rules modal

  function rulesTabButton(tab, activeId) {
    return '<button type="button" class="rules-tab' + (tab.id === activeId ? ' active' : '') + '" data-action="rules-tab" data-tab="' + tab.id + '">' + esc(tab.label) + ' <span class="zh">' + esc(tab.zh || '') + '</span></button>';
  }
  function rulesCard(c, settings) {
    var optNote = '';
    if (c.optional) {
      var on = settings && settings.optional && settings.optional[c.id];
      optNote = '<span class="opt-state ' + (on ? 'opt-on' : 'opt-off') + '">' + (on ? 'Enabled' : 'Disabled') + '</span>';
    }
    var example = '';
    if (c.example) {
      try {
        var kinds = T.parse(c.example);
        var winK = c.winTile ? T.parse(c.winTile)[0] : null;
        // Mark only the LAST occurrence of the winning tile — not every matching tile in the example (fix C.10).
        var lastWinIdx = -1;
        if (winK != null) { for (var wi = 0; wi < kinds.length; wi++) { if (kinds[wi] === winK) lastWinIdx = wi; } }
        example = '<div class="rules-example">' + kinds.map(function (k, ki) { return (ki === lastWinIdx) ? winMarker(k, { size: 'rules' }) : tileSpan(k, { size: 'rules' }); }).join('') + '</div>';
      } catch (e) { example = ''; }
    }
    return '<div class="rules-card' + (c.optional ? ' rules-card-optional' : '') + '">' +
      '<div class="rules-card-head"><span class="fan-pill">' + esc(c.fanText) + '</span>' +
      '<span class="rules-card-name">' + esc(c.name) + ' <span class="zh">' + esc(c.zh) + '</span></span>' + optNote + '</div>' +
      '<div class="rules-card-desc">' + esc(c.desc) + '</div>' + example +
      (c.note ? '<div class="rules-card-note">' + esc(c.note) + '</div>' : '') +
      '</div>';
  }
  function rulesTabBody(tab, settings) {
    if (tab.sections) return tab.sections.map(function (s) { return '<div class="rules-section"><h3>' + esc(s.heading) + ' <span class="zh">' + esc(s.zh) + '</span></h3><p>' + esc(s.body) + '</p></div>'; }).join('');
    if (tab.cards) return '<div class="rules-cards rules-color-' + (tab.color || 'default') + '">' + tab.cards.map(function (c) { return rulesCard(c, settings); }).join('') + '</div>';
    if (tab.points) {
      var rows = '';
      for (var f = 0; f < tab.points.length; f++) rows += '<div class="pay-row"><span>' + f + (f === tab.points.length - 1 ? '+' : '') + '</span><span>' + tab.points[f] + '</span></div>';
      return '<div class="payment-table">' + rows + '</div><div class="rules-notes">' + tab.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</div>';
    }
    if (tab.combos) {
      // Booklet combination tables: base hand in the header, each row "feature (note) = TOTAL Fan"; ↑ = held at the limit.
      return '<p class="rules-intro">' + esc(tab.intro) + '</p><div class="combo-grid">' + tab.combos.map(function (c) {
        return '<div class="combo-card"><div class="combo-head"><span class="combo-title">' + esc(c.title) + ' <span class="zh">' + esc(c.zh) + '</span></span>' +
          '<span class="fan-pill">' + c.fan + ' Fan</span></div><div class="combo-sub">' + esc(c.sub) + '</div>' +
          '<div class="combo-col-head"><span>+ add</span><span>Total</span></div>' +
          c.rows.map(function (r) {
            var limit = /↑$/.test(r[2]);
            return '<div class="combo-row' + (limit ? ' is-limit' : '') + '"><span class="combo-feature">' + esc(r[0]) +
              (r[1] ? ' <em class="combo-note">(' + esc(r[1]) + ')</em>' : '') + '</span><span class="combo-total">' + esc(r[2]) + '</span></div>';
          }).join('') + '</div>';
      }).join('') + '</div>';
    }
    if (tab.chains) {
      return '<p class="rules-intro">' + esc(tab.intro) + '</p>' + tab.chains.map(function (c) {
        return '<div class="fan-chain"><div class="fan-chain-title">' + esc(c.title) + ' <span class="zh">' + esc(c.zh) + '</span></div>' +
          '<div class="fan-chain-steps">' + c.steps.map(function (s) { return '<span class="fan-chain-step">' + esc(s) + '</span>'; }).join('') + '</div></div>';
      }).join('');
    }
    return '';
  }
  function renderRulesModal(modal) {
    modal = modal || {};
    var tabs = HKMJ.RulesContent.tabs;
    var active = tabs.filter(function (t) { return t.id === modal.tab; })[0] || tabs[0];
    var tabButtons = tabs.map(function (t) { return rulesTabButton(t, active.id); }).join('');
    return '<div class="modal-overlay"><div class="modal rules-modal" data-role="rules-modal">' +
      '<div class="modal-head"><h2 class="modal-title">Rules 牌例</h2><button type="button" class="btn btn-icon" data-action="close-modal">✕</button></div>' +
      '<div class="rules-tabs">' + tabButtons + '</div>' +
      '<div class="rules-body">' + rulesTabBody(active, modal.settings) + '</div>' +
      '</div></div>';
  }

  // ------------------------------------------------------------------ hand result modal

  function groupMarkup(g, winTile) {
    var n = g.tiles.length;
    var parts = g.tiles.map(function (t, i) {
      var isWinSlot = g.hasWinTile && (g.kind === 'chow' ? t === winTile : i === n - 1);
      var back = (g.kind === 'kong' && g.concealed && g.fromMeld && (i === 0 || i === n - 1));
      var opts = { size: 'result', back: back };
      return isWinSlot ? winMarker(t, opts) : tileSpan(t, opts);
    });
    return '<span class="result-group result-group-' + g.kind + (g.fromMeld ? ' from-meld' : '') + '">' + parts.join('') + '</span>';
  }
  function winningHandDisplay(view) {
    var r = view.result;
    if (r.type !== 'win' || !r.evaluation || !r.evaluation.groups || !r.evaluation.groups.length) return '';
    return '<div class="winning-hand">' + r.evaluation.groups.map(function (g) { return groupMarkup(g, r.winTile); }).join('') + '</div>';
  }
  function resultTitle(view) {
    var r = view.result;
    if (r.type === 'draw') return { en: 'Draw', zh: '流局', sub: 'The wall is exhausted.' };
    var winnerName = r.winner === 0 ? 'You' : view.players[r.winner].name;
    var verb = r.winner === 0 ? 'win' : 'wins';
    if (r.source === 'flowers') return { en: winnerName + ' ' + verb + ' with a Flower hand', zh: '花糊', sub: '' };
    if (r.source === 'self') return { en: winnerName + ' ' + verb + ' by Self-Pick', zh: '自摸', sub: '' };
    if (r.source === 'robKong') return { en: winnerName + ' ' + verb + ' by Robbing the Kong', zh: '搶槓', sub: '' };
    var payerName = r.payer === 0 ? 'your' : (view.players[r.payer].name + '’s');
    return { en: winnerName + ' ' + verb + ' on ' + payerName + ' discard', zh: '食糊', sub: '' };
  }
  function fanTable(ev) {
    var rows = ev.items.map(function (it) {
      return '<div class="fan-row"><span class="fan-name">' + esc(it.name) + ' <span class="zh">' + esc(it.zh) + '</span></span>' +
        '<span class="fan-detail">' + esc(it.detail || '') + '</span><span class="fan-value">' + it.fan + '</span></div>';
    }).join('');
    var replaced = (ev.replaced || []).map(function (it) {
      return '<div class="fan-row fan-row-replaced"><span class="fan-name">' + esc(it.name) + ' <span class="zh">' + esc(it.zh) + '</span></span>' +
        '<span class="fan-detail">' + esc(it.reason || '') + '</span><span class="fan-value">' + it.fan + '</span></div>';
    }).join('');
    var totalText = ev.limit ? (ev.fan + ' Fan — limit (raw ' + ev.rawFan + ')') : (ev.fan + ' Fan');
    return '<div class="fan-table">' + rows + replaced + '<div class="fan-total">' + totalText + '</div></div>';
  }
  function paymentLines(view) {
    var r = view.result;
    var lines = r.payments.map(function (delta, i) {
      if (!delta) return '';
      var name = i === 0 ? 'You' : view.players[i].name;
      if (delta < 0) return '<div class="payment-line">' + esc(name) + (i === 0 ? ' pay ' : ' pays ') + Math.abs(delta) + '</div>';
      return '<div class="payment-line payment-line-win">' + esc(name) + (i === 0 ? ' receive ' : ' receives ') + delta + '</div>';
    }).join('');
    return '<div class="payment-lines">' + lines + '</div>';
  }
  function scoresAfterRow(view) {
    var r = view.result;
    return '<div class="scores-after">' + view.players.map(function (p, i) {
      var delta = r.payments ? r.payments[i] : 0;
      return '<div class="score-after-row"><span>' + esc(i === 0 ? 'You' : p.name) + '</span><span>' + r.scoresAfter[i] + '</span>' +
        '<span class="delta">' + (delta ? signed(delta) : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function nextDealLine(view) {
    var r = view.result;
    if (r.gameOver) return '<div class="next-deal">Game over — final standings next.</div>';
    var dealerName = r.nextDealer === 0 ? 'You' : view.players[r.nextDealer].name;
    if (r.dealerStays) return '<div class="next-deal">' + (r.dealer === 0 ? 'You keep' : (view.players[r.dealer].name + ' keeps')) + ' the deal.</div>';
    var roundChange = r.nextRound !== r.round ? (' — ' + ROUND_ZH[r.nextRound] + ' ' + SEAT_EN[r.nextRound] + ' Round begins') : '';
    return '<div class="next-deal">The deal passes to ' + esc(dealerName) + '.' + roundChange + '</div>';
  }
  function revealedHandsRow(view) {
    var r = view.result;
    if (!r.hands) return '';
    return '<div class="revealed-hands">' + r.hands.map(function (h, i) {
      var name = i === 0 ? 'You' : view.players[i].name;
      var fl = (h.flowers || []).map(function (k) { return tileSpan(k, { size: 'reveal' }); }).join('');
      return '<div class="revealed-hand-row' + (r.winner === i ? ' is-winner' : '') + '"><span class="revealed-name">' + esc(name) + '</span>' +
        tileRow(h.hand, { size: 'reveal' }) + meldsMarkup(h.melds, { size: 'reveal' }) +
        (fl ? '<span class="revealed-flowers">' + fl + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function renderHandResult(view) {
    var r = view.result;
    var title = resultTitle(view);
    var body = r.type === 'draw'
      ? ('<div class="result-sub">' + esc(title.sub) + '</div>' + revealedHandsRow(view))
      : (winningHandDisplay(view) + fanTable(r.evaluation) + paymentLines(view) + scoresAfterRow(view) + revealedHandsRow(view));
    return '<div class="modal-overlay"><div class="modal result-modal">' +
      '<h2 class="modal-title">' + esc(title.en) + ' <span class="zh">' + esc(title.zh) + '</span></h2>' +
      body + nextDealLine(view) +
      '<div class="modal-actions"><button type="button" class="btn btn-brass" data-action="next-hand">Next hand 下一局</button></div>' +
      '</div></div>';
  }

  // ------------------------------------------------------------------ game over modal

  function renderGameOver(view) {
    var standings = view.standings || [];
    var rows = standings.map(function (s) {
      return '<div class="standing-row' + (s.index === 0 ? ' is-you' : '') + '"><span class="standing-rank">#' + s.rank + '</span>' +
        '<span class="standing-name">' + esc(s.index === 0 ? 'You' : s.name) + '</span><span class="standing-score">' + s.score + '</span></div>';
    }).join('');
    return '<div class="modal-overlay"><div class="modal gameover-modal">' +
      '<h2 class="modal-title">Game Over 結束</h2>' +
      '<div class="standings">' + rows + '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-brass" data-action="request-new-game">New Game 新局</button></div>' +
      '</div></div>';
  }

  // ------------------------------------------------------------------ generic confirm modal

  function renderConfirmModal(modal) {
    return '<div class="modal-overlay"><div class="modal confirm-modal">' +
      '<p>' + esc(modal.message) + '</p>' +
      '<div class="modal-actions"><button type="button" class="btn" data-action="' + esc(modal.cancelAction) + '">Cancel</button>' +
      '<button type="button" class="btn btn-brass" data-action="' + esc(modal.confirmAction) + '">Confirm</button></div>' +
      '</div></div>';
  }

  // ------------------------------------------------------------------ root dispatcher

  function renderRoot(state) {
    state = state || {};
    var base = (state.screen === 'game' && state.view) ? renderTable(state.view, state.ui || {}) : renderStart({ saveExists: state.saveExists });
    var overlay = '';
    if (state.modal) {
      if (state.modal.type === 'settings') overlay = renderSettingsModal(state.modal);
      else if (state.modal.type === 'rules') overlay = renderRulesModal(state.modal);
      else if (state.modal.type === 'confirm') overlay = renderConfirmModal(state.modal);
    } else if (state.screen === 'game' && state.view) {
      if (state.view.phase === 'handEnd') overlay = renderHandResult(state.view);
      else if (state.view.phase === 'gameEnd') overlay = renderGameOver(state.view);
    }
    return base + overlay;
  }

  HKMJ.UI = HKMJ.UI || {};
  HKMJ.UI.renderTable = renderTable;
  HKMJ.UI.renderStart = renderStart;
  HKMJ.UI.renderSettingsModal = renderSettingsModal;
  HKMJ.UI.renderRulesModal = renderRulesModal;
  HKMJ.UI.renderHandResult = renderHandResult;
  HKMJ.UI.renderGameOver = renderGameOver;
  HKMJ.UI.renderConfirmModal = renderConfirmModal;
  HKMJ.UI.renderRoot = renderRoot;
  HKMJ.UI._internal = { esc: esc, tileSpan: tileSpan, tileButton: tileButton, tileLabel: tileLabel, meldMarkup: meldMarkup, winMarker: winMarker, rankOf: rankOf };

  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
