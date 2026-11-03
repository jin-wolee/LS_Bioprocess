#!/usr/bin/env python3
"""Makes the media of the two READMEs into docs/media/: two GIFs and the screenshots, headless and repeatable (R2).

    uv run python scripts/media/make_media.py [--out docs/media] [--no-build] [--only tour,action,shots] [--keep-video DIR] [--timeline]

The media are the lab's own pictures of its synthetic run: the default scenario and the scenario of the guided scene, fixed seeds and fixed instants, the light theme, English for README.md and Korean
for the plant, the table of the tour and Lineage in README.ko.md. The script builds the lab as a local build (`VITE_LAB_LOCAL=1 npm run build:lab`, the build the plant QA serves: the plant of a Break-out
case is in it and not in the public build) unless --no-build, serves `dist/lab` on a free localhost port and drives headless Chromium with software WebGL through Python Playwright under uv; every browser
is closed. The GIFs are the recordings of Playwright turned into GIF by ffmpeg (`palettegen` and `paletteuse`, scripts/media/media_files.py); ffmpeg must be on the PATH, and the script says
so and stops if it is not. At the end it checks every file against the limits of the brief (media_files.py) and exits 1 on a file over its limit.

    tour.gif            the guided scene from the entry of the plant through its five steps
    action.gif          one operator action: a feed added from the bar, the run recomputed, the clock playing again, the list showing it
    *_en.png, *_ko.png  the plant, the card table of the tour, Lineage (both languages), Results and the plant of a Break-out case (English)

The script states no simulation result: a picture shows what the lab computed in the headless browser on that visit.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path[:0] = [str(HERE), str(REPO / "scripts" / "qa")]

from media_clips import record_action, record_tour  # noqa: E402
from media_files import SHOTS_EN, SHOTS_KO, inspect, kept_seconds, render_gif, require_ffmpeg, size_problems  # noqa: E402
from media_shots import breakout_shot, lineage_shot, plant_shot, results_shot, tour_table_shot  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from qa_infographic import serve  # noqa: E402
from qa_plant_helpers import SOFTWARE_GL  # noqa: E402

PARTS = ("tour", "action", "shots")


def build() -> int:
    """The local build of the lab, as the plant QA makes it."""
    return subprocess.run(["npm", "run", "build:lab"], cwd=REPO, env={**os.environ, "VITE_LAB_LOCAL": "1"}).returncode


def make_gif(recorder, browser, url: str, out: Path, name: str, work: Path, keep: Path | None, timeline: bool) -> None:
    recording = recorder(browser, url, work)
    if keep is not None:
        keep.mkdir(parents=True, exist_ok=True)
        (keep / f"{name}.webm").write_bytes(recording.video.read_bytes())
    render_gif(recording.video, out / name, recording.start, recording.end, recording.cuts, recording.crop)
    if timeline:
        marks = ", ".join(f"{label} {kept_seconds(t, recording.start, recording.cuts):.1f}" for label, t in recording.marks)
        print(f"{name} timeline (s into the GIF): {marks}, end {kept_seconds(recording.end, recording.start, recording.cuts):.1f}")


def make_shots(browser, url: str, out: Path) -> None:
    for lang in ("en", "ko"):
        plant_shot(browser, url, out / f"plant_{lang}.png", lang)
        tour_table_shot(browser, url, out / f"tour_table_{lang}.png", lang)
        lineage_shot(browser, url, out / f"lineage_{lang}.png", lang)
    results_shot(browser, url, out / "results_en.png")
    breakout_shot(browser, url, out / "breakout_en.png")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=REPO / "docs" / "media", help="the folder the media go to")
    ap.add_argument("--no-build", action="store_true", help="serve dist/lab as it is")
    ap.add_argument("--only", default=",".join(PARTS), help="which parts to make: tour, action, shots (comma separated)")
    ap.add_argument("--keep-video", type=Path, default=None, help="also keep each recording (webm) in this folder")
    ap.add_argument("--timeline", action="store_true", help="print where the steps of each GIF fall, in seconds into the GIF (for tuning the holds)")
    args = ap.parse_args(argv)
    parts = [p for p in args.only.split(",") if p]
    if not parts or any(p not in PARTS for p in parts):
        print(f"--only takes {', '.join(PARTS)}", file=sys.stderr)
        return 2
    require_ffmpeg()
    if not args.no_build and build() != 0:
        print("npm run build:lab failed", file=sys.stderr)
        return 1
    root = REPO / "dist" / "lab"
    if not (root / "index.html").exists():
        print(f"missing {root / 'index.html'} (run npm run build:lab)", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    with serve(root) as url, sync_playwright() as pw, tempfile.TemporaryDirectory(prefix="media-") as tmp:
        browser = pw.chromium.launch(headless=True, args=SOFTWARE_GL)
        try:
            for part in parts:
                try:
                    if part == "tour":
                        make_gif(record_tour, browser, url, args.out, "tour.gif", Path(tmp) / "tour", args.keep_video, args.timeline)
                    elif part == "action":
                        make_gif(record_action, browser, url, args.out, "action.gif", Path(tmp) / "action", args.keep_video, args.timeline)
                    else:
                        make_shots(browser, url, args.out)
                except Exception as e:  # noqa: BLE001 - one part failing must not leave the browser open or hide the others
                    failures.append(f"{part}: {type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}")
        finally:
            browser.close()
    wanted = [n for n, p in (("tour.gif", "tour"), ("action.gif", "action")) if p in parts] + ([*SHOTS_EN, *SHOTS_KO] if "shots" in parts else [])
    found = inspect(args.out)
    for f in found:
        print(f"{f.name:<20} {f.bytes:>9} bytes" + (f"  {f.width}x{f.height}" if f.width else "") + (f"  {f.seconds:.1f} s" if f.seconds else ""))
    print(f"{'total':<20} {sum(f.bytes for f in found):>9} bytes")
    problems = failures + size_problems(found, wanted)
    for p in problems:
        print(f"FAIL  make_media {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
