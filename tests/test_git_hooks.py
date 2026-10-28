"""scripts/git-hooks/pre-commit and pre-push, run inside a throwaway repo."""
from __future__ import annotations

import shutil

import pytest

from helpers import BANNED, REPO, run

UV_ENV = {"UV_PROJECT_ENVIRONMENT": str(REPO / ".venv")}  # reuse the project env instead of building one per test


@pytest.fixture
def hooked(repo):
    repo.git("config", "core.hooksPath", "scripts/git-hooks")
    return repo


def test_pre_commit_refuses_banned_token(hooked):
    hooked.write("notes.md", f"{BANNED}\n")
    r = hooked.commit("leak", env=UV_ENV)
    assert r.returncode != 0
    assert "banned" in r.stderr
    assert hooked.git("rev-parse", "--verify", "HEAD").returncode != 0  # no commit was created


def test_pre_commit_allows_clean_commit(hooked):
    hooked.write("notes.md", "fine\n")
    assert hooked.commit("clean", env=UV_ENV).returncode == 0


def test_pre_commit_fails_closed_without_uv(hooked):
    if shutil.which("uv", path="/usr/bin:/bin"):
        pytest.skip("uv is on the minimal PATH")
    hooked.write("notes.md", "fine\n")
    r = hooked.commit("clean", env={"PATH": "/usr/bin:/bin"})
    assert r.returncode != 0
    assert "uv" in r.stderr


def test_pre_push_refuses_without_allow_push(hooked):
    r = run(["scripts/git-hooks/pre-push", "origin", "url"], cwd=hooked.root, stdin="", env=UV_ENV)
    assert r.returncode != 0
    assert "ALLOW_PUSH=1" in r.stderr


def test_pre_push_scans_history_when_allowed(hooked):
    env = {**UV_ENV, "ALLOW_PUSH": "1"}
    hooked.write("notes.md", "fine\n")
    hooked.commit("clean", env=UV_ENV)
    assert run(["scripts/git-hooks/pre-push", "origin", "url"], cwd=hooked.root, stdin="", env=env).returncode == 0
    hooked.git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-q", "-m", f"msg {BANNED}")
    assert run(["scripts/git-hooks/pre-push", "origin", "url"], cwd=hooked.root, stdin="", env=env).returncode != 0
