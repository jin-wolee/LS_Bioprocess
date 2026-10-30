"""Check functions, shared plumbing and pure helpers for scripts/qa_lab.py (the CLI): the headless QA of the lab page (docs/design/lab_ui.md section 12).

Pure helpers (median, budgets, request log, the altered reference, words, the numbers walk) are unit-tested in tests/test_qa_lab.py. Checks take a browser (or the Playwright
handle, for `engines`) and the URL of the served build and return a Result; they never exit or print. The contrast and viewport helpers come from qa_checks.py and qa_infographic.py
(AHA: the sweeps over the theme matrix are a second copy here; a third copy would be extracted).
"""
from __future__ import annotations

import json
import re
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from qa_checks import KO_LIMIT, VIEWPORTS, Result, first_line, fmt_ratio, gzip_size, unchanged_keys
from qa_infographic import CONTRAST_JS, contrast_rows

SIZE_LIMIT = 300 * 1024  # first load, gzip bytes over the files of a cold load (lab_ui.md section 12)
TIME_LIMIT_MS = 1000  # median of the five timed runs of seed 1 in the Worker, headless Chromium
FINAL_MS = 120_000  # how long a browser may take to finish the check (Firefox and WebKit are the slower ones)
# the words that belong to the state `identical` alone (lab_ui.md section 7)
PASSED_ONLY_WORDS = ["reproducib", "byte for byte"]
# (label, #theme-select value, emulated prefers-color-scheme)
LAB_THEMES = [("light", "light", "light"), ("dark", "dark", "light"), ("auto-light", "auto", "light"), ("auto-dark", "auto", "dark")]
LANGS = ("en", "ko")


# ---- pure helpers (unit-tested) -------------------------------------------------------------------------


def median(values) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("median of nothing")
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def time_verdict(runs_ms) -> tuple[float | None, bool]:
    """(median of the timed runs, within the budget). No runs is a failure."""
    if not runs_ms:
        return None, False
    m = median(runs_ms)
    return m, m <= TIME_LIMIT_MS


def size_verdict(total_bytes: int) -> bool:
    return total_bytes <= SIZE_LIMIT


def served_path(url: str, base: str) -> str | None:
    """The file of the build that a request URL of the served origin reads; None for another origin."""
    u, b = urlsplit(url), urlsplit(base)
    if (u.scheme, u.netloc) != (b.scheme, b.netloc):
        return None
    return u.path.removeprefix(b.path).lstrip("/") or "index.html"


def cross_origin(urls, base: str) -> list[str]:
    """Requests to another origin. data: and blob: URLs never leave the page."""
    return [u for u in urls if not u.startswith(("data:", "blob:")) and served_path(u, base) is None]


def request_gzip_total(paths, root: Path) -> int:
    """`gzip -c <file> | wc -c` summed over the distinct files a cold load read."""
    return sum(gzip_size(Path(root) / p) for p in dict.fromkeys(paths))


def alter_reference(text: str) -> str:
    """The reference with one hex digit of the first truth hash changed: a build whose reference is wrong by the smallest possible amount."""
    first = json.loads(text)["truth"][0]["log_hash"]
    swapped = ("1" if first[0] == "0" else "0") + first[1:]
    return text.replace(first, swapped, 1)


def found_words(text: str, words) -> list[str]:
    low = text.lower()
    return [w for w in words if w.lower() in low]


def number_offenders(nodes) -> list[dict]:
    """Text nodes that hold a digit and sit under no data-ref, data-result or data-label element (invariant 3, lab_ui.md section 6)."""
    return [{"text": n["text"], "where": n["where"]} for n in nodes if re.search(r"\d", n["text"]) and not n["marked"]]


# ---- browser plumbing -----------------------------------------------------------------------------------


@contextmanager
def open_lab(browser, url, size=VIEWPORTS["1440"], scheme="light", reference=None):
    """A fresh context (a cold load), the page opened, with its console errors and request URLs. `reference`: None keeps the real reference.json; a str replaces its body; an int
    answers with that HTTP status (the page must say the check could not run)."""
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, color_scheme=scheme, locale="en-US")
    try:
        page = ctx.new_page()
        errors: list[str] = []
        requests: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("request", lambda r: requests.append(r.url))
        if reference is not None:
            if isinstance(reference, int):
                page.route("**/reference.json", lambda route: route.fulfill(status=reference, body="not found"))
            else:
                page.route("**/reference.json", lambda route: route.fulfill(status=200, content_type="application/json", body=reference))
        page.goto(url, wait_until="load")
        yield page, errors, requests
    finally:
        ctx.close()


def wait_final(page, timeout=FINAL_MS) -> dict:
    """Wait until the Worker has answered ready and the check has left `pending`; return its state, detail, banner text and the whole body text."""
    page.wait_for_selector("#main[data-ready=true]", timeout=timeout)
    page.wait_for_function("() => { const c = document.querySelector('#check-chip'); return !!c && c.dataset.checkState !== 'pending'; }", timeout=timeout)
    page.wait_for_selector("[data-result]", timeout=timeout)
    return page.evaluate("""() => { const c = document.querySelector('#check-chip');
        return {state: c.dataset.checkState, detail: JSON.parse(c.dataset.detail),
                banner: document.querySelector('#check-banner').innerText.trim(), body: document.body.innerText}; }""")


def set_lang(page, lang: str) -> None:
    if not (page.evaluate("document.documentElement.lang") or "").lower().startswith(lang):
        page.click("#lang-toggle")
    page.wait_for_function("l => document.documentElement.lang.toLowerCase().startsWith(l)", arg=lang, timeout=3000)


def apply_state(page, theme: str, lang: str) -> list[str]:
    """Drive the controls like a reader; return the contract violations seen on the way."""
    problems = []
    page.select_option("#theme-select", theme)
    set_lang(page, lang)
    page.wait_for_timeout(150)
    shown = page.evaluate("document.documentElement.dataset.theme || ''")
    if theme in ("light", "dark") and shown != theme:
        problems.append(f"theme {theme}: data-theme is '{shown}'")
    if theme == "auto" and shown:
        problems.append(f"theme auto: data-theme should be absent, is '{shown}'")
    return problems


# ---- checks ---------------------------------------------------------------------------------------------


def check_load(browser, url) -> Result:
    with open_lab(browser, url) as (page, errors, requests):
        final = wait_final(page)
        elsewhere = cross_origin(requests, url)
    problems = [f"console: {e[:140]}" for e in errors] + [f"request to another origin: {u}" for u in elsewhere]
    detail = f"Worker answered ready, check {final['state']}, {len(set(requests))} requests, {len(errors)} console errors, {len(elsewhere)} to another origin"
    return Result("load", not problems, detail + (f" | {problems[0]}" if problems else ""), {"requests": sorted(set(requests)), "problems": problems})


def check_size(browser, url, root: Path) -> Result:
    with open_lab(browser, url) as (page, _, requests):
        wait_final(page)
    paths = [p for p in dict.fromkeys(served_path(u, url) for u in requests) if p]
    total = request_gzip_total(paths, root)
    return Result("size", size_verdict(total), f"{total / 1024:.1f} KB gzip over {len(paths)} files of a cold load (limit {SIZE_LIMIT // 1024} KB)", {"gzip_bytes": total, "files": paths})


def check_time(browser, url) -> Result:
    with open_lab(browser, url) as (page, _, _):
        runs = wait_final(page)["detail"]["runs_ms"]
    m, ok = time_verdict(runs)
    shown = "no runs" if m is None else f"median {m:.0f} ms of {len(runs)} runs ({', '.join(f'{r:.0f}' for r in runs)})"
    return Result("time", ok, f"{shown}, limit {TIME_LIMIT_MS} ms", {"runs_ms": runs})


def check_check(browser, url, root: Path) -> Result:
    problems: list[str] = []
    with open_lab(browser, url) as (page, _, _):
        real = wait_final(page)
    if real["state"] != "identical":
        problems.append(f"real reference: state {real['state']} (expected identical)")
    if "byte for byte" not in real["banner"]:
        problems.append(f"real reference: banner lacks 'byte for byte': {real['banner'][:80]}")
    altered = alter_reference((root / "reference.json").read_text(encoding="utf-8"))
    with open_lab(browser, url, reference=altered) as (page, _, _):
        bad = wait_final(page)
    if bad["state"] != "failed":
        problems.append(f"altered reference: state {bad['state']} (expected failed)")
    if "FAILED" not in bad["banner"]:
        problems.append(f"altered reference: banner does not say FAILED: {bad['banner'][:80]}")
    if bad["detail"]["truth"] and bad["detail"]["truth"][0]["equal"]:
        problems.append("altered reference: the detail does not name seed 1 as differing")
    leaked = found_words(bad["body"], PASSED_ONLY_WORDS)
    if leaked:
        problems.append(f"altered reference: the page contains {leaked}")
    with open_lab(browser, url, reference=404) as (page, _, _):
        gone = wait_final(page)
    if gone["state"] != "error":
        problems.append(f"missing reference: state {gone['state']} (expected error)")
    if found_words(gone["body"], PASSED_ONLY_WORDS):
        problems.append("missing reference: the page contains words of the passed state")
    detail = f"real: {real['state']} ('{real['banner'][:60]}'); altered: {bad['state']} ('{bad['banner'][:40]}...'); missing: {gone['state']}"
    return Result("check", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def check_engines(pw, url) -> Result:
    """Firefox and WebKit, headless: the check reads `identical` (ADR-0019's claim, standing). A `failed` is a finding about the engine, never tolerated."""
    seen: dict[str, str] = {}
    problems: list[str] = []
    for name in ("firefox", "webkit"):
        browser = getattr(pw, name).launch(headless=True)
        try:
            with open_lab(browser, url) as (page, errors, _):
                final = wait_final(page)
            seen[name] = final["state"]
            if final["state"] != "identical":
                problems.append(f"{name}: {final['state']} {json.dumps(final['detail'])[:160]}")
            problems += [f"{name} console: {e[:100]}" for e in errors]
        finally:
            browser.close()
    return Result("engines", not problems, ", ".join(f"{k} {v}" for k, v in seen.items()) + (f" | {problems[0]}" if problems else ""), {"states": seen, "problems": problems})


NUMBERS_JS = """() => {
  const out = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !/\\d/.test(n.textContent)) continue;
    out.push({text: (n.textContent.match(/.{0,30}\\d+.{0,30}/s) || [n.textContent])[0].trim(), marked: !!el.closest('[data-ref],[data-result],[data-label]'),
              where: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/)[0] : '')});
  }
  return out;
}"""


def check_numbers(browser, url) -> Result:
    """Every text node with a digit sits under a data-ref (an input with its ledger id), a data-result (an output) or a data-label (an identifier or count): invariant 3."""
    offenders: list[dict] = []
    seen = refs = 0
    with open_lab(browser, url) as (page, _, _):
        wait_final(page)
        for lang in LANGS:
            set_lang(page, lang)
            nodes = page.evaluate(NUMBERS_JS)
            seen += len(nodes)
            offenders += [{**o, "lang": lang} for o in number_offenders(nodes)]
        bad_ids = page.evaluate("[...document.querySelectorAll('[data-ref]')].map(e => e.dataset.ref).filter(r => !/^([AS]\\d{3})( [AS]\\d{3})*$/.test(r))")
        refs = page.evaluate("document.querySelectorAll('[data-ref]').length")
    problems = [f"{o['lang']} {o['where']}: '{o['text']}'" for o in offenders] + [f"malformed data-ref '{r}'" for r in bad_ids]
    return Result("numbers", not problems and refs > 0, f"{seen} text nodes with a digit in two languages, {len(offenders)} outside a data-ref, data-result or data-label; {refs} inputs with a ledger id"
                  + (f" | {problems[0]}" if problems else ""), {"offenders": offenders})


def check_ko(browser, url) -> Result:
    text_js = "() => Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(e => [e.dataset.i18n, e.textContent.trim()]))"
    with open_lab(browser, url) as (page, _, _):
        wait_final(page)
        set_lang(page, "en")
        en = page.evaluate(text_js)
        set_lang(page, "ko")
        ko = page.evaluate(text_js)
    with open_lab(browser, url, VIEWPORTS["390"]) as (page, _, _):
        wait_final(page)
        set_lang(page, "ko")
        wide = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    same = unchanged_keys(en, ko)
    frac = len(same) / len(en) if en else 1.0
    listed = ", ".join(same[:12]) + (" ..." if len(same) > 12 else "")
    detail = f"{len(same)}/{len(en)} [data-i18n] unchanged in KO ({frac:.1%}, limit {KO_LIMIT:.0%})" + (f": {listed}" if same else "") + f"; horizontal overflow at 390px in KO: {max(wide, 0)} px"
    return Result("ko", bool(en) and frac <= KO_LIMIT and wide <= 0, detail, {"unchanged": same, "total": len(en)})


def run_cell(browser, url, out: Path, vp: str, label: str, theme: str, scheme: str, lang: str) -> dict:
    name = f"{vp}_{label}_{lang}"
    problems: list[str] = []
    bg = ""
    try:
        with open_lab(browser, url, VIEWPORTS[vp], scheme) as (page, errors, _):
            wait_final(page)
            problems += apply_state(page, theme, lang)
            m = page.evaluate("({sw: document.documentElement.scrollWidth, iw: window.innerWidth, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})")
            bg = m["bg"]
            if m["sw"] > m["iw"]:
                problems.append(f"horizontal scroll: scrollWidth {m['sw']} > innerWidth {m['iw']}")
            page.bring_to_front()  # a new context can hang the screenshot without it
            page.screenshot(path=str(out / "shots" / f"{name}.png"), full_page=True)
            problems += [f"console: {e[:160]}" for e in errors]
    except Exception as e:
        problems.append(first_line(e))
    return {"cell": name, "vp": vp, "label": label, "lang": lang, "bg": bg, "problems": problems}


def check_matrix(browser, url, out: Path) -> Result:
    cells = [run_cell(browser, url, out, vp, label, theme, scheme, lang) for vp in VIEWPORTS for label, theme, scheme in LAB_THEMES for lang in LANGS]
    for vp in VIEWPORTS:  # `auto` must follow the emulated system scheme
        for lang in LANGS:
            bgs = {c["label"]: c["bg"] for c in cells if c["vp"] == vp and c["lang"] == lang and c["label"].startswith("auto")}
            if len(bgs) == 2 and bgs["auto-light"] == bgs["auto-dark"]:
                cells[0]["problems"].append(f"auto does not follow prefers-color-scheme at {vp}/{lang} (--bg '{bgs['auto-light']}' in both)")
    bad = [c for c in cells if c["problems"]]
    shown = "; ".join(f"{c['cell']}: {c['problems'][0]}" for c in bad[:4])
    return Result("matrix", not bad, f"{len(cells) - len(bad)}/{len(cells)} cells clean" + (f" | {shown}" if bad else ""), {"cells": cells})


# the same page in the three settled states of the check: the colours of the chip and the banner differ per state, so each is swept
STATES = [("identical", None), ("failed", "altered"), ("error", 404)]


def check_contrast(browser, url, root: Path) -> Result:
    altered = alter_reference((root / "reference.json").read_text(encoding="utf-8"))
    parts, ok = [], True
    for state, how in STATES:
        reference = altered if how == "altered" else how
        for label, theme, scheme in LAB_THEMES:
            with open_lab(browser, url, scheme=scheme, reference=reference) as (page, _, _):
                final = wait_final(page)
                apply_state(page, theme, "en")
                data = page.evaluate(CONTRAST_JS)
            token_ratio, _, rows = contrast_rows(data)
            low = sorted((r for r in rows if r["ratio"] < r["need"]), key=lambda r: r["ratio"])
            tokens_ok = bool(data["tokens"]["fgToken"] and data["tokens"]["bgToken"])
            cell_ok = final["state"] == state and token_ratio >= 4.5 and not low and tokens_ok
            ok &= cell_ok
            worst = f", worst {fmt_ratio(low[0]['ratio'])} {low[0]['sel']} '{low[0]['text']}'" if low else ""
            parts.append(f"{state}/{label}: --fg/--bg {fmt_ratio(token_ratio)}, {len(low)}/{len(rows)} text colours below AA{worst}" + ("" if final["state"] == state else f" [state was {final['state']}]"))
    return Result("contrast", ok, " | ".join(parts[:3]) + f" | ... {len(parts)} cells", {"cells": parts})
