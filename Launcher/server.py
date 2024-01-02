"""Tiny local web server for the Surify app (macOS / Linux).

Serves the project at http://localhost:8765/, opens it in the
default browser and shuts itself down once the page has been closed.
"""
import http.server
import os
import posixpath
import threading
import time
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARENT = os.path.dirname(ROOT)
PORT = 8765
URL = f"http://localhost:{PORT}/"
IDLE_SECONDS = 120          # the page pings every 5s; browsers may throttle hidden tabs

last_ping = time.time()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        global last_ping
        path = urllib.parse.urlsplit(self.path).path
        if path.endswith("/__ping"):
            last_ping = time.time()
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def translate_path(self, path):
        path = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        if path in ("", "/"):
            return os.path.join(ROOT, "App", "index.html")
        parts = [p for p in posixpath.normpath(path).split("/") if p and p not in (".", "..")]
        rel = os.path.join(*parts) if parts else ""
        full = os.path.join(ROOT, rel)
        # Music folder may live in the parent directory instead
        if not os.path.exists(full) and parts and parts[0] == "Audios":
            alt = os.path.join(PARENT, rel)
            if os.path.exists(alt):
                return alt
        return full


def watchdog():
    while True:
        time.sleep(5)
        if time.time() - last_ping > IDLE_SECONDS:
            os._exit(0)


def main():
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:                       # already running: just open the page
        webbrowser.open(URL)
        return
    threading.Thread(target=watchdog, daemon=True).start()
    if not os.environ.get("NO_BROWSER"):
        webbrowser.open(URL)
    server.serve_forever()


if __name__ == "__main__":
    main()
