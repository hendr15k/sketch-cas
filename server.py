#!/usr/bin/env python3
"""Sketch-CAS server with training data API endpoint."""
import http.server
import json
import os
import time
import urllib.parse
from datetime import datetime

# Resolve paths relative to this script so the server runs identically
# in development (repo root) and in production deployments.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "training-data")
# Cap upload body at 25 MiB to avoid OOM-DoS while still leaving headroom
# for hand-written math training payloads that may include base64 images.
MAX_BODY_BYTES = 25 * 1024 * 1024
os.makedirs(DATA_DIR, exist_ok=True)


def _reject_constant(name: str) -> None:
    # json.loads accepts NaN/Infinity by default; they are not valid JSON and
    # would be stored in a file no JSON.parse can read back.
    raise ValueError("non-finite number: " + name)


def _write_json(path: str, payload: dict) -> None:
    """Write JSON atomically so readers never see a half-written file."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class Handler(http.server.SimpleHTTPRequestHandler):
    # Socket timeout: a client that announces a large Content-Length and then
    # sends nothing used to block the whole (single-threaded) server forever.
    timeout = 15

    def _cors_origin(self) -> str | None:
        """Only reflect local dev origins; a wildcard lets any website the
        user visits POST into the local training store."""
        origin = self.headers.get("Origin")
        if not origin:
            return None
        host = urllib.parse.urlsplit(origin).hostname or ""
        return origin if host in ("localhost", "127.0.0.1", "::1") else None

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/health":
            self._send_json(200, {"ok": True, "service": "sketch-cas"})
        elif any(seg.startswith(".") for seg in path.split("/") if seg):
            # Do not serve .git/, .env and friends from the checkout.
            self.send_error(404)
        else:
            super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/send-training":
            # Content-Length may be missing, malformed, or even negative for
            # malicious clients. Validate before passing to int()/rfile.read().
            cl_header = self.headers.get("Content-Length")
            try:
                length = int(cl_header) if cl_header is not None else 0
            except (TypeError, ValueError):
                self._send_json(400, {"ok": False, "error": "Invalid Content-Length"})
                return
            if length < 0:
                self._send_json(400, {"ok": False, "error": "Negative Content-Length"})
                return
            if length == 0:
                self._send_json(400, {"ok": False, "error": "Empty body"})
                return
            if length > MAX_BODY_BYTES:
                self._send_json(413, {"ok": False, "error": "Body too large"})
                return
            try:
                body = self.rfile.read(length)
            except (OSError, ConnectionError) as e:
                self._send_json(400, {"ok": False, "error": f"Read failed: {e}"})
                return
            try:
                data = json.loads(body, parse_constant=_reject_constant)
            except json.JSONDecodeError as e:
                self._send_json(400, {"ok": False, "error": f"Invalid JSON: {e}"})
                return
            except (RecursionError, ValueError) as e:
                # Deeply nested bodies raise RecursionError; NaN/Infinity are
                # rejected by _reject_constant.  Neither is a JSONDecodeError.
                self._send_json(400, {"ok": False, "error": f"Invalid JSON: {e}"})
                return
            # Two uploads inside the same second used to collide on one
            # filename and silently drop the first payload. Add a microsecond
            # suffix and write atomically so a crash cannot leave a truncated
            # latest.json behind.
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = "training_" + ts + "_" + str(time.time_ns() % 1_000_000).zfill(6) + ".json"
            filepath = os.path.join(DATA_DIR, filename)
            _write_json(filepath, data)
            _write_json(os.path.join(DATA_DIR, "latest.json"), data)
            self._send_json(200, {"ok": True, "file": filename})
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        # Quieter logging
        pass

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3141
    os.chdir(SCRIPT_DIR)
    # ThreadingHTTPServer: one stalled upload must not block health checks,
    # uploads or static files served to everybody else.
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Sketch-CAS server on :{port} (with training API)")
    server.serve_forever()
