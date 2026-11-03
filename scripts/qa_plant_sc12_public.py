"""The public-build part of the check `sc12` on the plant (docs/design/plant_ui.md sections 6 and 10, P7c): a build that bundles no SC12 file offers no case. Given the lab built as the public build is (no
VITE_LAB_LOCAL; the same build `breakout_public` makes), while a source of the Break-out screen is below main-reread: a plant link with `case=` falls back on the default plant and says so (the page knows no case),
the page sends the Worker no `plant_run` of a case, there is no link to the Break-out screen, no link from it to the plant, and no route to it; and the Worker, asked for a case by a page that goes round the
page's own checks, answers `invalid_spec` ("this build does not offer the Break-out screen") and no plan. The rule is the one of `breakout_public` (src/generated/breakout_public.ts): where the build is public
the check expects the opposite and says so. Returns the list of problems; it never exits or prints.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from qa_infographic import serve
from qa_lab_breakout import build_public, public_rule
from qa_plant_browser import RECORD_PLANT_JS, wait_scene
from qa_plant_drill import open_link
from qa_plant_helpers import PLANT_VIEWPORTS
from qa_plant_sc12_helpers import ARCHS, SEED, case_href

# Asks a fresh Worker of the build, by its own file, for a break-out case and resolves with the first answer to that request: the page's own checks are not in the way.
ASK_JS = """async (request) => {
  const file = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\\/assets\\/worker-[^/]+\\.js/.test(n));
  if (!file) return {noWorkerFile: true};
  return await new Promise((resolve) => {
    const w = new Worker(file, {type: 'module'});
    const types = [];
    w.onmessage = (e) => {
      types.push(e.data.type);
      if (e.data.type === 'ready') w.postMessage(request);
      if (e.data.id === request.id && (e.data.type === 'error' || e.data.type === 'plant_ready')) { w.terminate(); resolve({...e.data, types}); }
    };
    setTimeout(() => { w.terminate(); resolve({timeout: true, types}); }, 60000);
  });
}"""
REQUEST = {"type": "plant_run", "id": 900, "epoch": 1, "spec": {"case": "sc12_medium_lot", "architectures": ARCHS[:1], "seed": SEED, "actions": []}}


def public_problems(browser) -> list[str]:
    problems: list[str] = []
    if public_rule():
        return ["the Break-out screen is public in this build (every source re-read): this check expects it refused, and has to be changed with that decision"]
    with tempfile.TemporaryDirectory(prefix="lab-public-") as tmp:
        built = build_public(Path(tmp))
        if built.returncode != 0:
            return [f"the public build failed: {(built.stderr or built.stdout)[-200:]}"]
        with serve(Path(tmp)) as url, open_link(browser, url, case_href("sc12_medium_lot"), PLANT_VIEWPORTS["1280"], RECORD_PLANT_JS) as (page, errors):
            wait_scene(page)
            if page.get_attribute("#plant", "data-plant-case") is not None:
                problems.append("public build: the plant of a link with a case is a case")
            if page.query_selector("[data-link-note=case]") is None:
                problems.append("public build: the page does not say that the case of the link fell back")
            sent = [m for m in page.evaluate("window.__plantSent") if m["type"] == "plant_run"]
            if not sent or any(m.get("case") for m in sent):
                problems.append(f"public build: the page sent plant_run {[m.get('case') or m.get('spec') for m in sent]}, expected the default plant and no case")
            if page.query_selector("#nav-breakout") or page.query_selector("#breakout-open-plant") or page.query_selector("a[data-drill=breakout]"):
                problems.append("public build: the page links to the Break-out screen or to a case")
            page.evaluate("window.location.hash = '#/breakout'")
            page.wait_for_selector("#main[data-screen=breakout]", timeout=10_000)
            if page.query_selector("[data-note=refused]") is None or page.query_selector("#breakout-open-plant"):
                problems.append("public build: the address of the Break-out screen is not refused")
            answer = page.evaluate(ASK_JS, REQUEST)
            if answer.get("type") != "error" or answer.get("code") != "invalid_spec" or "does not offer the Break-out screen" not in answer.get("message", ""):
                problems.append(f"public build: the Worker answered a case with {answer.get('type')} {answer.get('code')} {str(answer.get('message'))[:80]}, expected invalid_spec 'this build does not offer the Break-out screen'")
            problems += [f"public build: console: {e[:140]}" for e in errors]
    return problems
