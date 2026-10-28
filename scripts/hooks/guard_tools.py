#!/usr/bin/env python3
"""PreToolUse guard for non-Bash tools.

1. GitHub MCP write tools (create/push/fork/merge/update/delete...) can create repos and push
   without any git command, so they are blocked. Read-only tools (get_/list_/search_/*_read) pass.
2. The headed Playwright MCP (`mcp__playwright__*`) opens a visible browser; this project
   uses headless checks only (playwright-headless MCP or scripts/qa_*.py).
3. Files listed in .claude/user_owned.txt belong to the author's own implementation track;
   Claude may review them but must not write them.

Exit 2 = block (stderr goes back to Claude). Malformed input blocks (fail closed).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

GITHUB_READ_PREFIXES = ("get_", "list_", "search_")
GITHUB_READ_SUFFIXES = ("_read",)


def block(msg: str) -> None:
    sys.stderr.write(f"BLOCKED by guard_tools: {msg}\n")
    sys.exit(2)


def repo_root() -> Path:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            return Path(out.stdout.strip())
    except Exception:
        pass
    return Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))


def user_owned(root: Path) -> list[str]:
    f = root / ".claude" / "user_owned.txt"
    if not f.exists():
        return []
    return [ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        block(f"unreadable hook input ({e})")
    tool = data.get("tool_name", "")
    tin = data.get("tool_input", {}) or {}

    if tool.startswith("mcp__github__"):
        name = tool[len("mcp__github__"):]
        if not (name.startswith(GITHUB_READ_PREFIXES) or name.endswith(GITHUB_READ_SUFFIXES)):
            block(f"{tool} writes to GitHub. Publishing is done by the user, not Claude.")
        sys.exit(0)

    if tool.startswith("mcp__playwright__"):
        block(f"{tool} opens a visible browser. Use mcp__playwright-headless__* or the repo's headless QA scripts.")

    if tool in {"Write", "Edit", "NotebookEdit"}:
        raw = tin.get("file_path") or tin.get("notebook_path") or ""
        if not raw:
            sys.exit(0)
        root = repo_root()
        try:
            rel = Path(raw).resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            sys.exit(0)  # outside the repo: not this guard's business
        for pattern in user_owned(root):
            if Path(rel).match(pattern) or rel == pattern:
                block(
                    f"{rel} is on the author's own implementation track (.claude/user_owned.txt). "
                    "Do not write it. Put review comments in docs/user_track/reviews/ instead."
                )
    sys.exit(0)


if __name__ == "__main__":
    main()
