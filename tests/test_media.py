"""The pictures of the READMEs (R2): the files docs/media/ holds, that every picture a README names exists and is under its limit, and the pure parts of the script that makes them (scripts/media/).

The limits are typed here from the author's brief, not read from the script: the tour 15 to 25 s, about 960 px wide, at most 6 MB; the action 6 to 10 s and at most 3 MB; a screenshot at most about 400 KB and
at most 1280 by 720 (a plant is cut to its own box); the folder under about 12 MB. The browser flows of the script are run by hand (`uv run python scripts/media/make_media.py`); here run what needs no browser.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "media"))

import media_files  # noqa: E402
from media_files import Found, gif_command, gif_filter, gif_info, keep_expression, kept_seconds, png_size, require_ffmpeg, size_problems  # noqa: E402

KB = 1024
MB = 1024 * 1024
MEDIA = REPO / "docs" / "media"
READMES = {"README.md": (REPO / "README.md").read_text(encoding="utf-8"), "README.ko.md": (REPO / "README.ko.md").read_text(encoding="utf-8")}
GIF_LIMITS = {"tour.gif": (15.0, 25.0, 6 * MB), "action.gif": (6.0, 10.0, 3 * MB)}
PNG_LIMIT = 400 * KB
MARK = "mark.svg"  # B1: the mark, one drawing written in code (not made by the script; the READMEs show it beside the title, the pages use it as their icon, tests/test_brand.py)
MARK_LIMIT = 2 * KB
EXPECTED_FILES = {"tour.gif", "action.gif", "plant_en.png", "tour_table_en.png", "lineage_en.png", "results_en.png", "breakout_en.png", "plant_ko.png", "tour_table_ko.png", "lineage_ko.png"}


def named(text: str) -> list[str]:
    return re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text)


# ---- the files ------------------------------------------------------------------------------------


@pytest.mark.parametrize("readme", sorted(READMES))
def test_every_image_a_readme_names_exists_and_is_under_its_limit(readme):
    paths = named(READMES[readme])
    assert paths, readme
    for path in paths:
        assert path.startswith("docs/media/"), path
        f = REPO / path
        assert f.is_file(), f"{readme} names {path}, which does not exist"
        if f.suffix == ".png":
            assert f.stat().st_size <= PNG_LIMIT, f"{path}: {f.stat().st_size} bytes"
            w, h = png_size(f)
            assert 1000 <= w <= 1280 and 500 <= h <= 720, f"{path}: {w} by {h}"
        elif f.suffix == ".svg":
            assert f.name == MARK and f.stat().st_size <= MARK_LIMIT, f"{path}: {f.stat().st_size} bytes"
        else:
            assert f.suffix == ".gif" and f.name in GIF_LIMITS, path
            assert f.stat().st_size <= GIF_LIMITS[f.name][2], f"{path}: {f.stat().st_size} bytes"


def test_the_gifs_run_as_long_as_the_brief_says_and_are_about_960_px_wide():
    for name, (low, high, _) in GIF_LIMITS.items():
        info = gif_info((MEDIA / name).read_bytes())
        assert low <= info["seconds"] <= high, f"{name}: {info['seconds']} s"
        assert 944 <= info["width"] <= 976, f"{name}: {info['width']} px wide"
        assert info["frames"] >= 10 * low * 0.5, f"{name}: only {info['frames']} frames"


def test_the_folder_holds_exactly_the_pictures_the_readmes_name_and_weighs_under_the_total():
    files = {p.name for p in MEDIA.iterdir() if p.is_file()}
    assert files == EXPECTED_FILES | {MARK}
    assert files == {path.split("/")[-1] for text in READMES.values() for path in named(text)}
    assert sum(p.stat().st_size for p in MEDIA.iterdir()) <= 12 * MB


def test_the_korean_screenshots_are_not_the_english_ones():
    for name in ("plant", "tour_table", "lineage"):
        assert (MEDIA / f"{name}_ko.png").read_bytes() != (MEDIA / f"{name}_en.png").read_bytes(), name


def test_the_script_names_the_same_files_and_the_same_limits():
    assert set(media_files.GIFS) | set(media_files.SHOTS_EN) | set(media_files.SHOTS_KO) == EXPECTED_FILES
    assert {name: (*rule["seconds"], rule["max_bytes"]) for name, rule in media_files.GIFS.items()} == GIF_LIMITS
    assert media_files.SHOT_MAX_BYTES == PNG_LIMIT and media_files.TOTAL_MAX_BYTES == 12 * MB and media_files.GIF_WIDTH == 960
    assert size_problems(media_files.inspect(MEDIA)) == []


# ---- the script's pure parts ----------------------------------------------------------------------


def test_the_select_expression_keeps_the_window_and_drops_each_cut():
    assert keep_expression(1.5, 9, []) == "gte(t,1.5)*lt(t,9)"
    assert keep_expression(1, 20, [(3, 4.25), (10, 12)]) == "gte(t,1)*lt(t,20)*not(gte(t,3)*lt(t,4.25))*not(gte(t,10)*lt(t,12))"


def test_the_filter_resamples_cuts_crops_scales_and_makes_one_palette():
    f = gif_filter(1.5, 9, [(3, 4.25)], (1280, 648))
    # the order matters: the frame rate first (the times of the select are the recording's), the window and the cuts, a time line without holes, the crop, the denoise and the drop of near copies, the scale
    assert f.startswith("fps=10,select='gte(t,1.5)*lt(t,9)*not(gte(t,3)*lt(t,4.25))',setpts=N/(10*TB),crop=1280:648:0:0,hqdn3d=0:0:8:8,mpdecimate,scale=960:-2:flags=lanczos,fps=10,split[a][b];")
    assert f.endswith("[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle")
    assert "crop=" not in gif_filter(0, 5, [])


def test_the_command_is_ffmpeg_with_the_filter_graph_and_a_loop_that_never_ends(tmp_path):
    cmd = gif_command("/usr/bin/ffmpeg", tmp_path / "in.webm", tmp_path / "out.gif", 0, 5, [])
    assert cmd[:2] == ["/usr/bin/ffmpeg", "-y"] and cmd[cmd.index("-i") + 1] == str(tmp_path / "in.webm")
    assert cmd[cmd.index("-filter_complex") + 1] == gif_filter(0, 5, []) and cmd[cmd.index("-loop") + 1] == "0" and cmd[-1] == str(tmp_path / "out.gif")


def test_a_point_of_the_recording_falls_in_the_gif_less_the_cuts_before_it():
    cuts = [(3.0, 4.0), (10.0, 12.5)]
    assert kept_seconds(2.0, 1.0, cuts) == 1.0
    assert kept_seconds(3.5, 1.0, cuts) == 2.0  # inside the first cut: 2.5 s from the start less the half second of the cut that is behind it
    assert kept_seconds(11.0, 1.0, cuts) == 8.0  # 10 s from the start less the whole first cut and the first second of the second
    assert kept_seconds(20.0, 1.0, cuts) == 19.0 - 1.0 - 2.5


def test_the_size_and_the_duration_of_a_gif_are_read_from_its_blocks():
    def frame(delay: int) -> bytes:
        return bytes([0x21, 0xF9, 0x04, 0x00, delay & 255, delay >> 8, 0x00, 0x00]) + bytes([0x2C, 0, 0, 0, 0, 2, 0, 1, 0, 0x00]) + bytes([0x02, 0x02, 0x4C, 0x01, 0x00])
    gif = b"GIF89a" + (7).to_bytes(2, "little") + (3).to_bytes(2, "little") + bytes([0x80, 0, 0]) + bytes(6) + frame(10) + frame(25) + b";"
    assert gif_info(gif) == {"width": 7, "height": 3, "frames": 2, "seconds": 0.35}
    with pytest.raises(ValueError):
        gif_info(b"PNG....")


def test_the_png_size_is_read_from_the_header(tmp_path):
    (tmp_path / "x.png").write_bytes(b"\x89PNG\r\n\x1a\n" + (13).to_bytes(4, "big") + b"IHDR" + (1280).to_bytes(4, "big") + (648).to_bytes(4, "big"))
    assert png_size(tmp_path / "x.png") == (1280, 648)


def test_the_size_check_names_a_missing_file_a_file_over_its_limit_and_a_gif_out_of_its_duration():
    good = [Found("tour.gif", 3 * MB, 960, 486, 21.7), Found("action.gif", 1 * MB, 960, 486, 9.2)] + [Found(n, 200 * KB, 1280, 648) for n in sorted(EXPECTED_FILES - set(GIF_LIMITS))]
    assert size_problems(good) == []
    assert size_problems(good[1:]) == ["tour.gif: missing"]
    assert size_problems(good[:1] + [Found("action.gif", 4 * MB, 960, 486, 12.0)] + good[2:]) == ["action.gif: 4194304 bytes, the limit is 3145728", "action.gif: 12.0 s, expected 6 to 10 s"]
    assert size_problems([Found("tour.gif", 7 * MB, 960, 486, 21.7)] + good[1:]) == ["tour.gif: 7340032 bytes, the limit is 6291456"]
    heavy = [Found(f.name, 450 * KB, f.width, f.height) if f.name == "plant_en.png" else f for f in good]
    assert size_problems(heavy) == ["plant_en.png: 460800 bytes, the limit is 409600"]
    narrow = [Found(f.name, f.bytes, 640, 486, 21.7) if f.name == "tour.gif" else f for f in good]
    assert size_problems(narrow) == ["tour.gif: 640 px wide, expected about 960"]


def test_the_script_says_so_and_stops_when_ffmpeg_is_not_on_the_path(monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(SystemExit) as stop:
        require_ffmpeg()
    assert "ffmpeg is not on the PATH" in str(stop.value)


def test_the_script_refuses_a_part_it_does_not_know_before_it_starts_a_browser():
    done = subprocess.run([sys.executable, str(REPO / "scripts" / "media" / "make_media.py"), "--only", "movie"], capture_output=True, text=True, cwd=REPO)
    assert done.returncode == 2 and "--only takes tour, action, shots" in done.stderr


def test_the_script_is_in_the_scripts_readme_and_names_no_ledger_id():
    listing = (REPO / "scripts" / "README.md").read_text(encoding="utf-8")
    assert re.search(r"^\| `media/make_media\.py`.*\|$", listing, re.M)
    for path in (REPO / "scripts" / "media").glob("*.py"):
        assert not re.search(r"\b[AS]\d{3}\b", path.read_text(encoding="utf-8")), path.name  # invariant 3: a ledger id belongs to a figure of the public pages, and these are scripts


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not on the PATH (the script itself says so and stops)")
def test_ffmpeg_turns_a_recording_into_a_gif_of_the_window_less_the_cuts(tmp_path):
    src = tmp_path / "src.mp4"
    made = subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=6", "-pix_fmt", "yuv420p", str(src)], capture_output=True, text=True)
    assert made.returncode == 0, made.stderr
    out = tmp_path / "out.gif"
    media_files.render_gif(src, out, 0.5, 5.5, [(2.0, 3.0)], (1280, 648))
    info = gif_info(out.read_bytes())
    assert (info["width"], info["height"]) == (960, 486)
    assert abs(info["seconds"] - 4.0) <= 0.2, info  # five seconds of window less one second cut
