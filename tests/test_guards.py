"""The two PreToolUse guards, driven the way Claude Code drives them: hook JSON on stdin."""
from __future__ import annotations

import subprocess
import json
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
        "# author-owned\nreference/sql/schema.sql\nreference/sql/queries/*.sql\nreference/simpy/sim_core.py\n", encoding="utf-8"
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
@pytest.mark.parametrize("rel", ["reference/sql/schema.sql", "reference/sql/queries/lineage.sql", "reference/simpy/sim_core.py"])
def test_tool_guard_blocks_user_owned_paths(owned_repo, tool, rel):
    r = tools_guard(owned_repo, tool, file_path=str(owned_repo / rel))
    assert r.returncode == 2
    assert "user_owned" in r.stderr


@pytest.mark.parametrize("rel", ["src/engine.ts", "reference/sql/queries/notes.txt", "reference/sql/other.sql"])
def test_tool_guard_allows_other_repo_paths(owned_repo, rel):
    assert tools_guard(owned_repo, "Write", file_path=str(owned_repo / rel)).returncode == 0


def test_tool_guard_ignores_paths_outside_the_repo(owned_repo, tmp_path):
    outside = tmp_path / "elsewhere" / "reference" / "sql" / "schema.sql"
    assert tools_guard(owned_repo, "Write", file_path=str(outside)).returncode == 0


def test_tool_guard_fails_closed_on_bad_input(owned_repo):
    assert run([sys.executable, "-I", GUARD_TOOLS], cwd=owned_repo, stdin="not json").returncode == 2


@pytest.mark.parametrize("command", [
    "echo ALLOW_PUSH", "if true; then git push; fi", "{ git push; }",
    "! git push", "while true; do git push; done", "nice git push",
    "timeout 60 git push", "watch git push", "stdbuf -oL git push",
    "bash -lc 'git push'", "bash -xc 'git push'",
    "bash -c \"bash -c 'bash -c \\\"bash -c true\\\"'\"",
    "gh issue comment 1 --body x", "gh pr review 1 --approve", "gh issue close 1",
    "gh pr ready 1", "gh secret set NAME", "gh variable set NAME",
    "gh label create x", "gh run rerun 1", "gh workflow enable x",
    "gh repo deploy-key add key", "gh repo unarchive", "gh ssh-key add key",
    "gh auth token", "gh api repos/a/b --field=x=y", "gh api repos/a/b -fx=y",
    "gh api repos/a/b -Fx=y", "gh api repos/a/b --raw-field=x=y",
    "gh api repos/a/b --input=file", "gh api repos/a/b -X=POST",
    "gh api repos/a/b --method POST", "gh api repos/a/b -X GET -f x=y",
    "curl -X POST https://api.github.com/x", "curl --data=x https://uploads.github.com/x",
    "wget --post-data=x https://api.github.com/x", "wget --method=DELETE https://uploads.github.com/x",
    "git config core.hooksPath /dev/null", "git -c core.hooksPath=/dev/null status",
    "git commit --no-verify", "git --no-pager push -h",
])
def test_audit_bash_payloads(command):
    assert bash_guard(command).returncode == 2


@pytest.mark.parametrize("command", ["git status", "git diff", "git commit -F msg.txt",
    "gh pr view 1", "gh run list", "gh api repos/o/r", "gh api repos/o/r -X GET",
    "curl -s https://example.org", "python3 -c 'print(1)'"])
def test_audit_bash_read_controls(command):
    assert bash_guard(command).returncode == 0


@pytest.mark.parametrize("tool", ["Write", "Edit", "NotebookEdit"])
@pytest.mark.parametrize("rel", [".claude/settings.json", ".claude/settings.local.json",
    "scripts/hooks/x.py", "scripts/git-hooks/pre-push", ".git/config", ".git/hooks/x",
    ".github/workflows/pages.yml"])
def test_audit_protected_paths(owned_repo, tool, rel):
    assert tools_guard(owned_repo, tool, file_path=str(owned_repo / rel)).returncode == 2


@pytest.mark.parametrize("tool", ["mcp__claude-in-chrome__navigate", "mcp__Claude_Browser__navigate", "mcp__computer-use__click"])
def test_audit_browser_families(owned_repo, tool):
    assert tools_guard(owned_repo, tool).returncode == 2


@pytest.mark.parametrize("old,new", [("Proposed", "Accepted"), ("## Decider's note", "## Decider's note\nchanged"), ("author only", "decision")])
def test_audit_adr_edits(owned_repo, old, new):
    path = owned_repo / "docs/adr/0001-test.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("- **Status:** Proposed\n## Decider's note\nauthor only\n")
    assert tools_guard(owned_repo, "Edit", file_path=str(path), old_string=old, new_string=new).returncode == 2


def test_audit_adr_normal_edit_allowed(owned_repo):
    assert tools_guard(owned_repo, "Edit", file_path=str(owned_repo / "docs/adr/0001-test.md"), old_string="old", new_string="new").returncode == 0


@pytest.mark.parametrize("payload", ['{"tool_name":"Write","tool_input":"bad"}', '{"tool_name":"Write","tool_input":{"file_path":42}}', '[]'])
def test_audit_malformed_tools_input(owned_repo, payload):
    assert run([sys.executable, "-I", GUARD_TOOLS], cwd=owned_repo, stdin=payload).returncode == 2


def test_audit_settings_matchers_and_deny_list():
    settings = json.loads((REPO / ".claude/settings.json").read_text())
    matchers = "|".join(x.get("matcher", "") for x in settings["hooks"]["PreToolUse"])
    for name in ("mcp__claude-in-chrome__.*", "mcp__Claude_Browser__.*", "mcp__computer-use__.*"):
        assert name in matchers
    for item in ("Bash(gh auth token*)", "Bash(gh secret *)", "Bash(gh variable *)", "Bash(gh repo deploy-key *)", "Bash(gh ssh-key *)"):
        assert item in settings["permissions"]["deny"]


@pytest.mark.parametrize("command", [
    "nice -n 5 git push", "watch -n 2 git push", "stdbuf -o L git push",
    "timeout --signal TERM 5 git push", "gh extension-command list",
])
def test_audit_wrapped_commands_and_unknown_gh_are_blocked(command):
    assert bash_guard(command).returncode == 2


@pytest.mark.parametrize("tool,key", [("Write", "file_path"), ("Edit", "file_path"), ("NotebookEdit", "notebook_path")])
@pytest.mark.parametrize("value", [0, False, None, ""])
def test_audit_falsey_path_is_malformed(owned_repo, tool, key, value):
    assert tools_guard(owned_repo, tool, **{key: value}).returncode == 2


@pytest.mark.parametrize("tool", ["Write", "Edit", "NotebookEdit"])
def test_audit_missing_path_is_malformed(owned_repo, tool):
    assert tools_guard(owned_repo, tool).returncode == 2


def test_adr_repeated_text_cannot_change_the_author_note(owned_repo):
    path = owned_repo / "docs/adr/0001-test.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("- **Status:** Proposed\nRepeated decision.\n## Decider's note\nRepeated decision.\n")
    assert tools_guard(owned_repo, "Edit", file_path=str(path), old_string="Repeated decision.", new_string="Changed decision.").returncode == 2


def test_adr_body_edit_preserves_existing_author_note(owned_repo):
    path = owned_repo / "docs/adr/0001-test.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("- **Status:** Proposed\nOrdinary body.\n## Decider's note\nAuthor decision.\n")
    assert tools_guard(owned_repo, "Edit", file_path=str(path), old_string="Ordinary body.", new_string="Revised body.").returncode == 0


@pytest.mark.parametrize("prefix", [
    "watch -t", "watch --no-title", "watch -n 2", "watch -n2",
    "watch --interval 2", "watch --interval=2", "watch -tn2", "watch -e", "watch --errexit", "watch --",
    "timeout -k 5s 10s", "timeout -k5s 10s", "timeout --kill-after 5s 10s",
    "timeout --kill-after=5s 10s", "timeout -s TERM 10s", "timeout --signal=TERM 10s",
    "timeout -- 10s", "timeout -v -- 10s", "timeout -vk5s 10s",
    "nice -n 5", "nice -n5", "nice --adjustment 5", "nice --adjustment=5", "nice --",
    "stdbuf -o L", "stdbuf -oL", "stdbuf --output L", "stdbuf --output=L", "stdbuf --",
    "sudo -u root", "sudo -uroot", "sudo --user root", "sudo --user=root", "sudo -nE --",
    "env -u NAME", "env -uNAME", "env --unset NAME", "env --unset=NAME", "env -i --",
    "xargs -tr", "xargs -n 1", "xargs -n1", "xargs --max-args 1", "xargs --max-args=1", "xargs -I {}", "xargs --",
    "command --", "builtin --", "exec --", "nohup --", "time --",
    "env -- watch -t timeout -k 5s -- 10s",
])
@pytest.mark.parametrize("command,expected", [("git push", 2), ("git status", 0)])
def test_wrapper_option_forms_reach_command(prefix, command, expected):
    result = bash_guard(f"{prefix} {command}")
    assert result.returncode == expected, result.stderr
    if expected == 2:
        assert "git push" in result.stderr


@pytest.mark.parametrize("command", [
    "watch --unknown git status", "watch -z git status", "timeout --unknown 10s git status",
    "env --split-string=anything git status", "watch -n", "timeout -k",
    "timeout --kill-after= 10s git status", "timeout --", "sudo -u",
])
def test_wrapper_uninspectable_options_fail_closed(command):
    assert bash_guard(command).returncode == 2


@pytest.mark.parametrize("prefix", ["env -", "env - NAME=value", "env -- -", "env -i -"])
@pytest.mark.parametrize("command,expected", [("git push", 2), ("git status", 0)])
def test_env_lone_hyphen_cannot_hide_command(prefix, command, expected):
    result = bash_guard(f"{prefix} {command}")
    assert result.returncode == expected, result.stderr
