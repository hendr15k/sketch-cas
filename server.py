#!/usr/bin/env python3
"""Sketch-CAS server with training data API endpoint."""
import http.server
import json
import os
import shutil
from datetime import datetime

DATA_DIR = "/opt/data/sketch-cas/training-data"
os.makedirs(DATA_DIR, exist_ok=True)
MAX_BODY_BYTES = 25 * 1024 * 1024  # 25 MB cap to prevent OOM DoS

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/send-training":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except (TypeError, ValueError):
                self.send_error(400, "Invalid Content-Length")
                return
            if length < 0 or length > MAX_BODY_BYTES:
                self.send_error(413, "Payload too large")
                return
            try:
                body = self.rfile.read(length) if length else b""
                data = json.loads(body)
            except json.JSONDecodeError as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Invalid JSON: " + str(e)}).encode())
                return
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())
                return
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = "training_" + ts + ".json"
            filepath = os.path.join(DATA_DIR, filename)
            try:
                with open(filepath, "w") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                # Also copy to latest
                shutil.copy2(filepath, os.path.join(DATA_DIR, "latest.json"))
            except OSError as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Write failed: " + str(e)}).encode())
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "file": filename}).encode())
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
    os.chdir("/opt/data/sketch-cas")
    server = http.server.HTTPServer(("0.0.0.0", 3141), Handler)
    print("Sketch-CAS server on :3141 (with training API)")
    server.serve_forever()
