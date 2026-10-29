#!/usr/bin/env python3
"""Headless QA for the infographic (`infographic/index.html`): eight checks, exit 1 if any fails.

    uv run python scripts/qa_infographic.py [--root infographic] [--out qa_out]

Serves --root over http.server on a free localhost port, drives headless Chromium (Playwright sync API),
writes results.json, summary.md and shots/*.png to --out. This file is the CLI, the server, the checks that sweep
the theme matrix (1 matrix, 5 contrast) and the report; the other checks and the unit-tested pure helpers live in
qa_checks.py. The element contract is in the S0b brief.
"""
from __future__ import annotations

import argparse
import functools
import json
import sys
import threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright
from qa_checks import (THEMES, VIEWPORTS, WHITE, Result, apply_state, check_clipping, check_flags, check_keyboard, check_ko,
                       check_size, check_timeline, contrast_ratio, effective_background, first_line, fmt_ratio, open_page, over,
                       required_ratio)

REPO = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def serve(directory: Path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()
        server.server_close()


# ---- checks that sweep the theme matrix ------------------------------------------------------------------


def run_cell(browser, url, out: Path, vp, label, theme, scheme, lang, story=False) -> dict:
    name = f"{vp}_{label}_{lang}" + ("_story" if story else "")
    problems: list[str] = []
    bg = ""
    try:
        with open_page(browser, url, VIEWPORTS[vp], scheme) as (page, errors):
            problems += apply_state(page, theme, lang, story)
            m = page.evaluate("({sw: document.documentElement.scrollWidth, iw: window.innerWidth,"
                              " bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})")
            bg = m["bg"]
            if VIEWPORTS[vp][0] < 600 and m["sw"] > m["iw"]:
                problems.append(f"horizontal scroll: scrollWidth {m['sw']} > innerWidth {m['iw']}")
            page.bring_to_front()  # new context: screenshots can hang without it
            page.screenshot(path=str(out / "shots" / f"{name}.png"), full_page=True)
            problems += [f"console: {e[:160]}" for e in errors]
    except Exception as e:
        problems.append(first_line(e))
    return {"cell": name, "vp": vp, "label": label, "lang": lang, "bg": bg, "problems": problems}


def check_matrix(browser, url, out: Path) -> Result:
    cells = [run_cell(browser, url, out, vp, label, theme, scheme, lang)
             for vp in VIEWPORTS for label, theme, scheme in THEMES for lang in ("en", "ko")]
    cells += [run_cell(browser, url, out, vp, "light", "light", "light", "en", story=True) for vp in VIEWPORTS]
    for vp in VIEWPORTS:  # `auto` must follow the emulated system scheme
        for lang in ("en", "ko"):
            bgs = {c["label"]: c["bg"] for c in cells if c["vp"] == vp and c["lang"] == lang and c["label"].startswith("auto")}
            if len(bgs) == 2 and bgs["auto-light"] == bgs["auto-dark"]:
                cells[0]["problems"].append(f"auto does not follow prefers-color-scheme at {vp}/{lang} (--bg '{bgs['auto-light']}' in both)")
    bad = [c for c in cells if c["problems"]]
    shown = "; ".join(f"{c['cell']}: {c['problems'][0]}" for c in bad[:4])
    return Result("matrix", not bad, f"{len(cells) - len(bad)}/{len(cells)} cells clean" + (f" | {shown}" if bad else ""), {"cells": cells})


CONTRAST_JS = """() => {
  const cx = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const rgba = css => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const root = getComputedStyle(document.documentElement);
  const tok = name => { if (!root.getPropertyValue(name).trim()) return null;
    const s = document.body.appendChild(document.createElement('span')); s.style.color = 'var(' + name + ')';
    const c = getComputedStyle(s).color; s.remove(); return rgba(c); };
  const body = getComputedStyle(document.body), fg = tok('--fg'), bg = tok('--bg');
  const tokens = {fg: fg || rgba(body.color), bg: bg || rgba(body.backgroundColor), fgToken: !!fg, bgToken: !!bg};
  const groups = new Map(); let skipped = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || el instanceof SVGElement || el.disabled) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width <= 2 || r.height <= 2 || cs.visibility !== 'visible' || +cs.opacity === 0) continue;
    const layers = []; let uncertain = false;
    for (let n = el; n; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.backgroundImage !== 'none') { uncertain = true; break; }
      const c = rgba(ncs.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] === 1) break; }
    }
    if (uncertain) { skipped++; continue; }
    const fgc = rgba(cs.color), key = JSON.stringify([fgc, layers, cs.fontSize, cs.fontWeight]);
    if (groups.has(key)) { groups.get(key).count++; continue; }
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/)[0] : '';
    groups.set(key, {fg: fgc, layers, px: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight) || 400, count: 1,
      sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls,
      text: [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 40)});
  }
  return {tokens, skipped, groups: [...groups.values()]};
}"""


def contrast_rows(data: dict) -> tuple[float, float, list[dict]]:
    """(token ratio, token bg as rgb, text-colour groups with their ratio and the ratio they need)."""
    t = data["tokens"]
    bg = over(tuple(t["bg"]), WHITE)
    rows = []
    for g in data["groups"]:
        eff = effective_background([tuple(layer) for layer in g["layers"]], bg)
        rows.append({**g, "ratio": contrast_ratio(over(tuple(g["fg"]), eff), eff), "need": required_ratio(g["px"], g["weight"])})
    return contrast_ratio(over(tuple(t["fg"]), bg), bg), bg, rows


def check_contrast(browser, url) -> Result:
    themes, parts, ok = {}, [], True
    for label, theme, scheme in THEMES[:3]:
        with open_page(browser, url, scheme=scheme) as (page, _):
            apply_state(page, theme, "en")
            data = page.evaluate(CONTRAST_JS)
        token_ratio, _, rows = contrast_rows(data)
        low = sorted((r for r in rows if r["ratio"] < r["need"]), key=lambda r: r["ratio"])
        t = data["tokens"]
        src = "" if t["fgToken"] and t["bgToken"] else " [--fg/--bg missing, used body colours]"
        theme_ok = token_ratio >= 4.5 and not low
        ok &= theme_ok
        worst = f", worst {fmt_ratio(low[0]['ratio'])} {low[0]['sel']} '{low[0]['text']}'" if low else ""
        parts.append(f"{label}: --fg/--bg {fmt_ratio(token_ratio)}{src}, {len(low)}/{len(rows)} text colours below AA{worst}"
                     f"{f', {data['skipped']} skipped (background image)' if data['skipped'] else ''}")
        themes[label] = {"token_ratio": token_ratio, "skipped": data["skipped"], "below_aa": low[:10], "groups": len(rows)}
    return Result("contrast", ok, " | ".join(parts), themes)


# ---- driver ---------------------------------------------------------------------------------------------

def guarded(name: str, fn) -> Result:
    try:
        return fn()
    except Exception as e:  # a crashed check is a failed check, not a crashed run
        return Result(name, False, f"crashed: {first_line(e)}")


def report(results: list[Result], out: Path) -> str:
    rows = [(f"{i} {r.name}", "PASS" if r.ok else "FAIL", r.detail) for i, r in enumerate(results, 1)]
    width = max(len(r[0]) for r in rows)
    table = "\n".join(f"{n:<{width}}  {s}  {d}" for n, s, d in rows)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], indent=2, ensure_ascii=False), encoding="utf-8")
    md = "| check | result | detail |\n|---|---|---|\n" + "\n".join(f"| {n} | {s} | {d.replace('|', '/')} |" for n, s, d in rows)
    (out / "summary.md").write_text(f"# Infographic QA\n\n{md}\n", encoding="utf-8")
    return table


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=REPO / "infographic", help="directory served; must contain index.html")
    ap.add_argument("--out", type=Path, default=REPO / "qa_out")
    args = ap.parse_args(argv)
    page_file = args.root / "index.html"
    if not page_file.exists():
        print(f"missing {page_file}", file=sys.stderr)
        return 1
    (args.out / "shots").mkdir(parents=True, exist_ok=True)
    with serve(args.root) as url, sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            results = [guarded("matrix", lambda: check_matrix(browser, url, args.out)),
                       guarded("timeline", lambda: check_timeline(browser, url)),
                       guarded("flags", lambda: check_flags(browser, url)),
                       guarded("keyboard", lambda: check_keyboard(browser, url)),
                       guarded("contrast", lambda: check_contrast(browser, url)),
                       guarded("size", lambda: check_size(page_file)),
                       guarded("ko", lambda: check_ko(browser, url)),
                       guarded("clipping", lambda: check_clipping(browser, url))]
        finally:
            browser.close()
    print(report(results, args.out))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
