"""Bounded browser probes for worker startup and untrusted links."""
from __future__ import annotations

import re
from urllib.parse import urlencode

from qa_checks import Result

# Cold worker failure must be visible on every screen that otherwise waits for ready.
READY_ROUTES = ("home", "setup", "plant", "results", "lineage", "challenge", "breakout", "notes")
WORKER_ASSET = re.compile(r"/worker-[^/]+\.js(?:\?.*)?$")
FAST_STARTUP_TIMEOUT = """(() => {
  const realTimeout = window.setTimeout;
  window.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 20000 ? 25 : ms, ...args);
})();"""
TRACK_PLANT_POSTS = """(() => {
  window.__qaPlantActions = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(message, ...rest) {
    if (message && message.type === 'plant_run') window.__qaPlantActions.push(message.spec.actions);
    return post.call(this, message, ...rest);
  };
})();"""


def nested_actions(depth: int = 5000) -> str:
    """A deliberately deep JSON array inside one action, without recursive Python encoding."""
    return '[{"kind":"add_feed","extra":' + '[' * depth + '0' + ']' * depth + '}]'


def check_robust(browser, url) -> Result:
    problems: list[str] = []
    page_errors: list[str] = []
    requests: list[str] = []
    worker_states: dict[str, dict[str, str | None]] = {}

    # A real worker load returning 404 exercises browser error delivery, not a replacement Worker.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    try:
        def unavailable(route):
            requests.append(route.request.url)
            route.fulfill(status=404, content_type="text/plain", body="missing")

        ctx.route(WORKER_ASSET, unavailable)
        page = ctx.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_default_navigation_timeout(15000)
        page.goto(url, wait_until="load")
        page.wait_for_selector('[data-problem="worker"]', timeout=10000)
        worker_states["404"] = {"state": page.get_attribute('#check-chip', 'data-check-state'), "text": page.locator('#check-chip').inner_text(), "problem": page.locator('[data-problem="worker"]').first.inner_text()}
        if worker_states["404"]["state"] != 'error':
            problems.append('worker 404: check chip did not report error')
        for screen in READY_ROUTES:
            page.evaluate("screen => { location.hash = '#/' + screen; }", screen)
            page.wait_for_selector(f'#main[data-screen="{screen}"]', timeout=5000)
            if page.locator('[data-problem="worker"]').count() == 0:
                problems.append(f"worker 404: no visible problem on {screen}")
        if not requests:
            problems.append("worker 404: the worker asset was not intercepted")
    except Exception as error:
        problems.append(f"worker 404: {type(error).__name__}: {str(error).splitlines()[0]}")
    finally:
        ctx.close()

    # A worker that loads but never says ready takes the startup timeout path.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    try:
        ctx.add_init_script(FAST_STARTUP_TIMEOUT)
        ctx.route(WORKER_ASSET, lambda route: route.fulfill(status=200, content_type="text/javascript", body="self.onmessage = () => {};"))
        page = ctx.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_default_navigation_timeout(15000)
        page.goto(url, wait_until="load")
        page.wait_for_selector('[data-problem="worker"]', timeout=10000)
        worker_states["silent"] = {"state": page.get_attribute('#check-chip', 'data-check-state'), "text": page.locator('#check-chip').inner_text(), "problem": page.locator('[data-problem="worker"]').first.inner_text()}
        if worker_states["silent"]["state"] != 'error':
            problems.append('silent worker: check chip did not report error')
    except Exception as error:
        problems.append(f"silent worker: {type(error).__name__}: {str(error).splitlines()[0]}")
    finally:
        ctx.close()

    # A huge link must be handled before constructing profile lists or starting a run.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    try:
        page = ctx.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_default_navigation_timeout(15000)
        query = urlencode({"set.reactor_count": "1000000000", "set.analyzer_count": "1000000000"})
        page.goto(f"{url}#/setup?{query}", wait_until="load")
        page.wait_for_selector('#main[data-ready="true"]', timeout=45000)
        for selector in ("#n", "#m"):
            page.wait_for_selector(selector, timeout=10000)
            if page.get_attribute(selector, "aria-invalid") != "true":
                problems.append(f"oversized setup: {selector} accepted")
        if page.locator('#run:not([disabled])').count():
            problems.append("oversized setup: Run enabled")
        if page.locator('[data-warn="integer"]').count() < 2:
            problems.append("oversized setup: processing limit not explained")
    except Exception as error:
        problems.append(f"oversized setup: {type(error).__name__}: {str(error).splitlines()[0]}")
    finally:
        ctx.close()

    # Deep nested JSON must be refused at the UI boundary and never sent to the Worker.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    try:
        ctx.add_init_script(TRACK_PLANT_POSTS)
        page = ctx.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.set_default_navigation_timeout(15000)
        query = urlencode({"actions": nested_actions()})
        page.goto(f"{url}#/plant?{query}", wait_until="load")
        page.wait_for_selector('#main[data-ready="true"]', timeout=45000)
        page.wait_for_selector('[data-link-note="actions"]', timeout=10000)
        page.wait_for_function("() => window.__qaPlantActions.length > 0", timeout=10000)
        sent = page.evaluate("() => window.__qaPlantActions")
        if any(actions for actions in sent):
            problems.append("nested actions: refused payload reached the Worker")
    except Exception as error:
        problems.append(f"nested actions: {type(error).__name__}: {str(error).splitlines()[0]}")
    finally:
        ctx.close()

    if page_errors:
        problems.append(f"page errors ({len(page_errors)}): {page_errors[0][:300]}")
    return Result("robust", not problems, "; ".join(problems) if problems else "worker 404 routes, silent worker, oversized setup and nested actions checked", {"problems": problems, "worker_404_requests": len(requests), "worker_assets": requests, "worker_states": worker_states, "page_errors": page_errors})
