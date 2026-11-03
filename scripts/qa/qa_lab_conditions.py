"""The conditions of a time measurement of the QA (docs/design/plant_ui.md section 8, "The conditions of a measurement"; the audit's item 23).

A time taken in software WebGL depends on the CPU the machine has to give (the same check gave 33 ms on a quiet machine and 67 ms at a load average of 11 to 13), so every check that measures a time
records beside its numbers: the load average of the machine at its start and at its end (the 1, 5 and 15 minute figures), the number of CPUs, the version of Chromium, the renderer string, the
viewport, and what was measured from where to where. The checks are `plant_frames`, the round trip of `plant_action`, the lab's `time` and the frames and round trips of the sweep. The record goes
into the data of the check's Result (`conditions`), and `summary` is the line that ends its detail, which names the load and the renderer. The load is recorded, not waited for, and it is no verdict.
No browser is needed to format or to judge a record, so tests/test_qa_conditions.py runs everything here with a fake page.
"""
from __future__ import annotations

import os

# The fields of a record, in the order they are written.
FIELDS = ("load_start", "load_end", "cpus", "chromium", "renderer", "viewport", "measured")

# The renderer the page's WebGL context reports: the unmasked string where the browser gives it, else the plain one. A scratch canvas, released at once; the page ships none of it.
RENDERER_JS = """() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const lose = gl.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
  return String(name);
}"""
NO_WEBGL = "no WebGL context"


def load_average() -> list[float]:
    """The load average of the machine now: the 1, 5 and 15 minute figures, two decimals."""
    return [round(x, 2) for x in os.getloadavg()]


def record(load_start, chromium: str, renderer: str, viewport, measured: str, load_end=None, cpus: int | None = None) -> dict:
    """A record of the conditions. `load_start` was taken (`load_average`) when the check began; the end of the load and the number of CPUs are read now unless given."""
    return {
        "load_start": list(load_start),
        "load_end": list(load_average() if load_end is None else load_end),
        "cpus": (os.cpu_count() or 0) if cpus is None else cpus,
        "chromium": chromium,
        "renderer": renderer,
        "viewport": [viewport[0], viewport[1]],
        "measured": measured,
    }


def of_page(browser, page, load_start, viewport, measured: str) -> dict:
    """The record of a measurement made in `page` of `browser`, at the moment it ended: the version of Chromium from the browser, the renderer from the page's own WebGL."""
    return record(load_start, browser.version, page.evaluate(RENDERER_JS) or NO_WEBGL, viewport, measured)


def _three(x) -> bool:
    return isinstance(x, (list, tuple)) and len(x) == 3 and all(isinstance(v, (int, float)) and v >= 0 for v in x)


def _load(x) -> str:
    return "/".join(f"{v:g}" for v in x) if _three(x) else "missing"


def summary(c: dict) -> str:
    """The one line that ends the detail of a check: the load at the start and the end, the CPUs, Chromium, the renderer and the viewport. A part that a record lacks is written as missing: `problems`
    says what is wrong, and the line itself never fails."""
    viewport = c.get("viewport") or ("?", "?")
    return (f"load {_load(c.get('load_start'))} to {_load(c.get('load_end'))} (1, 5 and 15 min) on {c.get('cpus', 'missing')} CPUs; Chromium {c.get('chromium', 'missing')}; "
            f"renderer {c.get('renderer', 'missing')}; viewport {viewport[0]}x{viewport[1]}")


def problems(c) -> list[str]:
    """What a record lacks. A time without its conditions cannot be compared with the one of another batch, so a check whose record has a problem fails."""
    if not isinstance(c, dict):
        return ["no conditions were recorded"]
    found = []
    if not _three(c.get("load_start")):
        found.append("the conditions lack the load at the start (three figures: 1, 5 and 15 minutes)")
    if not _three(c.get("load_end")):
        found.append("the conditions lack the load at the end (three figures: 1, 5 and 15 minutes)")
    if not (isinstance(c.get("cpus"), int) and c["cpus"] >= 1):
        found.append("the conditions lack the number of CPUs")
    if not str(c.get("chromium") or "").strip():
        found.append("the conditions lack the version of Chromium")
    if not str(c.get("renderer") or "").strip():
        found.append("the conditions lack the renderer")
    viewport = c.get("viewport")
    if not (isinstance(viewport, (list, tuple)) and len(viewport) == 2 and all(isinstance(v, int) and v > 0 for v in viewport)):
        found.append("the conditions lack the viewport")
    if not str(c.get("measured") or "").strip():
        found.append("the conditions lack what was measured, from where to where")
    return found
