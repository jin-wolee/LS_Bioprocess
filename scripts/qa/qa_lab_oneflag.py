"""The check `one_flag` for scripts/qa/qa_lab.py: the card "What one stored timestamp changes" on Home, end to end (A3, docs/design/lab_ui.md section 26).

Given the built page, Then the card is on Home with its Run button and no answer, and the page asked the Worker for no run of its own on load. When the reader presses Run and then Cancel after the
first seed, the card says the run was cancelled, between two seeds, and Run is on again. When the reader presses Run and waits, the card shows three questions with the figures of both records, the
records in the order of the run, each figure with its status and inside the one result block, no digit outside a marker and no word that ranks or compares; the request that was sent is the run of the
design. The same is read in Korean (the same figures and statuses), at the narrow viewport (no sideways scroll), in the dark theme (no text below AA contrast) and in the public build, which gives the
same answer. The link of the card opens Setup with the same settings filled and starts nothing. The time from the click to the answer is reported with its conditions and never judged: no budget exists for
this run (docs/design/lab_ui.md section 26).
"""
from __future__ import annotations

import re
import tempfile
import time
from pathlib import Path

from qa_checks import VIEWPORTS, Result, fmt_ratio
from qa_infographic import CONTRAST_JS, contrast_rows, serve
from qa_lab_breakout import build_public
from qa_lab_browser import NUMBERS_JS, apply_state, go, open_lab, set_lang, wait_final
from qa_lab_helpers import number_offenders
from qa_lab_oneflag_helpers import (
    one_flag_load_problems, one_flag_problems, one_flag_request_problems, setup_problems, signature, statuses,
)

# what the page sends to the Worker: the type and, for a run, the parts of the spec the card must keep exactly (window.__labRequests, in order)
REQUESTS_JS = """(() => {
  window.__labRequests = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    try {
      const spec = message && message.spec;
      window.__labRequests.push({type: message && message.type, id: message && message.id, scenario: spec && spec.scenario, architectures: spec && spec.architectures, seeds: spec && spec.seeds,
                                 settings: spec && spec.settings, has_actions: !!(message && message.actions), keys: spec ? Object.keys(spec) : []});
    } catch (e) { /* a message that cannot be read is not the card's */ }
    return post.call(this, message, ...rest);
  };
})();"""

# the card as a reader meets it: the button, the answer, the questions with their records and figures (the text of a figure and its status), the facts of the result block and the words of the page
ONE_FLAG_JS = """() => {
  const clean = e => e.innerText.replace(/\\s+/g, ' ').trim();
  const pageText = e => { const copy = e.cloneNode(true); copy.querySelectorAll('[lang=en]').forEach(x => x.remove()); return copy.textContent.replace(/\\s+/g, ' '); };
  const card = document.querySelector('#one-flag');
  const answer = card && card.querySelector('[data-one-flag-answer]');
  const block = answer && answer.querySelector('[data-result]');
  const dd = block ? [...block.querySelectorAll(':scope > dl.facts > dd')].map(clean) : [];
  const button = card && card.querySelector('#one-flag-run');
  return {
    card: !!card,
    run: button ? {disabled: button.disabled} : null,
    progress: card ? !!card.querySelector('#run-status') : false,
    cancelled: card ? !!card.querySelector('[data-problem=cancelled]') : false,
    cancelled_text: card && card.querySelector('[data-problem=cancelled] pre') ? card.querySelector('[data-problem=cancelled] pre').innerText : '',
    answer: !!answer,
    results_in_card: card ? card.querySelectorAll('[data-result]').length : 0,
    facts: block ? {scenario: dd[0], seeds: dd[1], engine: dd[2], architectures: dd[3], check: dd[4]} : null,
    questions: answer ? [...answer.querySelectorAll('section[data-question]')].map(q => ({
      id: q.dataset.question,
      title: clean(q.querySelector('h3')),
      note_cost: !!q.querySelector('[data-note=cost]'),
      columns: [...q.querySelectorAll('[data-architecture]')].map(c => ({
        arch: c.dataset.architecture,
        head: clean(c.querySelector('h4.flag-col-head')),
        figures: [...c.querySelectorAll('.figure')].map(f => ({metric: f.dataset.metric, status: f.dataset.status, value: clean(f.querySelector('.figure-value')), in_block: !!f.closest('[data-result]')})),
      })),
    })) : [],
    figures_outside: card ? [...card.querySelectorAll('.figure')].filter(f => !f.closest('[data-result]')).length : 0,
    link: answer && answer.querySelector('#one-flag-setup') ? answer.querySelector('#one-flag-setup').getAttribute('href') : null,
    text: card ? pageText(card) : '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}"""

SETUP_FORM_JS = """() => ({
  scenario: document.querySelector('#scenario').value,
  archs: Object.fromEntries([...document.querySelectorAll('[id^=arch-]')].map(e => [e.id.replace('arch-', ''), e.checked])),
  ablation: document.querySelector('#ablation').value,
  seeds: document.querySelector('#seeds').value,
  running: !!document.querySelector('#run-status'),
})"""


def read(page) -> dict:
    return page.evaluate(ONE_FLAG_JS)


def last_run(page):
    """The last run request that the page sent with an architecture: what a click on the card asked."""
    runs = [r for r in page.evaluate("window.__labRequests") if r.get("type") == "run" and r.get("architectures")]
    return runs[-1] if runs else None


def press_run(page, timeout=300_000) -> float:
    """Press Run on the card and wait for its answer; the seconds from the click to the answer (headless Chromium, the Worker running 20 seeds of two records)."""
    began = time.perf_counter()
    page.click("#one-flag-run")
    page.wait_for_selector("#one-flag [data-one-flag-answer]", timeout=timeout)
    return time.perf_counter() - began


def contrast_low(page) -> list[str]:
    token_ratio, _, rows = contrast_rows(page.evaluate(CONTRAST_JS))
    low = [f"{fmt_ratio(r['ratio'])} {r['sel']} '{r['text']}'" for r in rows if r["ratio"] < r["need"]]
    return ([f"--fg/--bg {fmt_ratio(token_ratio)}"] if token_ratio < 4.5 else []) + low


def cancel_problems(page) -> tuple[list[str], str]:
    """Run, then Cancel after the first seed: the card says the run was cancelled between two seeds, shows no answer, and Run is on again."""
    page.click("#one-flag-run")
    page.wait_for_function("() => { const p = document.querySelector('#one-flag #run-progress'); return !!p && Number(p.value) >= 1; }", timeout=120_000)
    page.click("#one-flag #cancel")
    page.wait_for_selector("#one-flag [data-problem=cancelled]", timeout=60_000)
    page.wait_for_selector("#one-flag-run:not([disabled])", timeout=10_000)
    found = read(page)
    done = re.search(r"after (\d+) of 20 seeds", found["cancelled_text"])
    problems = []
    if not done or int(done.group(1)) >= 20:
        problems.append(f"cancel: the run did not stop between seeds: '{found['cancelled_text']}'")
    if found["answer"] or found["progress"] or found["run"]["disabled"]:
        problems.append(f"cancel: after the cancel the card shows an answer {found['answer']}, a progress {found['progress']}, Run off {found['run']['disabled']}")
    return problems, found["cancelled_text"]


def check_one_flag(browser, url) -> Result:
    problems: list[str] = []
    notes: list[str] = []
    with open_lab(browser, url, init_script=REQUESTS_JS) as (page, errors, _):
        wait_final(page)
        first = read(page)
        if not first["card"] or first["run"] is None:
            return Result("one_flag", False, "Home has no card #one-flag with a Run button", {})
        if first["answer"] or first["progress"] or first["run"]["disabled"]:
            problems.append(f"before any click the card shows an answer {first['answer']}, a progress {first['progress']}, Run off {first['run']['disabled']}")
        problems += one_flag_load_problems(page.evaluate("window.__labRequests"))
        cancelled, said = cancel_problems(page)
        problems += cancelled
        seconds = press_run(page)
        problems += one_flag_request_problems(last_run(page))
        en = read(page)
        problems += one_flag_problems(en, "en")
        loose = number_offenders(page.evaluate(NUMBERS_JS))
        if loose:
            problems.append(f"{len(loose)} numbers outside a marker on Home with the answer, first: {loose[0]}")
        problems += [f"contrast (light): {p}" for p in contrast_low(page)]
        problems += apply_state(page, "dark", "en")
        problems += [f"contrast (dark): {p}" for p in contrast_low(page)]
        problems += apply_state(page, "auto", "en")
        set_lang(page, "ko")
        ko = read(page)
        problems += one_flag_problems(ko, "ko")
        if statuses(ko) != statuses(en):
            problems.append("ko: the figures and statuses of the card differ from the English page")
        if [q["title"] for q in ko["questions"]] == [q["title"] for q in en["questions"]] or not all(re.search(r"[가-힣]", q["title"]) for q in ko["questions"]):
            problems.append("ko: the questions are not in Korean")
        link = ko["link"]
        set_lang(page, "en")
        if not link or not link.startswith("#/setup?"):
            problems.append(f"the link of the card is '{link}', not a link to Setup")
        else:
            page.click("#one-flag-setup")
            page.wait_for_selector("#main[data-screen=setup]", timeout=10_000)
            try:  # the link fills the form in an effect after the first frame of Setup: wait for the scenario of the link (setup_problems names what Setup holds if it never comes)
                page.wait_for_function("() => { const s = document.querySelector('#scenario'); return !!s && s.value === 'sc03_feed_in_gap'; }", timeout=10_000)
            except Exception:
                pass
            page.wait_for_selector("#run:not([disabled])", timeout=30_000)
            problems += setup_problems(page.evaluate(SETUP_FORM_JS))
            go(page, "home")
            if not read(page)["answer"]:
                problems.append("the answer of the card is gone after a visit to Setup")
        problems += [f"console: {e[:100]}" for e in errors if "HTTP 4" not in e]

    with open_lab(browser, url, VIEWPORTS["390"], init_script=REQUESTS_JS) as (page, _, _):  # the narrow viewport: the answer does not scroll sideways, in either language
        wait_final(page)
        press_run(page)
        for lang in ("en", "ko"):
            set_lang(page, lang)
            narrow = read(page)
            problems += [f"390 px / {p}" for p in one_flag_problems(narrow, lang)]

    problems += public_problems(browser, signature(en))
    detail = (f"cancel '{said}'; run of 20 seeds and two records: {seconds:.1f} s from the click to the answer in headless Chromium (reported, not judged: no budget exists); "
              f"{len(en['questions'])} questions, {sum(len(c['figures']) for q in en['questions'] for c in q['columns'])} figures, statuses {sorted({s[3] for s in statuses(en)})}")
    return Result("one_flag", not problems, detail + (f" | {problems[0]}" if problems else ""), {"problems": problems, "seconds": round(seconds, 1)})


def public_problems(browser, expected) -> list[str]:
    """The public build (no local flag) has the card, runs it and gives the same figures as the local build: sc03_feed_in_gap is public, and the two builds hold one engine."""
    with tempfile.TemporaryDirectory(prefix="lab-public-") as tmp:
        out = Path(tmp)
        built = build_public(out)
        if built.returncode != 0:
            return [f"the public build failed: {(built.stderr or built.stdout)[-200:]}"]
        with serve(out) as url, open_lab(browser, url, init_script=REQUESTS_JS) as (page, _, _):
            wait_final(page)
            if not read(page)["card"]:
                return ["the public build has no card"]
            press_run(page)
            found = read(page)
            problems = [f"public build: {p}" for p in one_flag_problems(found, "en")] + [f"public build: {p}" for p in one_flag_request_problems(last_run(page))]
            if signature(found) != expected:
                problems.append("public build: the figures differ from those of the local build")
            return problems
