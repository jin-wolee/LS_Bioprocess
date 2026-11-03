"""The two recorded clips of the README media (R2): the guided scene of the plant, from its entry through its five steps, and one operator action. Each is a page of its own in a headless Chromium
with software WebGL, recorded by Playwright (a webm), driven the way a reader drives it (the clicks go to the real controls), with a small ring that follows the mouse so the GIF shows where the reader
pressed. The ring is injected into this script's own page and the lab ships none of it.

A flow marks what is waiting on the Worker as a cut (`Clip.skip`), so the GIF shows the plant and not the wait; the cuts, the start and the end of the kept stretch and the crop to the plant's box are
seconds and pixels on the clock and the picture of the recording, which starts when the page is made. media_files.py turns them into the ffmpeg filter. The pure and testable rules are there; this file
needs a browser.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from qa_lab_browser import apply_state
from qa_plant_browser import pause, seek, settle, wait_scene
from qa_plant_helpers import TOUR_SEEN_JS
from qa_plant_tour_flow import landed_on, settle_on_target
from qa_plant_tour_helpers import STEP_IDS

VIEWPORT = {"width": 1280, "height": 720}
# The instant the action clip and the plant screenshot open at: day 8, 09:40 of the default run, seed 1 (the reactors are running and the shelves hold cards), and the reactor the feed goes to (in the
# front row of the bay on the right, so that the entrance camera sees it).
ACTION_AT = 8 * 86400 + 9 * 3600 + 40 * 60
ACTION_UNIT = "U22"
# How long a step of the tour stays on the screen after the camera has reached it, in seconds: long enough to see where the camera is and read the title.
DWELL = {"draw": 2.0, "feed": 2.0, "run": 2.0, "records": 3.0, "truth": 2.4}

# A ring that follows the mouse and swells while a button is down, placed in the page by an init script. It slides between two positions (a transition), so one mouse move shows as a glide.
CURSOR_JS = """(() => {
  const make = () => {
    if (document.getElementById('media-cursor')) return;
    const c = document.createElement('div');
    c.id = 'media-cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #b45309;background:rgba(245,158,11,.28);'
      + 'pointer-events:none;z-index:2147483647;transform:translate(640px,360px) scale(1);transition:transform .42s ease-in-out;';
    document.documentElement.appendChild(c);
    let x = 640, y = 360, down = false;
    const draw = () => { c.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + (down ? 1.5 : 1) + ')'; };
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
    addEventListener('mousedown', () => { down = true; draw(); }, true);
    addEventListener('mouseup', () => { down = false; draw(); }, true);
  };
  if (document.documentElement) make(); else document.addEventListener('DOMContentLoaded', make);
})();"""


@dataclass
class Recording:
    """What a flow leaves: the video file; in seconds of its clock where the kept stretch starts and ends and what is cut out of it; the crop (width, height) from the top left, if any; and the timeline."""

    video: Path
    start: float
    end: float
    cuts: list[tuple[float, float]] = field(default_factory=list)
    crop: tuple[int, int] | None = None
    marks: list[tuple[str, float]] = field(default_factory=list)


class Clip:
    """A page being recorded, with the clock of the recording (seconds since the page was made) and the marks a flow sets on it."""

    def __init__(self, page, t0: float):
        self.page = page
        self.t0 = t0
        self.start = 0.0
        self.end = 0.0
        self.cuts: list[tuple[float, float]] = []
        self.crop: tuple[int, int] | None = None
        self.marks: list[tuple[str, float]] = []

    def now(self) -> float:
        return time.monotonic() - self.t0

    def mark(self, label: str) -> None:
        """Note the clock of the recording at a point of the flow, for the timeline `make_media.py --timeline` prints (where the seconds of a clip go)."""
        self.marks.append((label, self.now()))

    def begin(self) -> None:
        """Everything before this call is left out of the clip."""
        self.start = self.now()

    def finish(self) -> None:
        self.end = self.now()

    def fit_to_plant(self) -> None:
        """Crop the clip to the plant's own box (the width of the window by the height of the box, from the top of the window), so that the page under the plant is not in the picture."""
        box = self.page.locator(".plant-wrap").bounding_box()
        self.crop = (VIEWPORT["width"], int(box["height"]) // 2 * 2)

    def hold(self, seconds: float) -> None:
        self.page.wait_for_timeout(int(seconds * 1000))

    @contextmanager
    def skip(self, lead: float = 0.25, tail: float = 0.15):
        """What happens inside is cut out of the clip, less a little lead and tail so that the cut does not clip the last frame before it or the first after it."""
        a = self.now() + lead
        yield
        b = self.now() - tail
        if b > a:
            self.cuts.append((a, b))

    def press(self, selector: str) -> None:
        """Slide the ring to the middle of a control, press it as a reader does and let the click show."""
        box = self.page.locator(selector).first.bounding_box()
        assert box is not None, f"{selector} has no box"
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.wait_for_timeout(420)
        self.page.mouse.down()
        self.page.wait_for_timeout(80)
        self.page.mouse.up()
        self.page.wait_for_timeout(100)


@contextmanager
def recording(browser, workdir: Path, init_script: str = ""):
    """A fresh context of 1280 by 720 in the light theme with the recorder on and the ring in the page; yields (clip, recorded) where `recorded()` gives the Recording once the context is closed."""
    ctx = browser.new_context(viewport=VIEWPORT, record_video_dir=str(workdir), record_video_size=VIEWPORT, color_scheme="light", locale="en-US")
    ctx.add_init_script(CURSOR_JS + init_script)
    t0 = time.monotonic()
    page = ctx.new_page()
    clip = Clip(page, t0)
    result: dict[str, Recording] = {}
    try:
        yield clip, lambda: result["recording"]
    finally:
        if clip.end == 0.0:
            clip.finish()
        video = page.video
        ctx.close()
        result["recording"] = Recording(Path(video.path()), clip.start, clip.end, clip.cuts, clip.crop, clip.marks)


def open_home(clip: Clip, url: str) -> None:
    """The lab on Home, ready, in English and the light theme, before the clip begins."""
    page = clip.page
    page.goto(url, wait_until="load")
    page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
    apply_state(page, "light", "en")
    page.wait_for_selector("#check-chip:not([data-check-state=pending])", timeout=120_000)


def record_tour(browser, url: str, workdir: Path) -> Recording:
    """The guided scene from the entry of the plant: Home, the entry, the offer on the first visit, and the five steps by the Next button, the last of them with the overlay on. The sample is the one the lineage
    rule picks in the scenario of the tour (docs/design/plant_ui.md section 3.5), so nothing here names it."""
    with recording(browser, workdir) as (clip, recorded):
        page = clip.page
        open_home(clip, url)
        clip.begin()
        clip.hold(1.0)
        clip.press("#enter-plant")
        with clip.skip():
            page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
            wait_scene(page)
            page.wait_for_selector("[data-tour=offer]", timeout=15_000)
            page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")  # the scene fills the window, as a reader scrolls to it
            settle(page, 3)
        clip.fit_to_plant()
        clip.mark("offer")
        clip.hold(1.4)
        clip.press("[data-tour-take]")
        with clip.skip():
            page.wait_for_selector("#plant[data-plant-tour=draw]", timeout=90_000)
            landed_on(page, "draw")
        settle_on_target(page)
        for i, step_id in enumerate(STEP_IDS):
            if i:
                clip.press("[data-tour-next]")
                landed_on(page, step_id)
                settle_on_target(page)
            clip.mark(step_id)
            if step_id == "truth":
                with clip.skip():
                    page.wait_for_function("() => document.querySelectorAll('[data-tour-verdict]').length >= 9", timeout=60_000)
                    page.wait_for_selector("[data-plant-record=ready]", timeout=60_000)
                    settle(page, 3)
            clip.hold(DWELL[step_id])
        clip.press("[data-tour-next]")  # the last step reads Finish
        page.wait_for_selector("[data-tour]", state="detached", timeout=10_000)
        clip.mark("finish")
        clip.hold(0.8)
        clip.finish()
    return recorded()


def record_action(browser, url: str, workdir: Path) -> Recording:
    """One operator action on the default run: the plant at the entrance with the clock playing, the form of "Add a feed", the reactor chosen in it, Apply, the Worker recomputing the run, the clock playing
    again from the instant of the action and the list of the reader's actions showing the feed."""
    with recording(browser, workdir, TOUR_SEEN_JS) as (clip, recorded):
        page = clip.page
        open_home(clip, url)
        page.click("#enter-plant")
        page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
        wait_scene(page)
        pause(page)
        seek(page, ACTION_AT)
        page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
        page.click("[data-time=play]")
        page.evaluate("document.activeElement.blur()")
        clip.fit_to_plant()
        clip.begin()
        clip.hold(1.6)
        clip.mark("bar")
        clip.press("[data-action=add_feed]")
        page.wait_for_selector("[data-action-form=add_feed]", timeout=10_000)
        clip.hold(1.2)
        page.select_option("[data-action-form=add_feed] [name=unit]", ACTION_UNIT)
        clip.mark("form")
        clip.hold(1.0)
        clip.press("[data-act-apply]")
        with clip.skip():
            page.wait_for_selector("#plant[data-plant-epoch='2'][data-plant-scene=ready]", timeout=120_000)
            page.wait_for_function("() => !document.querySelector('#plant').dataset.plantRecomputing", timeout=120_000)
            settle(page, 3)
        page.wait_for_selector("[data-action-item]", timeout=10_000)
        clip.mark("list")
        clip.hold(3.6)
        clip.finish()
    return recorded()
