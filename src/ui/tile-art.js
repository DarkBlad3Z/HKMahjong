/* HK Mahjong — src/ui/tile-art.js
 * HKMJ.TileArt: one inline SVG <symbol> sprite (viewBox "0 0 60 80" per symbol) for all 42 tile kinds plus the
 * tile back. Pure string generation — no DOM, safe in Node.
 *
 * Face style follows a classic Hong Kong set (white face, three inks: red, green, black):
 *   萬  black numeral (一二三四伍六七八九) over a large red 萬
 *   筒  ringed "coin" pips in green / red / black; the 1 is a large green-and-red medallion
 *   索  segmented bamboo sticks in green / red / black; the 1 is a bird
 *   winds black 東南西北, dragons red 中 / green 發 / framed 白
 *   flowers & seasons: a small picture with the name and number in the top corners
 * Every suit and honour tile carries a small red corner index (1-9, E S W N, C F, B) at the top right.
 * The sprite draws only the face art; the tile body (rounded corners, thickness, shadow) is CSS on .tile.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});
  var T = HKMJ.Tiles;

  var RED = '#c62828', GREEN = '#1e7b3c', LEAF = '#2e8b47', BLACK = '#1a1d26', BROWN = '#7a5230',
    GOLD = '#e0a100', PINK = '#d6336c', WHITE = '#ffffff';
  // Brush-style (Kai) faces first, then Song/Ming serif faces, so the characters look hand-lettered where available.
  var CJK = '\'BiauKai\',\'Kaiti TC\',\'STKaiti\',\'DFKai-SB\',\'KaiTi\',\'AR PL UKai TW\',\'Songti TC\',\'STSong\',' +
    '\'Noto Serif CJK TC\',\'Noto Serif TC\',\'PMingLiU\',\'MingLiU\',serif';
  var LATIN = 'Arial,Helvetica,sans-serif';
  var NUMERALS = ['一', '二', '三', '四', '伍', '六', '七', '八', '九'];
  var WIND_LETTER = ['E', 'S', 'W', 'N'];

  function f(n) { return (Math.round(n * 100) / 100).toString(); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // Geometry is rotated in code (no SVG transforms), so every renderer draws the faces identically.
  function rp(x, y, a, cx, cy) {
    if (!a) return [x, y];
    var r = a * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * sn, cy + dx * sn + dy * c];
  }
  function poly(pts, color, extra) {
    return '<polygon points="' + pts.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '" fill="' + color + '"' + (extra || '') + '/>';
  }
  /** Rounded rectangle as a polygon, optionally rotated a degrees about (cx, cy). */
  function rrect(x, y, w, h, r, color, a, cx, cy) {
    r = Math.min(r, w / 2, h / 2);
    var pts = [];
    [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]].forEach(function (c) {
      for (var i = 0; i <= 4; i++) { var t = (c[2] + i * 22.5) * Math.PI / 180; pts.push(rp(c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r, a, cx, cy)); }
    });
    return poly(pts, color);
  }
  /** Ellipse as a polygon, rotated a degrees about its centre. */
  function ellipseP(cx, cy, rx, ry, a, color, extra) {
    var pts = [];
    for (var i = 0; i < 32; i++) { var t = (Math.PI * 2 * i) / 32; pts.push(rp(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, a, cx, cy)); }
    return poly(pts, color, extra);
  }
  function sym(id, inner) { return '<symbol id="' + id + '" viewBox="0 0 60 80">' + inner + '</symbol>'; }
  function text(x, y, s, o) {
    o = o || {};
    return '<text x="' + f(x) + '" y="' + f(y) + '" font-family="' + (o.font || CJK) + '" font-size="' + (o.size || 30) +
      '" font-weight="' + (o.weight || '700') + '" fill="' + (o.color || BLACK) + '" text-anchor="' + (o.anchor || 'middle') +
      '" dominant-baseline="central">' + esc(s) + '</text>';
  }
  /** Small red corner index, top right (the set's "1-9 / E S W N / C F" markers). */
  function cornerIndex(s) { return text(52.5, 10, s, { font: LATIN, size: 10, color: RED, weight: '700' }); }

  // ------------------------------------------------------------------ circles (筒)
  /** A ringed coin pip: outer ring, four-petal rosette, white eye. */
  function coin(cx, cy, r, color) {
    var sw = r * 0.18, d = r * 0.34, pr = r * 0.3;
    var s = '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r - sw / 2) + '" fill="none" stroke="' + color + '" stroke-width="' + f(sw) + '"/>';
    [[d, 0], [-d, 0], [0, d], [0, -d]].forEach(function (o) {
      s += '<circle cx="' + f(cx + o[0]) + '" cy="' + f(cy + o[1]) + '" r="' + f(pr) + '" fill="' + color + '"/>';
    });
    return s + '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r * 0.13) + '" fill="' + WHITE + '"/>';
  }
  /** The 1 of circles: a large green medallion with a beaded rim and a red rosette centre. */
  function medallion(cx, cy) {
    var s = '<circle cx="' + cx + '" cy="' + cy + '" r="20.5" fill="' + GREEN + '"/>';
    for (var i = 0; i < 20; i++) {
      var a = (Math.PI * 2 * i) / 20;
      s += '<circle cx="' + f(cx + Math.cos(a) * 17.3) + '" cy="' + f(cy + Math.sin(a) * 17.3) + '" r="1.35" fill="' + WHITE + '"/>';
    }
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="14.2" fill="' + WHITE + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="12.4" fill="none" stroke="' + GREEN + '" stroke-width="1.4"/>';
    for (var j = 0; j < 8; j++) {
      var b = (Math.PI * 2 * j) / 8;
      s += '<circle cx="' + f(cx + Math.cos(b) * 6.4) + '" cy="' + f(cy + Math.sin(b) * 6.4) + '" r="2.8" fill="' + RED + '"/>';
    }
    return s + '<circle cx="' + cx + '" cy="' + cy + '" r="3.3" fill="' + RED + '"/><circle cx="' + cx + '" cy="' + cy + '" r="1.3" fill="' + WHITE + '"/>';
  }
  function coins(list, r) { return list.map(function (p) { return coin(p[0], p[1], p[3] || r, p[2]); }).join(''); }

  var DOTS = {
    1: function () { return medallion(30, 43); },
    2: function () { return coins([[30, 28, GREEN], [30, 58, BLACK]], 9); },
    3: function () { return coins([[15, 22, GREEN], [30, 43, RED], [45, 64, BLACK]], 8); },
    4: function () { return coins([[18, 28, GREEN], [42, 28, BLACK], [18, 58, BLACK], [42, 58, GREEN]], 8.6); },
    5: function () { return coins([[16, 24, GREEN], [44, 24, BLACK], [30, 43, RED], [16, 62, BLACK], [44, 62, GREEN]], 7.8); },
    6: function () { return coins([[19, 21, GREEN], [41, 21, GREEN], [19, 45, RED], [41, 45, RED], [19, 65, RED], [41, 65, RED]], 8); },
    7: function () {
      return coins([[15, 16, GREEN, 6.6], [30, 23, GREEN, 6.6], [45, 30, GREEN, 6.6]]) +
        coins([[20, 48, RED], [40, 48, RED], [20, 67, RED], [40, 67, RED]], 7.6);
    },
    8: function () {
      var l = [];
      [17, 33, 49, 65].forEach(function (y) { l.push([20, y, BLACK], [40, y, BLACK]); });
      return coins(l, 7);
    },
    9: function () {
      var l = [], colors = [GREEN, RED, BLACK];
      [21, 43, 65].forEach(function (y, r) { [14, 29, 44].forEach(function (x) { l.push([x, y, colors[r]]); }); });
      return coins(l, 6.8);
    }
  };

  // ------------------------------------------------------------------ bamboo (索)
  /** A bamboo stick: rounded stalk split by a white centre line, with nodes at both ends and the middle. */
  function stick(cx, cy, h, color, angle) {
    var w = 5.2, x = cx - w / 2, y = cy - h / 2, a = angle || 0;
    return rrect(x, y, w, h, w / 2, color, a, cx, cy) +
      rrect(cx - 0.55, y + 1.8, 1.1, h - 3.6, 0.5, WHITE, a, cx, cy) +
      rrect(x - 0.9, cy - 1.1, w + 1.8, 2.2, 1, color, a, cx, cy) +
      rrect(x - 0.6, y, w + 1.2, 2, 1, color, a, cx, cy) +
      rrect(x - 0.6, y + h - 2, w + 1.2, 2, 1, color, a, cx, cy);
  }
  function sticks(list, h) { return list.map(function (p) { return stick(p[0], p[1], p[3] || h, p[2], p[4]); }).join(''); }

  /** The 1 of bamboo: a bird on a branch. */
  function bird() {
    return '<path d="M11 71 Q30 64 50 69" stroke="' + BROWN + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      '<path d="M26 50 Q13 58 8 73 Q18 64 29 56 Z" fill="' + GREEN + '"/>' +
      '<path d="M29 53 Q20 64 17 76 Q25 67 32 57 Z" fill="' + LEAF + '"/>' +
      '<path d="M31 55 Q27 66 27 76 Q31 68 35 58 Z" fill="' + GREEN + '"/>' +
      ellipseP(33, 46, 11.5, 8.5, -30, GREEN, ' stroke="' + RED + '" stroke-width="1.6"') +
      '<path d="M25 49 Q31 38 41 41 Q35 46 28 52 Z" fill="' + RED + '"/>' +
      '<path d="M26.5 48.5 Q31 42 37 42.5" stroke="' + WHITE + '" stroke-width="0.9" fill="none"/>' +
      '<path d="M38 41 Q40 33 41.5 28" stroke="' + GREEN + '" stroke-width="4.6" fill="none" stroke-linecap="round"/>' +
      '<circle cx="42.5" cy="25" r="5.2" fill="' + RED + '"/>' +
      '<path d="M40.5 20.5 Q39 14.5 43.5 13 Q42.5 17 44.8 20 Z" fill="' + RED + '"/>' +
      '<path d="M47.2 23.6 L52.5 25.6 L47.2 27.6 Z" fill="' + BLACK + '"/>' +
      '<circle cx="43.8" cy="24.2" r="1.35" fill="' + WHITE + '"/><circle cx="44.1" cy="24.2" r="0.65" fill="' + BLACK + '"/>' +
      '<path d="M32 54 L31 66 M36.5 53 L37.5 66" stroke="' + BLACK + '" stroke-width="1.3" stroke-linecap="round"/>';
  }

  var BAMBOO = {
    1: bird,
    2: function () { return sticks([[30, 27, GREEN], [30, 57, BLACK]], 21); },
    3: function () { return sticks([[30, 27, BLACK], [19, 57, GREEN], [41, 57, GREEN]], 21); },
    4: function () { return sticks([[19, 27, GREEN], [41, 27, BLACK], [19, 57, BLACK], [41, 57, GREEN]], 21); },
    5: function () { return sticks([[17, 25, GREEN], [43, 25, BLACK], [30, 42, RED], [17, 59, BLACK], [43, 59, GREEN]], 18); },
    6: function () { return sticks([[16, 27, GREEN], [30, 27, GREEN], [44, 27, GREEN], [16, 57, BLACK], [30, 57, BLACK], [44, 57, BLACK]], 21); },
    7: function () {
      return sticks([[30, 20, RED], [16, 42, GREEN], [30, 42, GREEN], [44, 42, GREEN], [16, 64, BLACK], [30, 64, BLACK], [44, 64, BLACK]], 16.5);
    },
    8: function () { // two diamonds: "∧∧" over "∨∨"
      return sticks([[17, 32, GREEN, 21, 15], [26, 32, GREEN, 21, -15], [34, 32, GREEN, 21, 15], [43, 32, GREEN, 21, -15],
        [17, 53, BLACK, 21, -15], [26, 53, BLACK, 21, 15], [34, 53, BLACK, 21, -15], [43, 53, BLACK, 21, 15]]);
    },
    9: function () {
      var l = [], colors = [GREEN, RED, BLACK];
      [21, 43, 65].forEach(function (y) { [15, 30, 45].forEach(function (x, c) { l.push([x, y, colors[c]]); }); });
      return sticks(l, 17);
    }
  };

  // ------------------------------------------------------------------ characters, winds, dragons
  function characters(rank) {
    return text(30, 25, NUMERALS[rank - 1], { size: 23, color: BLACK }) + text(30, 57, '萬', { size: 31, color: RED });
  }
  function wind(i) { return text(29, 45, T.WIND_ZH[i], { size: 38, color: BLACK }) + cornerIndex(WIND_LETTER[i]); }
  function whiteDragon() {
    return '<rect x="13" y="13" width="34" height="56" rx="2.2" fill="none" stroke="' + BLACK + '" stroke-width="2.2"/>' +
      '<rect x="15.6" y="15.6" width="28.8" height="50.8" rx="1.4" fill="none" stroke="' + BLACK + '" stroke-width="1.5" stroke-dasharray="1.5 1.5"/>' +
      '<rect x="18.2" y="18.2" width="23.6" height="45.6" rx="1" fill="none" stroke="' + BLACK + '" stroke-width="1.1"/>' +
      [[13, 13], [44, 13], [13, 66], [44, 66]].map(function (p) {
        return '<rect x="' + p[0] + '" y="' + p[1] + '" width="3" height="3" fill="' + BLACK + '"/>';
      }).join('') +
      text(30, 41, 'B', { font: LATIN, size: 9, color: RED });
  }
  function dragon(i) {
    if (i === 0) return text(29, 45, '中', { size: 40, color: RED }) + cornerIndex('C');
    if (i === 1) return text(29, 45, '發', { size: 36, color: GREEN }) + cornerIndex('F');
    return whiteDragon();
  }

  // ------------------------------------------------------------------ flowers & seasons
  function leaf(x1, y1, x2, y2, wid, color) {
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len * wid, ny = dx / len * wid;
    return '<path d="M' + f(x1) + ' ' + f(y1) + ' Q' + f(mx + nx) + ' ' + f(my + ny) + ' ' + f(x2) + ' ' + f(y2) +
      ' Q' + f(mx - nx) + ' ' + f(my - ny) + ' ' + f(x1) + ' ' + f(y1) + 'Z" fill="' + color + '"/>';
  }
  function stroke(d, color, w) { return '<path d="' + d + '" stroke="' + color + '" stroke-width="' + w + '" fill="none" stroke-linecap="round"/>'; }
  /** Round five-petal blossom (plum / small flowers). */
  function blossom(cx, cy, r, color) {
    var s = '';
    for (var i = 0; i < 5; i++) {
      var a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      s += '<circle cx="' + f(cx + Math.cos(a) * r * 0.55) + '" cy="' + f(cy + Math.sin(a) * r * 0.55) + '" r="' + f(r * 0.5) + '" fill="' + color + '"/>';
    }
    return s + '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r * 0.3) + '" fill="' + WHITE + '"/>' +
      '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r * 0.14) + '" fill="' + GOLD + '"/>';
  }
  /** Many-petal flower head (chrysanthemum / peony): rings of narrow petals. */
  function petalHead(cx, cy, n, len, wid, color, core) {
    var s = '';
    for (var i = 0; i < n; i++) {
      var t = (Math.PI * 2 * i) / n - Math.PI / 2;
      s += leaf(cx, cy, cx + Math.cos(t) * len, cy + Math.sin(t) * len, wid, color);
    }
    return s + '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(len * 0.32) + '" fill="' + core + '"/>';
  }
  function star(cx, cy, R, r, color, rot) { // five-point leaf (maple)
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = (Math.PI * i) / 5 - Math.PI / 2 + (rot || 0), rad = i % 2 ? r : R;
      pts.push(f(cx + Math.cos(a) * rad) + ',' + f(cy + Math.sin(a) * rad));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="' + color + '" stroke-linejoin="round"/>';
  }

  var FLOWER_ART = [
    function plum() {
      return stroke('M14 76 Q18 60 28 52 Q38 44 44 30', BROWN, 2.4) + stroke('M27 53 Q19 46 17 37', BROWN, 1.6) +
        leaf(33, 48, 42, 51, 2.6, LEAF) + leaf(20, 43, 12, 46, 2.2, LEAF) +
        blossom(38, 55, 8, RED) + blossom(19, 34, 6.2, RED) + blossom(44, 28, 5, RED);
    },
    function orchid() {
      return stroke('M30 76 Q15 60 9 40', GREEN, 2) + stroke('M30 76 Q27 54 31 36', LEAF, 2) + stroke('M30 76 Q43 60 51 48', GREEN, 2) +
        stroke('M30 76 Q20 66 15 60', LEAF, 1.6) + stroke('M31 40 Q34 34 36 30', GREEN, 1.3) +
        leaf(36, 30, 36 + Math.sin(-10 * Math.PI / 180) * 15, 30 - Math.cos(-10 * Math.PI / 180) * 15, 3.2, RED) +
        leaf(36, 30, 36 + Math.sin(-80 * Math.PI / 180) * 15, 30 - Math.cos(-80 * Math.PI / 180) * 15, 3.2, RED) +
        leaf(36, 30, 36 + Math.sin(60 * Math.PI / 180) * 15, 30 - Math.cos(60 * Math.PI / 180) * 15, 3.2, RED) +
        '<circle cx="36" cy="30" r="2.2" fill="' + GOLD + '"/>' + blossom(21, 49, 4.5, PINK);
    },
    function chrysanthemum() {
      return stroke('M30 76 Q31 62 30 46', GREEN, 2.2) + leaf(30, 64, 16, 58, 3.4, LEAF) + leaf(30, 58, 45, 53, 3.4, LEAF) +
        leaf(30, 70, 42, 70, 2.6, GREEN) + petalHead(30, 36, 18, 15, 2.2, RED, GOLD);
    },
    function bamboo() {
      var s = '';
      [[23, 20, 76, 4.6], [36, 30, 76, 3.8]].forEach(function (b) {
        s += '<rect x="' + f(b[0] - b[3] / 2) + '" y="' + b[1] + '" width="' + b[3] + '" height="' + (b[2] - b[1]) + '" rx="1.6" fill="' + GREEN + '"/>';
        for (var y = b[1] + 11; y < b[2]; y += 12) s += '<rect x="' + f(b[0] - b[3] / 2 - 0.8) + '" y="' + f(y) + '" width="' + f(b[3] + 1.6) + '" height="1.8" rx="0.9" fill="' + BLACK + '" opacity="0.55"/>';
      });
      return s + leaf(23, 31, 9, 24, 2.4, LEAF) + leaf(23, 31, 12, 38, 2.2, GREEN) + leaf(36, 41, 51, 34, 2.4, LEAF) +
        leaf(36, 41, 50, 46, 2.2, GREEN) + leaf(23, 55, 10, 60, 2.2, LEAF) + leaf(36, 65, 50, 62, 2.2, LEAF);
    }
  ];
  var SEASON_ART = [
    function spring() { // peony
      return stroke('M30 76 Q29 64 30 52', GREEN, 2.2) + leaf(30, 60, 15, 54, 3.8, LEAF) + leaf(30, 56, 46, 51, 3.8, GREEN) +
        petalHead(30, 38, 10, 20, 5, PINK, RED) + petalHead(30, 38, 8, 12, 3.4, RED, GOLD);
    },
    function summer() { // lotus
      var s = '<ellipse cx="30" cy="68" rx="18" ry="6.5" fill="' + GREEN + '"/><path d="M30 68 L22 63 M30 68 L38 63 M30 68 L30 62" stroke="' + LEAF + '" stroke-width="1"/>' +
        stroke('M30 66 Q31 56 30 48', GREEN, 2);
      [-56, -28, 28, 56, 0].forEach(function (deg) {
        var t = deg * Math.PI / 180;
        s += leaf(30, 48, 30 + Math.sin(t) * 26, 48 - Math.cos(t) * 26, deg ? 6 : 6.5, deg ? PINK : RED);
      });
      return s;
    },
    function autumn() { // maple leaves on a branch
      return stroke('M10 72 Q26 58 34 44 Q40 34 48 28', BROWN, 2.2) + stroke('M31 49 Q22 44 18 36', BROWN, 1.4) +
        star(40, 50, 9, 4, RED, 0.2) + star(18, 32, 7.5, 3.3, '#e06a1b', -0.2) + star(44, 26, 6.5, 2.9, RED, 0.1) +
        star(22, 62, 6.5, 2.9, '#e06a1b', 0.3);
    },
    function winter() { // pine branch with snow-berries
      var s = stroke('M8 70 Q28 58 50 46', BROWN, 2.6) + stroke('M28 59 Q30 48 26 36', BROWN, 1.8);
      [[20, 64], [38, 53], [26, 38], [48, 44]].forEach(function (c) {
        for (var i = 0; i < 9; i++) {
          var a = Math.PI + (Math.PI * i) / 8;
          s += stroke('M' + c[0] + ' ' + c[1] + ' L' + f(c[0] + Math.cos(a) * 9) + ' ' + f(c[1] + Math.sin(a) * 9), i % 2 ? LEAF : GREEN, 1.3);
        }
      });
      return s + '<circle cx="34" cy="62" r="2.3" fill="' + RED + '"/><circle cx="38.5" cy="64" r="2" fill="' + RED + '"/>';
    }
  ];

  function bonus(k) {
    var isFlower = T.isFlower(k), idx = k - (isFlower ? T.FLOWER0 : T.SEASON0), num = String(T.bonusNumber(k));
    if (isFlower) {
      return text(12, 11, T.FLOWER_ZH[idx], { size: 11, color: BLACK }) + text(51.5, 10.5, num, { font: LATIN, size: 10, color: RED }) + FLOWER_ART[idx]();
    }
    return text(9, 10.5, num, { font: LATIN, size: 10, color: BLACK }) + text(48, 11, T.SEASON_ZH[idx], { size: 11, color: RED }) + SEASON_ART[idx]();
  }

  function back() {
    return '<rect x="4" y="4" width="52" height="72" rx="6" fill="#1f7a5c"/>' +
      '<rect x="9" y="9" width="42" height="62" rx="4" fill="none" stroke="#2e9a76" stroke-width="2"/>' +
      '<rect x="15" y="15" width="30" height="50" rx="3" fill="none" stroke="#2e9a76" stroke-width="1" opacity="0.6"/>';
  }

  function buildSymbol(k) {
    if (T.isSuit(k)) {
      var suit = T.suitOf(k), rank = T.rankOf(k);
      var art = suit === 0 ? characters(rank) : suit === 1 ? DOTS[rank]() : BAMBOO[rank]();
      return art + cornerIndex(String(rank));
    }
    if (T.isWind(k)) return wind(k - T.EAST);
    if (T.isDragon(k)) return dragon(k - T.RED);
    if (T.isBonus(k)) return bonus(k);
    return '';
  }

  function spriteSVG() {
    var out = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">';
    for (var k = 0; k < T.ALL_KINDS; k++) out += sym('tk-' + k, buildSymbol(k));
    out += sym('tk-back', back());
    return out + '</svg>';
  }

  HKMJ.TileArt = {
    spriteSVG: spriteSVG,
    symbolId: function (kind) { return 'tk-' + kind; },
    BACK_ID: 'tk-back',
    faceSVG: buildSymbol // raw face markup for one kind (used by the preview script and tests)
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.TileArt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
