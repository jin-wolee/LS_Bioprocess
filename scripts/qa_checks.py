"""Check functions, shared plumbing and pure helpers for scripts/qa_infographic.py (the CLI).

Pure helpers (colour maths, compositing, size, i18n diff, clipping geometry) are unit-tested in
tests/test_qa_infographic.py. Checks take (browser, url) and return a Result; they never exit or print.
"""
from __future__ import annotations

import gzip
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

GZIP_LIMIT = 150 * 1024
KO_LIMIT = 0.05
CLIP_TOL = 2.0  # px of an SVG or its text that may be cut off
WHITE = (255, 255, 255)
VIEWPORTS = {"1440": (1440, 900), "390": (390, 844)}
# (label, #theme-select value, emulated prefers-color-scheme)
THEMES = [("light", "light", "light"), ("dark", "dark", "light"), ("neon", "neon", "light"),
          ("auto-light", "auto", "light"), ("auto-dark", "auto", "dark")]
CONTROLS = ["#theme-select", "#lang-toggle", "#story-toggle", "#timeline-slider", "#flag-toggles input[type=checkbox]"]
JOIN_SELECTORS = ["#join-result", "[data-role=join-result]", "#timeline"]  # last one is the weak fallback
FLAGS = "#flag-toggles input[type=checkbox]"


# ---- pure helpers (unit-tested) -------------------------------------------------------------------------

def _linear(channel: float) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb) -> float:
    r, g, b = (_linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a, b) -> float:
    hi, lo = sorted((relative_luminance(a), relative_luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def required_ratio(px: float, weight: float) -> float:
    """WCAG AA: 3:1 for large text (>= 24px, or >= 18.66px bold), 4.5:1 otherwise."""
    return 3.0 if px >= 24 or (px >= 18.66 and weight >= 700) else 4.5


def over(rgba, base):
    r, g, b, a = rgba
    return tuple(c * a + bc * (1 - a) for c, bc in zip((r, g, b), base))


def effective_background(layers, base):
    """Background colour seen through translucent `layers` (nearest ancestor first) on an opaque `base`."""
    acc = base
    for layer in reversed(layers):
        acc = over(layer, acc)
    return acc


def unchanged_keys(en: dict, ko: dict) -> list:
    return [k for k, text in en.items() if ko.get(k) in (None, text)]


def cut_sides(box, clip, tol: float = CLIP_TOL) -> dict:
    """Sides on which `box` (l, t, r, b) sticks out of `clip` by more than `tol` px; a None side of `clip` is unbounded."""
    gaps = (None if clip[0] is None else clip[0] - box[0], None if clip[1] is None else clip[1] - box[1],
            None if clip[2] is None else box[2] - clip[2], None if clip[3] is None else box[3] - clip[3])
    return {side: round(g, 1) for side, g in zip(("left", "top", "right", "bottom"), gaps) if g is not None and g > tol}


def gzip_size(path: Path) -> int:
    return len(gzip.compress(Path(path).read_bytes(), 6, mtime=0))


def fmt_ratio(x: float) -> str:
    return f"{x:.2f}"


# ---- browser plumbing -----------------------------------------------------------------------------------


@dataclass
class Result:
    name: str
    ok: bool
    detail: str
    data: dict = field(default_factory=dict)


@contextmanager
def open_page(browser, url, size=VIEWPORTS["1440"], scheme="light"):
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, color_scheme=scheme, locale="en-US")
    try:
        page = ctx.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(url, wait_until="load")
        yield page, errors
    finally:
        ctx.close()


def apply_state(page, theme: str, lang: str, story: bool = False) -> list[str]:
    """Drive the controls like a reader; return the contract violations seen on the way."""
    problems = []
    page.select_option("#theme-select", theme)
    if not (page.evaluate("document.documentElement.lang") or "").lower().startswith(lang):
        page.click("#lang-toggle")
    page.wait_for_function("l => document.documentElement.lang.toLowerCase().startsWith(l)", arg=lang, timeout=3000)
    if story:
        page.click("#story-toggle")
        if page.get_attribute("#story-toggle", "aria-pressed") != "true":
            problems.append("#story-toggle did not set aria-pressed=true")
    page.wait_for_timeout(150)
    ds = page.evaluate("({t: document.documentElement.dataset.theme || '', s: document.documentElement.dataset.skin || ''})")
    if theme in ("light", "dark") and ds["t"] != theme:
        problems.append(f"theme {theme}: data-theme is '{ds['t']}'")
    if theme == "neon" and ds["s"] != "neon":
        problems.append(f"theme neon: data-skin is '{ds['s']}'")
    return problems


def first_line(e: Exception) -> str:
    return f"{type(e).__name__}: {str(e).strip().splitlines()[0] if str(e).strip() else ''}"


# ---- checks ---------------------------------------------------------------------------------------------


def snap(x: float, lo: float, step: float, hi: float) -> float:
    return round(min(hi, lo + round((x - lo) / step) * step), 6)


def check_timeline(browser, url) -> Result:
    with open_page(browser, url) as (page, _):
        lo, hi, step = page.eval_on_selector("#timeline-slider", "e => [+e.min || 0, +e.max || 100, +e.step || 1]")
        values = sorted({snap(lo + (hi - lo) * i / 20, lo, step, hi) for i in range(21)})
        seen, used = [], None
        for v in values:
            page.fill("#timeline-slider", f"{v:g}")
            page.wait_for_timeout(80)
            used, text = page.evaluate("sels => { for (const s of sels) { const e = document.querySelector(s);"
                                       " if (e) return [s, e.innerText.trim().replace(/\\s+/g, ' ')]; } return [null, ''] }", JOIN_SELECTORS)
            seen.append({"value": v, "text": text})
    distinct = len({s["text"] for s in seen})
    weak = " (weak: fell back to the whole #timeline section)" if used == "#timeline" else ""
    detail = (f"{distinct} distinct texts over {len(values)} positions via {used}{weak}; "
              f"before='{seen[0]['text'][:70]}' after='{seen[-1]['text'][:70]}'")
    return Result("timeline", distinct > 1, detail, {"selector": used, "samples": seen})


def check_flags(browser, url) -> Result:
    with open_page(browser, url) as (page, _):
        boxes = page.locator(FLAGS)
        names = page.eval_on_selector_all(FLAGS, "els => els.map((e, i) => e.id || '#' + i)")
        changed, unchanged = [], []
        for i, name in enumerate(names):
            before = page.inner_html("#outcome-matrix")
            boxes.nth(i).click(force=True, timeout=3000)
            page.wait_for_timeout(80)
            (changed if page.inner_html("#outcome-matrix") != before else unchanged).append(name)
            boxes.nth(i).click(force=True, timeout=3000)  # restore the baseline for the next flag
            page.wait_for_timeout(80)
    note = f"; no effect (report only): {', '.join(unchanged)}" if unchanged else ""
    return Result("flags", bool(names) and bool(changed), f"{len(changed)}/{len(names)} flags change #outcome-matrix{note}",
                  {"changed": changed, "unchanged": unchanged})


RING_JS = """
const ring = el => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow].join('|'); };
const keyOf = (sels, el) => { for (const s of sels) { const i = [...document.querySelectorAll(s)].indexOf(el);
  if (i >= 0) return el.id ? '#' + el.id : s + '#' + i; } return null; };
"""


def check_keyboard(browser, url) -> Result:
    with open_page(browser, url) as (page, _):
        base = page.evaluate("sels => {" + RING_JS + " const m = {}; for (const s of sels) for (const el of document.querySelectorAll(s))"
                             " m[keyOf(sels, el)] = ring(el); return m; }", CONTROLS)
        reached, tabs = {}, 0
        while len(reached) < len(base) and tabs < 400:
            page.keyboard.press("Tab")
            tabs += 1
            hit = page.evaluate("sels => {" + RING_JS + " const el = document.activeElement; const k = el ? keyOf(sels, el) : null;"
                                " return k ? [k, ring(el)] : null; }", CONTROLS)
            if hit and hit[0] not in reached:
                page.wait_for_timeout(250)  # let focus transitions settle
                reached[hit[0]] = page.evaluate("() => {" + RING_JS + " return ring(document.activeElement); }")
    missing = [k for k in base if k not in reached]
    flat = [k for k, style in reached.items() if style == base[k]]
    detail = f"{len(reached)}/{len(base)} controls reached in {tabs} Tabs"
    if missing:
        detail += f"; not reachable: {', '.join(missing)}"
    if flat:
        detail += f"; no visible focus style: {', '.join(flat)}"
    return Result("keyboard", not missing and not flat and bool(base), detail, {"reached": list(reached), "missing": missing, "no_focus_style": flat})


def check_size(page_file: Path) -> Result:
    size = gzip_size(page_file)
    return Result("size", size <= GZIP_LIMIT, f"{size / 1024:.1f} KB gzip (limit {GZIP_LIMIT // 1024} KB)", {"gzip_bytes": size})


def check_ko(browser, url) -> Result:
    text_js = "() => Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(e => [e.dataset.i18n, e.textContent.trim()]))"
    with open_page(browser, url) as (page, _):
        apply_state(page, "light", "en")
        en = page.evaluate(text_js)
        apply_state(page, "light", "ko")
        ko = page.evaluate(text_js)
    same = unchanged_keys(en, ko)
    frac = len(same) / len(en) if en else 1.0
    listed = ", ".join(same[:12]) + (" ..." if len(same) > 12 else "")
    detail = f"{len(same)}/{len(en)} [data-i18n] unchanged in KO ({frac:.1%}, limit {KO_LIMIT:.0%})" + (f": {listed}" if same else "")
    return Result("ko", bool(en) and frac <= KO_LIMIT, detail, {"unchanged": same, "total": len(en)})


CLIP_JS = """() => {
  const box = r => [r.left, r.top, r.right, r.bottom];
  const desc = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')
    + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\\s+/)[0] : '');
  const isX = prop => prop === 'overflowX';
  // [lo, hi, clipper] on one axis; null bounds = nothing clips (the ancestor scrolls, or the page scrolls vertically)
  const axisClip = (el, prop) => {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const o = getComputedStyle(n)[prop];
      if (o === 'visible') continue;
      if (o === 'auto' || o === 'scroll') return [null, null, desc(n) + ' (scrolls)'];
      const r = n.getBoundingClientRect(), lo = isX(prop) ? r.left + n.clientLeft : r.top + n.clientTop;
      return [lo, lo + (isX(prop) ? n.clientWidth : n.clientHeight), desc(n)];
    }
    if (!isX(prop)) return [null, null, 'page'];
    const scrolls = [document.body, document.documentElement].some(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowX));
    return scrolls ? [null, null, 'page (scrolls)'] : [0, document.documentElement.clientWidth, 'viewport'];
  };
  const out = [];
  for (const el of document.querySelectorAll('svg, [class*="diagram" i], [role="img"], [role="figure"], [role="graphics-document"]')) {
    if (el.parentElement && el.parentElement.closest('svg')) continue;  // parts of an outer SVG
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
    const [x0, x1, byX] = axisClip(el, 'overflowX'), [y0, y1, byY] = axisClip(el, 'overflowY');
    const texts = el.tagName.toLowerCase() !== 'svg' ? [] : [...el.querySelectorAll('text')].map(t => ({t, r: t.getBoundingClientRect()}))
      .filter(x => x.r.width > 0 && x.r.height > 0 && x.t.textContent.trim())
      .map(x => ({text: x.t.textContent.trim().slice(0, 40), box: box(x.r)}));
    const sec = el.closest('section[id]');
    out.push({sel: desc(el), svg: el.tagName.toLowerCase() === 'svg', section: sec ? sec.id : '', box: box(r),
              clip: [x0, y0, x1, y1], by: [byX, byY], texts});
  }
  return out;
}"""


def clipping_offenders(vp: str, candidates: list[dict]) -> list[dict]:
    out = []
    for c in candidates:
        w, h = round(c["box"][2] - c["box"][0]), round(c["box"][3] - c["box"][1])
        base = {"vp": vp, "section": c["section"], "sel": c["sel"], "size": f"{w}x{h}"}
        cut = cut_sides(c["box"], c["clip"])
        if cut:
            by = c["by"][0] if "right" in cut or "left" in cut else c["by"][1]
            out.append({**base, "kind": "clipped by ancestor", "cut": cut, "by": by})
        bad = [{"text": t["text"], "cut": k} for t in c["texts"] if (k := cut_sides(t["box"], c["box"]))]
        if bad:
            out.append({**base, "kind": "text outside svg", "texts": bad})
    return out


def describe(o: dict) -> str:
    where = f"{o['vp']}px #{o['section'] or '?'} {o['sel']} {o['size']}"
    if o["kind"] == "text outside svg":
        return where + " text outside its box: " + ", ".join(f"'{t['text']}' {t['cut']}" for t in o["texts"][:3])
    return where + f" cut {o['cut']} by {o['by']}"


def check_clipping(browser, url) -> Result:
    offenders, checked = [], 0
    for vp, size in VIEWPORTS.items():
        with open_page(browser, url, size) as (page, _):
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(300)
            cands = page.evaluate(CLIP_JS)
        checked += len(cands)
        offenders += clipping_offenders(vp, cands)
    shown = "; ".join(describe(o) for o in offenders[:3]) + (f"; +{len(offenders) - 3} more" if len(offenders) > 3 else "")
    detail = f"{len(offenders)} offenders in {checked} SVG/diagram boxes (both widths)" + (f" | {shown}" if offenders else "")
    return Result("clipping", not offenders, detail, {"offenders": offenders, "checked": checked})
