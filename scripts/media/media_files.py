"""What `docs/media/` holds and what each file may weigh (the README media, R2): the names, the limits of the author's brief, the pure ffmpeg arguments that make a GIF from a recording, and the
check of the files on disk. No browser here, so pytest runs it (tests/test_media.py); the browser flows are in media_clips.py and media_shots.py, the CLI in make_media.py.

The GIF goes through ffmpeg: the recording is resampled to a fixed frame rate, the stretches the flow marked as waiting are cut out, the picture is scaled, and `palettegen` with `paletteuse` makes one
palette for the whole clip (the Python library route would add a dependency; ffmpeg is already a tool of the machine and the script says so when it is missing). The size and the duration of a GIF are read
from the file itself (its header and the delays of its frames), so checking the files needs no tool.
"""
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

KB = 1024
MB = 1024 * 1024

# The limits of the brief (R2): the tour 15 to 25 s at about 960 px and at most 6 MB, the action 6 to 10 s and at most 3 MB, a screenshot at most about 400 KB, the whole folder under about 12 MB.
GIF_WIDTH = 960
GIFS = {"tour.gif": {"seconds": (15.0, 25.0), "max_bytes": 6 * MB}, "action.gif": {"seconds": (6.0, 10.0), "max_bytes": 3 * MB}}
SHOT_MAX_BYTES = 400 * KB
TOTAL_MAX_BYTES = 12 * MB
# The screenshots, English for README.md; the Korean ones (`_ko`) are the plant, the table of the tour and the Lineage view, for README.ko.md.
SHOTS_EN = ["plant_en.png", "tour_table_en.png", "lineage_en.png", "results_en.png", "breakout_en.png"]
SHOTS_KO = ["plant_ko.png", "tour_table_ko.png", "lineage_ko.png"]
SHOT_SIZE = (1280, 720)

FPS = 10
COLOURS = 96


def require_ffmpeg() -> str:
    """The path of ffmpeg, or a SystemExit that says what is missing (the GIFs need ffmpeg on the PATH)."""
    found = shutil.which("ffmpeg")
    if found is None:
        raise SystemExit("make_media: ffmpeg is not on the PATH; install ffmpeg (for example `brew install ffmpeg`) and run it again")
    return found


def keep_expression(start: float, end: float, cuts: list[tuple[float, float]]) -> str:
    """The `select` expression that keeps the video from `start` to `end` seconds and drops each cut (from, to): a frame is kept when its time is inside the window and in no cut."""
    parts = [f"gte(t,{start:g})", f"lt(t,{end:g})"] + [f"not(gte(t,{a:g})*lt(t,{b:g}))" for a, b in cuts]
    return "*".join(parts)


def kept_seconds(t: float, start: float, cuts: list[tuple[float, float]]) -> float:
    """Where a point of the recording's clock falls in the GIF: the seconds from `start` less the cuts before it (a cut that holds the point counts up to the point)."""
    return t - start - sum(max(0.0, min(b, t) - max(a, start)) for a, b in cuts)


def gif_filter(start: float, end: float, cuts: list[tuple[float, float]], crop: tuple[int, int] | None = None, fps: int = FPS, width: int = GIF_WIDTH, colours: int = COLOURS) -> str:
    """The filter graph of a recording to a GIF: constant frame rate, the window and the cuts, a time line without holes, the crop from the top left (width, height) if there is one, a temporal denoise and
    `mpdecimate` (the codec of the recording refreshes the picture every few frames, a change of a few pixels that a GIF would store as a whole new rectangle; a frame that differs from the one before it by no
    more than that is dropped and the frame rate filled up again with the one before), the scale, one palette for the whole clip and the dither."""
    cropped = f"crop={crop[0]}:{crop[1]}:0:0," if crop else ""
    return (f"fps={fps},select='{keep_expression(start, end, cuts)}',setpts=N/({fps}*TB),{cropped}hqdn3d=0:0:8:8,mpdecimate,scale={width}:-2:flags=lanczos,fps={fps},split[a][b];"
            f"[a]palettegen=max_colors={colours}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle")


def gif_command(ffmpeg: str, src: Path, dst: Path, start: float, end: float, cuts: list[tuple[float, float]], crop: tuple[int, int] | None = None) -> list[str]:
    return [ffmpeg, "-y", "-v", "error", "-i", str(src), "-filter_complex", gif_filter(start, end, cuts, crop), "-loop", "0", str(dst)]


def render_gif(src: Path, dst: Path, start: float, end: float, cuts: list[tuple[float, float]], crop: tuple[int, int] | None = None) -> None:
    done = subprocess.run(gif_command(require_ffmpeg(), src, dst, start, end, cuts, crop), capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {dst.name}: {done.stderr.strip()[-400:]}")


def gif_info(data: bytes) -> dict:
    """The width, the height, the number of frames and the duration in seconds of a GIF, read from its blocks: the logical screen, the graphic control extensions (the delay of a frame, in hundredths of
    a second) and the image descriptors."""
    if data[:6] not in (b"GIF87a", b"GIF89a"):
        raise ValueError("not a GIF")
    width, height, flags = int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little"), data[10]
    i = 13 + (3 * 2 ** ((flags & 7) + 1) if flags & 0x80 else 0)
    frames, delay = 0, 0

    def skip_sub_blocks(at: int) -> int:
        while data[at] != 0:
            at += data[at] + 1
        return at + 1

    while i < len(data) and data[i] != 0x3B:
        if data[i] == 0x21:  # an extension: the label, then sub-blocks; a graphic control extension carries the delay of the next frame
            if data[i + 1] == 0xF9:
                delay += int.from_bytes(data[i + 4:i + 6], "little")
            i = skip_sub_blocks(i + 2)
        elif data[i] == 0x2C:  # an image: the descriptor, a local colour table if there is one, the LZW size, the sub-blocks
            local = data[i + 9]
            i += 10 + (3 * 2 ** ((local & 7) + 1) if local & 0x80 else 0) + 1
            i = skip_sub_blocks(i)
            frames += 1
        else:
            raise ValueError(f"unexpected block {data[i]:#x} at {i}")
    return {"width": width, "height": height, "frames": frames, "seconds": delay / 100}


@dataclass
class Found:
    name: str
    bytes: int
    width: int | None = None
    height: int | None = None
    seconds: float | None = None


def size_problems(found: list[Found], names: list[str] | None = None) -> list[str]:
    """What is wrong with the files of docs/media/ against the limits: a missing file (of `names`, every file of the folder by default), a file over its limit, a GIF out of its duration or not about
    960 px wide, a screenshot larger than 1280 by 720, and the total."""
    problems = []
    by_name = {f.name: f for f in found}
    for name in names if names is not None else [*GIFS, *SHOTS_EN, *SHOTS_KO]:
        if name not in by_name:
            problems.append(f"{name}: missing")
    for name, rule in GIFS.items():
        f = by_name.get(name)
        if f is None:
            continue
        if f.bytes > rule["max_bytes"]:
            problems.append(f"{name}: {f.bytes} bytes, the limit is {rule['max_bytes']}")
        low, high = rule["seconds"]
        if f.seconds is None or not low <= f.seconds <= high:
            problems.append(f"{name}: {f.seconds} s, expected {low:g} to {high:g} s")
        if f.width is None or abs(f.width - GIF_WIDTH) > 16:
            problems.append(f"{name}: {f.width} px wide, expected about {GIF_WIDTH}")
    for name in [*SHOTS_EN, *SHOTS_KO]:
        f = by_name.get(name)
        if f is not None and f.bytes > SHOT_MAX_BYTES:
            problems.append(f"{name}: {f.bytes} bytes, the limit is {SHOT_MAX_BYTES}")
        if f is not None and (f.width is None or f.width > SHOT_SIZE[0] or f.height is None or f.height > SHOT_SIZE[1]):
            problems.append(f"{name}: {f.width} by {f.height}, larger than {SHOT_SIZE[0]} by {SHOT_SIZE[1]}")
    total = sum(f.bytes for f in found)
    if total > TOTAL_MAX_BYTES:
        problems.append(f"docs/media/ holds {total} bytes, the limit is {TOTAL_MAX_BYTES}")
    return problems


def png_size(path: Path) -> tuple[int, int]:
    """The width and the height of a PNG, from its header (no image library)."""
    head = path.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name} is not a PNG")
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def inspect(folder: Path) -> list[Found]:
    """Every file of the folder with its size, and for a GIF its picture size and duration, for a PNG its picture size."""
    found = []
    for path in sorted(p for p in folder.iterdir() if p.is_file()):
        item = Found(path.name, path.stat().st_size)
        if path.suffix == ".gif":
            info = gif_info(path.read_bytes())
            item.width, item.height, item.seconds = info["width"], info["height"], info["seconds"]
        elif path.suffix == ".png":
            item.width, item.height = png_size(path)
        found.append(item)
    return found
