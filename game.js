/**
 * Deep-sea Reparefish
 * Vanilla JS / Canvas 2D — no external dependencies
 *
 * World: 4096 × 2288  |  Viewport: 960 × 540
 *
 * Custom assets:
 *   assets/skins.json          – list of PNG filenames for fish skins
 *   assets/images/skins/*.png  – skin images (name = filename sans extension)
 *   assets/images/background.png – tileable seabed texture (optional)
 */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  var WORLD_W = 4096, WORLD_H = 2288;
  var VIEW_W  = 960,  VIEW_H  = 540;

  var STATE_SELECT   = 'select';
  var STATE_PLAY     = 'play';
  var STATE_WIN      = 'win';
  var STATE_GAMEOVER = 'gameover';
  var STATE_LOCAL    = 'local';

  var ACCEL      = 1.8;
  var FRICTION   = 0.08;
  var MAX_SPD    = 18;

  var HINT_DIST   = 90;
  var REPAIR_DIST = 55;

  var LIGHT_R   = 220;
  var CONE_LEN  = 290;
  var CONE_HALF = 0.44;

  var DIFF_CFG   = [{ cables: 8, enemies: 6 }, { cables: 12, enemies: 10 }, { cables: 18, enemies: 16 }];
  var DIFF_NAMES = ['EASY', 'NORMAL', 'HARD'];

  var SPRINT_MULTIPLIER  = 2.5;
  var MAMA_FREEZE_RADIUS = 300;
  var KNOWN_SKIN_FILES   = ['elegant.png', 'viking.png', 'ninja.png'];
  var KNOWN_ENEMY_FRAMES = ['key1.png', 'key2.png', 'key3.png'];
  var HUNT_TIME_LIMITS   = [60000, 40000, 30000];
  var PLAYER_SKIN_DRAW   = { x: -35, y: -25, w: 70, h: 50 };
  var ENEMY_FRAME_DRAW   = { x: -0.9, y: -0.6, w: 1.8, h: 1.2 };
  var ENEMY_FRAME_INTERVAL_MS = 260;
  var SABOTEUR_FRAME_OFFSET = 999;
  var SABOTEUR_SIZE = 32;
  var STORY_LEVELS = [
    { cables: 4,  enemies: 3,  huntMs: 60000, depthBase: -6100, depthRange: 800 },
    { cables: 8,  enemies: 7,  huntMs: 40000, depthBase: -6500, depthRange: 900 },
    { cables: 14, enemies: 12, huntMs: 30000, depthBase: -6900, depthRange: 1000 },
    { cables: 18, enemies: 15, huntMs: 26000, depthBase: -7300, depthRange: 1100 },
    { cables: 22, enemies: 19, huntMs: 22000, depthBase: -7700, depthRange: 1200 }
  ];

  // Canvas-fallback colours per skin slot [body, fin, eye]
  var BUILTIN_COLORS = [
    ['#0e4470', '#0a2d4d', '#22ddff'],
    ['#5c2800', '#3d1c00', '#ff9900'],
    ['#0a4020', '#062812', '#44ff88']
  ];

  var LORE_TEXT = 'Year 3276. Abyssal cities float in darkness when the cable lattice breaks. ' +
    'Repairfish crews now guard five relay fronts: reefs, trenches, vents, rifts, and the abyssal crown. ' +
    'Humans can no longer dive this deep. You are the final signal runner.';

  // ── Globals ──────────────────────────────────────────────────────────────────
  var canvas, ctx, lightCanvas, lightCtx;
  var keys      = {};
  var gameState = STATE_SELECT;
  var lastTs    = 0;

  var player, cables, enemies, particles;
  var camera = { x: 0, y: 0 };
  var fixedCount = 0;
  var nearCable  = null;

  var hp = 2, hitCooldown = 0;
  var gameStartTs = 0, elapsedMs = 0;

  var selectedFish = 0;
  var difficulty   = 0;
  var numCables    = 6;
  var numEnemies   = 4;
  var fishName     = 'Fishyfish';
  var depthBase    = -6000;
  var depthRange   = 1000;

  // Sprint ability (once per game)
  var sprintUsed   = false;
  var sprintActive = 0;

  // Mama Fish ability (Easy/Normal solo only)
  var mamaFishUsed   = false;
  var mamaFishActive = 0;
  var mamaFishX      = 0;
  var mamaFishY      = 0;
  var mamaFishAngle  = 0;

  // Hunt phase: after all cables repaired, player gets electric aura and must kill predators
  var huntPhase      = false;
  var huntKills      = 0;
  var huntDeadlineTs = 0;

  // Local multiplayer
  var isLocalMode = false;
  var isStoryMode = false;
  var storyLevel  = -1;
  var player2      = null;
  var sabotageCooldown = 0;
  var localVsConfig = { roundTimeSec: 90 };
  var localRoundDurationMs = 90000;
  var isLanMode = false;
  var lanSession = null;
  var touchControlsEl = null;
  var touchMamaBtn    = null;

  // Dynamic asset data (populated by loadAssets)
  var skins         = [];    // [{name, img}]
  var enemyFrames   = [];    // [Image|null]
  var backgroundImg = null;  // Image or null
  var showHud       = true;
  var showMinimap   = true;
  var showHudName   = true;
  var showHudDepth  = true;
  var showHudObjective = true;
  var playerScale = 1;
  var animationIntensity = 1;

  var deco = { rocks: [], corals: [] };

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('game-canvas');
    canvas.width = VIEW_W; canvas.height = VIEW_H;
    ctx = canvas.getContext('2d');

    lightCanvas = document.createElement('canvas');
    lightCanvas.width = VIEW_W; lightCanvas.height = VIEW_H;
    lightCtx = lightCanvas.getContext('2d');

    // Start with built-in fallback skins so the picker renders immediately
    skins = builtinSkins();
    buildDeco();
    resetEntities();
    bindInput();
    buildFishPicker();
    refreshLbPreview();
    startTypewriter();
    fitToWindow();
    window.addEventListener('resize', fitToWindow);
    requestAnimationFrame(tick);
    registerServiceWorker();

    // Load PNG skins + background asynchronously; rebuild picker when ready
    loadAssets(function (loadedSkins, bgImg) {
      if (loadedSkins.length) {
        skins = loadedSkins;
        if (selectedFish >= skins.length) selectedFish = 0;
      }
      backgroundImg = bgImg;
      buildFishPicker();
    });

    // Mobile touch controls
    setupTouchControls();
    loadEnemyFrames();
    applyHudSettings();
  }

  function fitToWindow() {
    var wrapper = document.getElementById('game-wrapper');
    var s = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    wrapper.style.transform = 'scale(' + s + ')';
    wrapper.style.transformOrigin = 'top left';
    wrapper.style.position = 'absolute';
    wrapper.style.left = ((window.innerWidth  - VIEW_W * s) / 2) + 'px';
    wrapper.style.top  = ((window.innerHeight - VIEW_H * s) / 2) + 'px';
  }

  // ── Asset loading ─────────────────────────────────────────────────────────────
  function builtinSkins() {
    return BUILTIN_COLORS.map(function (c, i) {
      return { name: ['Elegant', 'Viking', 'Ninja'][i], img: null };
    });
  }

  function loadAssets(cb) {
    if (window.location.protocol === 'file:') {
      loadSkinImages(KNOWN_SKIN_FILES, cb);
      return;
    }
    secureFetchJson('assets/skins.json')
      .then(function (list) {
        if (!Array.isArray(list)) throw new Error('Invalid skins manifest');
        if (!list.every(function (v) { return typeof v === 'string'; })) throw new Error('Invalid skin entry in manifest');
        return list;
      })
      .then(function (list) { loadSkinImages(list, cb); })
      .catch(function () {
        // Fallback for file:// protocol: try known filenames directly
        var fallbackNames = KNOWN_SKIN_FILES;
        loadSkinImages(fallbackNames, cb);
      });
  }

  function secureFetchJson(path) {
    var url = new URL(path, window.location.href);
    var assetPath = url.pathname || path;
    var prot = url.protocol;
    if (prot !== 'http:' && prot !== 'https:' && prot !== 'file:') throw new Error('Blocked protocol: ' + prot);
    if (window.location.protocol === 'https:' && prot !== 'https:') throw new Error('Blocked insecure asset request: ' + assetPath);
    if ((prot === 'http:' || prot === 'https:') && url.origin !== window.location.origin) throw new Error('Blocked cross-origin asset request: ' + assetPath);
    return fetch(url.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer'
    }).then(function (res) {
      if (!res.ok) throw new Error('Asset request failed: ' + res.status + ' for ' + assetPath);
      return res.json();
    });
  }

  function loadSkinImages(list, cb) {
    var loaded    = [];
    var remaining = list.length;
    if (!remaining) { loadBg(function (bg) { cb([], bg); }); return; }
    list.forEach(function (fname, idx) {
      var raw  = fname.replace(/\.[^.]+$/, '');
      var name = raw.charAt(0).toUpperCase() + raw.slice(1);
      var img  = new Image();
      loaded[idx] = { name: name, img: img };
      img.onload = function () {
        if (--remaining === 0) loadBg(function (bg) { cb(loaded, bg); });
      };
      img.onerror = function () {
        loaded[idx] = { name: name, img: null };
        if (--remaining === 0) loadBg(function (bg) { cb(loaded, bg); });
      };
      img.src = 'assets/images/skins/' + fname;
    });
  }

  function loadBg(cb) {
    var img = new Image();
    img.onload  = function () { cb(img); };
    img.onerror = function () { cb(null); };
    img.src = 'assets/images/background.png';
  }

  function loadEnemyFrames() {
    enemyFrames = KNOWN_ENEMY_FRAMES.map(function () { return null; });
    KNOWN_ENEMY_FRAMES.forEach(function (fname, i) {
      var img = new Image();
      img.onload = function () { enemyFrames[i] = img; };
      img.onerror = function () { enemyFrames[i] = null; };
      img.src = 'assets/images/enemies/' + fname;
    });
  }

  // ── World decoration generation (fallback when no background.png) ─────────────
  function buildDeco() {
    var r = function (a, b) { return a + Math.random() * (b - a); };
    for (var i = 0; i < 180; i++) {
      deco.rocks.push({ x: r(0, WORLD_W), y: r(0, WORLD_H),
        rx: r(7, 50), ry: r(5, 28), rot: r(0, Math.PI), v: Math.floor(r(16, 62)) });
    }
    for (var j = 0; j < 80; j++) {
      deco.corals.push({ x: r(0, WORLD_W), y: r(0, WORLD_H),
        h: r(10, 42), n: Math.floor(r(2, 7)), hue: Math.random() < 0.55 ? 340 : 270 });
    }
  }

  // ── Entity reset ──────────────────────────────────────────────────────────────
  function resetEntities() {
    var cfg  = DIFF_CFG[difficulty];
    numCables  = cfg.cables;
    numEnemies = cfg.enemies;
    if (isStoryMode && storyLevel >= 0 && STORY_LEVELS[storyLevel]) {
      numCables = STORY_LEVELS[storyLevel].cables;
      numEnemies = STORY_LEVELS[storyLevel].enemies;
    }
    fixedCount = 0;
    particles  = [];
    hp = 2; hitCooldown = 0;

    sprintUsed = false; sprintActive = 0;
    mamaFishUsed = false; mamaFishActive = 0; mamaFishX = 0; mamaFishY = 0;
    huntPhase = false; huntKills = 0; huntDeadlineTs = 0;

    player = { x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0, angle: 0 };
    mamaFishAngle = player.angle;
    if (isLocalMode) {
      player2 = { x: WORLD_W / 2 + 200, y: WORLD_H / 2, vx: 0, vy: 0, angle: Math.PI, hp: 999 };
      sabotageCooldown = 0;
    } else {
      player2 = null;
    }

    cables = [];
    for (var i = 0; i < numCables; i++) {
      var x1  = 200 + Math.random() * (WORLD_W - 400);
      var y1  = 200 + Math.random() * (WORLD_H - 400);
      var ang = Math.random() * Math.PI * 2;
      var len = 90 + Math.random() * 130;
      var x2  = clamp(x1 + Math.cos(ang) * len, 100, WORLD_W - 100);
      var y2  = clamp(y1 + Math.sin(ang) * len, 100, WORLD_H - 100);
      var perp  = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
      var bulge = (Math.random() < 0.5 ? 1 : -1) * (50 + Math.random() * 80);
      var cpx   = (x1 + x2) / 2 + Math.cos(perp) * bulge;
      var cpy   = (y1 + y2) / 2 + Math.sin(perp) * bulge;
      var mx = 0.25 * x1 + 0.5 * cpx + 0.25 * x2;
      var my = 0.25 * y1 + 0.5 * cpy + 0.25 * y2;
      cables.push({ x1: x1, y1: y1, x2: x2, y2: y2, cpx: cpx, cpy: cpy, mx: mx, my: my, fixed: false });
    }

    enemies = [];
    for (var j = 0; j < numEnemies; j++) {
      var ex = (player.x < WORLD_W / 2) ? WORLD_W * 0.75 : WORLD_W * 0.25;
      var ey = (player.y < WORLD_H / 2) ? WORLD_H * 0.75 : WORLD_H * 0.25;
      for (var attempt = 0; attempt < 20; attempt++) {
        var tx = Math.random() * WORLD_W, ty = Math.random() * WORLD_H;
        if (Math.hypot(tx - player.x, ty - player.y) >= 600) { ex = tx; ey = ty; break; }
      }
      enemies.push({ x: ex, y: ey, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5),
        angle: 0, size: 28 + Math.random() * 22, homeX: ex, homeY: ey, chasing: false });
    }
    snapCamera();
  }

  // ── Input binding ─────────────────────────────────────────────────────────────
  // Fish-opt click handlers are bound inside buildFishPicker()
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape') {
        var tut = document.getElementById('tutorial-screen');
        if (tut && !tut.classList.contains('hidden')) {
          e.preventDefault();
          tut.classList.add('hidden');
          return;
        }
      }
      keys[e.code] = true;
      // Sprint activation
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || (isLocalMode && (e.code === 'Enter' || e.code === 'NumpadEnter'))) {
        if ((gameState === STATE_PLAY || gameState === STATE_LOCAL) && !sprintUsed) {
          sprintUsed = true;
          sprintActive = performance.now() + 1500;
        }
      }
      // Mama Fish activation
      if (e.code === 'Space') {
        if (gameState === STATE_PLAY && !isLocalMode && difficulty <= 1 && !mamaFishUsed) {
          mamaFishUsed = true;
          mamaFishActive = performance.now() + 4000;
          mamaFishX = player.x;
          mamaFishY = player.y;
          mamaFishAngle = player.angle;
        }
      }
    });
    window.addEventListener('keyup',   function (e) { keys[e.code] = false; });

    document.querySelectorAll('.diff-btn').forEach(function (el) {
      el.addEventListener('click', function () {
        isStoryMode = false;
        storyLevel = -1;
        document.querySelectorAll('.diff-btn').forEach(function (o) { o.classList.remove('selected'); });
        el.classList.add('selected');
        difficulty = parseInt(el.dataset.diff, 10);
        refreshLbPreview();
      });
    });

    document.getElementById('start-btn').addEventListener('click', function () {
      isLocalMode = false;
      isLanMode = false;
      lanSession = null;
      isStoryMode = false;
      storyLevel = -1;
      launchGame();
    });

    document.getElementById('local-btn').addEventListener('click', function () {
      openLocalVsLobby();
    });

    document.getElementById('local-vs-close-btn').addEventListener('click', function () {
      closeLocalVsLobby();
    });
    document.getElementById('local-vs-create-btn').addEventListener('click', function () {
      createLanRoom();
    });
    document.getElementById('local-vs-join-btn').addEventListener('click', function () {
      joinLanRoom();
    });
    document.getElementById('local-vs-start-btn').addEventListener('click', function () {
      syncLocalVsConfigFromForm();
      if (!lanSession || !lanSession.roomCode || !lanSession.token) {
        localVsStatus('Create or join a LAN room before starting.', true);
        return;
      }
      isLocalMode = true;
      isLanMode = true;
      isStoryMode = false;
      storyLevel = -1;
      closeLocalVsLobby();
      launchGame();
    });

    document.getElementById('tutorial-btn').addEventListener('click', function () {
      document.getElementById('tutorial-screen').classList.remove('hidden');
    });

    document.getElementById('tutorial-close-btn').addEventListener('click', function () {
      document.getElementById('tutorial-screen').classList.add('hidden');
    });
    document.getElementById('settings-btn').addEventListener('click', function () {
      document.getElementById('settings-screen').classList.remove('hidden');
    });
    document.getElementById('settings-close-btn').addEventListener('click', function () {
      document.getElementById('settings-screen').classList.add('hidden');
    });
    document.getElementById('setting-show-hud').addEventListener('change', function (e) {
      showHud = !!e.target.checked;
      applyHudSettings();
    });
    document.getElementById('setting-show-hud-name').addEventListener('change', function (e) {
      showHudName = !!e.target.checked;
      applyHudSettings();
    });
    document.getElementById('setting-show-hud-depth').addEventListener('change', function (e) {
      showHudDepth = !!e.target.checked;
      applyHudSettings();
    });
    document.getElementById('setting-show-hud-objective').addEventListener('change', function (e) {
      showHudObjective = !!e.target.checked;
      applyHudSettings();
    });
    document.getElementById('setting-show-minimap').addEventListener('change', function (e) {
      showMinimap = !!e.target.checked;
    });
    document.getElementById('setting-fish-scale').addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (!isNaN(v)) playerScale = clamp(v / 100, 0.8, 1.3);
    });
    document.getElementById('setting-animation-intensity').addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (!isNaN(v)) animationIntensity = clamp(v / 100, 0, 1.5);
    });
    document.getElementById('setting-depth-preset').addEventListener('change', function (e) {
      var parts = String(e.target.value || '').split(',');
      var base = parseInt(parts[0], 10);
      var range = parseInt(parts[1], 10);
      if (!isNaN(base)) depthBase = base;
      if (!isNaN(range) && range > 0) depthRange = range;
      updateHUD();
    });
    document.getElementById('story-btn').addEventListener('click', function () {
      document.getElementById('select-screen').classList.add('hidden');
      document.getElementById('story-level-screen').classList.remove('hidden');
    });
    document.getElementById('story-level-back-btn').addEventListener('click', function () {
      document.getElementById('story-level-screen').classList.add('hidden');
      document.getElementById('select-screen').classList.remove('hidden');
    });
    document.querySelectorAll('.story-level-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lvl = parseInt(btn.dataset.level, 10);
        if (isNaN(lvl) || !STORY_LEVELS[lvl]) return;
        isStoryMode = true;
        storyLevel = lvl;
        isLocalMode = false;
        isLanMode = false;
        lanSession = null;
        difficulty = clamp(lvl, 0, DIFF_CFG.length - 1);
        setSelectedDifficultyBtn(difficulty);
        depthBase = STORY_LEVELS[lvl].depthBase;
        depthRange = STORY_LEVELS[lvl].depthRange;
        document.getElementById('story-level-screen').classList.add('hidden');
        launchGame();
      });
    });

    document.getElementById('gameover-btn').addEventListener('click', function () {
      document.getElementById('gameover-screen').classList.add('hidden');
      goToSelect();
    });

    document.getElementById('restart-btn').addEventListener('click', function () {
      document.getElementById('win-screen').classList.add('hidden');
      goToSelect();
    });
  }

  function localVsStatus(msg, isError) {
    var el = document.getElementById('local-vs-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#ff8888' : '#66bbcc';
  }

  function syncLocalVsConfigFromForm() {
    var timeEl = document.getElementById('local-vs-time');
    if (timeEl) {
      var sec = parseInt(timeEl.value, 10);
      localVsConfig.roundTimeSec = isNaN(sec) ? 0 : sec;
    }
    localRoundDurationMs = localVsConfig.roundTimeSec > 0 ? localVsConfig.roundTimeSec * 1000 : 0;
  }

  function getLobbyRoomCode() {
    var roomEl = document.getElementById('local-vs-room-code');
    var roomCode = roomEl ? String(roomEl.value || '') : '';
    roomCode = roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (roomEl) roomEl.value = roomCode;
    return roomCode;
  }

  function setLobbyRoomCode(roomCode) {
    var roomEl = document.getElementById('local-vs-room-code');
    if (roomEl) roomEl.value = roomCode || '';
  }

  function createLanRoom() {
    syncLocalVsConfigFromForm();
    localVsStatus('Creating LAN room...', false);
    fetch('/api/lan/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roundTimeSec: localVsConfig.roundTimeSec })
    }).then(function (res) {
      if (!res.ok) throw new Error('Server returned ' + res.status);
      return res.json();
    }).then(function (data) {
      localVsConfig.roundTimeSec = data.roundTimeSec || localVsConfig.roundTimeSec;
      localRoundDurationMs = localVsConfig.roundTimeSec > 0 ? localVsConfig.roundTimeSec * 1000 : 0;
      lanSession = {
        roomCode: data.roomCode,
        token: data.token,
        role: data.role,
        ready: false,
        remoteInput: {},
        snapshot: null,
        pollInFlight: false,
        pushInFlight: false,
        snapshotInFlight: false,
        lastPollAt: 0,
        lastPushAt: 0,
        lastSnapshotAt: 0
      };
      setLobbyRoomCode(data.roomCode || '');
      var timeEl = document.getElementById('local-vs-time');
      if (timeEl) timeEl.value = String(localVsConfig.roundTimeSec);
      localVsStatus('Room created: ' + data.roomCode + '. Share code with saboteur.', false);
    }).catch(function (err) {
      localVsStatus('Failed to create room: ' + err.message, true);
    });
  }

  function joinLanRoom() {
    var roomCode = getLobbyRoomCode();
    if (!roomCode) {
      localVsStatus('Enter a room code first.', true);
      return;
    }
    localVsStatus('Joining room ' + roomCode + '...', false);
    fetch('/api/lan/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roomCode: roomCode })
    }).then(function (res) {
      if (!res.ok) throw new Error('Server returned ' + res.status);
      return res.json();
    }).then(function (data) {
      localVsConfig.roundTimeSec = data.roundTimeSec || localVsConfig.roundTimeSec;
      localRoundDurationMs = localVsConfig.roundTimeSec > 0 ? localVsConfig.roundTimeSec * 1000 : 0;
      lanSession = {
        roomCode: data.roomCode,
        token: data.token,
        role: data.role,
        ready: true,
        remoteInput: {},
        snapshot: null,
        pollInFlight: false,
        pushInFlight: false,
        snapshotInFlight: false,
        lastPollAt: 0,
        lastPushAt: 0,
        lastSnapshotAt: 0
      };
      setLobbyRoomCode(data.roomCode || roomCode);
      var timeEl = document.getElementById('local-vs-time');
      if (timeEl) timeEl.value = String(localVsConfig.roundTimeSec);
      localVsStatus('Joined room ' + data.roomCode + '. You control the saboteur fish.', false);
    }).catch(function (err) {
      localVsStatus('Failed to join room: ' + err.message, true);
    });
  }

  function sendLanInput(ts) {
    if (!isLanMode || !lanSession || lanSession.pushInFlight) return;
    if (ts - lanSession.lastPushAt < 70) return;
    var input = lanSession.role === 'join'
      ? { up: !!keys.ArrowUp, down: !!keys.ArrowDown, left: !!keys.ArrowLeft, right: !!keys.ArrowRight, sprint: !!(keys.Enter || keys.NumpadEnter) }
      : { up: false, down: false, left: false, right: false, sprint: false };
    lanSession.pushInFlight = true;
    lanSession.lastPushAt = ts;
    fetch('/api/lan/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roomCode: lanSession.roomCode, token: lanSession.token, input: input })
    }).catch(function () {
      localVsStatus('LAN link unstable: input sync delayed.', true);
    }).finally(function () {
      if (lanSession) lanSession.pushInFlight = false;
    });
  }

  function buildLanSnapshot(ts) {
    return {
      gameState: gameState,
      fixedCount: fixedCount,
      numCables: numCables,
      hp: hp,
      elapsedMs: elapsedMs,
      huntPhase: huntPhase,
      huntRemainingMs: huntDeadlineTs > 0 ? Math.max(0, huntDeadlineTs - ts) : 0,
      player: { x: player.x, y: player.y, angle: player.angle },
      player2: player2 ? { x: player2.x, y: player2.y, angle: player2.angle } : { x: player.x, y: player.y, angle: player.angle },
      enemies: enemies.map(function (e) {
        return { x: e.x, y: e.y, angle: e.angle, size: e.size, chasing: !!e.chasing, frozen: !!e.frozen };
      }),
      cables: cables.map(function (c) {
        return { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, cpx: c.cpx, cpy: c.cpy, mx: c.mx, my: c.my, fixed: !!c.fixed };
      })
    };
  }

  function sendLanSnapshot(ts) {
    if (!isLanMode || !lanSession || lanSession.role !== 'host' || lanSession.snapshotInFlight) return;
    if (ts - lanSession.lastSnapshotAt < 95) return;
    lanSession.snapshotInFlight = true;
    lanSession.lastSnapshotAt = ts;
    fetch('/api/lan/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roomCode: lanSession.roomCode, token: lanSession.token, snapshot: buildLanSnapshot(ts) })
    }).catch(function () {
      localVsStatus('LAN link unstable: snapshot sync delayed.', true);
    }).finally(function () {
      if (lanSession) lanSession.snapshotInFlight = false;
    });
  }

  function pollLanState(ts) {
    if (!isLanMode || !lanSession || lanSession.pollInFlight) return;
    if (ts - lanSession.lastPollAt < 120) return;
    lanSession.pollInFlight = true;
    lanSession.lastPollAt = ts;
    var query = '?roomCode=' + encodeURIComponent(lanSession.roomCode) + '&token=' + encodeURIComponent(lanSession.token);
    fetch('/api/lan/poll' + query, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!lanSession) return;
        lanSession.ready = !!data.ready;
        lanSession.remoteInput = (lanSession.role === 'host') ? (data.joinInput || {}) : (data.hostInput || {});
        if (lanSession.role === 'join' && data.snapshot) lanSession.snapshot = data.snapshot;
      })
      .catch(function () {
        localVsStatus('LAN link lost. Verify both devices are on the same Wi-Fi.', true);
      })
      .finally(function () {
        if (lanSession) lanSession.pollInFlight = false;
      });
  }

  function applyLanSnapshotToJoiner(ts) {
    if (!isLanMode || !lanSession || lanSession.role !== 'join') return;
    var s = lanSession.snapshot;
    if (!s || !s.player) return;
    player.x = s.player.x; player.y = s.player.y; player.angle = s.player.angle;
    player.vx = 0; player.vy = 0;
    if (!player2) player2 = { x: s.player2.x, y: s.player2.y, vx: 0, vy: 0, angle: s.player2.angle, hp: 999 };
    player2.x = s.player2.x; player2.y = s.player2.y; player2.angle = s.player2.angle;
    hp = s.hp;
    fixedCount = s.fixedCount;
    numCables = s.numCables;
    elapsedMs = s.elapsedMs;
    huntPhase = !!s.huntPhase;
    huntDeadlineTs = huntPhase ? ts + (s.huntRemainingMs || 0) : 0;
    if (s.gameState === STATE_WIN && gameState !== STATE_WIN) {
      gameState = STATE_WIN;
      showWinScreenLocal('REPAIR FISH WINS!', 'Host completed the mission.');
    } else if (s.gameState === STATE_GAMEOVER && gameState !== STATE_GAMEOVER) {
      gameState = STATE_GAMEOVER;
      showGameOverLocal('SABOTEUR WINS!', 'Host was overwhelmed.');
    }
    enemies = (s.enemies || []).map(function (e) {
      return {
        x: e.x, y: e.y, vx: 0, vy: 0, angle: e.angle, size: e.size,
        homeX: e.x, homeY: e.y, chasing: !!e.chasing, frozen: !!e.frozen
      };
    });
    cables = (s.cables || []).map(function (c) {
      return {
        x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, cpx: c.cpx, cpy: c.cpy, mx: c.mx, my: c.my, fixed: !!c.fixed
      };
    });
  }

  function openLocalVsLobby() {
    syncLocalVsConfigFromForm();
    document.getElementById('local-vs-screen').classList.remove('hidden');
    localVsStatus('Create or join a room. Start when both players are ready.', false);
  }

  function closeLocalVsLobby() {
    document.getElementById('local-vs-screen').classList.add('hidden');
  }

  function goToSelect() {
    gameState = STATE_SELECT;
    isLocalMode = false;
    isLanMode = false;
    lanSession = null;
    isStoryMode = false;
    storyLevel = -1;
    document.getElementById('select-screen').classList.remove('hidden');
    document.getElementById('story-level-screen').classList.add('hidden');
    document.getElementById('local-vs-screen').classList.add('hidden');
    document.getElementById('settings-screen').classList.add('hidden');
    // Reset gameover/win screen text to defaults
    var goScreen = document.getElementById('gameover-screen');
    var goH1 = goScreen.querySelector('h1');
    var goP  = goScreen.querySelector('p');
    if (goH1) goH1.textContent = 'GAME OVER';
    if (goP) goP.textContent = 'The predators got you!';
    var winScreen = document.getElementById('win-screen');
    var winH1 = winScreen.querySelector('h1');
    if (winH1) winH1.textContent = 'MISSION COMPLETE';
    refreshLbPreview();
    setTouchControlsVisibility();
  }

  function launchGame() {
    var nameInput = document.getElementById('fish-name-input');
    var input     = nameInput ? nameInput.value.trim() : '';
    fishName = input ? input.slice(0, 12) : (skins[selectedFish] ? skins[selectedFish].name : 'Fish');
    if (isLocalMode) {
      syncLocalVsConfigFromForm();
    } else {
      localRoundDurationMs = 0;
    }
    resetEntities();
    gameState   = isLocalMode ? STATE_LOCAL : STATE_PLAY;
    gameStartTs = performance.now();
    elapsedMs   = 0;
    document.getElementById('select-screen').classList.add('hidden');

    // Show/hide mama fish HUD
    var mamaBlock = document.getElementById('hud-mama-block');
    if (mamaBlock) {
      mamaBlock.style.display = (!isLocalMode && difficulty <= 1) ? '' : 'none';
    }
    // Show sprint HUD
    var sprintBlock = document.getElementById('hud-sprint-block');
    if (sprintBlock) sprintBlock.style.display = '';

    updateHUD();
    setTouchControlsVisibility();
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────
  function tick(ts) {
    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    if (gameState === STATE_PLAY || gameState === STATE_LOCAL) {
      if (isLanMode) pollLanState(ts);
      elapsedMs = ts - gameStartTs;
      if (isLanMode && lanSession && lanSession.role === 'join') {
        applyLanSnapshotToJoiner(ts);
        sendLanInput(ts);
        slideCamera();
        updateHUD();
      } else {
        movePlayer();
        if (isLocalMode && player2) movePlayer2();
        moveMamaFish(ts);
        moveEnemies(ts);
        tickParticles(dt);
        checkRepair();
        checkEnemyHit(ts);
        if (isLocalMode) {
          checkLocalCollision(ts);
          checkSabotage(ts);
        }
        slideCamera();
        updateHUD();
        if (isLanMode) {
          sendLanInput(ts);
          sendLanSnapshot(ts);
        }

        if (gameState === STATE_LOCAL) {
          // Repair wins if all cables fixed
          if (fixedCount >= numCables) {
            gameState = STATE_WIN;
            showWinScreenLocal('REPAIR FISH WINS!', 'All cables repaired!');
          } else if (localRoundDurationMs > 0 && elapsedMs >= localRoundDurationMs) {
            gameState = STATE_WIN;
            showWinScreenLocal('TIME UP', 'Round ended · repaired cables: ' + fixedCount + '/' + numCables);
          }
        } else if (fixedCount >= numCables && !huntPhase) {
          // Enter hunt phase: electric aura, kill all predators
          huntPhase = true;
          huntDeadlineTs = ts + getHuntLimitMs();
          mamaFishActive = 0; // remove mama fish
          hitCooldown = 0;
          // Hide mama HUD block during hunt phase
          var mamaBlock2 = document.getElementById('hud-mama-block');
          if (mamaBlock2) mamaBlock2.style.display = 'none';
          setTouchControlsVisibility();
        } else if (huntPhase && enemies.length === 0) {
          gameState = STATE_WIN;
          showWinScreen();
        } else if (huntPhase && ts >= huntDeadlineTs) {
          showHuntTimeout();
        }
      }
    } else {
      moveEnemies(ts);
      if (isLanMode) pollLanState(ts);
    }

    render(ts);
    requestAnimationFrame(tick);
  }

  // ── Physics ───────────────────────────────────────────────────────────────────
  function movePlayer() {
    if (isLanMode && lanSession && lanSession.role === 'join') return;
    var now = performance.now();
    var isSprinting = now < sprintActive;
    var spdCap = isSprinting ? MAX_SPD * SPRINT_MULTIPLIER : MAX_SPD;

    var up, down, left, right;
    if (isLocalMode) {
      // Player 1 (repair): WASD only
      up    = !!keys['KeyW'];
      down  = !!keys['KeyS'];
      left  = !!keys['KeyA'];
      right = !!keys['KeyD'];
    } else {
      up    = !!(keys['ArrowUp']    || keys['KeyW']);
      down  = !!(keys['ArrowDown']  || keys['KeyS']);
      left  = !!(keys['ArrowLeft']  || keys['KeyA']);
      right = !!(keys['ArrowRight'] || keys['KeyD']);
    }

    player.vx += ((right ? 1 : 0) - (left  ? 1 : 0)) * ACCEL;
    player.vy += ((down  ? 1 : 0) - (up    ? 1 : 0)) * ACCEL;

    var spd = Math.hypot(player.vx, player.vy);
    if (spd > 0) {
      var drag = Math.min(spd, FRICTION);
      player.vx -= (player.vx / spd) * drag;
      player.vy -= (player.vy / spd) * drag;
    }
    spd = Math.hypot(player.vx, player.vy);
    if (spd > spdCap) { player.vx = player.vx / spd * spdCap; player.vy = player.vy / spd * spdCap; }

    player.x = clamp(player.x + player.vx, 20, WORLD_W - 20);
    player.y = clamp(player.y + player.vy, 20, WORLD_H - 20);
    if (spd > 0.35) player.angle = lerpAngle(player.angle, Math.atan2(player.vy, player.vx), 0.12);
  }

  // Player 2 (saboteur) in local mode: Arrow Keys
  function movePlayer2() {
    if (!player2) return;
    var saboteurInput = isLanMode && lanSession ? (lanSession.remoteInput || {}) : keys;
    var up    = !!saboteurInput['ArrowUp'] || !!saboteurInput.up;
    var down  = !!saboteurInput['ArrowDown'] || !!saboteurInput.down;
    var left  = !!saboteurInput['ArrowLeft'] || !!saboteurInput.left;
    var right = !!saboteurInput['ArrowRight'] || !!saboteurInput.right;

    player2.vx += ((right ? 1 : 0) - (left  ? 1 : 0)) * ACCEL;
    player2.vy += ((down  ? 1 : 0) - (up    ? 1 : 0)) * ACCEL;

    var spd = Math.hypot(player2.vx, player2.vy);
    if (spd > 0) {
      var drag = Math.min(spd, FRICTION);
      player2.vx -= (player2.vx / spd) * drag;
      player2.vy -= (player2.vy / spd) * drag;
    }
    spd = Math.hypot(player2.vx, player2.vy);
    var p2Cap = MAX_SPD;
    if (spd > p2Cap) { player2.vx = player2.vx / spd * p2Cap; player2.vy = player2.vy / spd * p2Cap; }

    player2.x = clamp(player2.x + player2.vx, 20, WORLD_W - 20);
    player2.y = clamp(player2.y + player2.vy, 20, WORLD_H - 20);
    if (spd > 0.35) player2.angle = lerpAngle(player2.angle, Math.atan2(player2.vy, player2.vx), 0.12);

    // Prevent players from getting too far apart (max 800px)
    var sepDist = Math.hypot(player2.x - player.x, player2.y - player.y);
    if (sepDist > 800) {
      var pushX = (player.x - player2.x) / sepDist;
      var pushY = (player.y - player2.y) / sepDist;
      var excess = sepDist - 800;
      player2.x += pushX * excess * 0.5;
      player2.y += pushY * excess * 0.5;
      player.x -= pushX * excess * 0.5;
      player.y -= pushY * excess * 0.5;
      player2.x = clamp(player2.x, 20, WORLD_W - 20);
      player2.y = clamp(player2.y, 20, WORLD_H - 20);
      player.x = clamp(player.x, 20, WORLD_W - 20);
      player.y = clamp(player.y, 20, WORLD_H - 20);
    }
  }

  // Local mode: saboteur touching repair fish damages HP
  function checkLocalCollision(ts) {
    if (!player2 || ts < hitCooldown) return;
    var d = Math.hypot(player2.x - player.x, player2.y - player.y);
    if (d < 30) {
      hp--;
      hitCooldown = ts + 2000;
      spawnHitFX(player.x, player.y);
      if (hp <= 0) {
        gameState = STATE_GAMEOVER;
        showGameOverLocal('SABOTEUR WINS!', 'The repair fish was taken down!');
      }
    }
  }

  function checkSabotage(ts) {
    if (!player2 || ts < sabotageCooldown) return;
    for (var i = 0; i < cables.length; i++) {
      var c = cables[i];
      if (!c.fixed) continue;
      if (Math.hypot(player2.x - c.mx, player2.y - c.my) < REPAIR_DIST) {
        c.fixed = false;
        fixedCount = Math.max(0, fixedCount - 1);
        sabotageCooldown = ts + 900;
        spawnHitFX(c.mx, c.my);
        break;
      }
    }
  }

  function showGameOverLocal(title, msg) {
    var screen = document.getElementById('gameover-screen');
    var h1 = screen.querySelector('h1');
    var p  = screen.querySelector('p');
    if (h1) h1.textContent = title;
    if (p) p.textContent = msg;
    screen.classList.remove('hidden');
    setTouchControlsVisibility();
  }

  function showWinScreenLocal(title, msg) {
    var screen = document.getElementById('win-screen');
    var h1 = screen.querySelector('h1');
    if (h1) h1.textContent = title;
    document.getElementById('win-time').textContent = msg + '  \xb7  ' + formatTime(elapsedMs);
    document.getElementById('leaderboard').innerHTML = '';
    screen.classList.remove('hidden');
    setTouchControlsVisibility();
  }

  // ── Enemy AI ──────────────────────────────────────────────────────────────────
  function moveEnemies(ts) {
    var mamaActive = ts < mamaFishActive;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];

      // Mama fish freeze: skip movement for enemies within 300px radius
      if (mamaActive) {
        var md = Math.hypot(e.x - mamaFishX, e.y - mamaFishY);
        if (md < MAMA_FREEZE_RADIUS) { e.frozen = true; continue; }
      }
      e.frozen = false;

      var dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);

      // During hunt phase, enemies flee from the player
      if (huntPhase && d < 500) {
        e.chasing = false;
        e.vx -= (dx / d) * 0.12; e.vy -= (dy / d) * 0.08;
      } else if (d < 420 && (gameState === STATE_PLAY || gameState === STATE_LOCAL)) {
        e.chasing = true;
        e.vx += (dx / d) * 0.14; e.vy += (dy / d) * 0.09;
      } else {
        e.chasing = false;
        var wx = e.homeX + Math.sin(ts * 0.001 + e.homeX * 0.01) * 240 - e.x;
        var wy = e.homeY + Math.cos(ts * 0.0009 + e.homeY * 0.01) * 110 - e.y;
        var wd = Math.hypot(wx, wy) + 0.001;
        e.vx += (wx / wd) * 0.03; e.vy += (wy / wd) * 0.02;
      }

      e.vx *= 0.955; e.vy *= 0.955;
      var ev = Math.hypot(e.vx, e.vy), cap = e.chasing ? 3.2 : 1.7;
      if (ev > cap) { e.vx = e.vx / ev * cap; e.vy = e.vy / ev * cap; }
      e.x = clamp(e.x + e.vx, 0, WORLD_W);
      e.y = clamp(e.y + e.vy, 0, WORLD_H);
      if (ev > 0.1) e.angle = Math.atan2(e.vy, e.vx);
    }
  }

  function moveMamaFish(ts) {
    if (ts >= mamaFishActive || !enemies || !enemies.length) return;
    var nearest = null;
    var best = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var d = Math.hypot(e.x - mamaFishX, e.y - mamaFishY);
      if (d < best) { best = d; nearest = e; }
    }
    if (!nearest) return;
    var dx = nearest.x - mamaFishX;
    var dy = nearest.y - mamaFishY;
    var dist = Math.hypot(dx, dy) || 1;
    var speed = Math.min(3.4, dist);
    mamaFishX = clamp(mamaFishX + (dx / dist) * speed, 20, WORLD_W - 20);
    mamaFishY = clamp(mamaFishY + (dy / dist) * speed, 20, WORLD_H - 20);
    mamaFishAngle = lerpAngle(mamaFishAngle, Math.atan2(dy, dx), 0.16);

    for (var b = 0; b < 2; b++) {
      var trailX = mamaFishX - Math.cos(mamaFishAngle) * (34 + Math.random() * 10);
      var trailY = mamaFishY - Math.sin(mamaFishAngle) * (34 + Math.random() * 10);
      particles.push({
        x: trailX + (Math.random() - 0.5) * 4,
        y: trailY + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -0.35 - Math.random() * 0.35,
        life: 0.6 + Math.random() * 0.4,
        hue: 195 + Math.floor(Math.random() * 15),
        size: 2 + Math.random() * 2
      });
    }
  }

  // ── Enemy collision / health ──────────────────────────────────────────────────
  function checkEnemyHit(ts) {
    if (huntPhase) {
      // In hunt phase, player kills enemies on contact
      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (Math.hypot(e.x - player.x, e.y - player.y) < e.size + 18) {
          spawnHitFX(e.x, e.y);
          spawnRepairFX(e.x, e.y);
          enemies.splice(i, 1);
          huntKills++;
        }
      }
      return;
    }
    if (ts < hitCooldown) return;
    for (var j = 0; j < enemies.length; j++) {
      var e2 = enemies[j];
      if (Math.hypot(e2.x - player.x, e2.y - player.y) < e2.size + 14) {
        hp--;
        hitCooldown = ts + 2000;
        spawnHitFX(player.x, player.y);
        if (hp <= 0) {
          gameState = STATE_GAMEOVER;
          document.getElementById('gameover-screen').classList.remove('hidden');
          setTouchControlsVisibility();
        }
        break;
      }
    }
  }

  // ── Particles ─────────────────────────────────────────────────────────────────
  function tickParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy -= 0.02; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // Particle hues matched to skin slots (derived from BUILTIN_COLORS eye tones)
  var BUILTIN_HUES = [195, 28, 140];

  function spawnRepairFX(x, y) {
    var hue = BUILTIN_HUES[selectedFish % BUILTIN_HUES.length];
    for (var i = 0; i < 20; i++) {
      var a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
      particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.6 + Math.random() * 0.4, hue: hue + Math.floor(Math.random() * 40 - 20), size: 2 + Math.random() * 3 });
    }
  }

  function spawnHitFX(x, y) {
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
      particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.3, hue: 0, size: 3 + Math.random() * 3 });
    }
  }

  // ── Cable auto-repair ─────────────────────────────────────────────────────────
  function checkRepair() {
    nearCable = null;
    var best = HINT_DIST;
    for (var i = 0; i < cables.length; i++) {
      var c = cables[i];
      if (c.fixed) continue;
      var d = Math.hypot(c.mx - player.x, c.my - player.y);
      if (d < best) { best = d; nearCable = c; }
    }
    if (nearCable && best < REPAIR_DIST) {
      nearCable.fixed = true;
      fixedCount++;
      spawnRepairFX(nearCable.mx, nearCable.my);
      nearCable = null;
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────────
  function snapCamera() {
    camera.x = clamp(player.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camera.y = clamp(player.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
  }

  function slideCamera() {
    var focusX = player.x, focusY = player.y;
    if (isLocalMode && player2) {
      focusX = (player.x + player2.x) / 2;
      focusY = (player.y + player2.y) / 2;
    }
    var tx = clamp(focusX - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    var ty = clamp(focusY - VIEW_H / 2, 0, WORLD_H - VIEW_H);
    camera.x += (tx - camera.x) * 0.08;
    camera.y += (ty - camera.y) * 0.08;
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────
  function updateHUD() {
    var now = performance.now();
    var cc = document.getElementById('cables-count');
    var tv = document.getElementById('time-val');
    var hv = document.getElementById('hp-val');
    var fn = document.getElementById('hud-fish-name');
    if (cc) cc.textContent = huntPhase ? (numCables + ' / ' + numCables + ' ⚡') : (fixedCount + ' / ' + numCables);
    if (tv) {
      var displayTimeMs = elapsedMs;
      if (huntPhase && huntDeadlineTs > 0) displayTimeMs = Math.max(0, huntDeadlineTs - now);
      else if (gameState === STATE_LOCAL && localRoundDurationMs > 0) displayTimeMs = Math.max(0, localRoundDurationMs - elapsedMs);
      var secs = Math.floor(displayTimeMs / 1000), mins = Math.floor(secs / 60), s2 = secs % 60;
      tv.textContent = mins + ':' + (s2 < 10 ? '0' : '') + s2;
    }
    if (hv) hv.textContent = hp >= 2 ? '❤ ❤' : hp === 1 ? '❤ ♡' : '♡ ♡';
    if (fn) fn.textContent = fishName;
    var dv = document.getElementById('depth-val');
    if (dv && player) {
      dv.textContent = calculateDepth(player.y) + 'm';
    }
    var ov = document.getElementById('objective-val');
    if (ov) {
      if (huntPhase) {
        var leftSecs = Math.max(0, Math.ceil((huntDeadlineTs - now) / 1000));
        ov.textContent = 'HUNT PREDATORS (' + enemies.length + ' LEFT · ' + leftSecs + 'S)';
        ov.style.color = '#44ddff';
      } else if (nearCable) {
        ov.textContent = 'REPAIR NOW';
        ov.style.color = '#ffcc66';
      } else if (hp <= 1 && (gameState === STATE_PLAY || gameState === STATE_LOCAL)) {
        ov.textContent = 'DODGE PREDATORS';
        ov.style.color = '#ff6666';
      } else {
        if (isLocalMode) {
          if (isLanMode && lanSession && lanSession.role === 'join') ov.textContent = 'SABOTAGE CABLE NETWORK';
          else ov.textContent = 'REPAIR + EVADE SABOTEUR';
        }
        else if (isStoryMode) ov.textContent = 'STORY MISSION ' + (storyLevel + 1);
        else ov.textContent = 'REPAIR CABLES';
        ov.style.color = '#ffd166';
      }
    }

    // Sprint HUD
    var sv = document.getElementById('sprint-val');
    if (sv) {
      if (now < sprintActive) {
        sv.textContent = 'ACTIVE'; sv.style.color = '#ff6600';
      } else if (sprintUsed) {
        sv.textContent = 'USED'; sv.style.color = '#666666';
      } else {
        sv.textContent = 'READY'; sv.style.color = '#ffcc00';
      }
    }

    // Mama Fish HUD
    var mv = document.getElementById('mama-val');
    if (mv) {
      if (now < mamaFishActive) {
        mv.textContent = 'ACTIVE'; mv.style.color = '#00ffff';
      } else if (mamaFishUsed) {
        mv.textContent = 'USED'; mv.style.color = '#666666';
      } else {
        mv.textContent = 'READY'; mv.style.color = '#66ccff';
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render(ts) {
    var bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    bg.addColorStop(0, '#020c1a'); bg.addColorStop(1, '#01070e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // World decoration: use background image if loaded, else procedural
    if (backgroundImg) {
      var pat = ctx.createPattern(backgroundImg, 'repeat');
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    } else {
      drawRocks();
      drawCorals();
    }

    drawCables(ts);
    drawParticlesFX();
    drawEnemies(ts);
    if (gameState !== STATE_SELECT) {
      drawPlayerFish(ts);
      if (isLocalMode && player2) drawSaboteurFish(ts);
      if (performance.now() < mamaFishActive && !huntPhase) drawMamaFish(ts);
    }
    ctx.restore();

    var depthFog = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    depthFog.addColorStop(0, 'rgba(5,20,36,0.12)');
    depthFog.addColorStop(1, 'rgba(1,6,14,0.42)');
    ctx.fillStyle = depthFog;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    drawLighting(ts);
    if (showMinimap) drawMinimap();
    if ((gameState === STATE_PLAY || gameState === STATE_LOCAL) && nearCable) drawProximityHint();
  }

  // ── Procedural decoration (fallback) ──────────────────────────────────────────
  function drawRocks() {
    for (var i = 0; i < deco.rocks.length; i++) {
      var r = deco.rocks[i];
      if (!inView(r.x, r.y, r.rx + 4)) continue;
      var ds = depthScale(r.y);
      ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
      ctx.scale(ds, ds);
      ctx.fillStyle = 'rgb(' + r.v + ',' + (r.v + 5) + ',' + (r.v + 14) + ')';
      ctx.beginPath(); ctx.ellipse(0, 0, r.rx, r.ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawCorals() {
    for (var i = 0; i < deco.corals.length; i++) {
      var c = deco.corals[i];
      if (!inView(c.x, c.y, c.h + 8)) continue;
      var ds = depthScale(c.y);
      for (var b = 0; b < c.n; b++) {
        var ang = -Math.PI * 0.5 + ((c.n > 1 ? b / (c.n - 1) : 0.5) - 0.5) * 1.4;
        var tx  = c.x + Math.cos(ang) * c.h * ds, ty = c.y + Math.sin(ang) * c.h * ds;
        ctx.strokeStyle = 'hsla(' + c.hue + ',62%,38%,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = 'hsla(' + c.hue + ',65%,50%,0.45)';
        ctx.beginPath(); ctx.arc(tx, ty, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ── Cables (curved bezier) ────────────────────────────────────────────────────
  function drawCables(ts) {
    for (var i = 0; i < cables.length; i++) {
      var c = cables[i];
      if (!inView(c.mx, c.my, 100) && !inView(c.x1, c.y1, 20) && !inView(c.x2, c.y2, 20)) continue;
      if (c.fixed) drawCableFixed(c); else drawCableBroken(c, ts, c === nearCable);
    }
  }

  function drawCableBroken(c, ts, highlight) {
    var sw = Math.sin(ts * 0.0025 + c.x1 * 0.005) * 2;
    var sh = Math.cos(ts * 0.0022 + c.y1 * 0.005) * 2;

    ctx.beginPath();
    ctx.moveTo(c.x1 + sw, c.y1 + sh);
    ctx.quadraticCurveTo(c.cpx + sw, c.cpy + sh, c.x2 + sw, c.y2 + sh);
    ctx.strokeStyle = highlight ? 'rgba(255,140,0,0.95)' : 'rgba(200,90,20,0.85)';
    ctx.lineWidth = 3; ctx.stroke();

    drawAnchor(c.x1 + sw, c.y1 + sh, false);
    drawAnchor(c.x2 + sw, c.y2 + sh, false);

    ctx.save(); ctx.translate(c.mx + sw, c.my + sh);
    ctx.fillStyle = '#0c1824';
    ctx.strokeStyle = highlight ? '#ffaa00' : '#7a3a18';
    ctx.lineWidth = highlight ? 2 : 1.5;
    rrect(ctx, -12, -9, 24, 18, 3); ctx.fill(); ctx.stroke();
    for (var i = 0; i < 3; i++) {
      var ox = -5 + i * 5;
      ctx.strokeStyle = highlight ? 'rgba(255,' + (130 + i * 30) + ',0,0.9)' : 'rgba(155,55,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox, -6); ctx.lineTo(ox - 2, 0); ctx.lineTo(ox + 2, 0); ctx.lineTo(ox, 6); ctx.stroke();
    }
    if (highlight) {
      var t = (ts % 900) / 900;
      ctx.strokeStyle = 'rgba(255,175,0,' + (0.75 - t * 0.75) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 16 + t * 22, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCableFixed(c) {
    ctx.beginPath(); ctx.moveTo(c.x1, c.y1);
    ctx.quadraticCurveTo(c.cpx, c.cpy, c.x2, c.y2);
    ctx.strokeStyle = 'rgba(0,220,90,0.85)'; ctx.lineWidth = 3; ctx.stroke();
    drawAnchor(c.x1, c.y1, true); drawAnchor(c.x2, c.y2, true);
    ctx.save(); ctx.translate(c.mx, c.my);
    ctx.fillStyle = '#061c10'; ctx.strokeStyle = '#00cc55'; ctx.lineWidth = 1.5;
    rrect(ctx, -12, -9, 24, 18, 3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-1, 5); ctx.lineTo(7, -4); ctx.stroke();
    ctx.restore();
  }

  function drawAnchor(x, y, fixed) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle   = fixed ? '#062018' : '#0c1824';
    ctx.strokeStyle = fixed ? '#007a3a' : '#1e3850';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(-5, -5, 10, 10); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ── Repair particles ──────────────────────────────────────────────────────────
  function drawParticlesFX() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = p.life;
      ctx.fillStyle = 'hsl(' + p.hue + ',100%,65%)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Enemy fish ────────────────────────────────────────────────────────────────
  function drawEnemies(ts) {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!inView(e.x, e.y, e.size * 2)) continue;
      var ds = depthScale(e.y);
      ctx.save(); ctx.translate(e.x, e.y + 6 + (1 - ds) * 8);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, e.size * 0.72 * ds, e.size * 0.24 * ds, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle); ctx.scale(ds, ds);
      drawEnemyFish(e.size, e.chasing, ts, i);
      // Ice crystal overlay for frozen enemies
      if (e.frozen) {
        ctx.rotate(-e.angle); // reset rotation for overlay
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#88ddff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -e.size * 0.6); ctx.lineTo(0, e.size * 0.6);
        ctx.moveTo(-e.size * 0.5, -e.size * 0.3); ctx.lineTo(e.size * 0.5, e.size * 0.3);
        ctx.moveTo(-e.size * 0.5, e.size * 0.3); ctx.lineTo(e.size * 0.5, -e.size * 0.3);
        ctx.stroke();
        ctx.fillStyle = 'rgba(100,200,255,0.2)';
        ctx.beginPath(); ctx.arc(0, 0, e.size * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawEnemyFish(s, chasing, ts, idx) {
    var frames = enemyFrames.filter(function (f) { return f && f.complete && f.naturalWidth > 0; });
    if (frames.length) {
      var frame = frames[Math.floor(ts / ENEMY_FRAME_INTERVAL_MS + idx) % frames.length];
      ctx.drawImage(frame, s * ENEMY_FRAME_DRAW.x, s * ENEMY_FRAME_DRAW.y, s * ENEMY_FRAME_DRAW.w, s * ENEMY_FRAME_DRAW.h);
      if (chasing) {
        ctx.fillStyle = 'rgba(255,70,20,0.22)';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    // Morphing animation: oscillate body proportions
    var phase = ts * 0.003 + (idx || 0) * 2.1;
    var morphX = 1 + Math.sin(phase) * 0.12 * animationIntensity;
    var morphY = 1 + Math.cos(phase * 1.3) * 0.15 * animationIntensity;
    var finWag = Math.sin(phase * 2.2) * 0.18 * animationIntensity;
    var jawOpen = Math.max(0, Math.sin(phase * 1.7)) * s * 0.08 * animationIntensity;

    ctx.fillStyle = chasing ? '#330800' : '#0e1820';
    ctx.beginPath(); ctx.ellipse(0, 0, s * morphX, s * 0.42 * morphY, 0, 0, Math.PI * 2); ctx.fill();
    // Tail with wag
    ctx.fillStyle = chasing ? '#220500' : '#0a1218';
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, 0);
    ctx.lineTo(-s * 1.25, -s * 0.4 + finWag * s);
    ctx.lineTo(-s * 1.25, s * 0.4 + finWag * s);
    ctx.closePath(); ctx.fill();
    // Dorsal fin with morph
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.42 * morphY);
    ctx.lineTo(-s * 0.35, -s * (0.82 + Math.sin(phase * 1.5) * 0.08));
    ctx.lineTo(-s * 0.6, -s * 0.42 * morphY);
    ctx.closePath(); ctx.fill();
    // Jaw morph (mouth opening)
    if (chasing && jawOpen > 0.5) {
      ctx.fillStyle = '#1a0000';
      ctx.beginPath();
      ctx.ellipse(s * 0.6, jawOpen * 0.5, s * 0.18, jawOpen, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = chasing ? '#ff1200' : '#0077bb';
    ctx.beginPath(); ctx.arc(s * 0.46, -s * 0.1, s * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(s * 0.48, -s * 0.1, s * 0.06, 0, Math.PI * 2); ctx.fill();
    // Body stripe markings with morph
    ctx.strokeStyle = chasing ? 'rgba(255,90,40,0.45)' : 'rgba(80,140,180,0.4)';
    ctx.lineWidth = Math.max(1, s * 0.06);
    for (var i = -1; i <= 1; i++) {
      var sway = Math.sin(phase + i * 0.7) * s * 0.04;
      ctx.beginPath();
      ctx.moveTo(-s * 0.15 + i * s * 0.2 + sway, -s * 0.28 * morphY);
      ctx.lineTo(-s * 0.05 + i * s * 0.2 - sway, s * 0.28 * morphY);
      ctx.stroke();
    }
  }

  // ── Player fish ───────────────────────────────────────────────────────────────
  function drawPlayerFish(ts) {
    var skin = skins[selectedFish] || skins[0];
    var spd  = Math.hypot(player.vx, player.vy);
    var inv  = ts < hitCooldown && hp < 2;
    if (inv && Math.floor(ts / 80) % 2 === 0) return;
    var now = performance.now();
    var isSprinting = now < sprintActive;
    var ds = depthScale(player.y);

    ctx.save();
    ctx.translate(player.x, player.y + 7 + (1 - ds) * 10);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 0, 26 * ds, 9 * ds, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.scale(playerScale * ds, playerScale * ds);

    // Electric aura during hunt phase
    if (huntPhase) {
      var auraPhase = ts * 0.008;
      for (var ai = 0; ai < 8; ai++) {
        var aAngle = auraPhase + ai * Math.PI * 0.25;
        var aR = 28 + Math.sin(auraPhase * 2 + ai) * 8;
        var ax = Math.cos(aAngle) * aR;
        var ay = Math.sin(aAngle) * aR;
        ctx.strokeStyle = 'rgba(80,200,255,' + (0.4 + Math.sin(auraPhase + ai) * 0.3) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax * 0.3, ay * 0.3);
        ctx.lineTo(ax, ay);
        ctx.stroke();
      }
      var aGlow = ctx.createRadialGradient(0, 0, 8, 0, 0, 38);
      aGlow.addColorStop(0, 'rgba(60,180,255,0.35)');
      aGlow.addColorStop(0.6, 'rgba(40,120,255,0.15)');
      aGlow.addColorStop(1, 'rgba(20,60,255,0)');
      ctx.fillStyle = aGlow;
      ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.fill();
    }

    // Sprint trail effect
    if (isSprinting && spd > 0.5) {
      for (var ti = 1; ti <= 4; ti++) {
        var ta2 = (0.3 - ti * 0.06);
        ctx.globalAlpha = ta2;
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath(); ctx.ellipse(-14 * ti, 0, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Swim trail
    if (spd > 0.5) {
      var ta = Math.min(1, spd / 5) * 0.4;
      var tg = ctx.createRadialGradient(-22, 0, 0, -22, 0, 16);
      tg.addColorStop(0, 'rgba(120,200,255,' + ta + ')');
      tg.addColorStop(1, 'rgba(60,120,255,0)');
      ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(-22, 0, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
    }

    if (skin && skin.img && skin.img.complete && skin.img.naturalWidth > 0) {
      ctx.drawImage(skin.img, PLAYER_SKIN_DRAW.x, PLAYER_SKIN_DRAW.y, PLAYER_SKIN_DRAW.w, PLAYER_SKIN_DRAW.h);
    } else {
      var c = BUILTIN_COLORS[selectedFish % BUILTIN_COLORS.length];
      ctx.fillStyle = c[0];
      ctx.beginPath(); ctx.ellipse(0, 0, 24, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c[1];
      ctx.beginPath(); ctx.moveTo(-19, 0); ctx.lineTo(-32, -13); ctx.lineTo(-32, 13); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, -12); ctx.lineTo(-12, -24); ctx.lineTo(-19, -12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c[2];
      ctx.beginPath(); ctx.arc(14, -4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(15, -4, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Saboteur fish (player 2 in local mode): same visual style as enemies
  function drawSaboteurFish(ts) {
    if (!player2) return;
    var ds = depthScale(player2.y);
    ctx.save();
    ctx.translate(player2.x, player2.y + 6 + (1 - ds) * 9);
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath(); ctx.ellipse(0, 0, 20 * ds, 7 * ds, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(player2.x, player2.y);
    ctx.rotate(player2.angle);
    ctx.scale(ds, ds);
    drawEnemyFish(SABOTEUR_SIZE, true, ts, SABOTEUR_FRAME_OFFSET);
    ctx.restore();
  }

  // Mama fish: large protective fish with blue glow
  function drawMamaFish(ts) {
    var now = performance.now();
    var remaining = mamaFishActive - now;
    var totalDuration = 4000;
    var progress = 1 - (remaining / totalDuration);
    // Fade in first 0.5s, fade out last 0.5s
    var alpha = 1;
    if (progress < 0.125) alpha = progress / 0.125;
    else if (progress > 0.875) alpha = (1 - progress) / 0.125;

    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.translate(mamaFishX, mamaFishY);
    ctx.rotate(mamaFishAngle);

    // Blue glow aura (bigger)
    var glow = ctx.createRadialGradient(0, 0, 16, 0, 0, 90);
    glow.addColorStop(0, 'rgba(50,150,255,0.4)');
    glow.addColorStop(1, 'rgba(30,100,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 90, 0, Math.PI * 2); ctx.fill();

    // Large animated mama fish body / skin (bigger)
    var wag = Math.sin(ts * 0.02) * 7;
    var skin = skins[selectedFish] || skins[0];
    if (skin && skin.img && skin.img.complete && skin.img.naturalWidth > 0) {
      ctx.drawImage(skin.img, -60, -34, 120, 68);
      ctx.fillStyle = 'rgba(80,180,255,0.22)';
      ctx.beginPath(); ctx.ellipse(-56, wag * 0.15, 22, 20, wag * 0.02, 0, Math.PI * 2); ctx.fill();
    } else {
      var c = BUILTIN_COLORS[selectedFish % BUILTIN_COLORS.length];
      ctx.fillStyle = c[0];
      ctx.beginPath(); ctx.ellipse(0, 0, 56, 28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c[1];
      ctx.beginPath(); ctx.moveTo(-44, 0); ctx.lineTo(-74, -30 + wag); ctx.lineTo(-74, 30 - wag); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-11, -28); ctx.lineTo(-28, -54); ctx.lineTo(-44, -28); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c[2];
      ctx.beginPath(); ctx.arc(34, -8, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(36, -8, 5.5, 0, Math.PI * 2); ctx.fill();
    }

    // Freeze radius indicator
    ctx.strokeStyle = 'rgba(100,200,255,' + (alpha * 0.3) + ')';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(0, 0, MAMA_FREEZE_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Lighting ──────────────────────────────────────────────────────────────────
  function drawLighting(ts) {
    lightCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    lightCtx.fillStyle = 'rgba(1,8,24,0.88)';
    lightCtx.fillRect(0, 0, VIEW_W, VIEW_H);
    lightCtx.globalCompositeOperation = 'destination-out';

    // Player 1 light
    var sx = player.x - camera.x, sy = player.y - camera.y;
    var amb = lightCtx.createRadialGradient(sx, sy, 0, sx, sy, LIGHT_R);
    amb.addColorStop(0,    'rgba(0,0,0,1)');
    amb.addColorStop(0.55, 'rgba(0,0,0,0.75)');
    amb.addColorStop(1,    'rgba(0,0,0,0)');
    lightCtx.fillStyle = amb;
    lightCtx.beginPath(); lightCtx.arc(sx, sy, LIGHT_R, 0, Math.PI * 2); lightCtx.fill();

    var cg = lightCtx.createRadialGradient(sx, sy, 0, sx, sy, CONE_LEN);
    cg.addColorStop(0, 'rgba(0,0,0,0.85)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    lightCtx.fillStyle = cg;
    lightCtx.beginPath();
    lightCtx.moveTo(sx, sy);
    lightCtx.arc(sx, sy, CONE_LEN, player.angle - CONE_HALF, player.angle + CONE_HALF);
    lightCtx.closePath(); lightCtx.fill();

    // Player 2 light (local mode)
    if (isLocalMode && player2) {
      var sx2 = player2.x - camera.x, sy2 = player2.y - camera.y;
      var amb2 = lightCtx.createRadialGradient(sx2, sy2, 0, sx2, sy2, LIGHT_R);
      amb2.addColorStop(0,    'rgba(0,0,0,1)');
      amb2.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      amb2.addColorStop(1,    'rgba(0,0,0,0)');
      lightCtx.fillStyle = amb2;
      lightCtx.beginPath(); lightCtx.arc(sx2, sy2, LIGHT_R, 0, Math.PI * 2); lightCtx.fill();

      var cg2 = lightCtx.createRadialGradient(sx2, sy2, 0, sx2, sy2, CONE_LEN);
      cg2.addColorStop(0, 'rgba(0,0,0,0.85)'); cg2.addColorStop(1, 'rgba(0,0,0,0)');
      lightCtx.fillStyle = cg2;
      lightCtx.beginPath();
      lightCtx.moveTo(sx2, sy2);
      lightCtx.arc(sx2, sy2, CONE_LEN, player2.angle - CONE_HALF, player2.angle + CONE_HALF);
      lightCtx.closePath(); lightCtx.fill();
    }

    lightCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
  }

  // ── Minimap ───────────────────────────────────────────────────────────────────
  function drawMinimap() {
    var mx = VIEW_W - 146, my = 14, mw = 130, mh = 72;
    var sx = mw / WORLD_W, sy = mh / WORLD_H;
    ctx.fillStyle = 'rgba(0,5,15,0.72)'; ctx.strokeStyle = '#1a3848'; ctx.lineWidth = 1;
    ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx, my, mw, mh);
    for (var i = 0; i < cables.length; i++) {
      var c = cables[i];
      ctx.fillStyle = c.fixed ? '#00dd55' : '#dd5500';
      ctx.fillRect(mx + c.mx * sx - 1.5, my + c.my * sy - 1.5, 3, 3);
    }
    for (var j = 0; j < enemies.length; j++) {
      var e = enemies[j];
      ctx.fillStyle = e.chasing ? '#ff2200' : '#224466';
      ctx.fillRect(mx + e.x * sx - 1, my + e.y * sy - 1, 2.5, 2.5);
    }
    ctx.fillStyle = '#44aaff';
    ctx.beginPath(); ctx.arc(mx + player.x * sx, my + player.y * sy, 2.5, 0, Math.PI * 2); ctx.fill();
    if (isLocalMode && player2) {
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(mx + player2.x * sx, my + player2.y * sy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(70,170,255,0.5)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(mx + camera.x * sx, my + camera.y * sy, VIEW_W * sx, VIEW_H * sy);
    ctx.fillStyle = 'rgba(140,190,255,0.55)'; ctx.font = '8px monospace';
    ctx.fillText('MAP', mx + 4, my + 9);
  }

  // ── Proximity hint ────────────────────────────────────────────────────────────
  function drawProximityHint() {
    ctx.fillStyle = 'rgba(255,200,50,0.9)';
    ctx.font = 'bold 12px "Courier New",monospace'; ctx.textAlign = 'center';
    ctx.fillText('\u25ba CABLE NEARBY \u2014 SWIM CLOSER', VIEW_W / 2, VIEW_H - 18);
    ctx.textAlign = 'left';
  }

  // ── Leaderboard helpers ───────────────────────────────────────────────────────
  function loadLb() {
    try { return JSON.parse(localStorage.getItem('reparefish_lb') || '[]'); } catch (e) { return []; }
  }

  function saveLb(lb) {
    try { localStorage.setItem('reparefish_lb', JSON.stringify(lb)); } catch (e) {}
  }

  function formatTime(ms) {
    var secs = Math.floor(ms / 1000), mins = Math.floor(secs / 60), s2 = secs % 60;
    var cs = Math.floor((ms % 1000) / 10);
    return mins + ':' + (s2 < 10 ? '0' : '') + s2 + '.' + (cs < 10 ? '0' : '') + cs;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function lbTableHtml(rows) {
    if (!rows.length) return '<p style="opacity:0.4;font-size:0.75em;color:#7aaabb">No scores yet.</p>';
    var h = '<table class="lb-table"><thead><tr><th>#</th><th>NAME</th><th>TIME</th><th>DIFF</th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var dn = escHtml(DIFF_NAMES[r.diff] || String(r.diff));
      h += '<tr><td>' + (i + 1) + '</td><td>' + escHtml(r.name) + '</td><td>' + formatTime(r.time) + '</td><td>' + dn + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function refreshLbPreview() {
    var el = document.getElementById('lb-preview');
    if (!el) return;
    var rows = loadLb().filter(function (r) { return r.diff === difficulty; }).slice(0, 5);
    el.innerHTML = rows.length
      ? '<table class="lb-table lb-small"><thead><tr><th>#</th><th>NAME</th><th>TIME</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + escHtml(r.name) + '</td><td>' + formatTime(r.time) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p style="opacity:0.4;font-size:0.7em;color:#7aaabb">No scores for this difficulty.</p>';
  }

  function showWinScreen() {
    var lb = loadLb();
    lb.push({ name: fishName, time: Math.round(elapsedMs), diff: difficulty });
    lb.sort(function (a, b) { return a.time - b.time; });
    lb = lb.slice(0, 30);
    saveLb(lb);
    document.getElementById('win-time').textContent =
      fishName + ' \u2014 ' + formatTime(elapsedMs) + '  \xb7  ' + DIFF_NAMES[difficulty];
    var rows = lb.filter(function (r) { return r.diff === difficulty; }).slice(0, 8);
    document.getElementById('leaderboard').innerHTML = lbTableHtml(rows);
    document.getElementById('win-screen').classList.remove('hidden');
    setTouchControlsVisibility();
  }

  // ── Typewriter lore animation ─────────────────────────────────────────────────
  function startTypewriter() {
    var el = document.getElementById('lore-text');
    if (!el) return;
    el.textContent = '';
    var cursor = document.createElement('span');
    cursor.className = 'lore-cursor'; cursor.textContent = '\u258c';
    el.appendChild(cursor);
    var idx = 0;
    function typeNext() {
      if (idx >= LORE_TEXT.length) return;
      el.insertBefore(document.createTextNode(LORE_TEXT[idx]), cursor);
      idx++;
      if (idx < LORE_TEXT.length) setTimeout(typeNext, 22);
    }
    setTimeout(typeNext, 420);
  }

  // ── Fish picker (dynamic, rebuilt after asset load) ───────────────────────────
  function buildFishPicker() {
    var container = document.getElementById('fish-picker');
    if (!container) return;
    container.innerHTML = '';

    skins.forEach(function (skin, i) {
      var div = document.createElement('div');
      div.className = 'fish-opt' + (i === selectedFish ? ' selected' : '');
      div.dataset.fish = String(i);

      if (skin.img && skin.img.complete && skin.img.naturalWidth > 0) {
        var imgEl = document.createElement('img');
        imgEl.src = skin.img.src; imgEl.alt = skin.name; imgEl.className = 'fish-preview-img';
        div.appendChild(imgEl);
      } else {
        var c2 = document.createElement('canvas');
        c2.width = 70; c2.height = 50; c2.className = 'fish-preview';
        drawCanvasPreview(c2, i);
        div.appendChild(c2);
      }

      var span = document.createElement('span');
      span.textContent = skin.name;
      div.appendChild(span);
      container.appendChild(div);

      div.addEventListener('click', function () {
        document.querySelectorAll('.fish-opt').forEach(function (o) { o.classList.remove('selected'); });
        div.classList.add('selected');
        selectedFish = i;
        var ni = document.getElementById('fish-name-input');
        if (ni) ni.value = skin.name;
      });
    });

    // Sync name input
    var ni = document.getElementById('fish-name-input');
    if (ni && skins[selectedFish]) ni.value = skins[selectedFish].name;
  }

  function drawCanvasPreview(c, idx) {
    var pal = BUILTIN_COLORS[idx % BUILTIN_COLORS.length];
    var pc  = c.getContext('2d');
    pc.clearRect(0, 0, 70, 50);
    pc.save(); pc.translate(35, 27);
    pc.fillStyle = pal[0]; pc.beginPath(); pc.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2); pc.fill();
    pc.fillStyle = pal[1];
    pc.beginPath(); pc.moveTo(-14, 0); pc.lineTo(-24, -9); pc.lineTo(-24, 9); pc.closePath(); pc.fill();
    pc.beginPath(); pc.moveTo(-3, -9); pc.lineTo(-9, -17); pc.lineTo(-14, -9); pc.closePath(); pc.fill();
    pc.fillStyle = pal[2]; pc.beginPath(); pc.arc(10, -2, 3.5, 0, Math.PI * 2); pc.fill();
    pc.fillStyle = '#000'; pc.beginPath(); pc.arc(11, -2, 1.5, 0, Math.PI * 2); pc.fill();
    pc.restore();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function rrect(c2, x, y, w, h, r) {
    c2.beginPath();
    c2.moveTo(x + r, y); c2.lineTo(x + w - r, y); c2.quadraticCurveTo(x + w, y, x + w, y + r);
    c2.lineTo(x + w, y + h - r); c2.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c2.lineTo(x + r, y + h); c2.quadraticCurveTo(x, y + h, x, y + h - r);
    c2.lineTo(x, y + r); c2.quadraticCurveTo(x, y, x + r, y);
    c2.closePath();
  }

  function inView(x, y, pad) {
    pad = pad || 0;
    return x + pad >= camera.x && x - pad <= camera.x + VIEW_W &&
           y + pad >= camera.y && y - pad <= camera.y + VIEW_H;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function depthScale(y) {
    return 0.8 + (clamp(y, 0, WORLD_H) / WORLD_H) * 0.38;
  }

  function calculateDepth(y) {
    return depthBase - Math.round((y / WORLD_H) * depthRange);
  }

  function lerpAngle(a, b, t) {
    var d = b - a;
    while (d >  Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // ── Mobile touch controls ────────────────────────────────────────────────────
  function setupTouchControls() {
    var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isTouchDevice) return;

    var wrapper = document.getElementById('game-wrapper');

    // Create touch controls container
    var container = document.createElement('div');
    container.id = 'touch-controls';

    // Joystick
    var joystick = document.createElement('div');
    joystick.id = 'touch-joystick';
    joystick.className = 'touch-zone';
    var stick = document.createElement('div');
    stick.id = 'touch-stick';
    joystick.appendChild(stick);
    container.appendChild(joystick);

    // Sprint button
    var sprintBtn = document.createElement('div');
    sprintBtn.id = 'touch-sprint-btn';
    sprintBtn.className = 'touch-btn touch-zone';
    sprintBtn.textContent = 'SPRINT';
    container.appendChild(sprintBtn);

    // Mama button
    var mamaBtn = document.createElement('div');
    mamaBtn.id = 'touch-mama-btn';
    mamaBtn.className = 'touch-btn touch-zone';
    mamaBtn.textContent = 'MAMA';
    container.appendChild(mamaBtn);

    wrapper.appendChild(container);
    touchControlsEl = container;
    touchMamaBtn = mamaBtn;

    // Joystick touch handling
    var joyTouchId = null;
    var joyCenter = { x: 0, y: 0 };
    var joyRadius = 50;

    joystick.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      joyTouchId = t.identifier;
      var rect = joystick.getBoundingClientRect();
      joyCenter.x = rect.left + rect.width / 2;
      joyCenter.y = rect.top + rect.height / 2;
      // Scale joyRadius to match the visual size on screen
      joyRadius = rect.width / 2;
    }, { passive: false });

    window.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === joyTouchId) {
          e.preventDefault();
          var dx = t.clientX - joyCenter.x;
          var dy = t.clientY - joyCenter.y;
          var dist = Math.hypot(dx, dy);
          if (dist > joyRadius) { dx = dx / dist * joyRadius; dy = dy / dist * joyRadius; }
          stick.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
          // Map to keys
          var threshold = 0.3;
          var nx = dx / joyRadius;
          var ny = dy / joyRadius;
          keys['KeyW'] = ny < -threshold;
          keys['KeyS'] = ny > threshold;
          keys['KeyA'] = nx < -threshold;
          keys['KeyD'] = nx > threshold;
        }
      }
    }, { passive: false });

    function endJoy(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joyTouchId) {
          joyTouchId = null;
          stick.style.transform = 'translate(-50%, -50%)';
          keys['KeyW'] = false; keys['KeyS'] = false;
          keys['KeyA'] = false; keys['KeyD'] = false;
        }
      }
    }
    window.addEventListener('touchend', endJoy);
    window.addEventListener('touchcancel', endJoy);

    // Sprint button
    sprintBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if ((gameState === STATE_PLAY || gameState === STATE_LOCAL) && !sprintUsed) {
        sprintUsed = true;
        sprintActive = performance.now() + 1500;
      }
    }, { passive: false });

    // Mama button
    mamaBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (gameState === STATE_PLAY && !isLocalMode && difficulty <= 1 && !mamaFishUsed) {
        mamaFishUsed = true;
        mamaFishActive = performance.now() + 4000;
        mamaFishX = player.x;
        mamaFishY = player.y;
        mamaFishAngle = player.angle;
      }
    }, { passive: false });

    setTouchControlsVisibility();
  }

  function setTouchControlsVisibility() {
    if (!touchControlsEl) return;
    var inPlay = gameState === STATE_PLAY || gameState === STATE_LOCAL;
    touchControlsEl.classList.toggle('active', inPlay);
    if (touchMamaBtn) {
      // Hide mama button in local mode, hard difficulty, or during hunt phase
      touchMamaBtn.style.display = (gameState === STATE_PLAY && !isLocalMode && difficulty <= 1 && !huntPhase) ? '' : 'none';
    }
  }

  function applyHudSettings() {
    var hud = document.getElementById('hud');
    if (hud) hud.style.display = showHud ? 'flex' : 'none';
    var nameBlock = document.getElementById('hud-name-block');
    var depthBlock = document.getElementById('hud-depth-block');
    var objectiveBlock = document.getElementById('hud-objective-block');
    if (nameBlock) nameBlock.style.display = showHudName ? 'flex' : 'none';
    if (depthBlock) depthBlock.style.display = showHudDepth ? 'flex' : 'none';
    if (objectiveBlock) objectiveBlock.style.display = showHudObjective ? 'flex' : 'none';
  }

  function getHuntLimitMs() {
    if (isStoryMode && storyLevel >= 0 && STORY_LEVELS[storyLevel]) return STORY_LEVELS[storyLevel].huntMs;
    return HUNT_TIME_LIMITS[difficulty] || HUNT_TIME_LIMITS[HUNT_TIME_LIMITS.length - 1];
  }

  function setSelectedDifficultyBtn(diff) {
    document.querySelectorAll('.diff-btn').forEach(function (o) {
      o.classList.toggle('selected', parseInt(o.dataset.diff, 10) === diff);
    });
    refreshLbPreview();
  }

  function showHuntTimeout() {
    gameState = STATE_GAMEOVER;
    var go = document.getElementById('gameover-screen');
    var h1 = go.querySelector('h1');
    var p = go.querySelector('p');
    if (h1) h1.textContent = 'HUNT FAILED';
    if (p) p.textContent = 'Time is up. The predators escaped!';
    go.classList.remove('hidden');
    setTouchControlsVisibility();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.warn('[PWA] Service worker registration failed:', err);
    });
  }

  window.addEventListener('load', init);
}());
