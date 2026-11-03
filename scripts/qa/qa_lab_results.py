"""The `results` check for scripts/qa/qa_lab.py: Setup to Results, end to end (docs/design/lab_ui.md sections 3, 10 and 12)."""
from __future__ import annotations

import re

from qa_checks import Result, first_line
from qa_lab_browser import NUMBERS_JS, go, open_lab, run_small, set_architectures, wait_final, wait_run
from qa_lab_helpers import SMALL_RUN, detection_order_problems, label_sentence_ok, number_offenders, ordering_words, refs_off_their_line


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
    minimum_notes: document.querySelectorAll('[data-note=min-seeds]').length,
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


# the inputs (`.ref`) that sit among the text of a sentence: the vertical span of each and of the text next to it, to see that the sentence is not broken in three lines at the input
REFS_IN_TEXT_JS = """() => {
  const span = (node, last) => {
    if (!node || node.nodeType !== 3 || !node.textContent.trim()) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    const rect = rects[last ? rects.length - 1 : 0];
    return rect ? {top: rect.top, bottom: rect.bottom} : null;
  };
  return [...document.querySelectorAll('[data-i18n] > .ref')].map(ref => {
    const box = ref.getBoundingClientRect();
    return {text: ref.dataset.ref, top: box.top, bottom: box.bottom, before: span(ref.previousSibling, true), after: span(ref.nextSibling, false)};
  });
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
        if r["minimum_notes"] != 1 or r["few"] != 0:
            problems.append(f"two seeds: the seed minimum is not reached, and the page should say so once for the result block, found {r['minimum_notes']} times and {r['few']} beside figures")
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
        inline = page.evaluate(REFS_IN_TEXT_JS)  # an input in running text stays on the line of its sentence (the notice of the seed minimum is one)
        problems += [f"Results: {p}" for p in refs_off_their_line(inline)] + ([] if inline else ["Results: no input inside running text to check the line of"])
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
