"""Lab QA status reporting and local-build handoff."""
from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
from qa_checks import Result  # noqa: E402
import qa_build  # noqa: E402
import qa_lab  # noqa: E402


@pytest.mark.parametrize("no_engines,failed", [(True, False), (False, False), (True, True)])
def test_lab_cli_reports_skips_and_flaky_without_changing_exit_status(tmp_path, monkeypatch, capsys, no_engines, failed):
    root = tmp_path / "lab"
    root.mkdir()
    (root / "index.html").write_text("page")
    out = tmp_path / "out"
    calls = []
    browser = SimpleNamespace(close=lambda: calls.append("closed"))
    playwright = SimpleNamespace(chromium=SimpleNamespace(launch=lambda **_: browser))

    @contextmanager
    def serve(_):
        yield "http://local/"

    @contextmanager
    def playwright_context():
        yield playwright

    def guarded(name, fn):
        if name == "engines":
            return fn()
        if name == "load" and failed:
            return Result(name, False, "failed on purpose")
        if name == "robust":
            return Result(name, True, "recovered", {"qa_retry": {"flaky": True}})
        return Result(name, True, "ok")

    monkeypatch.setattr(qa_lab, "serve", serve)
    monkeypatch.setattr(qa_lab, "sync_playwright", playwright_context)
    monkeypatch.setattr(qa_lab, "guarded", guarded)
    monkeypatch.setattr(qa_lab, "check_engines", lambda *_: Result("engines", True, "verified"))
    args = ["--root", str(root), "--out", str(out), "--no-build"]
    if no_engines:
        args.append("--no-engines")
    assert qa_lab.main(args) == (1 if failed else 0)
    stdout = capsys.readouterr().out
    rows = json.loads((out / "results.json").read_text())
    summary = (out / "summary.md").read_text()
    engines = next(row for row in rows if row["name"] == "engines")
    assert engines["ok"] is True and bool(engines["data"].get("skipped")) is no_engines
    assert any("engines" in line and ("SKIP" if no_engines else "PASS") in line for line in stdout.splitlines())
    assert any("robust" in line and "FLAKY" in line for line in stdout.splitlines())
    assert any("engines" in line and ("| SKIP |" if no_engines else "| PASS |") in line for line in summary.splitlines())
    assert any("robust" in line and "| FLAKY |" in line for line in summary.splitlines())
    assert "SKIP 1" in stdout if no_engines else "SKIP 0" in stdout
    assert "FLAKY 1" in stdout and ("FAIL 1" if failed else "FAIL 0") in stdout
    assert ("FAIL  qa_lab load:" in stdout) is failed
    assert calls == ["closed"]


def test_shared_local_build_keeps_the_command_environment_and_return_code(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setenv("VITE_LAB_LOCAL", "0")
    monkeypatch.setenv("QA_BUILD_MARKER", "inherited")
    monkeypatch.setattr(qa_build, "REPO", tmp_path, raising=False)
    monkeypatch.setattr(qa_build, "subprocess", SimpleNamespace(run=lambda command, **kw: calls.append((command, kw)) or SimpleNamespace(returncode=17)), raising=False)
    build = getattr(qa_build, "build_local_lab", lambda: -999)
    assert build() == 17
    command, kw = calls[0]
    assert command == ["npm", "run", "build:lab"] and kw["cwd"] == tmp_path
    assert kw["env"]["VITE_LAB_LOCAL"] == "1" and kw["env"]["QA_BUILD_MARKER"] == "inherited"


def test_lab_build_wrapper_delegates_to_shared_local_build(monkeypatch):
    monkeypatch.setattr(qa_lab, "subprocess", SimpleNamespace(run=lambda *a, **kw: SimpleNamespace(returncode=91)), raising=False)
    monkeypatch.setattr(qa_lab, "build_local_lab", lambda: 37, raising=False)
    assert qa_lab.build() == 37
