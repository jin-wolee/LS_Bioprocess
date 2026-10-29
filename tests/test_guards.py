"""The two PreToolUse guards, driven the way Claude Code drives them: hook JSON on stdin."""
from __future__ import annotations

import subprocess
import sys

import pytest

from helpers import REPO, hook_json, run

GUARD_BASH = REPO / "scripts/hooks/guard_bash.py"
GUARD_TOOLS = REPO / "scripts/hooks/guard_tools.py"

BLOCKED = [
    "sudo -u root git push",
    "xargs -I {} git push",
    "git -C . push",
    'bash -c "git push origin main"',
    "git status && git push",
    "git status\ngit push",
    "echo $(git push)",
    "sudo -E git push",
    'eval "git push"',
    "git remote add origin x",
    "ALLOW_PUSH=1 gh repo create a/b --private",
    "gh api repos/a/b -X PATCH -f private=false",
    "gh api repos/a/b/issues -f title=x",
    "npm publish",
    "npx gh-pages -d dist",
    "npx --yes gh-pages -d dist",
    "npx -y gh-pages -d dist",
    "npx -y gh-pages@latest -d dist",
    "bunx --yes gh-pages -d dist",
    "bunx -y gh-pages -d dist",
    "gh workflow run deploy.yml",
    "gh workflow run deploy.yml -f env=prod",
    'bash -c "gh workflow run deploy.yml"',
    'echo "unbalanced',
]

ALLOWED = [
    'grep "git push" notes.txt',
    'git commit -m "fix a; b && c | d"',
    "git log --oneline 2>&1 | head",
    "git remote -v",
    "gh repo view a/b --json visibility",
    "gh api user/emails",
    "gh workflow list",
    "gh workflow view deploy.yml",
    "npx --yes prettier --check .",
    "npx -y vitest run",
    "bunx --bun tsc --noEmit",
    "git commit -F - <<'EOF'\nmessage\nEOF",
]


def bash_guard(command) -> subprocess.CompletedProcess:
    return run([sys.executable, "-I", GUARD_BASH], cwd=REPO, stdin=hook_json("Bash", command=command))


@pytest.mark.parametrize("command", BLOCKED)
def test_bash_guard_blocks_publishing(command):
    r = bash_guard(command)
    assert r.returncode == 2, r.stderr
    assert "BLOCKED" in r.stderr


@pytest.mark.parametrize("command", ALLOWED)
def test_bash_guard_allows_everyday_commands(command):
    r = bash_guard(command)
    assert r.returncode == 0, r.stderr


def test_bash_guard_fails_closed_on_bad_input():
    assert run([sys.executable, "-I", GUARD_BASH], cwd=REPO, stdin="not json").returncode == 2
    assert bash_guard(["git", "status"]).returncode == 2  # command must be a string


# ---------- guard_tools ----------
@pytest.fixture
def owned_repo(tmp_path):
    root = tmp_path / "owned"
    (root / ".claude").mkdir(parents=True)
    run(["git", "init", "-q"], cwd=root)
    (root / ".claude/user_owned.txt").write_text(
        "# author-owned\nsql/schema.sql\nsql/queries/*.sql\nreference/sim_core.py\n", encoding="utf-8"
    )
    return root


def tools_guard(root, tool, **tool_input) -> subprocess.CompletedProcess:
    return run([sys.executable, "-I", GUARD_TOOLS], cwd=root, stdin=hook_json(tool, **tool_input))


@pytest.mark.parametrize(
    "tool",
    ["mcp__github__create_repository", "mcp__github__push_files", "mcp__playwright__browser_navigate"],
)
def test_tool_guard_blocks_publishing_and_headed_browser(owned_repo, tool):
    assert tools_guard(owned_repo, tool).returncode == 2


@pytest.mark.parametrize(
    "tool",
    [
        "mcp__github__get_me",
        "mcp__github__issue_read",
        "mcp__github__list_commits",
        "mcp__playwright-headless__browser_navigate",
    ],
)
def test_tool_guard_allows_reads_and_headless(owned_repo, tool):
    assert tools_guard(owned_repo, tool).returncode == 0


@pytest.mark.parametrize("tool", ["Write", "Edit"])
@pytest.mark.parametrize("rel", ["sql/schema.sql", "sql/queries/lineage.sql", "reference/sim_core.py"])
def test_tool_guard_blocks_user_owned_paths(owned_repo, tool, rel):
    r = tools_guard(owned_repo, tool, file_path=str(owned_repo / rel))
    assert r.returncode == 2
    assert "user_owned" in r.stderr


@pytest.mark.parametrize("rel", ["src/engine.ts", "sql/queries/notes.txt", "sql/other.sql"])
def test_tool_guard_allows_other_repo_paths(owned_repo, rel):
    assert tools_guard(owned_repo, "Write", file_path=str(owned_repo / rel)).returncode == 0


def test_tool_guard_ignores_paths_outside_the_repo(owned_repo, tmp_path):
    outside = tmp_path / "elsewhere" / "sql" / "schema.sql"
    assert tools_guard(owned_repo, "Write", file_path=str(outside)).returncode == 0


def test_tool_guard_fails_closed_on_bad_input(owned_repo):
    assert run([sys.executable, "-I", GUARD_TOOLS], cwd=owned_repo, stdin="not json").returncode == 2
