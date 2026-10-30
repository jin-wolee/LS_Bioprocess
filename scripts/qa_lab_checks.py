"""Check functions, shared plumbing and pure helpers for scripts/qa_lab.py (the CLI): the headless QA of the lab page (docs/design/lab_ui.md section 12).

Pure helpers (median, budgets, request log, the altered reference, words, the numbers walk, the flag lists, the label-error sentence, the order of the detection figures) are unit-tested in
tests/test_qa_lab.py. Checks take a browser (or the Playwright handle, for `engines`) and the URL of the served build and return a Result; they never exit or print. The contrast and viewport
helpers come from qa_checks.py and qa_infographic.py (AHA: the sweeps over the theme matrix are a second copy here; a third copy would be extracted).

The screens are visited through the navigation links of the page, so the state of the page (the Worker, the form, the result of the last run) stays between them. The Results screen needs a
run: `run_small` makes the small run of the end-to-end path (the default scenario, two seeds of the list, A and C), because the gate does not time a run of twenty seeds.
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
SCREENS = ["home", "setup", "results", "notes"]
# the small run of the end-to-end path: the first two seeds of the list, A and C (a twenty-seed run is several seconds, and the gate does not time it)
SMALL_RUN = {"seeds": 2, "architectures": ["a_manual", "c_context"]}
# the lists of flags that exist now (lab_ui.md section 11); the legend of Results is one list per architecture shown
EXPECTED_FLAG_LISTS = ["setup-matrix", "setup-ablation", "results-legend", "notes-table"]
# the label-error sentence of lab_ui.md section 10 (spec section 5, "Notes from S2g"), without the code marks
LABEL_ERROR_SENTENCE = (
    "Without system_issued_id, a label error is not detected here. A conflict of the duplicate-file check (VR-008b) cannot tell a replayed file from two analyses that a label error gave the same "
    "label, and the double-label check (VR-009) looks for two different ids, so the error appears as false alarms of the type duplicate_replay. The numbers are shown as they are."
)
ORDERING = re.compile(r"\b(rank(?:s|ed|ing)?|best|better|worse|worst|win(?:s|ner|ning)?|outperform(?:s|ed)?|superior|inferior|leaderboard)\b", re.I)


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


def flag_list_problems(lists, flags) -> list[str]:
    """Lists of flags (`data-flag-list`) that lack a flag of `ready.flags`, name one that is not in it, or name one twice (lab_ui.md section 11)."""
    if not lists:
        return ["no list of flags (data-flag-list) on the screens checked"]
    problems = []
    for lst in lists:
        label = lst["name"] + (f" [{lst['arch']}]" if lst.get("arch") else "")
        named = lst["flags"]
        problems += [f"{label} lacks {f}" for f in flags if f not in named]
        problems += [f"{label} names {f}, which is not in ready.flags" for f in dict.fromkeys(named) if f not in flags]
        problems += [f"{label} lists {f} twice" for f in dict.fromkeys(named) if named.count(f) > 1]
    return problems


def missing_flag_lists(lists) -> list[str]:
    """The lists of EXPECTED_FLAG_LISTS that are not on the screens checked."""
    present = {lst["name"] for lst in lists}
    return [name for name in EXPECTED_FLAG_LISTS if name not in present]


def label_sentence_ok(text: str) -> bool:
    """Whether a text is the label-error sentence of the design note, apart from white space and the code marks around the flag and the type."""
    return " ".join(text.replace("`", "").split()) == LABEL_ERROR_SENTENCE


def ordering_words(text: str) -> list[str]:
    """Words that rank the architectures or declare a winner (spec section 8, anti-gaming rules 3 and 6), each once, in order of appearance."""
    return list(dict.fromkeys(m.group(0).lower() for m in ORDERING.finditer(text)))


def detection_order_problems(groups) -> list[str]:
    """Each error type of a detection block shows recall, then precision, then the false-alarm rate (spec section 8, rule 3): never a precision or a false-alarm rate without its recall."""
    if not groups:
        return ["no detection block on the Results screen"]
    problems = []
    for g in groups:
        order = [f for f in g["figures"] if f in ("recall", "precision", "false_alarm")]
        if order and "recall" not in order:
            problems.append(f"{g['type']}: {' and '.join(order)} with no recall beside it")
        elif order != [f for f in ("recall", "precision", "false_alarm") if f in order]:
            problems.append(f"{g['type']}: recall must come before precision and the false-alarm rate, found {order}")
    return problems


# ---- browser plumbing -----------------------------------------------------------------------------------


@contextmanager
def open_lab(browser, url, size=VIEWPORTS["1440"], scheme="light", reference=None, init_script=None):
    """A fresh context (a cold load), the page opened, with its console errors and request URLs. `reference`: None keeps the real reference.json; a str replaces its body; an int
    answers with that HTTP status (the page must say the check could not run). `init_script` runs in the page before any of its own code."""
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, color_scheme=scheme, locale="en-US")
    try:
        if init_script:
            ctx.add_init_script(init_script)
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
    """Wait until the Worker has answered ready and the check has left `pending`; return its state, detail, banner text and the whole body text. Home must be the screen shown."""
    page.wait_for_selector("#main[data-ready=true]", timeout=timeout)
    page.wait_for_function("() => { const c = document.querySelector('#check-chip'); return !!c && c.dataset.checkState !== 'pending'; }", timeout=timeout)
    page.wait_for_selector("[data-result]", timeout=timeout)
    return page.evaluate("""() => { const c = document.querySelector('#check-chip');
        return {state: c.dataset.checkState, detail: JSON.parse(c.dataset.detail),
                banner: document.querySelector('#check-banner').innerText.trim(), body: document.body.innerText}; }""")


def go(page, screen: str) -> None:
    """Follow the navigation link of a screen, as a reader does; the state of the page stays."""
    page.click(f"#nav-{screen}")
    page.wait_for_selector(f"#main[data-screen={screen}]", timeout=10_000)
    page.wait_for_timeout(60)


def wait_run(page, timeout=FINAL_MS) -> None:
    """Wait for the run in flight to end: its status appears when Run is pressed and goes when the result, the refusal or the cancel arrives."""
    page.wait_for_selector("#run-status", state="attached", timeout=5_000)
    page.wait_for_selector("#run-status", state="detached", timeout=timeout)


def set_architectures(page, wanted) -> None:
    for arch in ("a_manual", "b_lims_lite", "c_context"):
        page.set_checked(f"#arch-{arch}", arch in wanted)


def run_small(page) -> str:
    """The small run of the end-to-end path, started from Setup like a reader does it; returns the seeds as the form held them. The page ends on Results with the result shown."""
    go(page, "setup")
    page.wait_for_selector("#run:not([disabled])", timeout=30_000)
    page.fill("#seed-count", str(SMALL_RUN["seeds"]))
    set_architectures(page, SMALL_RUN["architectures"])
    seeds = page.input_value("#seeds")
    page.click("#run")
    wait_run(page)
    page.wait_for_selector("[data-result][data-report]", timeout=10_000)
    return seeds


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
    """Every text node with a digit sits under a data-ref (an input with its ledger id), a data-result (an output) or a data-label (an identifier or count): invariant 3. All four screens,
    in both languages; the Results screen after the small run."""
    offenders: list[dict] = []
    seen = refs = 0
    bad_ids: list[str] = []
    with open_lab(browser, url) as (page, _, _):
        wait_final(page)
        run_small(page)
        for lang in LANGS:
            set_lang(page, lang)
            for screen in SCREENS:
                go(page, screen)
                nodes = page.evaluate(NUMBERS_JS)
                seen += len(nodes)
                offenders += [{**o, "lang": lang, "screen": screen} for o in number_offenders(nodes)]
                bad_ids += page.evaluate("[...document.querySelectorAll('[data-ref]')].map(e => e.dataset.ref).filter(r => !/^([AS]\\d{3})( [AS]\\d{3})*$/.test(r))")
                refs += page.evaluate("document.querySelectorAll('[data-ref]').length")
    problems = [f"{o['lang']} {o['screen']} {o['where']}: '{o['text']}'" for o in offenders] + [f"malformed data-ref '{r}'" for r in bad_ids]
    return Result("numbers", not problems and refs > 0, f"{seen} text nodes with a digit on {len(SCREENS)} screens in two languages, {len(offenders)} outside a data-ref, data-result or data-label; {refs} inputs with a ledger id"
                  + (f" | {problems[0]}" if problems else ""), {"offenders": offenders})


def check_ko(browser, url) -> Result:
    text_js = "() => Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(e => [e.dataset.i18n, e.textContent.trim()]))"
    texts: dict[str, dict] = {}
    with open_lab(browser, url) as (page, _, _):
        wait_final(page)
        run_small(page)
        for lang in LANGS:
            set_lang(page, lang)
            texts[lang] = {}
            for screen in SCREENS:
                go(page, screen)
                texts[lang].update(page.evaluate(text_js))
    wide = 0
    with open_lab(browser, url, VIEWPORTS["390"]) as (page, _, _):
        wait_final(page)
        run_small(page)
        set_lang(page, "ko")
        for screen in SCREENS:
            go(page, screen)
            wide = max(wide, page.evaluate("document.documentElement.scrollWidth - window.innerWidth"))
    en, ko = texts["en"], texts["ko"]
    same = unchanged_keys(en, ko)
    frac = len(same) / len(en) if en else 1.0
    listed = ", ".join(same[:12]) + (" ..." if len(same) > 12 else "")
    detail = f"{len(same)}/{len(en)} [data-i18n] unchanged in KO over {len(SCREENS)} screens ({frac:.1%}, limit {KO_LIMIT:.0%})" + (f": {listed}" if same else "") + f"; horizontal overflow at 390px in KO: {max(wide, 0)} px"
    return Result("ko", bool(en) and frac <= KO_LIMIT and wide <= 0, detail, {"unchanged": same, "total": len(en)})


def run_cell(browser, url, out: Path, vp: str, label: str, theme: str, scheme: str, lang: str) -> dict:
    name = f"{vp}_{label}_{lang}"
    problems: list[str] = []
    bg = ""
    try:
        with open_lab(browser, url, VIEWPORTS[vp], scheme) as (page, errors, _):
            wait_final(page)
            run_small(page)
            problems += apply_state(page, theme, lang)
            for screen in SCREENS:
                go(page, screen)
                m = page.evaluate("({sw: document.documentElement.scrollWidth, iw: window.innerWidth, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})")
                bg = m["bg"]
                if m["sw"] > m["iw"]:
                    problems.append(f"{screen}: horizontal scroll: scrollWidth {m['sw']} > innerWidth {m['iw']}")
                page.bring_to_front()  # a new context can hang the screenshot without it
                # the Results page of two architectures is tens of thousands of pixels tall at the narrow viewport: its picture is the first screen of it
                page.screenshot(path=str(out / "shots" / f"{name}_{screen}.png"), full_page=screen != "results")
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
    return Result("matrix", not bad, f"{len(cells) - len(bad)}/{len(cells)} cells clean over {len(SCREENS)} screens" + (f" | {shown}" if bad else ""), {"cells": cells})


# the same page in the three settled states of the check: the colours of the chip and the banner differ per state, so each is swept; the other screens only in the state identical
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
                swept = {"home": page.evaluate(CONTRAST_JS)}
                if state == "identical":
                    run_small(page)
                    for screen in SCREENS[1:]:
                        go(page, screen)
                        swept[screen] = page.evaluate(CONTRAST_JS)
            for screen, data in swept.items():
                token_ratio, _, rows = contrast_rows(data)
                low = sorted((r for r in rows if r["ratio"] < r["need"]), key=lambda r: r["ratio"])
                tokens_ok = bool(data["tokens"]["fgToken"] and data["tokens"]["bgToken"])
                cell_ok = final["state"] == state and token_ratio >= 4.5 and not low and tokens_ok
                ok &= cell_ok
                worst = f", worst {fmt_ratio(low[0]['ratio'])} {low[0]['sel']} '{low[0]['text']}'" if low else ""
                parts.append(f"{state}/{label}/{screen}: --fg/--bg {fmt_ratio(token_ratio)}, {len(low)}/{len(rows)} text colours below AA{worst}" + ("" if final["state"] == state else f" [state was {final['state']}]"))
    failed = [p for p in parts if " 0/" not in p or "[state was" in p]
    return Result("contrast", ok, " | ".join((failed or parts)[:3]) + f" | ... {len(parts)} cells", {"cells": parts})


# ---- the flags check (lab_ui.md section 11) -------------------------------------------------------------

COLLECT_FLAGS_JS = """() => ({
  expected: (document.querySelector('#main').dataset.flags || '').split(',').filter(Boolean),
  lists: [...document.querySelectorAll('[data-flag-list]')].map(l => ({name: l.dataset.flagList, arch: l.dataset.architecture || '', flags: [...l.querySelectorAll('[data-flag]')].map(e => e.dataset.flag)})),
})"""

# The Worker answers `ready` with one flag more, as it will once ADR-0017 is built (material_lot_links: A off, B off, C on, and its ablation). The page is not changed for it: every list that
# exists must show the ninth flag, and a flag the dictionary has no entries for shows its name.
NINTH_FLAG_JS = """(() => {
  const NINTH = 'material_lot_links';
  const patch = (d) => {
    if (!d || d.type !== 'ready') return d;
    const presets = d.presets.map(p => ({...p, flags: {...p.flags, [NINTH]: p.id === 'c_context'}}));
    const c = presets.find(p => p.id === 'c_context');
    presets.push({...c, id: 'c_context_minus_' + NINTH, role: 'ablation', ablated_flag: NINTH, flags: {...c.flags, [NINTH]: false}});
    return {...d, flags: [...d.flags, NINTH], presets};
  };
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      const add = this.addEventListener.bind(this);
      this.addEventListener = (type, fn, opts) => type === 'message' ? add(type, (e) => fn(new MessageEvent('message', {data: patch(e.data)})), opts) : add(type, fn, opts);
    }
  };
})();"""


def flag_lists(page) -> dict:
    """Every list of flags on Setup, Results (after the small run) and Notes, with the flags `ready` gave the page."""
    run_small(page)
    seen = {"expected": [], "lists": []}
    for screen in ("setup", "results", "notes"):
        go(page, screen)
        got = page.evaluate(COLLECT_FLAGS_JS)
        seen["expected"] = got["expected"]
        seen["lists"] += got["lists"]
    return seen


def check_flags(browser, url) -> Result:
    """Each list of flags on screen has exactly the flags of `ready.flags`: with the real Worker (the flags of today) and with a Worker that sends one flag more."""
    problems: list[str] = []
    counts = []
    for label, script in (("engine", None), ("one flag more", NINTH_FLAG_JS)):
        with open_lab(browser, url, init_script=script) as (page, errors, _):
            wait_final(page)
            seen = flag_lists(page)
        found = flag_list_problems(seen["lists"], seen["expected"]) + [f"no list {n}" for n in missing_flag_lists(seen["lists"])]
        if label != "engine" and "material_lot_links" not in seen["expected"]:
            found.append("the patched Worker did not reach the page")
        problems += [f"{label}: {p}" for p in found + [f"console: {e[:100]}" for e in errors]]
        counts.append(f"{label}: {len(seen['lists'])} lists of {len(seen['expected'])} flags")
    return Result("flags", not problems, "; ".join(counts) + (f" | {problems[0]}" if problems else ""), {"problems": problems})


# ---- Setup to Results, end to end -----------------------------------------------------------------------

RESULTS_JS = """() => {
  const clean = e => e.innerText.replace(/\\s+/g, ' ').trim();
  // the words of the page, not the engine strings (lang="en" data, such as "nearest rank" in the rule of the percentile)
  const pageText = e => { const copy = e.cloneNode(true); copy.querySelectorAll('[lang=en]').forEach(x => x.remove()); return copy.textContent; };
  const block = document.querySelector('[data-result][data-report]');
  const arch = e => (e.closest('section.arch') || {dataset: {}}).dataset.architecture;
  return {
    present: !!block,
    archs: [...document.querySelectorAll('section.arch')].map(a => a.dataset.architecture),
    seeds: block ? clean(block.querySelector('dl.facts dd:nth-of-type(2)')) : '',
    minimum_note: !!document.querySelector('[data-note=min-seeds]'),
    few: document.querySelectorAll('[data-warn=few-seeds]').length,
    label_notes: [...document.querySelectorAll('[data-note=label-error]')].map(n => ({arch: arch(n), text: clean(n)})),
    reported: [...document.querySelectorAll('.figure[data-status=reported]')].map(f => ({metric: f.dataset.metric, bar: !!f.querySelector('svg.range-bar[data-bar=range]'), seeds: f.querySelector('.figure-meta').innerText})),
    detection: [...document.querySelectorAll('section.arch .detect-type')].map(d => ({type: d.dataset.errorType, arch: arch(d), figures: [...d.querySelectorAll('.figure')].map(f => f.dataset.metric.split('.').pop())})),
    profiles: [...document.querySelectorAll('.util-profile')].map(p => p.dataset.profile),
    routing: !!document.querySelector('[data-utilisation] p.notice'),
    text: block ? pageText(block) : '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}"""


def read_results(page) -> dict:
    return page.evaluate(RESULTS_JS)


def check_results(browser, url) -> Result:
    """Given the default scenario, two seeds and A and C, When the reader presses Run on Setup, Then the report reaches the page with every figure in a result block (a number in a marker),
    a range bar for each figure with a value, recall beside precision and the false-alarm rate, the seed-count warning, utilisation once with its profile and no text that orders the
    architectures. Then C with one flag off shows the label-error sentence once, a mixed fleet shows per-profile utilisation, a list the engine refuses is shown verbatim, a cancel stops
    the run between seeds, and the link of the setup opens the same setup."""
    problems: list[str] = []
    notes: list[str] = []
    with open_lab(browser, url) as (page, errors, _):
        wait_final(page)
        seeds = run_small(page)
        r = read_results(page)
        if not r["present"]:
            return Result("results", False, "the report did not reach the page", {})
        if r["archs"] != SMALL_RUN["architectures"]:
            problems.append(f"architectures shown {r['archs']}")
        if r["seeds"] != seeds:
            problems.append(f"seeds shown '{r['seeds']}', run with '{seeds}'")
        bare = [f["metric"] for f in r["reported"] if not f["bar"]]
        if bare or not r["reported"]:
            problems.append(f"{len(bare)} of {len(r['reported'])} figures with a value have no range bar: {bare[:2]}")
        problems += detection_order_problems(r["detection"])
        if not r["minimum_note"] or r["few"] != len(r["reported"]):
            problems.append(f"two seeds: the seed minimum is not reached, and the page says so {r['few']} times for {len(r['reported'])} spreads (and {'once' if r['minimum_note'] else 'not'} at the top)")
        if r["label_notes"]:
            problems.append(f"the label-error sentence is shown for {[n['arch'] for n in r['label_notes']]}, where system_issued_id is on or ingest_idempotency is off")
        if r["profiles"] != ["allinone_atline"] or r["routing"]:
            problems.append(f"utilisation profiles {r['profiles']}, routing note {r['routing']}")
        if ordering_words(r["text"]):
            problems.append(f"words that order the architectures: {ordering_words(r['text'])}")
        loose = number_offenders(page.evaluate(NUMBERS_JS))
        if loose:
            problems.append(f"{len(loose)} numbers outside a marker on Results, first: {loose[0]}")
        if r["overflow"] > 0:
            problems.append(f"horizontal overflow {r['overflow']} px on Results")
        notes.append(f"{len(r['reported'])} figures, {len(r['detection'])} detection blocks")

        # C with one flag off: the label-error sentence, once, for the architecture whose flags make it true
        go(page, "setup")
        page.fill("#seed-count", "1")
        set_architectures(page, ["c_context"])
        page.select_option("#ablation", "c_context_minus_system_issued_id")
        page.click("#run")
        wait_run(page)
        page.wait_for_selector("[data-result][data-report]", timeout=10_000)
        r = read_results(page)
        sentences = [(n["arch"], label_sentence_ok(n["text"])) for n in r["label_notes"]]
        if sentences != [("c_context_minus_system_issued_id", True)]:
            problems.append(f"label-error sentence {sentences} (wanted it once, for c_context_minus_system_issued_id, as the design note words it)")

        # a mixed fleet: an all-in-one beside an HPLC, per-profile utilisation and the routing rule in words; a small plant keeps the run short
        go(page, "setup")
        page.fill("#n", "6")
        page.fill("#bay-size", "6")
        page.select_option("#analyzer-2", "hplc")
        page.fill("#seed-count", "1")
        set_architectures(page, ["a_manual"])
        page.select_option("#ablation", "")
        page.click("#run")
        wait_run(page)
        page.wait_for_selector("[data-result][data-report]", timeout=10_000)
        r = read_results(page)
        if r["profiles"] != ["allinone_atline", "hplc"] or not r["routing"]:
            problems.append(f"mixed fleet: profiles {r['profiles']}, routing note {r['routing']}")

        # a list the engine refuses arrives as its own message, verbatim
        go(page, "setup")
        page.select_option("#analyzer-1", "hplc")
        page.click("#run")
        wait_run(page)
        page.wait_for_selector("[data-problem=engine_error]", timeout=10_000)
        message = page.inner_text("[data-problem=engine_error] pre")
        if "requested" not in message or page.get_attribute("[data-problem=engine_error] pre", "lang") != "en":
            problems.append(f"engine_error message not shown verbatim in lang=en: '{message[:80]}'")

        # a cancel is read between seeds: thirty seeds of a small plant, cancelled after the first progress
        go(page, "setup")
        page.select_option("#analyzer-1", "allinone_atline")
        page.select_option("#analyzer-2", "allinone_atline")
        page.fill("#seed-count", "30")
        page.click("#run")
        page.wait_for_function("() => { const p = document.querySelector('#run-progress'); return !!p && Number(p.value) >= 1; }", timeout=60_000)
        page.click("#cancel")
        try:
            page.wait_for_selector("[data-problem=cancelled]", timeout=30_000)
            stopped = page.inner_text("[data-problem=cancelled] pre")
        except Exception as e:  # the Worker did not read the cancel between seeds
            stopped = f"no answer within 30 s ({first_line(e)})"
        done = re.search(r"after (\d+) of 30 seeds", stopped)
        if not done or int(done.group(1)) >= 30:
            problems.append(f"cancel: the run did not stop between seeds: '{stopped}'")
        notes.append(f"cancel: {stopped}")

        # the link holds the setup and never a result; a cold load of it fills the form
        go(page, "setup")
        page.fill("#seeds", "1009, 1103")
        link = page.input_value("#share-link")
        if "schema=1" not in link or "engine=" not in link or re.search(r"result|report|median", link):
            problems.append(f"the link does not hold the spec only: {link[:120]}")
        problems += [f"console: {e[:100]}" for e in errors if "HTTP 4" not in e]
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    try:
        opened = ctx.new_page()
        opened.goto(link, wait_until="load")
        opened.wait_for_selector("#seeds", timeout=60_000)
        form = {"seeds": opened.input_value("#seeds"), "n": opened.input_value("#n"), "analyzer": opened.input_value("#analyzer-2")}
        if form["seeds"] != "1009, 1103" or form["n"] != "6":
            problems.append(f"the link did not fill the form: {form}")
    finally:
        ctx.close()
    return Result("results", not problems, "; ".join(notes) + (f" | {problems[0]}" if problems else ""), {"problems": problems})
