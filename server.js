#!/usr/bin/env node
/**
 * Deep-Sea Repairfish — Static file server (Node.js, zero dependencies)
 *
 * Serves the game files so PWA / service-worker features work.
 * Includes a tiny LAN session API for same-Wi-Fi multiplayer.
 *
 * Usage:
 *   node server.js                 # default port 8000
 *   node server.js --port 3000     # custom port
 *   npm start                      # uses package.json script
 */
'use strict';

var http = require('http');
var fs   = require('fs');
var path = require('path');
var os   = require('os');

// ── CLI args ─────────────────────────────────────────────────────────────────
var PORT = 8000;
var HOST = '0.0.0.0';
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--port' && process.argv[i + 1]) {
    PORT = parseInt(process.argv[++i], 10) || 8000;
  } else if (process.argv[i] === '--host' && process.argv[i + 1]) {
    HOST = process.argv[++i];
  }
}

var ROOT = __dirname;
var rooms = Object.create(null);
var ROOM_TTL_MS = 1000 * 60 * 60 * 2;
var BODY_LIMIT = 32 * 1024;

// ── MIME types ───────────────────────────────────────────────────────────────
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json'
};

// ── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  var ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(ts + ' ' + msg);
}

function json(res, code, payload) {
  var body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function cleanupRooms() {
  var now = Date.now();
  Object.keys(rooms).forEach(function (code) {
    if (now - rooms[code].updatedAt > ROOM_TTL_MS) delete rooms[code];
  });
}

function makeToken(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function parseJsonBody(req, cb) {
  var chunks = [];
  var total = 0;
  req.on('data', function (chunk) {
    total += chunk.length;
    if (total > BODY_LIMIT) {
      req.destroy();
      cb(new Error('Body too large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', function () {
    if (!chunks.length) {
      cb(null, {});
      return;
    }
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (e) {
      cb(new Error('Invalid JSON'));
    }
  });
  req.on('error', function () { cb(new Error('Request error')); });
}

function sanitizeInput(input) {
  input = input || {};
  return {
    up: !!input.up,
    down: !!input.down,
    left: !!input.left,
    right: !!input.right,
    sprint: !!input.sprint
  };
}

function safeNum(v, lo, hi, dft) {
  var n = Number(v);
  if (!isFinite(n)) return dft;
  return clamp(n, lo, hi);
}

function sanitizeSnapshot(snapshot) {
  snapshot = snapshot || {};
  var player = snapshot.player || {};
  var player2 = snapshot.player2 || {};
  var enemies = Array.isArray(snapshot.enemies) ? snapshot.enemies.slice(0, 24) : [];
  var cables = Array.isArray(snapshot.cables) ? snapshot.cables.slice(0, 30) : [];
  return {
    gameState: ['play', 'local', 'win', 'gameover'].indexOf(snapshot.gameState) >= 0 ? snapshot.gameState : 'play',
    fixedCount: safeNum(snapshot.fixedCount, 0, 999, 0),
    numCables: safeNum(snapshot.numCables, 0, 999, 0),
    hp: safeNum(snapshot.hp, 0, 2, 2),
    elapsedMs: safeNum(snapshot.elapsedMs, 0, 1000 * 60 * 60, 0),
    huntPhase: !!snapshot.huntPhase,
    huntRemainingMs: safeNum(snapshot.huntRemainingMs, 0, 1000 * 60 * 10, 0),
    player: {
      x: safeNum(player.x, 0, 4096, 2048),
      y: safeNum(player.y, 0, 2288, 1144),
      angle: safeNum(player.angle, -10, 10, 0)
    },
    player2: {
      x: safeNum(player2.x, 0, 4096, 2248),
      y: safeNum(player2.y, 0, 2288, 1144),
      angle: safeNum(player2.angle, -10, 10, 0)
    },
    enemies: enemies.map(function (e) {
      e = e || {};
      return {
        x: safeNum(e.x, 0, 4096, 0),
        y: safeNum(e.y, 0, 2288, 0),
        angle: safeNum(e.angle, -10, 10, 0),
        size: safeNum(e.size, 8, 80, 24),
        chasing: !!e.chasing,
        frozen: !!e.frozen
      };
    }),
    cables: cables.map(function (c) {
      c = c || {};
      return { fixed: !!c.fixed, mx: safeNum(c.mx, 0, 4096, 0), my: safeNum(c.my, 0, 2288, 0) };
    })
  };
}

function lanApi(req, res) {
  cleanupRooms();
  var reqUrl = new URL(req.url, 'http://localhost');
  var pathname = reqUrl.pathname;
  if (req.method === 'POST' && pathname === '/api/lan/create') {
    parseJsonBody(req, function (err, body) {
      if (err) { json(res, 400, { error: err.message }); return; }
      var roomCode = '';
      for (var i = 0; i < 8; i++) {
        roomCode = makeToken(6);
        if (!rooms[roomCode]) break;
      }
      var hostToken = makeToken(20);
      var roundTimeSec = safeNum(body.roundTimeSec, 0, 300, 90);
      rooms[roomCode] = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        roundTimeSec: roundTimeSec,
        hostToken: hostToken,
        joinToken: null,
        hostInput: sanitizeInput({}),
        joinInput: sanitizeInput({}),
        snapshot: null
      };
      json(res, 200, { roomCode: roomCode, token: hostToken, role: 'host', roundTimeSec: roundTimeSec });
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/lan/join') {
    parseJsonBody(req, function (err, body) {
      if (err) { json(res, 400, { error: err.message }); return; }
      var roomCode = String((body && body.roomCode) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      var room = rooms[roomCode];
      if (!room) { json(res, 404, { error: 'Room not found' }); return; }
      if (room.joinToken) { json(res, 409, { error: 'Room already full' }); return; }
      var joinToken = makeToken(20);
      room.joinToken = joinToken;
      room.updatedAt = Date.now();
      json(res, 200, { roomCode: roomCode, token: joinToken, role: 'join', roundTimeSec: room.roundTimeSec });
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/lan/input') {
    parseJsonBody(req, function (err, body) {
      if (err) { json(res, 400, { error: err.message }); return; }
      var roomCode = String((body && body.roomCode) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      var token = String((body && body.token) || '');
      var room = rooms[roomCode];
      if (!room) { json(res, 404, { error: 'Room not found' }); return; }
      if (token === room.hostToken) room.hostInput = sanitizeInput(body.input);
      else if (token === room.joinToken) room.joinInput = sanitizeInput(body.input);
      else { json(res, 403, { error: 'Invalid token' }); return; }
      room.updatedAt = Date.now();
      json(res, 200, { ok: true });
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/lan/snapshot') {
    parseJsonBody(req, function (err, body) {
      if (err) { json(res, 400, { error: err.message }); return; }
      var roomCode = String((body && body.roomCode) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      var token = String((body && body.token) || '');
      var room = rooms[roomCode];
      if (!room) { json(res, 404, { error: 'Room not found' }); return; }
      if (token !== room.hostToken) { json(res, 403, { error: 'Host token required' }); return; }
      room.snapshot = sanitizeSnapshot(body.snapshot);
      room.updatedAt = Date.now();
      json(res, 200, { ok: true });
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/lan/poll') {
    var roomCode = String(reqUrl.searchParams.get('roomCode') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var token = String(reqUrl.searchParams.get('token') || '');
    var room = rooms[roomCode];
    if (!room) { json(res, 404, { error: 'Room not found' }); return; }
    var role = '';
    if (token === room.hostToken) role = 'host';
    else if (token === room.joinToken) role = 'join';
    else { json(res, 403, { error: 'Invalid token' }); return; }
    room.updatedAt = Date.now();
    json(res, 200, {
      role: role,
      ready: !!room.joinToken,
      roundTimeSec: room.roundTimeSec,
      joinInput: role === 'host' ? room.joinInput : undefined,
      hostInput: role === 'join' ? room.hostInput : undefined,
      snapshot: role === 'join' ? room.snapshot : null
    });
    return;
  }
  json(res, 404, { error: 'Unknown LAN endpoint' });
}

// ── Static file serving ──────────────────────────────────────────────────────
function serveStatic(req, res) {
  var reqUrl = new URL(req.url, 'http://localhost');
  var relPath = decodeURIComponent(reqUrl.pathname);
  if (relPath === '/') relPath = '/index.html';

  // Prevent directory traversal
  var filePath = path.resolve(ROOT, '.' + relPath);
  if (filePath.indexOf(path.resolve(ROOT)) !== 0) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404); res.end('Not Found');
      return;
    }
    var ext  = path.extname(filePath).toLowerCase();
    var mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stats.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ── Server ───────────────────────────────────────────────────────────────────
var server = http.createServer(function (req, res) {
  if (req.url.indexOf('/api/lan/') === 0) {
    lanApi(req, res);
  } else if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    res.writeHead(405, { 'Allow': 'GET, POST' }); res.end('Method Not Allowed');
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
function getLocalIP() {
  var interfaces = os.networkInterfaces();
  var keys = Object.keys(interfaces);
  for (var k = 0; k < keys.length; k++) {
    var addrs = interfaces[keys[k]];
    for (var a = 0; a < addrs.length; a++) {
      if (addrs[a].family === 'IPv4' && !addrs[a].internal) return addrs[a].address;
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, HOST, function () {
  var localIP = getLocalIP();
  log('Serving ' + ROOT + ' on http://127.0.0.1:' + PORT);
  if (HOST === '0.0.0.0' || HOST === '::') {
    log('LAN URL: http://' + localIP + ':' + PORT);
  }
  log('Press Ctrl+C to stop.');
});
