"""Pure helpers of the check `plant_a11y` of the headless QA of the plant (docs/design/plant_ui.md section 10, P8a): who covers whom, how many presses of Tab a path took, what the optional hum did, what
reduced motion changed and how much of the plant the chrome leaves free. No browser here, so pytest runs them (tests/test_qa_plant_a11y.py); the check that drives the page is in qa_plant_a11y.py.
"""
from __future__ import annotations

# The most presses of Tab that a path may take: from the top of the page to the objects list (the top bar, the HUD, the clock and the bar come first), and from the panel to the button of an action.
TABS_TO_LIST = 120
TABS_TO_BUTTON = 60
# The plant's own box that the chrome (cards, panel, stack) may leave free at 390 by 844 in its default state: at least half (P8a, the audit's item 26).
FLOOR_MIN = 0.5
# The scene is kept this close to the middle of the view (device coordinates, -1 to 1) by a follow that cuts, within a few frames of a step under reduced motion.
FOLLOW_CENTRE = 0.3


def overlaps(a: dict, b: dict, slack: float = 0.5) -> bool:
    """Whether two rectangles `{x, y, w, h}` share an area (touching, or within `slack` pixels of it, does not count)."""
    return a["x"] + slack < b["x"] + b["w"] and b["x"] + slack < a["x"] + a["w"] and a["y"] + slack < b["y"] + b["h"] and b["y"] + slack < a["y"] + a["h"]


def inside(inner: dict, outer: dict, slack: float = 1.0) -> bool:
    """Whether `inner` lies in `outer`, give or take `slack` pixels (a box whose content is cut at its edge is not inside)."""
    return inner["x"] >= outer["x"] - slack and inner["y"] >= outer["y"] - slack and inner["x"] + inner["w"] <= outer["x"] + outer["w"] + slack and inner["y"] + inner["h"] <= outer["y"] + outer["h"] + slack


def cover_problems(rects: dict, pairs: list[tuple[str, str]], where: str) -> list[str]:
    """Each pair of named rectangles must not overlap; a name with no rectangle (the element is not there or not shown) is a problem of its own."""
    problems = [f"{where}: {name} has no box" for name in sorted({n for p in pairs for n in p}) if rects.get(name) is None]
    return problems + [f"{where}: {a} covers {b}" for a, b in pairs if rects.get(a) and rects.get(b) and overlaps(rects[a], rects[b])]


def cut_problems(item_rects: list[dict], box: dict | None, what: str) -> list[str]:
    """Every item of a list must lie in the box that holds it, whole (the third item of the list of actions was cut at the foot of its box)."""
    if box is None:
        return [f"{what}: the box has no rectangle"]
    return [f"{what}: item {i} is cut by its box" for i, r in enumerate(item_rects, 1) if not inside(r, box)]


def tab_problems(presses: int | None, limit: int, target: str) -> list[str]:
    """The path reached its target by Tab alone, in at most `limit` presses."""
    if presses is None:
        return [f"{target} was not reached by Tab in {limit} presses"]
    return [] if presses <= limit else [f"{target} took {presses} presses of Tab, over {limit}"]


def hum_problems(made_before: int, pressed_before: bool, made_after: int, pressed_after: bool, stored: str | None, made_reload: int, pressed_reload: bool, made_gesture: int) -> list[str]:
    """The room hum is off until the reader turns it on, the press makes one audio context and is kept, and a visit that finds it on makes none until a gesture."""
    problems = []
    if made_before != 0 or pressed_before:
        problems.append(f"the hum was on before the reader asked: {made_before} audio contexts made, pressed {pressed_before}")
    if made_after != 1 or not pressed_after:
        problems.append(f"turning the hum on made {made_after} audio contexts and left it pressed {pressed_after}, expected 1 and True")
    if stored != "on":
        problems.append(f"the choice was kept as {stored!r}, expected 'on'")
    if made_reload != 0 or not pressed_reload:
        problems.append(f"a visit that finds the hum on made {made_reload} audio contexts before any gesture and shows it pressed {pressed_reload}, expected 0 and True")
    if made_gesture != 1:
        problems.append(f"the first gesture of that visit made {made_gesture} audio contexts, expected 1")
    return problems


def reduced_problems(reduced: dict, normal: dict) -> list[str]:
    """What reduced motion changes, from two pages given the same link: the clock starts paused and stays at its instant (the other plays on), the turning ring is not drawn (the other animates), and a follow
    cuts to the tube at a step (its place on the screen is near the middle at once)."""
    problems = []
    if reduced["playing"] != "false" or reduced["t_after"] != reduced["t_before"]:
        problems.append(f"under reduced motion the clock plays: playing {reduced['playing']}, {reduced['t_before']} to {reduced['t_after']}")
    if normal["playing"] != "true" or normal["t_after"] == normal["t_before"]:
        problems.append(f"without the preference the clock does not play (the control of the check): playing {normal['playing']}, {normal['t_before']} to {normal['t_after']}")
    if reduced["ring_display"] != "none":
        problems.append(f"the turning ring is drawn under reduced motion (display {reduced['ring_display']})")
    if normal["ring_animation"] in ("", "none"):
        problems.append("without the preference the ring does not turn (the control of the check)")
    x, y = reduced["follow_ndc"]
    if abs(x) > FOLLOW_CENTRE or abs(y) > FOLLOW_CENTRE:
        problems.append(f"under reduced motion the followed tube is at ({x:.2f}, {y:.2f}) three frames after a step: the camera glides instead of cutting")
    return problems


def share_problems(covered: list[bool], limit: float = FLOOR_MIN) -> list[str]:
    """The share of the sample points of the plant's box that no card, panel or bar covers must be at least `limit`."""
    if not covered:
        return ["no point of the plant was sampled"]
    free = covered.count(False) / len(covered)
    return [] if free >= limit else [f"the chrome leaves {free:.0%} of the plant free, under the {limit:.0%} it must"]


def contrast_problems(cells: list[dict]) -> list[str]:
    """Each cell of the sweep (a theme, a language, a state of the page) has no text colour below its AA ratio."""
    return [f"{c['cell']}: {len(c['low'])} text colours below AA, worst {c['low'][0]}" for c in cells if c["low"]]
