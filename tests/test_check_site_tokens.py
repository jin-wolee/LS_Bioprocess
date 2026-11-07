from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from helpers import BANNED, REPO

SCRIPT = REPO / "scripts/check_site_tokens.py"


def scan(root, secret):
    env = {**os.environ, "GUARDRAIL_TERMS": secret}
    return subprocess.run([sys.executable, str(SCRIPT), "--ci"], cwd=root, env=env, capture_output=True, text=True)


def test_clean_site_passes(tmp_path):
    (tmp_path / "dist/site").mkdir(parents=True)
    (tmp_path / "dist/site/index.html").write_text("clean")
    assert scan(tmp_path, BANNED).returncode == 0


@pytest.mark.parametrize("where", ["content", "filename", "binary"])
def test_site_detects_tokens_without_printing_them(tmp_path, where):
    site = tmp_path / "dist/site"
    site.mkdir(parents=True)
    name = BANNED if where == "filename" else "asset"
    data = (b"\xff" if where == "binary" else b"") + (BANNED.encode() if where != "filename" else b"clean")
    (site / name).write_bytes(data)
    result = scan(tmp_path, BANNED)
    assert result.returncode == 1
    assert BANNED not in result.stdout + result.stderr


def test_site_and_secret_are_required(tmp_path):
    assert scan(tmp_path, BANNED).returncode == 1
    (tmp_path / "dist/site").mkdir(parents=True)
    assert scan(tmp_path, "# comment only").returncode == 1
