/* HK Mahjong — src/ui/tile-art.js
 * HKMJ.TileArt: builds one inline SVG <symbol> sprite (viewBox "0 0 60 80" per symbol) covering all 42 tile
 * kinds plus the tile back, per UI_SPEC.md §2 "Tile faces". Pure string generation — no DOM, safe in Node.
 * The sprite draws only the FACE ART (pips / characters / motifs); the ivory/jade "chrome" of a physical tile
 * (rounded corners, back-layer thickness, drop shadow) is CSS on the .tile element that hosts the <use>.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;

  var INK = '#1c2230', RED = '#c1272d', BLUE = '#1f4f9e', GREEN = '#1f7a3a', GOLD = '#c9a44c';
  var CJK = '\'Songti TC\',\'STSong\',\'Noto Serif CJK TC\',\'Noto Serif TC\',\'PMingLiU\',\'MingLiU\',serif';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function sym(id, inner) { return '<symbol id="' + id + '" viewBox="0 0 60 80">' + inner + '</symbol>'; }
  function text(x, y, s, opts) {
    opts = opts || {};
    var size = opts.size || 30, color = opts.color || INK, weight = opts.weight || '700';
    return '<text x="' + x + '" y="' + y + '" font-family="' + CJK + '" font-size="' + size + '" font-weight="' + weight +
      '" fill="' + color + '" text-anchor="middle" dominant-baseline="middle">' + esc(s) + '</text>';
  }

  // ------------------------------------------------------------------ pip primitives on a shared 3x3 grid
  // columns x = 16 / 30 / 44 ; rows y = 20 / 40 / 60 (viewBox is 60 wide, 80 tall)
  var COL = [16, 30, 44], ROW = [20, 40, 60];
  function pt(col, row) { return { x: COL[col], y: ROW[row] }; }

  function dotRing(p, r, color) {
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + (r * 0.32).toFixed(1) + '"/>' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (r * 0.4).toFixed(1) + '" fill="' + color + '"/>';
  }
  function bigOrnateDot(p) {
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="17" fill="none" stroke="' + RED + '" stroke-width="3"/>' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="11.5" fill="none" stroke="' + BLUE + '" stroke-width="2.6"/>' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="6" fill="' + GREEN + '"/>';
  }
  function stickBar(p, color, h) {
    h = h || 20; var w = h * 0.34;
    var x = p.x - w / 2, y = p.y - h / 2;
    var s = '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h + '" rx="' + (w * 0.35).toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
    var n1 = y + h * 0.34, n2 = y + h * 0.67;
    s += '<line x1="' + x.toFixed(1) + '" y1="' + n1.toFixed(1) + '" x2="' + (x + w).toFixed(1) + '" y2="' + n1.toFixed(1) + '" stroke="' + color + '" stroke-width="1.4"/>';
    s += '<line x1="' + x.toFixed(1) + '" y1="' + n2.toFixed(1) + '" x2="' + (x + w).toFixed(1) + '" y2="' + n2.toFixed(1) + '" stroke="' + color + '" stroke-width="1.4"/>';
    return s;
  }
  function birdGlyph(cx, cy) {
    var s = '';
    s += '<path d="M ' + (cx - 11) + ' ' + (cy + 20) + ' Q ' + (cx - 20) + ' ' + (cy - 2) + ' ' + (cx - 6) + ' ' + (cy - 14) + ' Q ' + (cx - 12) + ' ' + (cy + 6) + ' ' + (cx - 2) + ' ' + (cy + 16) + ' Z" fill="' + GREEN + '"/>'; // wing
    s += '<ellipse cx="' + cx + '" cy="' + (cy + 8) + '" rx="11" ry="16" fill="' + GREEN + '"/>'; // body
    s += '<circle cx="' + cx + '" cy="' + (cy - 12) + '" r="6.5" fill="' + GREEN + '"/>'; // head
    s += '<path d="M ' + (cx - 2) + ' ' + (cy - 20) + ' L ' + cx + ' ' + (cy - 28) + ' L ' + (cx + 4) + ' ' + (cy - 19) + ' Z" fill="' + RED + '"/>'; // crest
    s += '<circle cx="' + (cx + 3) + '" cy="' + (cy - 13) + '" r="1.3" fill="' + INK + '"/>'; // eye
    s += '<path d="M ' + cx + ' ' + (cy + 22) + ' L ' + (cx - 5) + ' ' + (cy + 33) + ' L ' + cx + ' ' + (cy + 29) + ' L ' + (cx + 5) + ' ' + (cy + 33) + ' Z" fill="' + BLUE + '"/>'; // tail
    return s;
  }

  var DOT_LAYOUTS = {
    1: function () { return bigOrnateDot(pt(1, 1)); },
    2: function () { return dotRing(pt(1, 0), 7, GREEN) + dotRing(pt(1, 2), 7, GREEN); },
    3: function () { return dotRing(pt(0, 0), 6.5, GREEN) + dotRing(pt(1, 1), 6.5, RED) + dotRing(pt(2, 2), 6.5, BLUE); },
    4: function () { return [pt(0, 0), pt(2, 0), pt(0, 2), pt(2, 2)].map(function (p) { return dotRing(p, 7, BLUE); }).join(''); },
    5: function () { return [pt(0, 0), pt(2, 0), pt(0, 2), pt(2, 2)].map(function (p) { return dotRing(p, 6.5, BLUE); }).join('') + dotRing(pt(1, 1), 7, RED); },
    6: function () {
      return [pt(0, 0), pt(2, 0)].map(function (p) { return dotRing(p, 6.5, GREEN); }).join('') +
        [pt(0, 1), pt(2, 1), pt(0, 2), pt(2, 2)].map(function (p) { return dotRing(p, 6.5, RED); }).join('');
    },
    7: function () {
      return [pt(0, 0), pt(1, 1), pt(2, 2)].map(function (p) { return dotRing(p, 6, GREEN); }).join('') +
        [pt(2, 0), pt(0, 1), pt(2, 1), pt(0, 2)].map(function (p) { return dotRing(p, 6, RED); }).join('');
    },
    8: function () {
      var cols = [22, 38], rows = [13, 30, 47, 64], out = '';
      cols.forEach(function (x) { rows.forEach(function (y) { out += dotRing({ x: x, y: y }, 5.6, BLUE); }); });
      return out;
    },
    9: function () {
      var colors = [BLUE, RED, GREEN], out = '';
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) out += dotRing(pt(c, r), 5.8, colors[r]);
      return out;
    }
  };

  var STICK_LAYOUTS = {
    1: function () { return birdGlyph(30, 40); },
    2: function () { return stickBar(pt(1, 0), GREEN) + stickBar(pt(1, 2), GREEN); },
    3: function () { return stickBar(pt(1, 0), GREEN) + stickBar(pt(0, 2), GREEN) + stickBar(pt(2, 2), GREEN); },
    4: function () { return [pt(0, 0), pt(2, 0), pt(0, 2), pt(2, 2)].map(function (p) { return stickBar(p, GREEN); }).join(''); },
    5: function () { return [pt(0, 0), pt(2, 0), pt(0, 2), pt(2, 2)].map(function (p) { return stickBar(p, GREEN); }).join('') + stickBar(pt(1, 1), RED); },
    6: function () { return [0, 1, 2].map(function (r) { return stickBar(pt(0, r), GREEN) + stickBar(pt(2, r), GREEN); }).join(''); },
    7: function () { return stickBar(pt(1, 0), RED) + [0, 1, 2].map(function (r) { return stickBar(pt(0, r), GREEN) + stickBar(pt(2, r), GREEN); }).join(''); },
    8: function () {
      var out = '';
      [14, 32, 50, 68].forEach(function (y, i) { out += stickBar({ x: 22, y: y }, GREEN); out += stickBar({ x: 38, y: y + (i % 2 ? -7 : 7) }, GREEN); });
      return out;
    },
    9: function () {
      var out = '';
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) out += stickBar(pt(c, r), c === 1 ? RED : GREEN);
      return out;
    }
  };

  function manSymbol(rank) {
    return text(30, 32, T.NUM_ZH[rank - 1], { size: 26, color: INK }) + text(30, 62, '萬', { size: 28, color: RED });
  }
  function dotsSymbol(rank) { return DOT_LAYOUTS[rank](); }
  function sticksSymbol(rank) { return STICK_LAYOUTS[rank](); }
  function windSymbol(zh) { return text(30, 44, zh, { size: 44, color: INK }); }
  function dragonSymbol(idx) {
    if (idx === 0) return text(30, 44, '中', { size: 44, color: RED });
    if (idx === 1) return text(30, 44, '發', { size: 40, color: GREEN });
    return '<rect x="13" y="15" width="34" height="50" rx="5" fill="none" stroke="' + BLUE + '" stroke-width="3"/>' +
      '<rect x="19" y="21" width="22" height="38" rx="3" fill="none" stroke="' + BLUE + '" stroke-width="2"/>';
  }

  var FLOWER_COLOR = ['#c65f8a', '#7a5ba6', GOLD, GREEN];
  function flowerMotif(idx, cx, cy) {
    var color = FLOWER_COLOR[idx];
    if (idx === 0) { // plum blossom — 5 petals in a ring
      var s = '';
      for (var i = 0; i < 5; i++) {
        var a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        s += '<circle cx="' + (cx + Math.cos(a) * 7).toFixed(1) + '" cy="' + (cy + Math.sin(a) * 7).toFixed(1) + '" r="5" fill="' + color + '"/>';
      }
      return s + '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="' + GOLD + '"/>';
    }
    if (idx === 1) { // orchid — three curved petal strokes fanning out
      var s2 = '';
      [-30, 0, 30].forEach(function (deg) {
        s2 += '<path d="M ' + cx + ' ' + (cy + 10) + ' Q ' + cx + ' ' + (cy - 12) + ' ' + cx + ' ' + (cy - 18) +
          '" stroke="' + color + '" stroke-width="4" fill="none" stroke-linecap="round" transform="rotate(' + deg + ' ' + cx + ' ' + (cy + 10) + ')"/>';
      });
      return s2 + '<circle cx="' + cx + '" cy="' + (cy + 8) + '" r="2.6" fill="' + GOLD + '"/>';
    }
    if (idx === 2) { // chrysanthemum — gold sunburst
      var s3 = '';
      for (var j = 0; j < 8; j++) {
        var a2 = (Math.PI * 2 * j) / 8;
        s3 += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + Math.cos(a2) * 11).toFixed(1) + '" y2="' + (cy + Math.sin(a2) * 11).toFixed(1) + '" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round"/>';
      }
      return s3 + '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + color + '"/>';
    }
    // bamboo — two stalk segments + leaves
    return stickBar({ x: cx, y: cy + 3 }, color, 26) +
      '<path d="M ' + cx + ' ' + (cy - 6) + ' L ' + (cx + 12) + ' ' + (cy - 14) + ' L ' + (cx + 3) + ' ' + (cy - 6) + ' Z" fill="' + color + '"/>' +
      '<path d="M ' + cx + ' ' + (cy + 2) + ' L ' + (cx - 12) + ' ' + (cy - 4) + ' L ' + (cx - 3) + ' ' + (cy + 4) + ' Z" fill="' + color + '"/>';
  }

  var SEASON_BAND = [['#f4c9d8', '#bfe3b8'], ['#bfe3b8', '#f6e08a'], ['#f2b878', '#e0714f'], ['#bcd7ef', '#eef6fb']];
  function seasonMotif(idx, gradId) {
    var band = SEASON_BAND[idx];
    return '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + band[0] + '"/><stop offset="1" stop-color="' + band[1] + '"/></linearGradient></defs>' +
      '<rect x="10" y="30" width="40" height="20" rx="8" fill="url(#' + gradId + ')" stroke="' + GOLD + '" stroke-width="1"/>';
  }

  function bonusSymbol(k) {
    var isFlower = T.isFlower(k);
    var idx = k - (isFlower ? T.FLOWER0 : T.SEASON0);
    var num = T.bonusNumber(k);
    var zh = isFlower ? T.FLOWER_ZH[idx] : T.SEASON_ZH[idx];
    var color = isFlower ? FLOWER_COLOR[idx] : INK;
    var s = text(11, 16, String(num), { size: 13, color: INK, weight: '600' });
    s += text(48, 18, zh, { size: 18, color: color, weight: '700' });
    s += isFlower ? flowerMotif(idx, 30, 46) : (seasonMotif(idx, 'hkmj-season-grad-' + idx) + text(30, 44, zh, { size: 15, color: INK, weight: '600' }));
    return s;
  }

  function backSymbol() {
    return '<rect x="4" y="4" width="52" height="72" rx="6" fill="#1f7a5c"/>' +
      '<rect x="9" y="9" width="42" height="62" rx="4" fill="none" stroke="#2e9a76" stroke-width="2"/>' +
      '<rect x="15" y="15" width="30" height="50" rx="3" fill="none" stroke="#2e9a76" stroke-width="1" opacity="0.6"/>';
  }

  function buildSymbol(k) {
    if (T.isSuit(k)) {
      var suit = T.suitOf(k), rank = T.rankOf(k);
      if (suit === 0) return manSymbol(rank);
      if (suit === 1) return dotsSymbol(rank);
      return sticksSymbol(rank);
    }
    if (T.isWind(k)) return windSymbol(T.WIND_ZH[k - T.EAST]);
    if (T.isDragon(k)) return dragonSymbol(k - T.RED);
    if (T.isBonus(k)) return bonusSymbol(k);
    return '';
  }

  function spriteSVG() {
    var out = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">';
    for (var k = 0; k < T.ALL_KINDS; k++) out += sym('tk-' + k, buildSymbol(k));
    out += sym('tk-back', backSymbol());
    out += '</svg>';
    return out;
  }

  HKMJ.TileArt = {
    spriteSVG: spriteSVG,
    symbolId: function (kind) { return 'tk-' + kind; },
    BACK_ID: 'tk-back'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.TileArt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
