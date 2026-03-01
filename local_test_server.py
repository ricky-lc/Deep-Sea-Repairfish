#!/usr/bin/env python3
"""Simple HTTP server for Deep-Sea Repairfish.

Serves static game files so the PWA / service-worker features work.
Local multiplayer is same-keyboard and needs no server at all — this
script is only useful when you want an http:// URL instead of file://.

Usage:
    python3 local_test_server.py              # default port 8000
    python3 local_test_server.py --port 3000  # custom port
"""

from __future__ import annotations

import argparse
import http.server
import logging
import os
import socket
import socketserver
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def get_local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve Deep-Sea Repairfish over HTTP.")
    parser.add_argument("--host", default="0.0.0.0", help="Host/IP to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent
    os.chdir(repo_root)

    handler = http.server.SimpleHTTPRequestHandler
    with ReusableTCPServer((args.host, args.port), handler) as httpd:
        local_ip = get_local_ip()
        logger.info("Serving %s on http://127.0.0.1:%d", repo_root, args.port)
        if args.host in ("0.0.0.0", "::"):
            logger.info("LAN URL: http://%s:%d", local_ip, args.port)
        logger.info("Press Ctrl+C to stop.")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
