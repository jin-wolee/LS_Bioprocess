"""Browser plumbing for the checks of the lab page (scripts/qa_lab.py): a fresh page with its console and request logs, the waits, the visit of a screen through its navigation link, the small
run of the end-to-end path and the controls for language and theme.

The screens are visited through the navigation links of the page, so the state of the page (the Worker, the form, the result of the last run) stays between them. The Results screen needs a
run: `run_small` makes the small run of the end-to-end path (the default scenario, two seeds of the list, A and C), because the gate does not time a run of twenty seeds. The Lineage and
Challenge screens need a view and a started challenge: `show_lineage` and `start_challenge`; `prepare_page` makes all three, so a sweep over the screens finds something on each.
"""
from __future__ import annotations

from contextlib import contextmanager

from qa_checks import VIEWPORTS
from qa_lab_helpers import SCREENS, SMALL_RUN


FINAL_MS = 120_000  # how long a browser may take to finish the check (Firefox and WebKit are the slower ones)


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


def shown_screens(page) -> list[str]:
    """The screens of SCREENS that this build offers: the Break-out screen has no navigation link in a build that refuses it (docs/design/lab_ui.md section 20)."""
    return [s for s in SCREENS if page.query_selector(f"#nav-{s}") is not None]


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


# Records every message the Worker sends, in order, as plain JSON (window.__labMessages). It wraps the Worker class before any page code runs and listens beside the page's own listener.
RECORD_JS = """(() => {
  window.__labMessages = [];
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => { try { window.__labMessages.push(JSON.parse(JSON.stringify(e.data))); } catch (err) { /* a message that is not plain data is a finding of its own */ } });
    }
  };
})();"""


def show_lineage(page, timeout=60_000) -> None:
    """The Lineage screen with its default form (SC3, seed 1, the rule, A, B and C): press Show lineage and wait for the view."""
    go(page, "lineage")
    page.wait_for_selector("#lineage-show:not([disabled])", timeout=30_000)
    page.click("#lineage-show")
    page.wait_for_selector("#lineage-view", timeout=timeout)


def start_challenge(page, variant="sample", shown=None, seed=None, timeout=60_000) -> str:
    """The Challenge screen: choose the variant, the record and the seed, press Start and wait for the record. With nothing given it takes the defaults of the form. Returns the seed it ran."""
    go(page, "challenge")
    page.wait_for_selector("#challenge-start:not([disabled])", timeout=30_000)
    page.check(f"#challenge-variant-{variant}")
    if shown:
        page.check(f"#challenge-shown-{shown}")
    if seed is not None:
        page.fill("#challenge-seed", str(seed))
    ran = page.input_value("#challenge-seed")
    page.click("#challenge-start")
    page.wait_for_selector("#challenge-play", timeout=timeout)
    return ran


def show_breakout(page, archs=("a_manual", "c_context"), timeout=90_000) -> None:
    """The Break-out screen with its default case and seed, A and C (the two records that differ most in what direction 3 can read): press Run and wait for the result."""
    go(page, "breakout")
    page.wait_for_selector("#breakout-run:not([disabled])", timeout=30_000)
    for arch in page.eval_on_selector_all("[id^=breakout-arch-]", "els => els.map(e => e.id.replace('breakout-arch-', ''))"):
        page.set_checked(f"#breakout-arch-{arch}", arch in archs)
    page.click("#breakout-run")
    page.wait_for_selector("#breakout-result", timeout=timeout)


def prepare_page(page) -> None:
    """A page with something on every screen: the small run, a lineage view, a started challenge (the sample variant, unrevealed) and, where the build offers it, a break-out result."""
    run_small(page)
    show_lineage(page)
    start_challenge(page)
    if page.query_selector("#nav-breakout") is not None:
        show_breakout(page)


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
