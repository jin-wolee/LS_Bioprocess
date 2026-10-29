"""scripts/check_all.sh: the Stop hook and the --manual gate, run inside a throwaway repo."""
from __future__ import annotations

import json

import pytest

from helpers import BANNED, REPO, run

UV_ENV = {"UV_PROJECT_ENVIRONMENT": str(REPO / ".venv")}  # reuse the project env instead of building one per test

# The throwaway repo's only test logs every run into a gitignored file, so a test can count how
# often check_all really ran the checks without that logging changing the repo state.
PROBE_TEST = '''from pathlib import Path


def test_probe():
    log = Path("qa_out/pytest-ran.log")
    log.parent.mkdir(exist_ok=True)
    with log.open("a") as f:
        f.write("ran\\n")
'''
STOP_ACTIVE = json.dumps({"stop_hook_active": True})


@pytest.fixture
def lab(repo):
    repo.write("tests/test_probe.py", PROBE_TEST)
    return repo


def check_all(lab, *args, stdin=""):
    return run(["bash", "scripts/check_all.sh", *args], cwd=lab.root, stdin=stdin, env=UV_ENV)


def stop_hook(lab, active=False):
    return check_all(lab, stdin=json.dumps({"stop_hook_active": active}))


def runs(lab) -> int:
    log = lab.root / "qa_out/pytest-ran.log"
    return len(log.read_text().splitlines()) if log.exists() else 0


def output(r) -> str:
    return r.stdout + r.stderr


# ---------- --manual ----------
def test_manual_passes_and_prints_a_summary(lab):
    r = check_all(lab, "--manual")
    assert r.returncode == 0, output(r)
    assert "PASS" in r.stdout
    assert runs(lab) == 1


def test_manual_fails_with_exit_1_and_names_the_problem(lab):
    lab.write("notes.md", f"{BANNED}\n")
    r = check_all(lab, "--manual")
    assert r.returncode == 1
    assert "FAIL" in r.stdout and "notes.md" in r.stdout


def test_manual_runs_pytest(lab):
    lab.write("tests/test_bad.py", "def test_bad():\n    assert False\n")
    r = check_all(lab, "--manual")
    assert r.returncode == 1
    assert "pytest" in r.stdout and "test_bad" in r.stdout


def test_manual_ignores_stdin_stop_hook_active_and_unchanged_state(lab):
    assert stop_hook(lab).returncode == 0  # records the clean state
    r = check_all(lab, "--manual", stdin=STOP_ACTIVE)
    assert r.returncode == 0, output(r)
    assert runs(lab) == 2
    lab.write("notes.md", f"{BANNED}\n")
    assert check_all(lab, "--manual", stdin=STOP_ACTIVE).returncode == 1


def test_manual_does_not_wait_for_stdin(lab):
    r = run(["bash", "scripts/check_all.sh", "--manual"], cwd=lab.root, stdin=None, env=UV_ENV)
    assert r.returncode == 0, output(r)


# ---------- hook mode: when it runs ----------
def test_hook_skips_when_nothing_changed_since_the_last_green_check(lab):
    assert stop_hook(lab).returncode == 0
    assert runs(lab) == 1
    assert (lab.root / ".claude/.last-check").read_text().strip()
    assert stop_hook(lab).returncode == 0
    assert runs(lab) == 1


CHANGES = {
    "new-file": (lambda lab: None, lambda lab: lab.write("notes.md", "a\n")),
    "edited-untracked-file": (lambda lab: lab.write("notes.md", "a\n"), lambda lab: lab.write("notes.md", "b\n")),
    "edited-tracked-file": (lambda lab: (lab.write("notes.md", "a\n"), lab.commit()), lambda lab: lab.write("notes.md", "b\n")),
    "deleted-tracked-file": (lambda lab: (lab.write("notes.md", "a\n"), lab.commit()), lambda lab: (lab.root / "notes.md").unlink()),
    "staged-edit": (
        lambda lab: (lab.write("notes.md", "a\n"), lab.commit()),
        lambda lab: (lab.write("notes.md", "b\n"), lab.git("add", "notes.md")),
    ),
}


@pytest.mark.parametrize("name", CHANGES)
def test_hook_notices_edits_made_without_the_edit_tools(lab, name):
    setup, change = CHANGES[name]
    setup(lab)
    assert stop_hook(lab).returncode == 0
    before = runs(lab)
    assert (lab.root / ".claude/.dirty").exists() is False  # no Write/Edit hook ran: only the file state differs
    change(lab)
    assert stop_hook(lab).returncode == 0
    assert runs(lab) == before + 1


def test_hook_runs_when_the_dirty_marker_exists_and_clears_it(lab):
    assert stop_hook(lab).returncode == 0
    (lab.root / ".claude/.dirty").touch()
    assert stop_hook(lab).returncode == 0
    assert runs(lab) == 2
    assert not (lab.root / ".claude/.dirty").exists()


def test_hook_blocks_with_exit_2_and_keeps_checking_until_green(lab):
    lab.write("notes.md", f"{BANNED}\n")
    r = stop_hook(lab)
    assert r.returncode == 2
    assert "notes.md" in r.stderr
    assert not (lab.root / ".claude/.last-check").exists()  # a failed check must not count as checked
    assert stop_hook(lab).returncode == 2                   # same unchanged state is still checked and still red
    lab.write("notes.md", "fine\n")
    assert stop_hook(lab).returncode == 0


def test_hook_never_loops_when_already_continuing_because_of_it(lab):
    lab.write("notes.md", f"{BANNED}\n")
    assert stop_hook(lab, active=True).returncode == 0
    assert runs(lab) == 0


# ---------- checks it runs ----------
def test_hook_runs_pytest(lab):
    lab.write("tests/test_bad.py", "def test_bad():\n    assert False\n")
    r = stop_hook(lab)
    assert r.returncode == 2
    assert "pytest" in r.stderr


@pytest.mark.parametrize("rel", ["src/a.ts", "engine/src/sim/b.js"])
def test_math_random_in_source_fails(lab, rel):
    lab.write(rel, "const x = Math.random();\n")
    r = check_all(lab, "--manual")
    assert r.returncode == 1
    assert "Math.random" in r.stdout


def test_math_random_outside_source_or_in_tests_is_ignored(lab):
    for rel in [
        "src/a.test.ts",
        "src/__tests__/b.ts",
        "engine/src/tests/c.ts",
        "engine/node_modules/pkg/index.js",
        "engine/scripts/d.js",
    ]:
        lab.write(rel, "const x = Math.random();\n")
    r = check_all(lab, "--manual")
    assert r.returncode == 0, output(r)
