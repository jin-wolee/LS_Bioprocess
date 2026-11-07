"""The browser half of the check `plant_tour` that walks the tour (docs/design/plant_ui.md sections 3.5 and 10, P8b): read what the host says at a step, hold it to the step the plan gives, look at the panel
it opens, its text, the card table and the verdict table, the requests the page sent, and take the screenshots. The pure rules are in qa_plant_tour_helpers.py. Each function takes a page and returns the
problems it found; none exits or prints.
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import first_line
from qa_infographic import CONTRAST_JS, contrast_rows
from qa_lab_browser import apply_state
from qa_lab_helpers import number_offenders
from qa_plant_a11y_helpers import contrast_problems, cover_problems, inside
from qa_plant_a11y_layout import RECT_JS
from qa_plant_browser import NUMBERS_IN_JS, plant_messages, settle, wait_scene
from qa_plant_helpers import clock_reading, plan_from_messages
from qa_plant_tour_helpers import ON_TARGET, STEP_IDS, TRACE, card_cells, centre_problems, expected_steps, step_problems, tour_sample, trace_problems, truth_request_problems, verdict_problems

STEP_JS = """() => { const d = document.querySelector('#plant').dataset;
  return {tour: d.plantTour ?? null, t: d.plantT, playing: d.plantPlaying, pick: d.plantPick ?? null, look: d.plantLook ?? null, ndc: d.plantLookNdc ? JSON.parse(d.plantLookNdc) : null, truth: d.plantTruth, epoch: d.plantEpoch}; }"""
SENT_JS = "window.__plantSent.filter((m) => m.type === 'plant_truth').map((m) => ({type: m.type, pick: m.pick}))"
# The sentence of the overlay's label in each language (plant_ui.md section 3.3), typed from the dictionaries.
LABEL = {"en": "Simulation's own view, not available to any record", "ko": "시뮬레이션 자체의 시점이며 어떤 기록에도 없는 정보"}
THEMES = [("light", "light", "light"), ("dark", "dark", "light")]
# The numbers of the offer and of the box, and of the record panel while one is open (the head of a column of the card table and the truth step open it; P9).
TOUR_SCOPE = ".plant-tour, [data-plant-record]"
PANELS = {"reactor": "[data-plant-panel=reactor]", "sample": "[data-plant-panel=sample]", "record": "[data-plant-record=ready]"}


def step_state(page) -> dict:
    return page.evaluate(STEP_JS)


def sent_truth(page) -> list[dict]:
    return page.evaluate(SENT_JS)


def settle_on_target(page, timeout: int = 10_000) -> None:
    """Wait until the camera has stopped easing toward the object a step brought it to (the place of its target is within a hair of the middle of the view)."""
    page.wait_for_function(f"() => {{ const n = document.querySelector('#plant').dataset.plantLookNdc; if (!n) return false; const [x, y] = JSON.parse(n); return Math.abs(x) < {ON_TARGET} && Math.abs(y) < {ON_TARGET}; }}", timeout=timeout)


LANDED_JS = """(w) => { const d = document.querySelector('#plant').dataset;
  return d.plantTour === w.id && d.plantT === String(w.t) && (d.plantPick ?? null) === (w.pick ?? null) && d.plantLook === w.look && d.plantTruth === w.truth; }"""  # wait_for_function hands a None to the page as undefined, not null


def wait_landed(page, want: dict, where: str) -> list[str]:
    """Wait until the step has landed: its id, the clock at its instant, the object picked, the camera brought to its frame and the overlay as the step says. The id shows as soon as the step is drawn and the
    rest follows it by a frame, so a check that read at once would read the step before. A step that never lands is the finding, with what differs."""
    try:
        page.wait_for_function(LANDED_JS, arg=want, timeout=30_000, polling=100)
    except Exception as e:  # noqa: BLE001 - the timeout is the finding
        return [f"{where}: the step never landed ({first_line(e)})"] + step_problems(step_state(page), want, where)
    return []


def landed_on(page, step_id: str) -> None:
    """Wait until a step is applied (its id, its instant from the trace, and the camera brought to something): the keys of the tour are taken from then on, so a check that pressed one the moment the step
    showed would press it before the tour listens."""
    t = {"draw": TRACE["drawn"], "feed": TRACE["feed"], "run": TRACE["run"], "records": TRACE["end"], "truth": TRACE["end"]}[step_id]
    page.wait_for_function("([id, t]) => { const d = document.querySelector('#plant').dataset; return d.plantTour === id && d.plantT === String(t) && !!d.plantLook; }", arg=[step_id, t], timeout=30_000, polling=100)


def tour_plan(page) -> dict | None:
    """The plan the page received for the epoch on screen, with the halls that arrived."""
    return plan_from_messages(plant_messages(page), int(step_state(page)["epoch"]))


def shoot(page, out: Path, name: str) -> None:
    """A screenshot of the plant as a reader sees it: the scene filling the view, the camera at rest."""
    page.evaluate("document.querySelector('.plant-wrap').scrollIntoView({block: 'start'})")
    settle(page, 2)
    (out / "tour").mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out / "tour" / name))


def number_problems(page, where: str) -> list[str]:
    """The figures of the box and the offer, and of the record panel when one is open: each sits inside a data-ref, data-result or data-label."""
    return [f"{where}: a number outside a data-ref, data-result or data-label: '{o['text']}' in {o['where']}" for o in number_offenders(page.evaluate(NUMBERS_IN_JS, TOUR_SCOPE))]


def sweep_problems(page, lang: str, where: str) -> list[str]:
    """The text on the page now, in light and in dark: no colour below AA, and no number outside a label (the box, the offer and the record panel when one is open)."""
    problems = number_problems(page, where)
    cells = []
    for label, theme, scheme in THEMES:
        page.emulate_media(color_scheme=scheme)
        apply_state(page, theme, lang)
        settle(page, 2)
        _, _, rows = contrast_rows(page.evaluate(CONTRAST_JS))
        cells.append({"cell": f"{where}/{label}", "low": [f"{r['ratio']:.2f} {r['sel']} '{r['text']}'" for r in sorted((r for r in rows if r["ratio"] < r["need"]), key=lambda r: r["ratio"])]})
    page.emulate_media(color_scheme="light")
    apply_state(page, "auto", lang)
    return problems + contrast_problems(cells)


def panel_problems(page, want: dict, where: str) -> list[str]:
    """The panel the step opens is on the page and no other: a reactor, a sample or the record of the sample; the steps of the halls have none."""
    problems = []
    for name, selector in PANELS.items():
        shown = page.query_selector(selector) is not None
        if shown != (want["panel"] == name):
            problems.append(f"{where}: the {name} panel is {'shown' if shown else 'not shown'}, the step {'opens' if want['panel'] == name else 'does not open'} it")
    return problems


def text_problems(page, want: dict, plan: dict, lang: str, where: str) -> list[str]:
    """The text of the step is in a polite live region, with its title and the figures of the plan as labels: the sample, the reactor, the analyzer and the clock reading of the step."""
    live = page.query_selector("[data-tour-live]")
    if live is None or live.get_attribute("aria-live") != "polite":
        return [f"{where}: the text of the step is not in a polite live region"]
    problems = []
    if page.query_selector(f"[data-tour-live] [data-i18n='plant.tour.{want['id']}.title']") is None:
        problems.append(f"{where}: the live region does not hold the title of the step")
    body = live.inner_text()
    s = tour_sample(plan)
    ids = {"draw": [s["id"], plan["units"][s["unit"]]["id"]], "feed": [s["id"], plan["units"][s["unit"]]["id"]], "run": [plan["analyzers"][s["analyzer"]]["id"]], "records": [s["id"]], "truth": [s["id"]]}[want["id"]]
    problems += [f"{where}: the text does not name {x}" for x in ids if x not in body]
    if want["id"] != "truth":
        day, time = clock_reading(want["t"])
        if time not in body or str(day) not in body:
            problems.append(f"{where}: the text does not read the instant as day {day} {time}")
    if lang == "ko" and not any("가" <= c <= "힣" for c in body):
        problems.append(f"{where}: the text is not in Korean")
    return problems


def table_problems(page, want: dict, plan: dict, where: str) -> list[str]:
    """Step 4 and 5: the card of the sample in each hall side by side, drawn from the plan (a stored slot or not, and the time the context was joined by)."""
    halls = page.evaluate("[...document.querySelectorAll('[data-tour-hall]')].map((e) => e.dataset.tourHall)")
    if halls != plan["layout"]["architectures"]:
        return [f"{where}: the card table has the halls {halls}, expected {plan['layout']['architectures']}"]
    problems = []
    for (hall, slot), (stored, basis) in card_cells(plan, tour_sample(plan)["index"]).items():
        cell = page.query_selector(f"[data-tour-slot='{hall}:{slot}']")
        got = None if cell is None else (cell.get_attribute("data-stored") == "1", (cell.query_selector("[data-tour-basis]") or cell).get_attribute("data-tour-basis"))
        if got != (stored, basis):
            problems.append(f"{where}: the cell {hall} {slot} is {got}, the plan's card says {(stored, basis)}")
    return problems[:4]


def verdict_table_problems(page, lang: str, where: str) -> list[str]:
    """Step 5: the verdict table is the overlay (marked, with the sentence of the label) and holds the nine verdicts of the trace."""
    page.wait_for_function("() => document.querySelectorAll('[data-tour-verdict]').length >= 9", timeout=30_000)
    got = page.evaluate("Object.fromEntries([...document.querySelectorAll('[data-tour-verdict]')].map((e) => [e.dataset.tourVerdict, e.dataset.verdict]))")
    problems = [f"{where}: {p}" for p in verdict_problems(got)]
    if LABEL[lang] not in page.inner_text("[data-tour-verdicts]"):
        problems.append(f"{where}: the verdict table does not carry the sentence of the label")
    return problems


def layout_problems(page, where: str) -> list[str]:
    """The box covers neither bar and the record panel beside it does not touch it; the box lies inside the plant's own box."""
    names = {"tour": "[data-tour=step]", "time": "[data-plant-time]", "bar": "[data-plant-bar=actions]", "record": "[data-plant-record]"}
    rects = {k: page.evaluate(RECT_JS, v) for k, v in names.items()}
    wrap = page.evaluate(RECT_JS, ".plant-wrap")
    pairs = [("tour", "time"), ("tour", "bar")] + ([("record", "tour")] if rects["record"] else [])
    problems = cover_problems(rects, pairs, where)
    if rects["tour"] and wrap and not inside(rects["tour"], {"x": wrap["x"], "y": wrap["y"], "w": wrap["w"], "h": wrap["h"]}):
        problems.append(f"{where}: the box runs outside the plant's box")
    return problems


def body_problems(page, where: str) -> list[str]:
    """The buttons of the box are in view: the box's body scrolls and the buttons do not, so the reader never has to scroll to find Next; and what the body holds fits, or is scrollable, in the box."""
    rects = {"box": page.evaluate(RECT_JS, "[data-tour=step]"), "buttons": page.evaluate(RECT_JS, ".plant-tour-buttons")}
    if rects["box"] is None or rects["buttons"] is None or not inside(rects["buttons"], rects["box"]):
        return [f"{where}: the buttons of the box are not inside the box {rects}"]
    return []


def open_record_problems(page, where: str) -> list[str]:
    """The head of a hall's column in the card table opens that hall's full record of the sample (one record panel at a time), and the lens goes there; the lens is put back for the steps after."""
    page.click("[data-tour-open=c_context]")
    try:
        page.wait_for_selector("[data-plant-record=ready][data-record-architecture=c_context]", timeout=15_000)
    except Exception as e:  # noqa: BLE001 - the timeout is the finding
        return [f"{where}: the head of the column of c_context did not open its record ({first_line(e)})"]
    problems = number_problems(page, f"{where}, the record opened from the card table")
    if page.get_attribute("[data-plant-record]", "data-record-sample") != TRACE["sample"]:
        problems.append(f"{where}: the record that opened is of {page.get_attribute('[data-plant-record]', 'data-record-sample')}, not of {TRACE['sample']}")
    if page.get_attribute("[data-lens-option=c_context]", "aria-pressed") != "true":
        problems.append(f"{where}: the lens did not go to the hall whose record was opened")
    page.click("[data-record=close]")
    page.wait_for_selector("[data-plant-record]", state="detached", timeout=10_000)
    page.click("[data-lens-option=a_manual]")
    return problems


def walk_tour(page, lang: str, out: Path, size: str, deep: bool) -> list[str]:
    """Take the tour from the step shown to the end with the Next button, holding each step to the plan; `deep` adds the contrast and the numbers, the layout, Back from the truth step by the buttons and the
    keys, and the state the plant is left in. Returns the problems."""
    problems: list[str] = []
    plan = want = None
    for i, step_id in enumerate(STEP_IDS):
        where = f"{lang} {size} step {i + 1} ({step_id})"
        page.wait_for_selector(f"#plant[data-plant-tour={step_id}]", timeout=60_000)
        if plan is None:
            wait_scene(page)
            plan = tour_plan(page)
            want = expected_steps(plan) if plan else []
            problems += trace_problems(want)
            if not want:
                return problems
        landed = wait_landed(page, want[i], where)
        if landed:
            return problems + landed
        settle_on_target(page)
        got = step_state(page)
        problems += step_problems(got, want[i], where) + centre_problems(got["ndc"], ON_TARGET, where) + panel_problems(page, want[i], where) + text_problems(page, want[i], plan, lang, where)
        if step_id == "records":
            problems += table_problems(page, want[i], plan, where)
        if step_id == "truth":
            if page.query_selector("[data-tour-table=cards]") is not None:
                problems.append(f"{where}: the card table is still on the page at the truth step (the verdict table takes its place)")
            page.wait_for_function("window.__plantSent.filter((m) => m.type === 'plant_truth').length >= 2", timeout=30_000)
            page.wait_for_selector("[data-plant-record=ready]", timeout=30_000)
            problems += verdict_table_problems(page, lang, where)
        problems += truth_request_problems(sent_truth(page), step_id)
        if page.query_selector("[data-tour-progress]") is None or len(page.query_selector_all("[data-tour-progress] [data-label]")) != 2:
            problems.append(f"{where}: the number of the step and the count of the steps are not two labels")
        settle_on_target(page)
        shoot(page, out, f"step{i + 1}_{step_id}_{size}_{lang}.png")
        if deep:
            problems += layout_problems(page, where)
            if step_id in ("records", "truth"):
                problems += sweep_problems(page, lang, where)
                problems += body_problems(page, where)
            if step_id == "records":
                problems += open_record_problems(page, where)
        if i < len(STEP_IDS) - 1:
            page.click("[data-tour-next]")
    return problems
