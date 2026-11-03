"""Browser plumbing of the checks of the operator actions (docs/design/plant_ui.md section 10, P6a): the form of an action opened and sent by the keyboard, the waits for the answer of the Worker, the
undo, the messages of an epoch, and the script that times the round trip. The page ships no test global: the state is read from the attributes of the plant host and the only instruments are scripts that
this module injects into its own browser context. A function takes a page and returns or raises; it never exits or prints.
"""
from __future__ import annotations

from qa_plant_browser import plant_messages, state

# Times the action round trip (docs/design/plant_ui.md section 8): from the click on Apply (or on an Undo) to the first frame of the new plan, which is the first write of `data-plant-calls` by the new scene: after
# the epoch of the host has changed and the scene of the host has been made again (`data-plant-scene` goes to loading and back to ready; the scene of the old plan may still write once before that), on the next
# animation frame. Every time goes to window.__rt, and the instant of each click to window.__t0s. The page ships none of it.
ROUND_TRIP_JS = """(() => {
  window.__rt = [];
  window.__t0s = [];
  let t0 = 0, epoch0 = null, waiting = false, phase = 0;
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-act-apply],[data-undo]')) { t0 = performance.now(); window.__t0s.push(t0); epoch0 = document.querySelector('#plant').dataset.plantEpoch; waiting = true; phase = 0; }
  }, true);
  new MutationObserver((records) => {
    for (const r of records) {
      if (!waiting) return;
      const host = r.target;
      if (r.attributeName === 'data-plant-epoch' && host.dataset.plantEpoch !== epoch0) phase = 1;
      else if (r.attributeName === 'data-plant-scene' && phase >= 1 && host.dataset.plantScene === 'ready') phase = 2;
      else if (r.attributeName === 'data-plant-calls' && phase === 2) { waiting = false; const start = t0; requestAnimationFrame(() => window.__rt.push(performance.now() - start)); }
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-plant-calls', 'data-plant-epoch', 'data-plant-scene'] });
})();"""

SEEK_TIMEOUT = 15_000
RUN_TIMEOUT = 180_000


def act_state(page) -> dict:
    """The attributes the operator actions add to the plant host, with the epoch and the hashes."""
    s = state(page)
    return {**s, "actions": page.get_attribute("#plant", "data-plant-actions"), "recomputing": page.get_attribute("#plant", "data-plant-recomputing"), "hash": page.evaluate("location.hash")}


def runs_sent(page) -> int:
    """How many `plant_run` requests the page has sent: the epoch of the newest, since the epoch grows with every request, a refused one included."""
    return page.evaluate("window.__plantSent.filter((m) => m.type === 'plant_run').length")


def open_form(page, kind: str) -> None:
    """Open the form of an action as a keyboard user does: the focus on its button (the overflow first for the three optional ones), Enter, and wait for the form."""
    if kind in ("raise_alarm", "change_lot", "set_labelling"):
        page.focus("[data-action=more]")
        page.keyboard.press("Enter")
        page.wait_for_selector("#plant-bar-more", timeout=SEEK_TIMEOUT)
    page.focus(f"[data-action={kind}]")
    page.keyboard.press("Enter")
    page.wait_for_selector(f"[data-action-form={kind}]", timeout=SEEK_TIMEOUT)


def fill_form(page, fields: dict[str, str], row: str | None = None) -> None:
    """Fill the controls of the open form by their names (a select by its value, an input by typing) and pick a row of the sampling board when one is named."""
    if row is not None:
        page.click(f"[data-board-row='{row}']")
    for name, value in fields.items():
        control = page.locator(f"[data-action-form] [name={name}]")
        if control.evaluate("e => e.tagName") == "SELECT":
            control.select_option(value)
        else:
            control.fill(value)


def apply(page) -> None:
    """Send the action as a keyboard user does: the focus on Apply and Enter."""
    page.focus("[data-act-apply]")
    page.keyboard.press("Enter")


def wait_epoch(page, epoch: int, halls: int = 3) -> None:
    """Wait until the plan of that epoch is on screen and drawn, nothing is recomputing and every hall of it has arrived."""
    page.wait_for_function(
        "([e, n]) => { const h = document.querySelector('#plant'); if (!h || h.dataset.plantEpoch !== String(e) || h.dataset.plantRecomputing || h.dataset.plantScene !== 'ready') return false; "
        "try { return Object.keys(JSON.parse(h.dataset.cellsHash)).length >= n; } catch (err) { return false; } }",
        arg=[epoch, halls], timeout=RUN_TIMEOUT,
    )


def wait_refusal(page) -> dict:
    """Wait for the refusal block of the form: its reason (`data-plant-refusal`), its text and the message of the Worker it shows."""
    page.wait_for_selector("[data-plant-refusal]", timeout=RUN_TIMEOUT)
    return refusal(page)


def refusal(page) -> dict:
    return page.evaluate("() => { const e = document.querySelector('[data-plant-refusal]'); return e ? {reason: e.dataset.plantRefusal, text: e.innerText, message: (e.querySelector('code') || {innerText: ''}).innerText} : null; }")


def ready_of(page, epoch: int) -> dict | None:
    """The `plant_ready` message the Worker sent for an epoch (the recorder of the Worker's messages must be in the page)."""
    return next((m["data"] for m in plant_messages(page) if m["data"]["type"] == "plant_ready" and m["data"]["epoch"] == epoch), None)


def list_items(page) -> list[dict]:
    """The actions in the list of the HUD: the kind of each and its sentence."""
    return page.eval_on_selector_all("[data-action-item]", "els => els.map((e) => ({kind: e.dataset.actionItem, text: e.innerText}))")


def undo(page, index: int = 0) -> None:
    """Undo an action of the list by the keyboard."""
    page.focus(f"[data-act-list] li:nth-child({index + 1}) [data-undo]")
    page.keyboard.press("Enter")


def bring_bar_into_view(page) -> None:
    """The scene fills the window and the bar sits at its foot: scroll the plant to the bottom of the window, as a reader does, before a screenshot of the bar."""
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'end'})")
    page.wait_for_timeout(250)
