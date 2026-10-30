"""The `flags` check for scripts/qa_lab.py: every list of flags on the page has exactly the flags of `ready.flags` (docs/design/lab_ui.md section 11)."""
from __future__ import annotations

from qa_checks import Result
from qa_lab_browser import go, open_lab, run_small, show_lineage, wait_final
from qa_lab_helpers import flag_list_problems, missing_flag_lists


COLLECT_FLAGS_JS = """() => ({
  expected: (document.querySelector('#main').dataset.flags || '').split(',').filter(Boolean),
  lists: [...document.querySelectorAll('[data-flag-list]')].map(l => ({name: l.dataset.flagList, arch: l.dataset.architecture || '', flags: [...l.querySelectorAll('[data-flag]')].map(e => e.dataset.flag)})),
})"""

# The Worker answers `ready` with one flag more: a synthetic name that no engine has (a real flag's name would be listed twice once the engine has it, as material_lot_links is since ADR-0017),
# on in C and off in A and B, with its ablation. The page is not changed for it: every list that exists must show the extra flag, and a flag the dictionary has no entries for shows its name.
EXTRA_FLAG_JS = """(() => {
  const EXTRA = 'synthetic_extra_flag';
  const patch = (d) => {
    if (!d || d.type !== 'ready') return d;
    const presets = d.presets.map(p => ({...p, flags: {...p.flags, [EXTRA]: p.id === 'c_context'}}));
    const c = presets.find(p => p.id === 'c_context');
    presets.push({...c, id: 'c_context_minus_' + EXTRA, role: 'ablation', ablated_flag: EXTRA, flags: {...c.flags, [EXTRA]: false}});
    return {...d, flags: [...d.flags, EXTRA], presets};
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
    """Every list of flags on Setup, Results (after the small run), Lineage (after a view), Challenge (its start panel: the records to search) and Notes, with the flags `ready` gave the page."""
    run_small(page)
    show_lineage(page)
    seen = {"expected": [], "lists": []}
    for screen in ("setup", "results", "lineage", "challenge", "notes"):
        go(page, screen)
        got = page.evaluate(COLLECT_FLAGS_JS)
        seen["expected"] = got["expected"]
        seen["lists"] += got["lists"]
    return seen


def check_flags(browser, url) -> Result:
    """Each list of flags on screen has exactly the flags of `ready.flags`: with the real Worker (the flags of today) and with a Worker that sends one flag more."""
    problems: list[str] = []
    counts = []
    for label, script in (("engine", None), ("one flag more", EXTRA_FLAG_JS)):
        with open_lab(browser, url, init_script=script) as (page, errors, _):
            wait_final(page)
            seen = flag_lists(page)
        found = flag_list_problems(seen["lists"], seen["expected"]) + [f"no list {n}" for n in missing_flag_lists(seen["lists"])]
        if label != "engine" and "synthetic_extra_flag" not in seen["expected"]:
            found.append("the patched Worker did not reach the page")
        problems += [f"{label}: {p}" for p in found + [f"console: {e[:100]}" for e in errors]]
        counts.append(f"{label}: {len(seen['lists'])} lists of {len(seen['expected'])} flags")
    return Result("flags", not problems, "; ".join(counts) + (f" | {problems[0]}" if problems else ""), {"problems": problems})
