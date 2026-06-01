#!/usr/bin/env python3
"""Sketch-CAS server with training data API endpoint."""
import http.server
import json
import os
import shutil
from datetime import datetime

DATA_DIR = "/opt/data/sketch-cas/training-data"
# Cap upload body at 25 MiB to avoid OOM-DoS while still leaving headroom
# for hand-written math training payloads that may include base64 images.
MAX_BODY_BYTES = 25 * 1024 * 1024
os.makedirs(DATA_DIR, exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/api/send-training":
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
                data = json.loads(body)
            except json.JSONDecodeError as e:
                self._send_json(400, {"ok": False, "error": f"Invalid JSON: {e}"})
                return
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = "training_" + ts + ".json"
            filepath = os.path.join(DATA_DIR, filename)
            with open(filepath, "w") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            # Also copy to latest
            shutil.copy2(filepath, os.path.join(DATA_DIR, "latest.json"))
            self._send_json(200, {"ok": True, "file": filename})
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        # Quieter logging
        pass

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3141
    os.chdir("/opt/data/sketch-cas")
    server = http.server.HTTPServer(("0.0.0.0", port), Handler)
    print(f"Sketch-CAS server on :{port} (with training API)")
    server.serve_forever()
