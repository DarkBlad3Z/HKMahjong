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

  function freshUi() { return { selectedIndex: null, hintInfo: null, hintSuggestion: null, aiThinking: {}, toast: null, callouts: [], picker: null, _graceNext: false }; }

  // ------------------------------------------------------------------ persistence (never let storage break the app)

  function defaultUiSettings() {
    var s = JSON.parse(JSON.stringify(HKMJ.DEFAULT_SETTINGS || { minFan: 3, payment: 'full', unit: 'points', rounds: 4, aiLevel: 'normal', startingScore: 0, optional: {} }));
    s.name = 'You'; s.speed = 'normal'; s.hints = true; s.sound = true;
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

  // ------------------------------------------------------------------ sound (tiny synthesised WebAudio, never files)

  function getAudioCtx() {
    if (!state.settings || !state.settings.sound) return null;
    try {
      if (!audioCtx) { var Ctor = root.AudioContext || root.webkitAudioContext; if (!Ctor) return null; audioCtx = new Ctor(); }
      return audioCtx;
    } catch (e) { console.error('HKMJ: audio init failed', e); return null; }
  }
  function blip(ctx, t, freq, dur, type) {
    var osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function playSound(kind) {
    try {
      var ctx = getAudioCtx(); if (!ctx) return;
      var now = ctx.currentTime;
      if (kind === 'clack') blip(ctx, now, 210, 0.045, 'square');
      else if (kind === 'chime') { blip(ctx, now, 660, 0.13, 'sine'); blip(ctx, now + 0.05, 880, 0.14, 'sine'); }
      else if (kind === 'chord') [523.25, 659.25, 784.0].forEach(function (f, i) { blip(ctx, now + i * 0.03, f, 0.35, 'triangle'); });
    } catch (e) { console.error('HKMJ: playSound failed', e); }
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
  function calloutTextForWin(result) { return result.source === 'self' ? '自摸!' : (result.source === 'flowers' ? '花糊!' : '食糊!'); }

  function handleEngineEvent(evt) {
    if (evt.type === 'discard') playSound('clack');
    else if (evt.type === 'claim') { playSound('chime'); addCallout(evt.player, calloutTextForClaim(evt.claim)); }
    else if (evt.type === 'concealedKong' || evt.type === 'addKong') { playSound('chime'); addCallout(evt.player, '槓 Kong!'); }
    else if (evt.type === 'robKong') { playSound('chime'); addCallout(evt.player, '搶槓!'); }
    else if (evt.type === 'win') { playSound('chord'); addCallout(evt.player, calloutTextForWin(evt.result)); }
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
      G = new HKMJ.Game({ settings: engineSettings, names: [draft.name || 'You', 'Mei', 'Wing', 'Keung'], humans: [0] });
      attachEngineListeners();
      G.start();
    } catch (e) {
      console.error('HKMJ: failed to start game', e);
      showToast('Could not start a new game. Check the console.');
      return;
    }
    state.screen = 'game'; state.modal = null; state.ui = freshUi();
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
    advance();
  }

  // ------------------------------------------------------------------ hand display order (mirrors render.js youBlock)

  function handDisplayOrder(view) {
    var me = view.players[0];
    var hand = (me.hand || []).slice();
    if (me.drawn != null) { var i = hand.indexOf(me.drawn); if (i >= 0) hand.splice(i, 1); hand.push(me.drawn); }
    return hand;
  }
  function moveSelection(delta, len) {
    if (!len) return;
    var cur = state.ui.selectedIndex;
    var next = (cur == null) ? (delta > 0 ? 0 : len - 1) : Math.max(0, Math.min(len - 1, cur + delta));
    state.ui.selectedIndex = next;
    render();
  }

  // ------------------------------------------------------------------ render

  function render() {
    if (!rootEl) return;
    if (state.ui && state.settings) state.ui.soundOn = !!state.settings.sound;
    try { rootEl.innerHTML = HKMJ.UI.renderRoot(state); }
    catch (e) {
      console.error('HKMJ: render failed', e);
      try { rootEl.innerHTML = '<div class="fatal-error">Something went wrong rendering the table — check the console.</div>'; } catch (e2) { /* nothing more we can do */ }
    }
    applyCanvasScale();
    try { var logEl = rootEl.querySelector('.log-panel'); if (logEl) logEl.scrollTop = logEl.scrollHeight; } catch (e3) { /* cosmetic */ }
  }

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
      canvas.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    } catch (e) { console.error('HKMJ: canvas scale failed', e); }
  }
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
        state.settings = draft; persistSettings(); state.modal = null; render();
        return;
      }
      case 'settings-restart-now': startNewGame(state.modal.draft); return;
      case 'settings-keep-playing': state.settings = state.modal.draft; persistSettings(); state.modal = null; render(); return;
      case 'tile-click': {
        var idx = +el.getAttribute('data-index'), kind = +el.getAttribute('data-tile');
        var canDiscard = state.view && (state.view.actions || []).some(function (a) { return a.type === 'discard'; });
        if (!canDiscard) return;   // not your turn to discard: ignore instead of nagging
        if (state.ui.selectedIndex === idx) humanAct({ type: 'discard', tile: kind });
        else { state.ui.selectedIndex = idx; render(); }
        return;
      }
      case 'discard-selected': {
        if (state.ui.selectedIndex == null || !state.view) { showToast('Select a tile first.'); return; }
        var hand = handDisplayOrder(state.view), k = hand[state.ui.selectedIndex];
        if (k != null) humanAct({ type: 'discard', tile: k });
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
  function unlockAudio() {
    try {
      var ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (e) { /* audio is optional */ }
  }
  // Pointer handling. The table re-renders by innerHTML whenever an AI timer, callout or toast fires. If that happens
  // between mousedown and mouseup, the pressed element is replaced and the browser never fires 'click' — the player's
  // tap is silently lost. So a real pointer press is dispatched on pointerup when it is released over an element with
  // the same action signature as the one pressed (re-rendered or not). 'click' still handles keyboard activation
  // (Enter/Space on a focused button) and synthetic clicks, and is ignored right after a pointer dispatch.
  var downSig = null, lastPointerDispatch = 0;
  function actionSig(el) {
    if (!el) return null;
    return ['data-action', 'data-type', 'data-tile', 'data-tiles', 'data-index', 'data-picker', 'data-tab']
      .map(function (a) { return el.getAttribute(a) || ''; }).join('|');
  }
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) { downSig = null; return; }
    downSig = actionSig(closestWithAction(e.target));
  }
  function onPointerUp(e) {
    if (e.button !== undefined && e.button !== 0) return;
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
    if (!actions.length) return;
    var key = e.key;
    if (view.phase === 'turn' && view.turn === 0) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') { moveSelection(key === 'ArrowLeft' ? -1 : 1, handDisplayOrder(view).length); e.preventDefault(); return; }
      if ((key === 'Enter' || key === ' ') && state.ui.selectedIndex != null) {
        var hand = handDisplayOrder(view), kind = hand[state.ui.selectedIndex];
        if (kind != null && actions.some(function (a) { return a.type === 'discard' && a.tile === kind; })) { humanAct({ type: 'discard', tile: kind }); e.preventDefault(); }
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
      rootEl.addEventListener('pointerup', onPointerUp);
    }
    rootEl.addEventListener('change', onFormChange);
    root.document.addEventListener('keydown', onKeyDown);
    if (root.addEventListener) root.addEventListener('resize', onResize);
    render();
  }

  // Browser QA hook only (never surfaced in the UI, off by default). Console usage: HKMJ.App.debug.autoplay(true).
  HKMJ.App = {
    init: init,
    debug: {
      game: function () { return G; },
      state: function () { return state; },
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
