"""Shared local server for the browser QA scripts."""
from __future__ import annotations

import functools
import os
import subprocess
import threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def build_local_lab() -> int:
    """Build the lab with local-only screens available to QA."""
    return subprocess.run(["npm", "run", "build:lab"], cwd=REPO, env={**os.environ, "VITE_LAB_LOCAL": "1"}).returncode


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def serve(directory: Path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()
        server.server_close()
