#!/usr/bin/env python3
"""PreToolUse guard for non-Bash tools.

1. GitHub MCP write tools (create/push/fork/merge/update/delete...) can create repos and push
   without any git command, so they are blocked. Read-only tools (get_/list_/search_/*_read) pass.
2. The headed Playwright MCP (`mcp__playwright__*`) opens a visible browser; this project
   uses headless checks only (playwright-headless MCP or scripts/qa/qa_*.py).
3. Files listed in .claude/user_owned.txt belong to the author's own implementation track;
   Claude may review them but must not write them.

Exit 2 = block (stderr goes back to Claude). Malformed input blocks (fail closed).
"""
from __future__ import annotations

import json
import os
import re
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
    tin = data.get("tool_input", {})
    if not isinstance(tin, dict):
        block("invalid tool input")

    if tool.startswith("mcp__github__"):
        name = tool[len("mcp__github__"):]
        if not (name.startswith(GITHUB_READ_PREFIXES) or name.endswith(GITHUB_READ_SUFFIXES)):
            block(f"{tool} writes to GitHub. Publishing is done by the user, not Claude.")
        sys.exit(0)

    if tool.startswith(("mcp__playwright__", "mcp__claude-in-chrome__", "mcp__Claude_Browser__", "mcp__computer-use__")):
        block(f"{tool} opens a visible browser. Use mcp__playwright-headless__* or the repo's headless QA scripts.")

    if tool in {"Write", "Edit", "NotebookEdit"}:
        paths = [tin[key] for key in ("file_path", "notebook_path") if key in tin]
        if not paths or any(not isinstance(path, str) or not path for path in paths):
            block("invalid or missing file path")
        raw = paths[0]
        root = repo_root()
        try:
            rel = Path(raw).resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            sys.exit(0)  # outside the repo: not this guard's business
        parts = Path(rel).parts
        if (len(parts) >= 2 and parts[0] == ".claude" and re.fullmatch(r"settings.*\.json", parts[1])
                or rel.startswith(("scripts/hooks/", "scripts/git-hooks/", ".git/", ".github/workflows/"))):
            block("protected repository path")
        if rel.startswith("docs/adr/") and rel.endswith(".md"):
            new = tin.get("new_string", "") if tool == "Edit" else tin.get("content", "")
            old = tin.get("old_string", "") if tool == "Edit" else ""
            if not isinstance(new, str) or not isinstance(old, str):
                block("invalid ADR edit")
            original = (root / rel).read_text(encoding="utf-8") if (root / rel).is_file() else ""
            header = "## Decider's note"
            note_at = original.find(header)
            position = original.find(old) if old else -1
            revised = original.replace(old, new) if tool == "Edit" and old else new
            if (re.search(r"\*\*Status:\*\*\s*Accepted\b", revised, re.I) and not re.search(r"\*\*Status:\*\*\s*Accepted\b", original, re.I)
                    or header in old or header in new
                    or (note_at >= 0 and position >= note_at)
                    or (note_at >= 0 and original[note_at:] != revised[revised.find(header):])):
                block("ADR decision is reserved for the author")
        for pattern in user_owned(root):
            if Path(rel).match(pattern) or rel == pattern:
                block(
                    f"{rel} is on the author's own implementation track (.claude/user_owned.txt). "
                    "Do not write it. Put review comments in docs/user_track/reviews/ instead."
                )
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        block("invalid hook input")
