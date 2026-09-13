"""Static server for the ForgeSense frontend.

Usage:
  python serve.py [port]
Backend API is read from localStorage 'forgesense.api' (default http://localhost:8080).
"""
import http.server
import socketserver
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"ForgeSense frontend on http://localhost:{PORT}")
    print("Open the browser, enter the admin password when prompted.")
    httpd.serve_forever()