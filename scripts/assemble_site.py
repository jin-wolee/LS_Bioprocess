#!/usr/bin/env python3
"""Assemble the public site folder `dist/site/`: the infographic at its root with its fonts at `fonts/` and its pictures at `media/`, the lab at `lab/`, an empty `.nojekyll`.

    uv run python scripts/assemble_site.py

The Pages workflow (.github/workflows/pages.yml) runs this script and uploads `dist/site/`; run it locally to get the same folder, then `uv run python scripts/qa/qa_site.py` to check it
(docs/design/lab_ui.md section 13). It builds the lab first, as the public build: VITE_LAB_LOCAL is taken out of the environment, so a shell that exports it cannot put the
"not for publication" Break-out screen into the folder, and a `dist/lab` left by `qa_lab.py` (a local build) is replaced. Only `site/infographic/index.html`, `site/infographic/fonts/` and `site/infographic/media/` are copied from
`site/infographic/`: the page names its fonts and its pictures by relative address (`fonts/...`, `media/...`) and asks no other origin for them, and the folder carries the licence texts beside the fonts (SIL OFL 1.1); the build
script and the sources of the page stay behind. A missing input is refused before the old folder is touched.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = "site/infographic/index.html"
FONTS = "site/infographic/fonts"  # the woff2 files the page names and their licences (fonts/README.md)
MEDIA = "site/infographic/media"  # the pictures the page names (the hero picture of the plant, scripts/media/make_media.py --only hero)
LAB = "dist/lab"
LAB_NEEDS = ("index.html", "reference.json")  # reference.json: the Worker of the lab fetches it for the browser check
OUT = "dist/site"


class AssembleError(Exception):
    pass


def build_lab(root: Path) -> None:
    """`npm run build:lab` as the public build (no VITE_LAB_LOCAL)."""
    env = {k: v for k, v in os.environ.items() if k != "VITE_LAB_LOCAL"}
    if subprocess.run(["npm", "run", "build:lab"], cwd=root, env=env).returncode != 0:
        raise AssembleError("npm run build:lab failed")


def assemble(root: Path) -> list[str]:
    """Write `dist/site/` under `root` from the committed page and the built lab; return the files in it, sorted, relative to the folder."""
    needed = [PAGE, *(f"{LAB}/{name}" for name in LAB_NEEDS)]
    missing = [rel for rel in needed if not (root / rel).is_file()]
    missing += [d for d in (FONTS, MEDIA) if not (root / d).is_dir()]
    if missing:
        raise AssembleError(f"missing {', '.join(missing)} (the lab is built by npm run build:lab, the page by site/infographic/build.py, its picture by scripts/media/make_media.py --only hero)")
    out = root / OUT
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    shutil.copyfile(root / PAGE, out / "index.html")
    shutil.copytree(root / FONTS, out / "fonts")
    shutil.copytree(root / MEDIA, out / "media")
    shutil.copytree(root / LAB, out / "lab")
    (out / ".nojekyll").touch()
    return sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())


def main(argv=None) -> int:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args(argv)
    try:
        build_lab(ROOT)
        files = assemble(ROOT)
    except AssembleError as e:
        print(f"assemble_site: {e}", file=sys.stderr)
        return 1
    print(f"assemble_site: {OUT}/ holds {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
