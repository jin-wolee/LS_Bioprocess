"""scripts/check_all.sh: the Stop hook and the --manual gate, run inside a throwaway repo."""
from __future__ import annotations

import json
import os
import re

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


# ---------- hook mode: the batch marker defers the gate ----------
# While an executor batch runs the orchestrator keeps .claude/.batch-running (batch name and start time); the Stop hook then prints one line and
# leaves the gate to the orchestrator's `check_all.sh --manual`. It touches no state, so the first turn after the marker is gone runs the gate.
BATCH = "marker maintenance, started 2026-10-30 15:16"


def marker(lab, text: str = BATCH):
    return lab.write(".claude/.batch-running", text + "\n")


def unreadable_marker(lab):
    path = marker(lab)
    path.chmod(0)
    return path


def test_the_batch_marker_is_ignored_by_git(lab):
    marker(lab)
    assert lab.git("check-ignore", "-q", ".claude/.batch-running").returncode == 0


def test_hook_defers_while_the_batch_marker_exists_and_runs_nothing(lab):
    lab.write("notes.md", f"{BANNED}\n")  # the gate would block on this
    (lab.root / ".claude").mkdir(exist_ok=True)
    (lab.root / ".claude/.dirty").touch()
    marker(lab)
    r = stop_hook(lab)
    assert r.returncode == 0, output(r)
    assert r.stdout == ""
    lines = r.stderr.splitlines()
    assert len(lines) == 1, r.stderr
    assert BATCH in lines[0] and "check_all.sh --manual" in lines[0] and "deferred" in lines[0]
    assert runs(lab) == 0
    assert not (lab.root / ".claude/.last-check").exists()
    assert (lab.root / ".claude/.dirty").exists()


def test_the_deferral_leaves_a_recorded_state_alone(lab):
    assert stop_hook(lab).returncode == 0
    recorded = (lab.root / ".claude/.last-check").read_text()
    lab.write("notes.md", "a\n")
    marker(lab)
    assert stop_hook(lab).returncode == 0
    assert (lab.root / ".claude/.last-check").read_text() == recorded
    assert runs(lab) == 1


@pytest.mark.parametrize("make", [lambda lab: marker(lab, ""), lambda lab: marker(lab, "\n  \n"), unreadable_marker], ids=["empty", "blank", "unreadable"])
def test_an_empty_or_unreadable_marker_still_defers_and_says_so(lab, make):
    if make is unreadable_marker and os.geteuid() == 0:
        pytest.skip("root reads a mode-0 file")
    lab.write("notes.md", f"{BANNED}\n")
    make(lab)
    r = stop_hook(lab)
    assert r.returncode == 0, output(r)
    lines = r.stderr.splitlines()
    assert len(lines) == 1 and "empty or unreadable" in lines[0] and "deferred" in lines[0], r.stderr
    assert runs(lab) == 0
    assert not (lab.root / ".claude/.last-check").exists()


@pytest.mark.parametrize("flags", [("--manual",), ("--manual", "--lab"), ("--lab",)])
def test_manual_and_lab_ignore_the_batch_marker(lab, flags):
    qa_lab_stub(lab)
    marker(lab)
    r = check_all(lab, *flags, stdin=json.dumps({"stop_hook_active": False}))
    assert r.returncode == 0, output(r)
    assert "deferred" not in output(r)
    assert runs(lab) == 1
    assert lab_runs(lab) == (1 if "--lab" in flags else 0)
    lab.write("notes.md", f"{BANNED}\n")
    assert check_all(lab, *flags, stdin=json.dumps({"stop_hook_active": False})).returncode == (1 if "--manual" in flags else 2)


@pytest.mark.parametrize("dirty", [True, False], ids=["dirty-marker", "edits-through-bash"])
def test_the_first_turn_after_the_marker_is_removed_runs_the_gate(lab, dirty):
    lab.write("notes.md", "fine\n")
    if dirty:
        (lab.root / ".claude").mkdir(exist_ok=True)
        (lab.root / ".claude/.dirty").touch()
    marker(lab)
    assert stop_hook(lab).returncode == 0
    assert runs(lab) == 0
    (lab.root / ".claude/.batch-running").unlink()
    r = stop_hook(lab)
    assert r.returncode == 0, output(r)
    assert runs(lab) == 1
    assert (lab.root / ".claude/.last-check").read_text().strip()
    assert not (lab.root / ".claude/.dirty").exists()


def test_after_the_marker_is_removed_the_hook_blocks_on_what_the_batch_broke(lab):
    lab.write("notes.md", f"{BANNED}\n")
    marker(lab)
    assert stop_hook(lab).returncode == 0
    (lab.root / ".claude/.batch-running").unlink()
    r = stop_hook(lab)
    assert r.returncode == 2 and "notes.md" in r.stderr


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
        "engine/node_modules/pkg/index.js",
        "engine/scripts/d.js",
    ]:
        lab.write(rel, "const x = Math.random();\n")
    r = check_all(lab, "--manual")
    assert r.returncode == 0, output(r)


# ---------- the summary names the failing Vitest tests ----------
# What Vitest 5.0.5 prints inside `npm run -s check` when its output is captured (no TTY, so no colour codes). The failure lines
# start with a space, which the summary filter once dropped (a Stop-hook run printed "npm run check failed" and no test name).
# Paths are made up; the second capture is trimmed (code frames and stack lines cut).
VITEST_ONE_TEST_FAILS = """
 RUN  v5.0.5 /work/repo

 ❯ engine/tests/bad.test.ts (4 tests | 1 failed | 1 todo) 4ms
   ❯ suite alpha (4)
     ❯ inner (2)
       × fails on purpose 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  engine/tests/bad.test.ts > suite alpha > inner > fails on purpose
AssertionError: expected 2 to be 3 // Object.is equality

- Expected
+ Received

- 3
+ 2

 ❯ engine/tests/bad.test.ts:8:54
      8|     it("fails on purpose", () => { expect(add(1, 1)).toBe(3); });
       |                                                      ^

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 3 passed | 1 todo (5)
   Start at  11:03:03
   Duration  89ms (transform 53%, import 24%, tests 13%, worker 9%)
"""
VITEST_FILE_AND_TEST_FAIL = """
 RUN  v5.0.5 /work/repo

 ❯ engine/tests/importfail.test.ts (0 test)
 ❯ engine/tests/timeout.test.ts (1 test | 1 failed) 53ms
   × slow 52ms

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  engine/tests/importfail.test.ts [ engine/tests/importfail.test.ts ]
Error: Cannot find module '../src/missing.ts' imported from /work/repo/engine/tests/importfail.test.ts

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  engine/tests/timeout.test.ts > slow
Error: Test timed out in 50ms.

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯

Vitest caught 1 unhandled error during the test run.


 Test Files  2 failed | 2 passed (4)
      Tests  1 failed | 2 passed (3)
     Errors  1 error
   Start at  11:04:55
   Duration  134ms (tests 70%, import 15%, worker 9%)
"""
VITEST_ALL_PASS = """
 RUN  v5.0.5 /work/repo


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  11:03:19
   Duration  188ms (worker 65%, import 20%, transform 10%, tests 5%)
"""
# The other two steps of `npm run check` (rework, same Vitest 5.0.5 / tsc 6.0.3 / eslint 10.13.0 captures, trimmed): tsc prints one line per error with
# its file, eslint (stylish) prints the file path on a line of its own, the problem lines under it, then a count line.
TSC_ERRORS = """engine/src/ts_a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
engine/src/ts_a.ts(3,14): error TS2741: Property 'b' is missing in type '{ a: number; }' but required in type 'P'.
engine/src/ts_b.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.
"""
ESLINT_ERRORS_AND_WARNINGS = """
/work/repo/engine/src/lint_a.ts
  2:7  error    'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars
  3:1  warning  Unexpected console statement                 no-console
  5:1  error    Unexpected var, use let or const instead     no-var

/work/repo/engine/src/lint_c.ts
  1:22  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/work/repo/engine/src/lint_warn_only.ts
  2:1  warning  Unexpected console statement  no-console

✖ 5 problems (3 errors, 2 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.
"""
ESLINT_WARNINGS_ONLY = """
/work/repo/engine/src/lint_warn_only.ts
  2:1  warning  Unexpected console statement  no-console

✖ 1 problem (0 errors, 1 warning)
"""
# name -> (what the fake check prints, lines the summary must hold, text it must not hold)
VITEST_NOISE = ["Duration", "Start at", " RUN "]  # the run header and timing lines are not part of the summary
CHECK_FAILURES = {
    "vitest-one-test": (
        VITEST_ONE_TEST_FAILS,
        [
            " FAIL  engine/tests/bad.test.ts > suite alpha > inner > fails on purpose",
            " Test Files  1 failed | 1 passed (2)",
            "      Tests  1 failed | 3 passed | 1 todo (5)",
        ],
        VITEST_NOISE,
    ),
    "vitest-file-and-test": (
        VITEST_FILE_AND_TEST_FAIL,
        [
            " FAIL  engine/tests/importfail.test.ts [ engine/tests/importfail.test.ts ]",
            " FAIL  engine/tests/timeout.test.ts > slow",
            " Test Files  2 failed | 2 passed (4)",
            "      Tests  1 failed | 2 passed (3)",
            "     Errors  1 error",
        ],
        VITEST_NOISE,
    ),
    "tsc": (TSC_ERRORS, TSC_ERRORS.splitlines(), []),
    "eslint": (
        ESLINT_ERRORS_AND_WARNINGS,
        [
            "/work/repo/engine/src/lint_a.ts",
            "  2:7  error    'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars",
            "  5:1  error    Unexpected var, use let or const instead     no-var",
            "/work/repo/engine/src/lint_c.ts",
            "  1:22  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any",
            "✖ 5 problems (3 errors, 2 warnings)",
        ],
        ["warning  Unexpected", "no-console", "lint_warn_only"],  # warnings stay out, and so does the path of a file that has only warnings
    ),
}


def fake_check(lab, check_output: str, exit_code: int) -> None:
    """A `check` script that prints what the steps of `npm run check` printed and exits like it does."""
    lab.write("check_output.txt", check_output)
    lab.write("package.json", json.dumps({"scripts": {"check": f"cat check_output.txt; exit {exit_code}"}}))


@pytest.mark.parametrize("name", CHECK_FAILURES)
def test_manual_summary_names_what_failed_in_npm_run_check(lab, name):
    shape, expected, absent = CHECK_FAILURES[name]
    fake_check(lab, shape, 1)
    r = check_all(lab, "--manual")
    assert r.returncode == 1, output(r)
    assert "npm run check failed" in r.stdout
    lines = r.stdout.splitlines()
    for line in expected:
        assert line in lines, r.stdout
    for text in absent:
        assert text not in r.stdout


@pytest.mark.parametrize("name", CHECK_FAILURES)
def test_hook_stderr_names_what_failed_in_npm_run_check(lab, name):
    shape, expected, absent = CHECK_FAILURES[name]
    fake_check(lab, shape, 1)
    r = stop_hook(lab)
    assert r.returncode == 2, output(r)
    lines = r.stderr.splitlines()
    for line in expected:
        assert line in lines, r.stderr
    for text in absent:
        assert text not in r.stderr


def test_an_eslint_file_path_comes_right_before_its_first_error_line(lab):
    fake_check(lab, ESLINT_ERRORS_AND_WARNINGS, 1)
    lines = check_all(lab, "--manual").stdout.splitlines()
    for path, first_error in [
        ("/work/repo/engine/src/lint_a.ts", "  2:7  error    'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars"),
        ("/work/repo/engine/src/lint_c.ts", "  1:22  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any"),
    ]:
        assert lines.index(path) + 1 == lines.index(first_error)
    assert lines.count("/work/repo/engine/src/lint_a.ts") == 1  # one path line per file, not one per error


# The cap (rework R2): 40 lines of per-test and per-error detail; the lines that say which gate failed are never cut.
SUMMARY_CAP = 40
SUMMARY_FIXED_MAX = 10  # at most: 3 step verdicts, the Math.random line, 3 Vitest count lines, eslint's count line, the "more lines" notice, the manual verdict or the hook's hint


@pytest.mark.parametrize("mode", ["manual", "hook"])
def test_the_cap_cuts_detail_lines_and_keeps_the_fixed_ones(lab, mode):
    lab.write("src/a.ts", "const x = Math.random();\n")
    many = "\n".join(f" FAIL  engine/tests/bad.test.ts > suite > fails {i}" for i in range(100))
    fake_check(lab, many + "\n Test Files  1 failed (1)\n      Tests  100 failed (100)\n", 1)
    r = check_all(lab, "--manual") if mode == "manual" else stop_hook(lab)
    text = r.stdout if mode == "manual" else r.stderr
    lines = text.splitlines()
    assert r.returncode == (1 if mode == "manual" else 2), output(r)
    for fixed in (" Test Files  1 failed (1)", "      Tests  100 failed (100)"):
        assert fixed in lines, text
    assert any("npm run check failed" in line for line in lines), text
    assert any("Math.random found" in line for line in lines), text
    shown = [line for line in lines if line.startswith(" FAIL  engine/tests/")]
    assert 0 < len(shown) <= SUMMARY_CAP
    notice = [m.group(1) for m in map(re.compile(r"\((\d+) more lines not shown\)").fullmatch, lines) if m]
    assert notice and len(shown) + int(notice[0]) == 100, text  # the notice counts what the cap cut
    assert len(lines) <= SUMMARY_CAP + SUMMARY_FIXED_MAX, text


def test_a_passing_vitest_run_adds_nothing_to_the_summary(lab):
    fake_check(lab, VITEST_ALL_PASS, 0)
    r = check_all(lab, "--manual")
    assert r.returncode == 0, output(r)
    for passing_line in ("Test Files", "Tests ", "passed", *VITEST_NOISE):
        assert passing_line not in r.stdout
    assert stop_hook(lab).returncode == 0


def test_eslint_warnings_alone_add_nothing_to_the_summary(lab):
    fake_check(lab, ESLINT_WARNINGS_ONLY, 0)
    r = check_all(lab, "--manual")
    assert r.returncode == 0, output(r)
    for text in ("lint_warn_only", "no-console", "problem"):
        assert text not in r.stdout
    assert stop_hook(lab).returncode == 0


# ---------- --lab: the end-to-end run of the lab page (docs/design/lab_ui.md section 12) ----------
# The throwaway repo gets a stub in place of scripts/qa/qa_lab.py that logs each run into the gitignored qa_out/, like the probe test above, and exits as told.
QA_LAB_STUB = '''import sys
from pathlib import Path

Path("qa_out").mkdir(exist_ok=True)
with Path("qa_out/qa-lab-ran.log").open("a") as f:
    f.write("ran\\n")
print("1 load  PASS  stub")
if EXIT:
    print("FAIL  qa_lab load: the stub fails on purpose")
sys.exit(EXIT)
'''


def qa_lab_stub(lab, exit_code: int = 0) -> None:
    lab.write("scripts/qa/qa_lab.py", QA_LAB_STUB.replace("EXIT", str(exit_code)))


def lab_runs(lab) -> int:
    log = lab.root / "qa_out/qa-lab-ran.log"
    return len(log.read_text().splitlines()) if log.exists() else 0


def test_manual_does_not_run_the_lab_page_checks_without_the_flag(lab):
    qa_lab_stub(lab)
    assert check_all(lab, "--manual").returncode == 0
    assert lab_runs(lab) == 0


@pytest.mark.parametrize("flags", [("--manual", "--lab"), ("--lab", "--manual")])
def test_manual_lab_runs_the_page_checks_once_after_the_other_steps_and_passes(lab, flags):
    qa_lab_stub(lab)
    r = check_all(lab, *flags)
    assert r.returncode == 0, output(r)
    assert "PASS" in r.stdout
    assert lab_runs(lab) == 1
    assert runs(lab) == 1  # pytest still ran as before


def test_manual_lab_fails_when_the_page_checks_fail_and_the_summary_names_the_failing_check(lab):
    qa_lab_stub(lab, 1)
    r = check_all(lab, "--manual", "--lab")
    assert r.returncode == 1, output(r)
    lines = r.stdout.splitlines()
    assert "FAIL  qa_lab failed (exit 1)" in lines, r.stdout
    assert "FAIL  qa_lab load: the stub fails on purpose" in lines, r.stdout
    assert "check_all --manual: FAIL" in lines


def test_the_other_steps_still_fail_the_gate_with_the_lab_flag(lab):
    qa_lab_stub(lab)
    lab.write("notes.md", f"{BANNED}\n")
    r = check_all(lab, "--manual", "--lab")
    assert r.returncode == 1 and "notes.md" in r.stdout


def test_the_stop_hook_never_runs_the_page_checks(lab):
    qa_lab_stub(lab, 1)
    assert stop_hook(lab).returncode == 0
    assert lab_runs(lab) == 0


def test_an_unknown_flag_is_refused_instead_of_silently_skipping_a_check(lab):
    r = check_all(lab, "--manual", "--lap")
    assert r.returncode == 2
    assert "--lap" in output(r) and "--lab" in output(r)
    assert runs(lab) == 0


def test_stale_marker_warns_and_does_not_defer(lab):
    import time
    path = marker(lab)
    old = time.time() - 7 * 3600
    os.utime(path, (old, old))
    result = stop_hook(lab)
    assert result.returncode == 0, output(result)
    assert "stale" in output(result).lower()
    assert runs(lab) == 1


def test_session_brief_warns_about_marker_age(lab):
    import time
    path = marker(lab)
    old = time.time() - 7 * 3600
    os.utime(path, (old, old))
    result = run(["bash", "scripts/hooks/session_brief.sh"], cwd=lab.root)
    assert "stale" in output(result).lower()
    assert "hour" in output(result).lower()


@pytest.mark.parametrize("rel", ["src/view.tsx", "site/app.js", "src/contest.ts"])
def test_audit_random_scope_rejects_source_files(lab, rel):
    lab.write(rel, "const x = Math.random();\n")
    r = check_all(lab, "--manual")
    assert r.returncode == 1 and "Math.random" in r.stdout


def test_audit_random_scope_excludes_actual_test_files(lab):
    for rel in ["src/example.test.ts", "src/nested/example.test.ts"]:
        lab.write(rel, "const x = Math.random();\n")
    assert check_all(lab, "--manual").returncode == 0


@pytest.mark.parametrize("rel,blocked", [
    ("src/latest.ts", True), ("src/latest.spec.ts", True),
    ("src/check.test.tsx", True), ("site/check.test.ts", True),
    ("src/check.test.ts", False), ("src/nested/check.test.ts", False),
    ("src/__tests__/helper.ts", True), ("engine/src/tests/helper.js", True),
])
def test_audit_discovered_test_exclusion(lab, monkeypatch, tmp_path, rel, blocked):
    # Stub the unrelated gate steps so this exercises only the shell's source scan.
    bindir = tmp_path / "bin"
    bindir.mkdir()
    uv = bindir / "uv"
    uv.write_text("#!/bin/sh\nexit 0\n")
    uv.chmod(0o755)
    monkeypatch.setenv("PATH", str(bindir) + os.pathsep + os.environ["PATH"])
    lab.write(rel, "const x = Math.random();\n")
    result = check_all(lab, "--manual")
    assert (result.returncode == 1) is blocked, output(result)
