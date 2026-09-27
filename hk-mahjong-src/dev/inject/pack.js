#!/usr/bin/env node
/* Dev-only helper for visual QA in the in-app browser (which cannot open local files).
 * Packs every bundled file as gzip+base64 with an FNV-1a hash so it can be shipped into the browser's
 * localStorage file-by-file (only changed files need re-sending), then assembled like build.js does.
 *   node dev/inject/pack.js                 -> table: key, hash, base64 length, changed-since-last-mark
 *   node dev/inject/pack.js --print KEY [PART] [SIZE]   -> print base64 (optionally one PART of SIZE chars)
 *   node dev/inject/pack.js --mark          -> remember current hashes as "sent"
 *   node dev/inject/pack.js --assemble      -> print the browser-side assembler snippet
 */
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib');
var ROOT = path.join(__dirname, '..', '..');
var man = JSON.parse(fs.readFileSync(path.join(ROOT, 'build.manifest.json'), 'utf8'));
var KEYS = {
  'src/ui/index.html': 'tpl', 'src/ui/styles.css': 'css',
  'src/core/tiles.js': 'tiles', 'src/core/rng.js': 'rng', 'src/core/hand.js': 'hand', 'src/core/scoring.js': 'scoring',
  'src/core/engine.js': 'engine', 'src/core/ai.js': 'ai', 'src/ui/tile-art.js': 'tileart', 'src/ui/rules-content.js': 'rules',
  'src/ui/render.js': 'render', 'src/ui/app.js': 'app'
};
function keyOf(p) { return KEYS[p] || path.basename(p).replace(/\W/g, ''); }
function fnv(t) { var h = 2166136261; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
var files = [man.template].concat(man.css, man.js);
var packed = files.map(function (p) {
  var b64 = zlib.gzipSync(fs.readFileSync(path.join(ROOT, p)), { level: 9 }).toString('base64');
  return { key: keyOf(p), path: p, b64: b64, hash: fnv(b64) };
});
var markFile = path.join(__dirname, 'sent.json');
var sent = fs.existsSync(markFile) ? JSON.parse(fs.readFileSync(markFile, 'utf8')) : {};
var args = process.argv.slice(2);
if (args[0] === '--print') {
  var f = packed.filter(function (x) { return x.key === args[1]; })[0];
  if (!f) { console.error('no key ' + args[1]); process.exit(1); }
  if (args[2] !== undefined) { var size = +(args[3] || 12000), part = +args[2]; process.stdout.write(f.b64.slice(part * size, (part + 1) * size)); }
  else process.stdout.write(f.b64);
} else if (args[0] === '--mark') {
  var m = {}; packed.forEach(function (x) { m[x.key] = x.hash; }); fs.writeFileSync(markFile, JSON.stringify(m, null, 1)); console.log('marked', Object.keys(m).length);
} else if (args[0] === '--assemble') {
  var order = packed.map(function (x) { return x.key; });
  console.log('order=' + JSON.stringify({ tpl: 'tpl', css: man.css.map(keyOf), js: man.js.map(keyOf) }));
} else {
  var total = 0;
  packed.forEach(function (x) { total += x.b64.length; console.log((x.key + '          ').slice(0, 10) + ' ' + x.hash + ' ' + String(x.b64.length).padStart(7) + (sent[x.key] === x.hash ? '' : '  CHANGED') + '  parts@12000=' + Math.ceil(x.b64.length / 12000)); });
  console.log('total b64 chars ' + total);
}
