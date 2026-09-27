/* HK Mahjong — src/ui/app.js
 * Controller: DOM mounting, event delegation, game loop / AI pacing, modals, settings, save/resume, sound.
 * Plain DOM APIs only; defensive try/catch around storage/audio/AI (UI_SPEC.md §6). Re-renders by setting
 * innerHTML from the pure HKMJ.UI.render* functions and relies on event delegation with data-action attributes.
 */
(function (root) {
  'use strict';
  var HKMJ = root.HKMJ || (root.HKMJ = {});

  var SETTINGS_KEY = 'hkmj.settings.v1', SAVE_KEY = 'hkmj.save.v1';
  var SPEED_TURN = { relaxed: 1100, normal: 650, fast: 250 };
  var SPEED_CLAIM = { relaxed: 700, normal: 450, fast: 150 };

  var G = null;
  var rootEl = null;
  var timers = [];
  var calloutSeq = 0;
  var audioCtx = null;
  // Debug-only autoplay (HKMJ.App.debug.autoplay): off by default, never exposed in the UI. When on, player 0's
  // decisions are made by the AI too, at normal pacing, through the same scheduling path used for the AIs.
  var autoplayOn = false;
  var state = {
    screen: 'start', view: null, settings: null, saveExists: false, modal: null,
    ui: freshUi()
  };

  function freshUi() {
    return { selectedIndex: null, hintInfo: null, hintSuggestion: null, aiThinking: {}, toast: null, callouts: [], picker: null, _graceNext: false,
      handOrder: null, handDrawn: null, handKey: null };
  }

  // ------------------------------------------------------------------ persistence (never let storage break the app)

  function defaultUiSettings() {
    var s = JSON.parse(JSON.stringify(HKMJ.DEFAULT_SETTINGS || { minFan: 3, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0, optional: {} }));
    s.name = 'You'; s.speed = 'normal'; s.hints = true; s.sound = true; s.music = true;
    s.displaySize = 'standard'; s.hoverHighlight = true; s.newTiles = 'sorted';   // display preferences (no restart needed)
    return s;
  }
  function loadSettings() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(SETTINGS_KEY);
      var base = defaultUiSettings();
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      var merged = {};
      Object.keys(base).forEach(function (k) { merged[k] = (parsed[k] !== undefined) ? parsed[k] : base[k]; });
      merged.optional = {};
      Object.keys(base.optional).forEach(function (k) { merged.optional[k] = (parsed.optional && parsed.optional[k] !== undefined) ? parsed.optional[k] : base.optional[k]; });
      return merged;
    } catch (e) { console.error('HKMJ: loadSettings failed', e); return defaultUiSettings(); }
  }
  function persistSettings() { try { root.localStorage && root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { console.error('HKMJ: persistSettings failed', e); } }
  function autosave() { try { if (G && root.localStorage) root.localStorage.setItem(SAVE_KEY, G.serialize()); } catch (e) { console.error('HKMJ: autosave failed', e); } }
  function checkSaveExists() { try { return !!(root.localStorage && root.localStorage.getItem(SAVE_KEY)); } catch (e) { return false; } }
  function clearSave() { try { root.localStorage && root.localStorage.removeItem(SAVE_KEY); } catch (e) { console.error('HKMJ: clearSave failed', e); } }
  function cloneDraft(settings) { return JSON.parse(JSON.stringify(settings)); }

  // ------------------------------------------------------------------ sound + music (synthesised WebAudio, never files)
  // Everything is generated on the fly: sound effects are short oscillator/noise envelopes and the music is an
  // original chiptune loop played by a small look-ahead sequencer. Settings → Sound (effects) and Music (loop).

  function ensureAudioCtx() {
    try {
      if (!audioCtx) {
        var Ctor = root.AudioContext || root.webkitAudioContext; if (!Ctor) return null;
        audioCtx = new Ctor();
        sfxBus = audioCtx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(audioCtx.destination);
        musicBus = audioCtx.createGain(); musicBus.gain.value = MUSIC_VOL; musicBus.connect(audioCtx.destination);
      }
      return audioCtx;
    } catch (e) { console.error('HKMJ: audio init failed', e); return null; }
  }
  function getAudioCtx() { return (state.settings && state.settings.sound) ? ensureAudioCtx() : null; }
  var sfxBus = null, musicBus = null, noiseBuf = null, MUSIC_VOL = 0.07;
  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function tone(ctx, dest, t, freq, dur, type, vol, slideTo) {
    var osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.03);
  }
  function noise(ctx, dest, t, dur, vol, hp) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = noiseBuf; filt.type = 'highpass'; filt.frequency.value = hp;
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(gain); gain.connect(dest);
    src.start(t); src.stop(t + dur + 0.02);
  }
  /** Voice-like sound: an oscillator gliding f0 -> f1 through a band-pass "mouth" that opens and closes
   *  (formants[0] -> [1] -> [2]); optional `mid` makes the pitch rise to a peak halfway (the chicken's GAWK). */
  function voice(ctx, dest, t, f0, f1, dur, type, vol, formants, mid) {
    var osc = ctx.createOscillator(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f0, t);
    if (mid) { osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45); osc.frequency.exponentialRampToValueAtTime(mid, t + dur); }
    else osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    filt.type = 'bandpass'; filt.Q.value = 3;
    filt.frequency.setValueAtTime(formants[0], t);
    filt.frequency.exponentialRampToValueAtTime(formants[1], t + dur * 0.35);
    filt.frequency.exponentialRampToValueAtTime(formants[2], t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    gain.gain.setValueAtTime(vol, t + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.03);
  }
  /** One firework: rising whistle, a boom, then a spray of crackles. */
  function firework(ctx, dest, t, size) {
    tone(ctx, dest, t, 700 + Math.random() * 300, 0.45, 'sine', 0.05, 2200 + Math.random() * 800);
    var b = t + 0.45;
    kick(ctx, dest, b, 0.6 * size); noise(ctx, dest, b, 0.9 * size, 0.35 * size, 150);
    for (var i = 0; i < 18; i++) noise(ctx, dest, b + 0.12 + Math.random() * 0.9, 0.025, 0.05 + Math.random() * 0.1, 4000 + Math.random() * 3000);
  }
  function kick(ctx, dest, t, vol) { tone(ctx, dest, t, 150, 0.14, 'sine', vol, 42); }
  /** Briefly lower the music so a fanfare stands out. */
  function duckMusic(ctx, secs) {
    if (!musicBus) return;
    var g = musicBus.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(MUSIC_VOL * 0.25, t + 0.05);
    g.setValueAtTime(MUSIC_VOL * 0.25, t + secs);
    g.linearRampToValueAtTime(MUSIC_VOL, t + secs + 0.4);
  }
  function playSound(kind) {
    try {
      var ctx = getAudioCtx(); if (!ctx) return;
      var t = ctx.currentTime + 0.01, out = sfxBus, i;
      if (kind === 'clack') { tone(ctx, out, t, 210, 0.045, 'square', 0.12); noise(ctx, out, t, 0.03, 0.08, 2500); }
      else if (kind === 'chow') {            // "nom nom nom" — three munches with a little crunch
        [0, 0.24, 0.48].forEach(function (d, j) {
          voice(ctx, out, t + d, [210, 175, 195][j], [150, 130, 140][j], 0.19, 'sawtooth', 0.22, [350, 1400, 300]);
          noise(ctx, out, t + d + 0.1, 0.05, 0.07, 3000);
        });
      } else if (kind === 'pong') {          // punchy "pa-PONG" with a drum hit
        kick(ctx, out, t, 0.5); noise(ctx, out, t, 0.08, 0.25, 1800);
        tone(ctx, out, t, midiHz(76), 0.07, 'square', 0.14); tone(ctx, out, t + 0.09, midiHz(83), 0.22, 'square', 0.15, midiHz(88));
      } else if (kind === 'kong') {          // heavier: double hit and a rising three-note stab
        kick(ctx, out, t, 0.55); kick(ctx, out, t + 0.12, 0.5); noise(ctx, out, t + 0.12, 0.1, 0.28, 1500);
        [76, 81, 88].forEach(function (m, j) { tone(ctx, out, t + j * 0.07, midiHz(m), 0.2, 'sawtooth', 0.09); });
      } else if (kind === 'win') {           // victory fanfare + fireworks
        duckMusic(ctx, 3.2);
        [72, 76, 79, 84, 88].forEach(function (m, j) { tone(ctx, out, t + j * 0.075, midiHz(m), 0.18, 'square', 0.12); });
        [72, 76, 79, 84].forEach(function (m) { tone(ctx, out, t + 0.42, midiHz(m), 0.9, 'triangle', 0.1); tone(ctx, out, t + 0.42, midiHz(m + 12), 0.7, 'square', 0.035); });
        kick(ctx, out, t + 0.42, 0.5);
        [[0.35, 1.0], [0.9, 1.25], [1.45, 0.9], [1.85, 1.1]].forEach(function (r) { firework(ctx, out, t + r[0], r[1]); });
      } else if (kind === 'chicken') {       // bawk bawk bawk... ba-GAWK!
        duckMusic(ctx, 2.0);
        [0, 0.17, 0.34, 0.62].forEach(function (d, j) { voice(ctx, out, t + d, [620, 580, 640, 600][j], [460, 430, 470, 440][j], 0.09, 'sawtooth', 0.2, [900, 1800, 1000]); });
        voice(ctx, out, t + 0.82, 520, 480, 0.1, 'sawtooth', 0.2, [900, 1700, 1100]);
        voice(ctx, out, t + 0.95, 560, 980, 0.42, 'sawtooth', 0.24, [1000, 2400, 1600], 700);
      } else if (kind === 'start') {         // "ready, go!" jingle
        duckMusic(ctx, 1.0);
        [60, 64, 67].forEach(function (m, j) { tone(ctx, out, t + j * 0.11, midiHz(m + 12), 0.1, 'square', 0.12); kick(ctx, out, t + j * 0.11, 0.3); });
        for (i = 0; i < 4; i++) tone(ctx, out, t + 0.36 + i * 0.05, midiHz(79 + i * 2), 0.06, 'square', 0.1);
        [72, 79, 84].forEach(function (m) { tone(ctx, out, t + 0.58, midiHz(m), 0.6, 'triangle', 0.12); });
        tone(ctx, out, t + 0.58, midiHz(96), 0.5, 'square', 0.05, midiHz(100)); noise(ctx, out, t + 0.58, 0.35, 0.2, 5000);
      } else if (kind === 'chime') { tone(ctx, out, t, 660, 0.13, 'sine', 0.15); tone(ctx, out, t + 0.05, 880, 0.14, 'sine', 0.15); }
    } catch (e) { console.error('HKMJ: playSound failed', e); }
  }

  // Original chiptune loop: A minor, 150 BPM, 4 bars (Am F C G) of 16th-note steps — driving bass, arpeggios,
  // a lead melody on every other pass, kick / snare / hats.
  var MUSIC = {
    bpm: 150,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    bass: [45, 41, 48, 43],
    lead: [[0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 74, 2], [8, 76, 3], [12, 79, 2], [14, 76, 2],
      [16, 77, 2], [18, 76, 2], [20, 74, 4], [24, 72, 2], [26, 74, 2], [28, 69, 4],
      [32, 72, 2], [34, 74, 2], [36, 76, 2], [38, 79, 2], [40, 81, 4], [44, 79, 2], [46, 76, 2],
      [48, 74, 2], [50, 76, 2], [52, 79, 2], [54, 76, 2], [56, 74, 4], [60, 71, 2], [62, 74, 2]]
  };
  var music = { on: false, timer: null, step: 0, pass: 0, next: 0 };
  function scheduleStep(ctx, st, t) {
    var dur = 60 / MUSIC.bpm / 4, bar = Math.floor(st / 16) % 4, inBar = st % 16, out = musicBus;
    var ch = MUSIC.chords[bar];
    if (inBar % 2 === 0) tone(ctx, out, t, midiHz(MUSIC.bass[bar] + (inBar % 4 === 2 ? 12 : 0)), dur * 1.8, 'triangle', 0.5);
    var arp = [ch[0], ch[1], ch[2], ch[1]];
    tone(ctx, out, t, midiHz(arp[inBar % 4] + 12), dur * 0.9, 'square', music.pass % 2 ? 0.07 : 0.11);
    if (inBar % 4 === 0) kick(ctx, out, t, 0.9);
    if (inBar === 4 || inBar === 12) noise(ctx, out, t, 0.12, 0.45, 1200);
    if (inBar % 4 === 2) noise(ctx, out, t, 0.035, 0.22, 7000);
    if (music.pass % 2) MUSIC.lead.forEach(function (n) {
      if (n[0] === st) { tone(ctx, out, t, midiHz(n[1]), dur * n[2] * 0.95, 'square', 0.16); tone(ctx, out, t, midiHz(n[1]) * 1.005, dur * n[2] * 0.95, 'square', 0.06); }
    });
  }
  function musicTick() {
    var ctx = audioCtx; if (!ctx || !music.on) return;
    var dur = 60 / MUSIC.bpm / 4;
    while (music.next < ctx.currentTime + 0.15) {
      try { scheduleStep(ctx, music.step, music.next); } catch (e) { /* keep the loop alive */ }
      music.next += dur;
      music.step = (music.step + 1) % 64;
      if (music.step === 0) music.pass++;
    }
  }
  function startMusic() {
    if (!state.settings || !state.settings.music || music.on) return;
    var ctx = ensureAudioCtx(); if (!ctx || !root.setInterval) return;
    try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) { /* optional */ }
    music.on = true; music.step = 0; music.pass = 0; music.next = ctx.currentTime + 0.1;
    if (musicBus) { musicBus.gain.cancelScheduledValues(ctx.currentTime); musicBus.gain.setValueAtTime(MUSIC_VOL, ctx.currentTime); }
    music.timer = root.setInterval(musicTick, 30);
  }
  function stopMusic() {
    music.on = false;
    if (music.timer && root.clearInterval) root.clearInterval(music.timer);
    music.timer = null;
    try { if (audioCtx && musicBus) { var t = audioCtx.currentTime; musicBus.gain.cancelScheduledValues(t); musicBus.gain.setValueAtTime(0.0001, t); } } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ callouts / toast

  function addCallout(player, text) {
    var id = 'c' + (calloutSeq++);
    state.ui.callouts.push({ player: player, text: text, id: id });
    render();
    timers.push(setTimeout(function () {
      state.ui.callouts = state.ui.callouts.filter(function (c) { return c.id !== id; });
      render();
    }, 1100));
  }
  function showToast(text) {
    var id = 't' + (calloutSeq++);
    state.ui.toast = { text: text, id: id };
    render();
    timers.push(setTimeout(function () { if (state.ui.toast && state.ui.toast.id === id) { state.ui.toast = null; render(); } }, 2600));
  }

  // ------------------------------------------------------------------ engine events -> sound + callouts (never hidden-tile data)

  function calloutTextForClaim(claim) { return { chow: '上 Chow!', pong: '碰 Pong!', kong: '槓 Kong!' }[claim] || claim; }
  /** Chicken hand 雞糊: a win with no Fan except from flowers/seasons (only possible with a low Minimum Fan). */
  function isChickenHand(result) {
    try {
      if (!result || result.source === 'flowers' || !result.evaluation) return false;
      var F = HKMJ.Scoring.FEATURES;
      return (result.evaluation.items || []).every(function (it) { return F[it.id] && F[it.id].group === 'bonus'; });
    } catch (e) { return false; }
  }
  function calloutTextForWin(result) { return result.source === 'self' ? '自摸!' : (result.source === 'flowers' ? '花糊!' : '食糊!'); }

  function handleEngineEvent(evt) {
    if (evt.type === 'discard') playSound('clack');
    else if (evt.type === 'claim') { playSound(evt.claim === 'chow' ? 'chow' : evt.claim === 'kong' ? 'kong' : 'pong'); addCallout(evt.player, calloutTextForClaim(evt.claim)); }
    else if (evt.type === 'concealedKong' || evt.type === 'addKong') { playSound('kong'); addCallout(evt.player, '槓 Kong!'); }
    else if (evt.type === 'robKong') { playSound('chime'); addCallout(evt.player, '搶槓!'); }
    else if (evt.type === 'win') {
      var chicken = isChickenHand(evt.result);
      playSound(chicken ? 'chicken' : 'win');
      addCallout(evt.player, chicken ? '雞糊! 🐔' : calloutTextForWin(evt.result));
    }
    else if (evt.type === 'blockedWin' && evt.player === 0) {
      var tileName = (evt.tile != null && HKMJ.Tiles) ? (HKMJ.Tiles.name(evt.tile) + ' ' + HKMJ.Tiles.zh(evt.tile) + ' completes your hand, but') : 'Winning shape, but';
      showToast(tileName + ' it is only ' + evt.fan + ' Fan — this table needs ' + evt.minFan + '.');
    }
  }
  function attachEngineListeners() {
    if (!G) return;
    G.on(function (evt) { try { handleEngineEvent(evt); } catch (e) { console.error('HKMJ: event handler failed', e); } });
  }

  // ------------------------------------------------------------------ AI pacing / game loop

  var aiTimer = null;   // exactly one pending AI step at a time (advance() may run several times per state)
  function clearTimers() { timers.forEach(function (id) { clearTimeout(id); }); timers = []; if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }
  function delayForTurn() {
    if (autoplayOn) return SPEED_TURN.normal;
    var base = SPEED_TURN[state.settings.speed] || SPEED_TURN.normal;
    if (state.ui._graceNext) { state.ui._graceNext = false; return Math.max(500, base); }
    return base;
  }
  function delayForClaim() {
    if (autoplayOn) return SPEED_CLAIM.normal;
    var base = SPEED_CLAIM[state.settings.speed] || SPEED_CLAIM.normal;
    if (state.ui._graceNext) { state.ui._graceNext = false; return Math.max(500, base); }
    return base;
  }
  function scheduleAI(fn, delay, thinkingPlayers) {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    state.ui.aiThinking = {};
    (thinkingPlayers || []).forEach(function (p) { state.ui.aiThinking[p] = true; });
    render();
    aiTimer = setTimeout(function () {
      aiTimer = null;
      (thinkingPlayers || []).forEach(function (p) { state.ui.aiThinking[p] = false; });
      fn();
    }, delay);
  }
  function safeFallback(actions) {
    actions = actions || [];
    return actions.filter(function (a) { return a.type === 'pass'; })[0] ||
      actions.filter(function (a) { return a.type === 'discard'; })[0] ||
      actions[0] || { type: 'pass' };
  }
  function aiActFor(p) {
    var view, actions, action, res;
    try { view = G.getView(p); actions = G.getActions(p); }
    catch (e) { console.error('HKMJ: getView/getActions failed', e); return; }
    if (!actions.length) return;
    // Player 0 only ever reaches here under debug autoplay (see HKMJ.App.debug below); it always decides at
    // the fixed 'normal' level, independent of the configured aiLevel used for the three computer players.
    var level = (p === 0) ? 'normal' : state.settings.aiLevel;
    try { action = HKMJ.AI.decide(view, actions, { level: level }); }
    catch (e) { console.error('HKMJ: AI.decide failed', e); action = safeFallback(actions); }
    try { res = G.act(p, action); } catch (e) { res = { ok: false, error: String(e) }; }
    if (!res.ok) {
      console.error('HKMJ: AI act failed', res.error, action);
      try { G.act(p, safeFallback(actions)); } catch (e2) { console.error('HKMJ: AI fallback act failed', e2); }
    }
  }
  function doAiTurn(p) { if (!G) return; aiActFor(p); advance(); }
  function doAiClaims(list) { if (!G) return; list.forEach(aiActFor); advance(); }

  function advance() {
    if (!G) { render(); return; }
    try { state.view = G.getView(0); } catch (e) { console.error('HKMJ: getView failed', e); }
    syncHandOrder();
    refreshHints();
    render();
    autosave();
    var pend;
    try { pend = G.getPending(); } catch (e) { console.error('HKMJ: getPending failed', e); return; }
    if (pend.type === 'gameEnd') return;
    if (pend.type === 'handEnd') {
      // Debug autoplay: keep the game moving on its own — advance to the next hand after ~1.5s (UI_SPEC debug hook).
      if (autoplayOn) {
        timers.push(setTimeout(function () {
          if (!G || !autoplayOn) return;
          var r; try { r = G.nextHand(); } catch (e) { r = { ok: false, error: String(e) }; }
          if (!r.ok) { console.error('HKMJ: autoplay nextHand failed', r.error); return; }
          state.ui.selectedIndex = null; state.ui.hintSuggestion = null; state.ui.picker = null;
          advance();
        }, 1500));
      }
      return;
    }
    if (pend.type === 'turn') {
      if (pend.player !== 0 || autoplayOn) scheduleAI(function () { doAiTurn(pend.player); }, delayForTurn(), [pend.player]);
      return;
    }
    if (pend.type === 'claim' || pend.type === 'robKong') {
      var aiList = (pend.waiting || []).filter(function (p) { return p !== 0 || autoplayOn; });
      if (aiList.length) scheduleAI(function () { doAiClaims(aiList); }, delayForClaim(), aiList);
      return;
    }
  }

  function refreshHints() {
    state.ui.hintInfo = null;
    if (!G || !state.settings.hints) return;
    try { state.ui.hintInfo = G.getHints(0); } catch (e) { console.error('HKMJ: getHints failed', e); }
  }

  function humanAct(action) {
    if (!G) return;
    var res;
    try { res = G.act(0, action); } catch (e) { res = { ok: false, error: String(e) }; }
    if (!res.ok) { console.error('HKMJ: human act failed', res.error, action); showToast('That is not available right now.'); return; }
    state.ui.selectedIndex = null; state.ui.picker = null; state.ui.hintSuggestion = null;
    state.ui._graceNext = true;
    advance();
  }

  // ------------------------------------------------------------------ new game / settings diff

  function gameSettingsDiffer(draft, active) {
    if (!active) return false;
    var keys = ['minFan', 'payment', 'unit', 'rounds', 'aiLevel'];
    for (var i = 0; i < keys.length; i++) if (draft[keys[i]] !== active[keys[i]]) return true;
    var optKeys = Object.keys((HKMJ.DEFAULT_SETTINGS && HKMJ.DEFAULT_SETTINGS.optional) || {});
    for (var j = 0; j < optKeys.length; j++) if (!!draft.optional[optKeys[j]] !== !!active.optional[optKeys[j]]) return true;
    return false;
  }
  function startNewGame(draft) {
    state.settings = draft;
    persistSettings();
    var engineSettings = {
      minFan: draft.minFan, payment: draft.payment, unit: draft.unit, rounds: draft.rounds,
      aiLevel: draft.aiLevel, startingScore: (HKMJ.DEFAULT_SETTINGS && HKMJ.DEFAULT_SETTINGS.startingScore) || 0,
      optional: draft.optional
    };
    clearTimers();
    try {
      G = new HKMJ.Game({ settings: engineSettings, names: [draft.name || 'You', 'Julie', 'Bell', 'Patt'], humans: [0] });
      attachEngineListeners();
      G.start();
    } catch (e) {
      console.error('HKMJ: failed to start game', e);
      showToast('Could not start a new game. Check the console.');
      return;
    }
    state.screen = 'game'; state.modal = null; state.ui = freshUi();
    playSound('start'); startMusic();
    advance();
  }
  function continueGame() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(SAVE_KEY);
      if (!raw) { showToast('No saved game found.'); return; }
      G = HKMJ.Game.deserialize(raw);
      attachEngineListeners();
    } catch (e) {
      console.error('HKMJ: continueGame failed', e);
      showToast('That save could not be loaded.');
      clearSave();
      return;
    }
    state.screen = 'game'; state.modal = null; state.ui = freshUi();
    playSound('start'); startMusic();
    advance();
  }

  // ------------------------------------------------------------------ hand display order (mirrors render.js youBlock)

  function handDisplayOrder(view) { return HKMJ.UI.handOrder.display(view, state.ui).kinds; }

  /** Keep your arrangement in step with the engine's hand: new deal -> sorted; otherwise tiles that left are
   *  dropped, new tiles are placed per Settings → New tiles go, and the tile just drawn sits apart at the right. */
  function syncHandOrder() {
    var view = state.view, ho = HKMJ.UI && HKMJ.UI.handOrder;
    if (!view || !view.players || !view.players[0] || !ho) return;
    var me = view.players[0], key = String(view.handNo);
    var prev = (state.ui.handKey === key && state.ui.handOrder) ? { order: state.ui.handOrder, drawn: state.ui.handDrawn } : null;
    try {
      var r = ho.reconcile(prev, me.hand || [], me.drawn, { placeNew: state.settings && state.settings.newTiles });
      state.ui.handOrder = r.order; state.ui.handDrawn = r.drawn; state.ui.handKey = key;
    } catch (e) { console.error('HKMJ: hand order sync failed', e); state.ui.handOrder = null; state.ui.handDrawn = null; }
  }
  function sortHand() {
    var view = state.view; if (!view || !view.players) return;
    var me = view.players[0];
    var r = HKMJ.UI.handOrder.sorted(me.hand || [], me.drawn);
    state.ui.handOrder = r.order; state.ui.handDrawn = r.drawn; state.ui.handKey = String(view.handNo);
    state.ui.selectedIndex = null;
    render();
  }
  /** Discarding by clicking a tile: take out exactly that copy, so identical tiles elsewhere keep their places. */
  function forgetDiscarded(idx, kind) {
    if (!state.view) return;
    var order = handDisplayOrder(state.view);
    if (idx == null || order[idx] !== kind) return;
    var wasApart = state.ui.handDrawn !== null && state.ui.handDrawn !== undefined && idx === order.length - 1;
    order.splice(idx, 1);
    state.ui.handOrder = order;
    if (wasApart) state.ui.handDrawn = null;
    state.ui.handKey = String(state.view.handNo);
  }
  /** Move the tile at display index `from` to `to` (drag and drop, Shift+arrow keys). */
  function moveHandTile(from, to) {
    var order = handDisplayOrder(state.view);
    if (from === to || from < 0 || from >= order.length) return false;
    state.ui.handOrder = HKMJ.UI.handOrder.move(order, from, to);
    state.ui.handDrawn = null;              // once you arrange tiles yourself the drawn tile just joins the row
    state.ui.handKey = String(state.view.handNo);
    return true;
  }
  function moveSelection(delta, len) {
    if (!len) return;
    var cur = state.ui.selectedIndex;
    var next = (cur == null) ? (delta > 0 ? 0 : len - 1) : Math.max(0, Math.min(len - 1, cur + delta));
    state.ui.selectedIndex = next;
    render();
  }

  // ------------------------------------------------------------------ render

  var renderPending = false;
  function render() {
    if (!rootEl) return;
    if (drag && drag.moved) { renderPending = true; return; }   // never replace the hand under a tile being dragged
    renderPending = false;
    if (state.ui && state.settings) {
      state.ui.soundOn = !!state.settings.sound;
      state.ui.musicOn = state.settings.music !== false;
      state.ui.displaySize = state.settings.displaySize || 'standard';
      state.ui.hoverHighlight = state.settings.hoverHighlight !== false;
    }
    try { rootEl.innerHTML = HKMJ.UI.renderRoot(state); }
    catch (e) {
      console.error('HKMJ: render failed', e);
      try { rootEl.innerHTML = '<div class="fatal-error">Something went wrong rendering the table — check the console.</div>'; } catch (e2) { /* nothing more we can do */ }
    }
    applyCanvasScale();
    applySeatFit();
    applyHoverHighlight();
    try { var logEl = rootEl.querySelector('.log-panel'); if (logEl) logEl.scrollTop = logEl.scrollHeight; } catch (e3) { /* cosmetic */ }
  }

  /** Last resort for a seat that still overflows its edge after overlapping hidden tiles (e.g. four Kongs at
   *  Extra large): shrink that seat only, so it never covers a neighbour. Measured in canvas px (offset sizes). */
  function applySeatFit() {
    try {
      var z = HKMJ.UI.SIZES[(state.settings && state.settings.displaySize) || 'standard'] || HKMJ.UI.SIZES.standard;
      var F = HKMJ.UI.FELT, rowAvail = F.w - 2 * (2 * F.edge + z.hh), colAvail = F.h - 2 * F.edge;
      [['.seat-bottom', 'w', rowAvail], ['.seat-top', 'w', rowAvail], ['.seat-left', 'h', colAvail], ['.seat-right', 'h', colAvail]].forEach(function (c) {
        var el = rootEl.querySelector(c[0]);
        if (!el || !el.style || !el.style.setProperty) return;
        var len = c[1] === 'w' ? el.offsetWidth : el.offsetHeight;
        var fit = (len && len > c[2]) ? Math.max(0.5, c[2] / len) : 1;
        el.style.setProperty('--fit', String(fit));
      });
    } catch (e) { /* cosmetic */ }
  }

  // ------------------------------------------------------------------ Settings → Highlight matching tiles
  var hoverKind = null;
  function applyHoverHighlight() {
    try {
      var old = rootEl.querySelectorAll('.tile-match');
      for (var i = 0; i < old.length; i++) old[i].classList.remove('tile-match');
      if (hoverKind === null || !state.settings || state.settings.hoverHighlight === false || (drag && drag.moved)) return;
      var list = rootEl.querySelectorAll('.table-screen .tile[data-kind="' + hoverKind + '"]');
      for (var j = 0; j < list.length; j++) list[j].classList.add('tile-match');
    } catch (e) { /* cosmetic */ }
  }
  function kindUnder(target) {
    var t = target && target.closest ? target.closest('.tile[data-kind]') : null;
    return t ? t.getAttribute('data-kind') : null;
  }
  function onMouseOver(e) {
    if (!state.settings || state.settings.hoverHighlight === false || (drag && drag.moved)) return;
    var k = kindUnder(e.target);
    if (k === hoverKind) return;
    hoverKind = k;
    applyHoverHighlight();
  }
  function onMouseLeave() { if (hoverKind !== null) { hoverKind = null; applyHoverHighlight(); } }

  /** The table is a fixed 1440x900 design canvas (UI_SPEC.md §3), scaled uniformly to fit the window and
   * centred, letterboxed by the rail colour (CSS handles the letterbox background; this just sizes the box). */
  function applyCanvasScale() {
    try {
      var wrap = rootEl.querySelector('.canvas-outer');
      var canvas = rootEl.querySelector('.canvas-scale');
      if (!wrap || !canvas) return;
      var scale = Math.min(wrap.clientWidth / 1440, wrap.clientHeight / 900);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      scale = Math.max(0.35, scale);
      canvasScale = scale;
      canvas.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    } catch (e) { console.error('HKMJ: canvas scale failed', e); }
  }
  var canvasScale = 1;
  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyCanvasScale, 80);
  }

  // ------------------------------------------------------------------ event delegation

  function closestWithAction(el) {
    while (el && el !== rootEl) {
      if (el.getAttribute && el.getAttribute('data-action')) return el;
      el = el.parentNode;
    }
    return null;
  }

  function dispatch(action, el) {
    switch (action) {
      case 'request-new-game': {
        var activeGame = G && state.view && state.view.phase !== 'gameEnd';
        state.modal = activeGame
          ? { type: 'confirm', message: 'Start a new game? Your current game will be lost.', confirmAction: 'open-new-game-settings', cancelAction: 'close-modal' }
          : { type: 'settings', draft: cloneDraft(state.settings), forNewGame: true };
        render();
        return;
      }
      case 'open-new-game-settings':
        state.modal = { type: 'settings', draft: cloneDraft(state.settings), forNewGame: true };
        render();
        return;
      case 'continue-game': continueGame(); return;
      case 'open-rules':
        state.modal = { type: 'rules', tab: 'basics', settings: state.settings };
        render();
        return;
      case 'rules-tab':
        if (state.modal && state.modal.type === 'rules') { state.modal.tab = el.getAttribute('data-tab'); render(); }
        return;
      case 'open-settings':
        state.modal = { type: 'settings', draft: cloneDraft(state.settings), forNewGame: false };
        render();
        return;
      case 'close-modal': case 'settings-cancel': state.modal = null; render(); return;
      case 'settings-save': {
        var draft = state.modal.draft;
        if (state.modal.forNewGame) { startNewGame(draft); return; }
        var active = state.view ? state.view.settings : null;
        if (active && gameSettingsDiffer(draft, active)) { state.modal.confirmingRestart = true; render(); return; }
        state.settings = draft; persistSettings(); state.modal = null; syncMusic(); render();
        return;
      }
      case 'settings-restart-now': startNewGame(state.modal.draft); return;
      case 'settings-keep-playing': state.settings = state.modal.draft; persistSettings(); state.modal = null; syncMusic(); render(); return;
      case 'tile-click': {
        var idx = +el.getAttribute('data-index'), kind = +el.getAttribute('data-tile');
        var canDiscard = state.view && (state.view.actions || []).some(function (a) { return a.type === 'discard'; });
        if (!canDiscard) return;   // not your turn to discard: ignore instead of nagging
        if (state.ui.selectedIndex === idx) { forgetDiscarded(idx, kind); humanAct({ type: 'discard', tile: kind }); }
        else { state.ui.selectedIndex = idx; render(); }
        return;
      }
      case 'discard-selected': {
        if (state.ui.selectedIndex == null || !state.view) { showToast('Select a tile first.'); return; }
        var hand = handDisplayOrder(state.view), k = hand[state.ui.selectedIndex];
        if (k != null) { forgetDiscarded(state.ui.selectedIndex, k); humanAct({ type: 'discard', tile: k }); }
        return;
      }
      case 'act': {
        var type = el.getAttribute('data-type');
        var act = { type: type };
        if (el.hasAttribute('data-tile')) act.tile = +el.getAttribute('data-tile');
        if (el.hasAttribute('data-tiles')) { try { act.tiles = JSON.parse(el.getAttribute('data-tiles')); } catch (e) { act.tiles = null; } }
        humanAct(act);
        return;
      }
      case 'open-picker': {
        var pk = el.getAttribute('data-picker');
        var wanted = pk === 'chow' ? ['chow'] : ['kong', 'concealedKong', 'addKong'];
        var opts = ((state.view && state.view.actions) || []).filter(function (a) { return wanted.indexOf(a.type) >= 0; });
        state.ui.picker = { kind: pk, options: opts };
        render();
        return;
      }
      case 'pick-option': {
        var pi = +el.getAttribute('data-index');
        var opt = state.ui.picker && state.ui.picker.options[pi];
        state.ui.picker = null;
        if (opt) humanAct(opt); else render();
        return;
      }
      case 'close-picker': state.ui.picker = null; render(); return;
      case 'hint-button': {
        if (!state.view) return;
        try { state.ui.hintSuggestion = HKMJ.AI.suggest(state.view, state.view.actions || []); }
        catch (e) { console.error('HKMJ: AI.suggest failed', e); state.ui.hintSuggestion = null; }
        render();
        return;
      }
      case 'toggle-sound': state.settings.sound = !state.settings.sound; persistSettings(); render(); return;
      case 'toggle-music':
        state.settings.music = !state.settings.music; persistSettings();
        if (state.settings.music && state.screen === 'game') startMusic(); else stopMusic();
        render(); return;
      case 'sort-hand': sortHand(); return;
      case 'next-hand': {
        if (!G) return;
        var r; try { r = G.nextHand(); } catch (e) { r = { ok: false, error: String(e) }; }
        if (!r.ok) { console.error('HKMJ: nextHand failed', r.error); return; }
        state.ui.selectedIndex = null; state.ui.hintSuggestion = null; state.ui.picker = null;
        advance();
        return;
      }
      default:
        if (state.modal && action === state.modal.confirmAction) { dispatch(action === 'open-new-game-settings' ? action : 'close-modal', el); }
    }
  }

  /** Browsers only allow audio after a user gesture: create/resume the context on the first click. */
  function syncMusic() { if (state.settings && state.settings.music && state.screen === 'game') startMusic(); else stopMusic(); }
  function unlockAudio() {
    try {
      var ctx = (state.settings && (state.settings.sound || state.settings.music)) ? ensureAudioCtx() : null;
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (e) { /* audio is optional */ }
  }
  // Pointer handling. The table re-renders by innerHTML whenever an AI timer, callout or toast fires. If that happens
  // between mousedown and mouseup, the pressed element is replaced and the browser never fires 'click' — the player's
  // tap is silently lost. So a real pointer press is dispatched on pointerup when it is released over an element with
  // the same action signature as the one pressed (re-rendered or not). 'click' still handles keyboard activation
  // (Enter/Space on a focused button) and synthetic clicks, and is ignored right after a pointer dispatch.
  var downSig = null, lastPointerDispatch = 0;
  // Dragging your hand tiles. A press on a hand tile becomes a drag once it moves 6px; until then it is a click.
  var drag = null;   // { idx, x0, y0, el, moved, id, rects, target, marker, hand }
  function actionSig(el) {
    if (!el) return null;
    return ['data-action', 'data-type', 'data-tile', 'data-tiles', 'data-index', 'data-picker', 'data-tab']
      .map(function (a) { return el.getAttribute(a) || ''; }).join('|');
  }
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) { downSig = null; return; }
    downSig = actionSig(closestWithAction(e.target));
    // touch screens have no hover: a tap on any face-up tile highlights its matches instead
    if (e.pointerType === 'touch' && state.settings && state.settings.hoverHighlight !== false) { hoverKind = kindUnder(e.target); applyHoverHighlight(); }
    var tileEl = e.target && e.target.closest ? e.target.closest('.hand-tiles .tile') : null;
    drag = null;
    if (tileEl && !state.modal && state.screen === 'game') {
      drag = { idx: +tileEl.getAttribute('data-index'), x0: e.clientX, y0: e.clientY, el: tileEl, moved: false, id: e.pointerId };
    }
  }
  function startDrag(e) {
    drag.moved = true;
    drag.hand = drag.el.parentNode;
    var tiles = drag.hand.querySelectorAll('.tile');
    drag.rects = [];
    for (var i = 0; i < tiles.length; i++) drag.rects.push(tiles[i].getBoundingClientRect());
    drag.hand.classList.add('drag-active');
    drag.el.classList.add('tile-dragging');
    drag.el.classList.remove('tile-match');
    try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    drag.marker = root.document.createElement('div');
    drag.marker.className = 'drop-marker';
    drag.hand.appendChild(drag.marker);
    onMouseLeave();
  }
  /** Where the dragged tile would land: before the first other tile whose centre is right of the pointer. */
  function dropIndexAt(x) {
    var target = 0;
    for (var i = 0; i < drag.rects.length; i++) {
      if (i === drag.idx) continue;
      var r = drag.rects[i];
      if (x > r.left + r.width / 2) target++;
    }
    return target;
  }
  function onPointerMove(e) {
    if (!drag || (drag.id !== undefined && e.pointerId !== drag.id)) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) { if (dx * dx + dy * dy < 36) return; startDrag(e); }
    var sc = canvasScale || 1;
    drag.el.style.transform = 'translate(' + (dx / sc) + 'px,' + (dy / sc - 8) + 'px)';
    drag.target = dropIndexAt(e.clientX);
    // marker sits in the gap before the tile that will follow the dropped one (in unscaled hand coordinates)
    var others = [];
    for (var i = 0; i < drag.rects.length; i++) if (i !== drag.idx) others.push(drag.rects[i]);
    var handRect = drag.hand.getBoundingClientRect(), xs;
    if (!others.length) xs = drag.rects[drag.idx].left;
    else if (drag.target >= others.length) xs = others[others.length - 1].right + 2;
    else xs = others[drag.target].left - 2;
    drag.marker.style.left = ((xs - handRect.left) / sc) + 'px';
    if (e.preventDefault) e.preventDefault();
  }
  function endDrag(commit) {
    var d = drag; drag = null;
    if (!d) return;
    try { if (d.marker && d.marker.parentNode) d.marker.parentNode.removeChild(d.marker); } catch (err) { /* ignore */ }
    if (commit && d.target !== undefined && state.view) {
      if (moveHandTile(d.idx, d.target)) state.ui.selectedIndex = null;
    }
    syncHandOrder();
    render();
  }
  function onPointerCancel() { if (drag && drag.moved) endDrag(false); drag = null; }
  function onPointerUp(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (drag && drag.moved) { endDrag(true); downSig = null; lastPointerDispatch = Date.now(); return; }
    drag = null;
    if (renderPending) render();
    var el = closestWithAction(e.target), sig = actionSig(el), pressed = downSig;
    downSig = null;
    if (!el || !sig || sig !== pressed) return;
    unlockAudio();
    lastPointerDispatch = Date.now();
    dispatch(el.getAttribute('data-action'), el);
  }
  function onClick(e) {
    if (Date.now() - lastPointerDispatch < 700) return;   // already handled on pointerup
    unlockAudio();
    var el = closestWithAction(e.target);
    if (!el) return;
    dispatch(el.getAttribute('data-action'), el);
  }
  // A double-click is two clicks: the first selects a tile, the second (on the selected tile) discards it,
  // so no separate dblclick handler is needed (one would try to discard a second tile).
  function onFormChange(e) {
    var el = e.target;
    var field = el.getAttribute && el.getAttribute('data-field');
    if (!field || !state.modal || state.modal.type !== 'settings') return;
    var value = (el.type === 'checkbox') ? el.checked : el.value;
    if (field === 'minFan' || field === 'rounds') value = +value;
    if (field.indexOf('optional.') === 0) state.modal.draft.optional[field.slice(9)] = value;
    else state.modal.draft[field] = value;
    if (field !== 'name') render(); // avoid yanking focus out of the text field on every keystroke-triggered change
  }
  function onKeyDown(e) {
    if (state.screen !== 'game' || !state.view || state.modal) return;
    var view = state.view, actions = view.actions || [];
    var key = e.key;
    // arranging your hand works at any time: S sorts, Shift+Left/Right moves the selected tile
    if ((key === 's' || key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey && view.phase !== 'handEnd' && view.phase !== 'gameEnd') {
      sortHand(); e.preventDefault(); return;
    }
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && e.shiftKey && state.ui.selectedIndex != null) {
      var from = state.ui.selectedIndex, to = from + (key === 'ArrowLeft' ? -1 : 1);
      if (moveHandTile(from, to)) { state.ui.selectedIndex = Math.max(0, Math.min(handDisplayOrder(view).length - 1, to)); render(); }
      e.preventDefault(); return;
    }
    if (!actions.length) return;
    if (view.phase === 'turn' && view.turn === 0) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') { moveSelection(key === 'ArrowLeft' ? -1 : 1, handDisplayOrder(view).length); e.preventDefault(); return; }
      if ((key === 'Enter' || key === ' ') && state.ui.selectedIndex != null) {
        var hand = handDisplayOrder(view), kind = hand[state.ui.selectedIndex];
        if (kind != null && actions.some(function (a) { return a.type === 'discard' && a.tile === kind; })) { forgetDiscarded(state.ui.selectedIndex, kind); humanAct({ type: 'discard', tile: kind }); e.preventDefault(); }
        return;
      }
    }
    var typeMap = { w: ['win', 'selfWin', 'flowerWin'], p: ['pong'], k: ['kong', 'concealedKong', 'addKong'], c: ['chow'] };
    var lower = key.toLowerCase();
    if (typeMap[lower]) {
      var opts = actions.filter(function (a) { return typeMap[lower].indexOf(a.type) >= 0; });
      if (opts.length === 1) { humanAct(opts[0]); e.preventDefault(); }
      else if (opts.length > 1) { state.ui.picker = { kind: (lower === 'c' ? 'chow' : 'kong'), options: opts }; render(); e.preventDefault(); }
      return;
    }
    if ((key === ' ' || key === 'Escape') && (view.phase === 'claim' || view.phase === 'robKong')) {
      var pass = actions.filter(function (a) { return a.type === 'pass'; })[0];
      if (pass) { humanAct(pass); e.preventDefault(); }
    }
  }

  // ------------------------------------------------------------------ init

  function init() {
    rootEl = root.document.getElementById('app');
    if (!rootEl) { console.error('HKMJ: #app root element not found'); return; }
    try {
      var spriteHost = root.document.getElementById('tile-sprite');
      if (spriteHost && HKMJ.TileArt) spriteHost.innerHTML = HKMJ.TileArt.spriteSVG();
    } catch (e) { console.error('HKMJ: failed to install tile sprite', e); }
    state.settings = loadSettings();
    state.saveExists = checkSaveExists();
    rootEl.addEventListener('click', onClick);
    if (root.PointerEvent) {
      rootEl.addEventListener('pointerdown', onPointerDown);
      rootEl.addEventListener('pointermove', onPointerMove);
      rootEl.addEventListener('pointerup', onPointerUp);
      rootEl.addEventListener('pointercancel', onPointerCancel);
    }
    rootEl.addEventListener('mouseover', onMouseOver);
    rootEl.addEventListener('mouseleave', onMouseLeave);
    rootEl.addEventListener('change', onFormChange);
    root.document.addEventListener('keydown', onKeyDown);
    root.document.addEventListener('visibilitychange', function () {
      try { if (audioCtx) { if (root.document.hidden) audioCtx.suspend(); else audioCtx.resume(); } } catch (e) { /* optional */ }
    });
    if (root.addEventListener) root.addEventListener('resize', onResize);
    render();
  }

  // Browser QA hook only (never surfaced in the UI, off by default). Console usage: HKMJ.App.debug.autoplay(true).
  HKMJ.App = {
    init: init,
    debug: {
      game: function () { return G; },
      state: function () { return state; },
      audio: function () { return { ctx: audioCtx ? audioCtx.state : null, music: music.on, step: music.step, pass: music.pass }; },
      play: function (kind) { playSound(kind); },
      autoplay: function (on) {
        autoplayOn = !!on;
        if (autoplayOn && G) advance();
      }
    }
  };
  if (typeof root.document !== 'undefined') {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = HKMJ.App;
})(typeof globalThis !== 'undefined' ? globalThis : this);
