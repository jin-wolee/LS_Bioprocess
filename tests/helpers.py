"""Helpers shared by the guard, check_docs and git-hook tests."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BANNED = "zzbanned"
DROP_ENV = {"GUARDRAIL_TERMS", "ALLOW_PUSH", "CLAUDE_PROJECT_DIR"}


def run(cmd, *, cwd, stdin=None, env=None) -> subprocess.CompletedProcess:
    full = {k: v for k, v in os.environ.items() if k not in DROP_ENV}
    full.update(env or {})
    return subprocess.run([str(c) for c in cmd], cwd=cwd, input=stdin, capture_output=True, text=True, env=full)


def hook_json(tool: str, **tool_input) -> str:
    return json.dumps({"tool_name": tool, "tool_input": tool_input})


class Repo:
    """Throwaway git repo with its own copy of scripts/ and its own banned-token list."""

    def __init__(self, root: Path):
        self.root = root
        root.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "tester")
        self.git("config", "user.email", "tester@example.com")
        self.git("config", "commit.gpgsign", "false")
        shutil.copytree(REPO / "scripts", root / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        for name in (".gitignore", "pyproject.toml", "uv.lock"):
            shutil.copy(REPO / name, root / name)
        self.write(".guardrails.local.txt", f"# test list\n{BANNED}\n")

    def git(self, *args, env=None) -> subprocess.CompletedProcess:
        return run(["git", *args], cwd=self.root, env=env)

    def write(self, rel: str, text: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def check(self, *flags, stdin=None, env=None) -> subprocess.CompletedProcess:
        return run([sys.executable, "scripts/check_docs.py", *flags], cwd=self.root, stdin=stdin, env=env)

    def hook(self, path: Path, tool: str = "Write") -> subprocess.CompletedProcess:
        return self.check("--hook", stdin=hook_json(tool, file_path=str(path)))

    def commit(self, message: str = "x", env=None) -> subprocess.CompletedProcess:
        self.git("add", "-A")
        return self.git("commit", "-q", "-m", message, env=env)
