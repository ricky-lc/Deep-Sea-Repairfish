#!/usr/bin/env node
/**
 * Deep-Sea Repairfish — Static file server (Node.js, zero dependencies)
 *
 * Serves the game files so PWA / service-worker features work.
 * Local multiplayer is same-keyboard — no server API needed.
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
  if (req.method === 'GET') {
    serveStatic(req, res);
  } else {
    res.writeHead(405, { 'Allow': 'GET' }); res.end('Method Not Allowed');
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
