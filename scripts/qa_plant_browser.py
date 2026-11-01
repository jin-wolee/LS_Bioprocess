"""Browser plumbing of the plant QA (docs/design/plant_ui.md section 10): the page opened on the plant, the waits, the attributes of the plant host read as one object, the controls of the clock, the
scripts that run in the page (frame times, pixels). The page ships no test global: the state is read from the attributes of the plant host (`data-plant-*`, `data-run-hash`, `data-cells-hash`)
and the only instruments are scripts this module injects into its own browser context (a requestAnimationFrame wrapper, an observer of one attribute).
"""
from __future__ import annotations

from base64 import b64encode
from contextlib import contextmanager

from qa_lab_browser import apply_state, open_lab
from qa_plant_helpers import PLANT_VIEWPORTS

# Records the time of every animation frame (window.__plantFrames) and every value that data-plant-tubes takes (window.__plantTubes); wraps requestAnimationFrame before any page code runs. The
# page ships none of it.
FRAMES_JS = """(() => {
  window.__plantFrames = [];
  window.__plantTubes = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__plantFrames.push(t); cb(t); });
  new MutationObserver((records) => {
    for (const r of records) window.__plantTubes.push(Number(r.target.getAttribute('data-plant-tubes')));
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-plant-tubes'] });
})();"""

# The luminance spread and the number of distinct colours (of 4096) in a PNG, computed in the page so that no image library is needed.
PIXELS_JS = """async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, s = 0, s2 = 0; const seen = new Set();
  for (let i = 0; i < d.length; i += 16) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++; s += y; s2 += y * y; seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
  }
  const mean = s / n;
  return {width: c.width, height: c.height, mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), colours: seen.size};
}"""

# The number of pixels in which two PNGs differ (any channel), and their size.
DIFF_JS = """async ([a, b]) => {
  const load = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    return {w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data};
  };
  const x = await load(a), y = await load(b);
  if (x.w !== y.w || x.h !== y.h) return {differing: -1, total: 0, size: [x.w, x.h, y.w, y.h]};
  let differing = 0;
  for (let i = 0; i < x.d.length; i += 4) {
    if (x.d[i] !== y.d[i] || x.d[i + 1] !== y.d[i + 1] || x.d[i + 2] !== y.d[i + 2] || x.d[i + 3] !== y.d[i + 3]) differing++;
  }
  return {differing, total: x.w * x.h, size: [x.w, x.h, y.w, y.h]};
}"""

STATE_JS = """() => { const h = document.querySelector('#plant');
  return h ? {scene: h.dataset.plantScene, tier: h.dataset.plantTier, t: h.dataset.plantT, speed: h.dataset.plantSpeed, playing: h.dataset.plantPlaying, epoch: h.dataset.plantEpoch,
              calls: h.dataset.plantCalls, tubes: h.dataset.plantTubes, objects: h.dataset.plantObjects, runHash: h.dataset.runHash, cellsHash: h.dataset.cellsHash} : null; }"""
LIST_JS = """() => { const out = {}; for (const e of document.querySelectorAll('#plant-objects [data-object-kind]')) out[e.dataset.objectKind] = (out[e.dataset.objectKind] || 0) + 1; return out; }"""


@contextmanager
def open_plant(browser, url, size=PLANT_VIEWPORTS["1280"], scheme="light", theme="auto", lang="en", init_script=None):
    """A cold load of Home with the lab ready, the language and theme chosen, then the plant entered through its entry on Home, as a reader does. Yields (page, errors, requests)."""
    with open_lab(browser, url, size, scheme, init_script=init_script) as (page, errors, requests):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        apply_state(page, theme, lang)
        page.click("#enter-plant")
        page.wait_for_selector("#main[data-screen=plant]", timeout=10_000)
        yield page, errors, requests


def wait_scene(page, timeout=90_000) -> dict:
    """Wait until the Worker has answered with the plan and the scene has drawn its first frames; return the attributes of the plant host."""
    page.wait_for_selector("#plant[data-plant-scene=ready]", timeout=timeout)
    page.wait_for_function("() => !!document.querySelector('#plant').dataset.plantCalls", timeout=timeout)
    return page.evaluate(STATE_JS)


def state(page) -> dict:
    return page.evaluate(STATE_JS)


def pause(page) -> None:
    """Pause the clock with its own control (the key Space does the same) and wait until the attribute says so."""
    if page.get_attribute("#plant", "data-plant-playing") == "true":
        page.click("[data-time=play]")
    page.wait_for_function("() => document.querySelector('#plant').dataset.plantPlaying === 'false'", timeout=10_000)


def seek(page, t: int) -> None:
    """Move the clock to `t` by the scrubber (the clock stays paused or playing as it was) and wait until the attribute reads it: by the minute, as the scrubber has whole minutes."""
    page.fill("[data-time=scrub]", str(int(t) // 60 * 60))
    page.wait_for_function("(t) => Math.floor(Number(document.querySelector('#plant').dataset.plantT) / 60) * 60 === t", arg=int(t) // 60 * 60, timeout=10_000)


def settle(page, frames: int = 3) -> None:
    """Wait for a few animation frames of the page so that the scene has been drawn for the clock reading that was set."""
    page.evaluate("(n) => new Promise((resolve) => { let k = 0; const f = () => (++k >= n ? resolve(null) : requestAnimationFrame(f)); requestAnimationFrame(f); })", frames)


def pixel_stats(page, png: bytes) -> dict:
    return page.evaluate(PIXELS_JS, b64encode(png).decode())


@contextmanager
def blank_page(browser):
    """A page with nothing on it, for the scripts that only decode images; its context is closed."""
    ctx = browser.new_context()
    try:
        page = ctx.new_page()
        page.set_content("<html><body></body></html>")
        yield page
    finally:
        ctx.close()


def pixel_diff(page, a: bytes, b: bytes) -> dict:
    return page.evaluate(DIFF_JS, [b64encode(a).decode(), b64encode(b).decode()])
