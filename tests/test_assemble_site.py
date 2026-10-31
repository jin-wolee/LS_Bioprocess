"""scripts/assemble_site.py: the folder the Pages workflow uploads (docs/design/lab_ui.md section 13).

The expected file lists are typed by hand from the rule of the design: the infographic page at the root, the built lab under lab/, an empty .nojekyll, and nothing else (S3h1 review: site/infographic/
also holds the build script and the sources of the page, which must not be published).
"""
from __future__ import annotations

import subprocess
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import assemble_site as asm  # noqa: E402

LAB_FILES = {
    "dist/lab/index.html": "<!doctype html><title>lab</title>",
    "dist/lab/reference.json": '{"hashes": []}',
    "dist/lab/assets/main-1a2b.js": "console.log(1)",
    "dist/lab/assets/worker-3c4d.js": "console.log(2)",
}


def tree(root, lab=True, page=True):
    files = {
        "site/infographic/build.py": "# build script\n",
        "site/infographic/src/body.html": "<p>source</p>",
        "site/infographic/dist/artifact.html": "<p>fragment</p>",
        "dist/lab-public/reference.json": "{}",
    }
    if page:
        files["site/infographic/index.html"] = "<!doctype html><title>page</title>"
    if lab:
        files.update(LAB_FILES)
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return root


def listing(folder):
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())


def test_the_folder_holds_the_page_the_lab_and_nojekyll_and_nothing_else(tmp_path):
    root = tree(tmp_path)
    files = asm.assemble(root)
    expected = [".nojekyll", "index.html", "lab/assets/main-1a2b.js", "lab/assets/worker-3c4d.js", "lab/index.html", "lab/reference.json"]
    assert listing(root / "dist" / "site") == expected
    assert files == expected


def test_the_page_and_the_lab_are_copied_byte_for_byte(tmp_path):
    root = tree(tmp_path)
    asm.assemble(root)
    site = root / "dist" / "site"
    assert (site / "index.html").read_bytes() == (root / "site/infographic/index.html").read_bytes()
    for rel in LAB_FILES:
        assert (site / "lab" / rel.removeprefix("dist/lab/")).read_bytes() == (root / rel).read_bytes()


def test_nojekyll_is_an_empty_file(tmp_path):
    root = tree(tmp_path)
    asm.assemble(root)
    assert (root / "dist" / "site" / ".nojekyll").read_bytes() == b""


def test_the_build_script_and_the_sources_of_the_page_are_not_published(tmp_path):
    root = tree(tmp_path)
    asm.assemble(root)
    published = listing(root / "dist" / "site")
    assert not [f for f in published if "build.py" in f or f.startswith("src/") or "artifact.html" in f or "lab-public" in f]


def test_a_stale_file_of_an_earlier_run_is_removed(tmp_path):
    root = tree(tmp_path)
    old = root / "dist" / "site" / "old" / "left-over.txt"
    old.parent.mkdir(parents=True)
    old.write_text("x")
    asm.assemble(root)
    assert not (root / "dist" / "site" / "old").exists()


@pytest.mark.parametrize("missing", ["dist/lab/index.html", "dist/lab/reference.json", "site/infographic/index.html"])
def test_a_missing_input_is_refused_and_no_folder_is_left(tmp_path, missing):
    root = tree(tmp_path)
    (root / missing).unlink()
    with pytest.raises(asm.AssembleError, match=missing):
        asm.assemble(root)
    assert not (root / "dist" / "site").exists()


def test_a_refused_run_leaves_the_folder_of_the_earlier_run(tmp_path):
    root = tree(tmp_path)
    asm.assemble(root)
    (root / "dist/lab/reference.json").unlink()
    with pytest.raises(asm.AssembleError):
        asm.assemble(root)
    assert (root / "dist" / "site" / "index.html").exists()


# ---------- the public build ----------
def fake_run(calls, returncode=0):
    def run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, returncode)
    return run


def test_the_lab_is_built_as_the_public_build_even_when_the_shell_exports_the_local_flag(tmp_path, monkeypatch):
    monkeypatch.setenv("VITE_LAB_LOCAL", "1")
    monkeypatch.setenv("KEEP_ME", "yes")
    calls = []
    monkeypatch.setattr(asm.subprocess, "run", fake_run(calls))
    asm.build_lab(tmp_path)
    (cmd, kwargs), = calls
    assert cmd == ["npm", "run", "build:lab"]
    assert kwargs["cwd"] == tmp_path
    assert "VITE_LAB_LOCAL" not in kwargs["env"]
    assert kwargs["env"]["KEEP_ME"] == "yes"


def test_a_failed_build_is_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(asm.subprocess, "run", fake_run([], returncode=1))
    with pytest.raises(asm.AssembleError, match="build:lab"):
        asm.build_lab(tmp_path)


def test_main_builds_first_then_assembles_and_reports_failure_as_exit_1(tmp_path, monkeypatch, capsys):
    order = []
    monkeypatch.setattr(asm, "ROOT", tree(tmp_path))
    monkeypatch.setattr(asm, "build_lab", lambda root: order.append("build"))
    real = asm.assemble
    monkeypatch.setattr(asm, "assemble", lambda root: (order.append("assemble"), real(root))[1])
    assert asm.main([]) == 0
    assert order == ["build", "assemble"]
    assert "6 files" in capsys.readouterr().out
    (tmp_path / "dist/lab/index.html").unlink()
    assert asm.main([]) == 1
    assert "dist/lab/index.html" in capsys.readouterr().err
