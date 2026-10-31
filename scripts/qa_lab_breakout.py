"""The checks of the Break-out screen for scripts/qa_lab.py: `sc12` and `breakout_public` (docs/design/lab_ui.md sections 6, 12 and 20).

`sc12`: Given SC12 (the medium-lot case) at its first seed, the walk-back sets and the retro-flag of each record on the page equal the report of that case and seed (typed by hand in
qa_lab_breakout_helpers.BREAKOUT_EXPECTED); direction 3 reads "not reachable from this record" where both link flags are off, and a figure that is not reachable carries no count; recall comes with precision
and the false-alarm rate; the plant is the typed one; the mycoplasma case carries the C29 sentence and the bacterial case does not; the result holds no key of the hidden script; the screen of a
build that is not public is marked not for publication.
`breakout_public`: Given the build as the public build makes it (no VITE_LAB_LOCAL), while a source of the screen is below main-reread the page has no link to the screen, answers its address with
the refusal and bundles none of its files; the rule is read from src/generated/breakout_public.ts, which scripts/lab_ledger.py writes from the ledgers.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

from qa_checks import Result
from qa_infographic import serve
from qa_lab_browser import RECORD_JS, go, open_lab, set_lang, wait_final
from qa_lab_breakout_helpers import BREAKOUT_ARCHS, BREAKOUT_CASE, BREAKOUT_SEED, breakout_problems, breakout_result_problems, observed_problems

REPO = Path(__file__).resolve().parents[1]
PUBLIC_TS = REPO / "src" / "generated" / "breakout_public.ts"

# one object per architecture on the Break-out screen: what the page says of the sets, the re-flags, the figures and the flags
FOUND_JS = """() => [...document.querySelectorAll('[data-breakout-arch]')].map(a => {
  const kinds = (sel) => Object.fromEntries([...a.querySelectorAll(sel + ' li')].map(li => [li.dataset.kind, Number(li.querySelector('[data-label]').textContent)]));
  const d3 = a.querySelector('[data-direction-set="3"]');
  return {
    id: a.dataset.breakoutArch, reach: a.dataset.reach,
    d1: kinds('[data-items="direction_1"]'),
    d3: d3.dataset.d3 === 'not_reachable' ? null : kinds('[data-items="direction_3"]'),
    reflagged: Number(a.querySelector('[data-reflagged]').dataset.reflagged),
    cells: Object.fromEntries([...a.querySelectorAll('.bo-cell[data-metric]')].map(c => [c.dataset.metric, {status: c.dataset.status, kind: c.dataset.cell, num: c.dataset.num ?? null, den: c.dataset.den ?? null}])),
    flags: [...a.querySelectorAll('[data-flag-list="breakout-column"] [data-flag]')].map(f => f.dataset.flag + ':' + f.querySelector('[data-flag-state]').dataset.flagState),
  };
})"""
OBSERVED_JS = """() => [...document.querySelectorAll('[data-events="observed"] tr[data-event]')].map(r => [r.cells[0].textContent.trim(), r.dataset.event, r.cells[2].textContent.trim()])"""


def public_rule() -> bool:
    """Whether no id of the screen follows to a source below main-reread: the constant that scripts/lab_ledger.py writes."""
    return "BREAKOUT_PUBLIC = true;" in PUBLIC_TS.read_text(encoding="utf-8")


def run_case(page, case: str, archs, timeout=90_000) -> None:
    """On the Break-out screen: choose the case, tick exactly these records, press Run and wait for the result of this case."""
    page.select_option("#breakout-case", case)
    for arch in page.eval_on_selector_all("[id^=breakout-arch-]", "els => els.map(e => e.id.replace('breakout-arch-', ''))"):
        page.set_checked(f"#breakout-arch-{arch}", arch in archs)
    page.click("#breakout-run")
    page.wait_for_selector(f"#breakout-result[data-case={case}]", timeout=timeout)


def check_sc12(browser, url) -> Result:
    problems: list[str] = []
    with open_lab(browser, url, init_script=RECORD_JS) as (page, errors, _):
        wait_final(page)
        if page.query_selector("#nav-breakout") is None:
            return Result("sc12", False, "the build does not offer the Break-out screen (a local build does: VITE_LAB_LOCAL=1 npm run build:lab)")
        go(page, "breakout")
        page.wait_for_selector("#breakout-run:not([disabled])", timeout=30_000)
        marked = page.query_selector("[data-note=not-for-publication]") is not None
        if marked == public_rule():
            problems.append(f"the screen is {'marked' if marked else 'not marked'} not for publication, but the public rule says {public_rule()}")
        defaults = [page.input_value("#breakout-case"), page.input_value("#breakout-seed"), [a for a in BREAKOUT_ARCHS if page.is_checked(f"#breakout-arch-{a}")]]
        if defaults != [BREAKOUT_CASE, str(BREAKOUT_SEED), BREAKOUT_ARCHS]:
            problems.append(f"the form starts from {defaults}, expected the first case, the first seed and A, B, C and C without each link flag")
        run_case(page, BREAKOUT_CASE, BREAKOUT_ARCHS)
        found = page.evaluate(FOUND_JS)
        problems += breakout_problems(found)
        problems += observed_problems(page.evaluate(OBSERVED_JS))
        if page.query_selector("[data-c29]") is not None:
            problems.append("the C29 sentence is on a bacterial result")
        sent = [m for m in page.evaluate("window.__labMessages") if m["type"] == "breakout_result"]
        problems += breakout_result_problems(sent[-1]["result"]) if sent else ["no breakout_result message"]
        # the same page in Korean: direction 3 of A is still stated in words
        set_lang(page, "ko")
        if "도달할 수 없음" not in (page.text_content("[data-breakout-arch=a_manual] [data-d3=not_reachable]") or ""):
            problems.append("the Korean page does not say that direction 3 of A is not reachable")
        set_lang(page, "en")
        # the mycoplasma case: the sentence of the author's ruling on C29, and only there
        run_case(page, "sc12_mycoplasma", ["c_context"])
        c29 = page.text_content("[data-c29]") if page.query_selector("[data-c29]") else None
        if c29 is None or "stop rule stays" not in c29:
            problems.append(f"the mycoplasma result lacks the C29 sentence (found: {c29!r})")
        else:
            set_lang(page, "ko")
            if "정지 규칙" not in (page.text_content("[data-c29]") or ""):
                problems.append("the Korean C29 sentence is missing")
        problems += [f"console: {e[:100]}" for e in errors]
    shown = [f["id"] for f in found]
    detail = f"{BREAKOUT_CASE} seed {BREAKOUT_SEED}: {len(shown)} records on the page against the typed report" + (" (marked not for publication)" if marked else "")
    return Result("sc12", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems})


def build_public(out: Path) -> subprocess.CompletedProcess:
    """The lab built as the public build is: Vite with no VITE_LAB_LOCAL, into `out`. reference.json comes from dist/lab-public, where `npm run build:lab` put it."""
    env = {k: v for k, v in os.environ.items() if k != "VITE_LAB_LOCAL"}
    return subprocess.run(["npx", "vite", "build", "-c", "src/vite.config.ts", "--outDir", str(out), "--emptyOutDir"], cwd=REPO, env=env, capture_output=True, text=True)


def check_breakout_public(browser) -> Result:
    with tempfile.TemporaryDirectory(prefix="lab-public-") as tmp:
        out = Path(tmp)
        built = build_public(out)
        if built.returncode != 0:
            return Result("breakout_public", False, f"the public build failed: {(built.stderr or built.stdout)[-200:]}")
        with serve(out) as url:
            return public_build_result(browser, url, out)


def public_build_result(browser, url, out: Path, name="breakout_public") -> Result:
    """The page of a public build, served at `url` from the folder `out`, against the public rule. scripts/qa_site.py runs it on the lab of the assembled site folder as well."""
    expected = public_rule()
    worker = "".join(p.read_text(encoding="utf-8") for p in (out / "assets").glob("worker-*.js"))
    bundled = bool(re.search(r"sc12_medium_lot", worker))
    problems: list[str] = []
    if bundled != expected:
        problems.append(f"the Worker of the public build {'holds' if bundled else 'lacks'} the SC12 files, the rule says {'public' if expected else 'not public'}")
    with open_lab(browser, url, init_script=RECORD_JS) as (page, errors, _):
        page.wait_for_selector("#main[data-ready=true]", timeout=60_000)
        link = page.query_selector("#nav-breakout") is not None
        if link != expected:
            problems.append(f"the navigation {'has' if link else 'has no'} link to the Break-out screen in the public build")
        ready = next(m for m in page.evaluate("window.__labMessages") if m["type"] == "ready")
        if (ready["breakout"] is not None) != expected:
            problems.append(f"ready.breakout is {'set' if ready['breakout'] is not None else 'null'} in the public build")
        page.evaluate("window.location.hash = '#/breakout'")
        page.wait_for_selector("#main[data-screen=breakout]", timeout=10_000)
        refused = page.query_selector("[data-note=refused]") is not None
        form = page.query_selector("#breakout-form") is not None
        if refused == expected or form != expected:
            problems.append(f"the address of the screen shows {'the refusal' if refused else 'no refusal'} and {'a form' if form else 'no form'} in the public build")
        marked = page.query_selector("[data-note=not-for-publication]") is not None
        if marked:
            problems.append("the public build marks the screen not for publication instead of refusing it")
        problems += [f"console: {e[:100]}" for e in errors]
    state = "offered (every source re-read)" if expected else "refused (a source is below main-reread)"
    return Result(name, not problems, f"public build: Break-out screen {state}; the Worker " + ("holds" if bundled else "holds none of") + " the SC12 files" + (f" | {problems[0]}" if problems else ""), {"problems": problems})
