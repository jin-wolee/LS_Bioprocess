"""The timing mode of the browser QA (P9, audit item 21; docs/design/lab_ui.md section 13).

The budgets of docs/design/plant_ui.md section 8 and docs/design/lab_ui.md section 12 were measured on the author's machine. A CI runner has a software renderer and shared CPUs, so the Pages workflow
runs the QA scripts with `--timing report`: a check that measures time (the lab's `time`, the plant's `plant_frames`, the round trip of `plant_action`, the times of a spec of `plant_sweep`) still takes its
numbers and prints them with their conditions, and a time over its limit is a note, "reported, not judged", and not a failure. A time that was not measured, too few frames and every check that does not
measure time fail as they always do. The default mode, `judge`, is the local gate's and is unchanged.

The mode is set once by the command line of a QA script (`set_mode`) before its checks run; a check asks `over_limit` what to do with the lines that say a time is over a limit.
"""
from __future__ import annotations

MODES = ("judge", "report")
_mode = {"name": "judge"}


def set_mode(name: str) -> None:
    if name not in MODES:
        raise ValueError(f"unknown timing mode {name!r} (modes: {', '.join(MODES)})")
    _mode["name"] = name


def set_report_only(on: bool) -> None:
    set_mode("report" if on else "judge")


def report_only() -> bool:
    return _mode["name"] == "report"


def over_limit(lines: list[str]) -> tuple[list[str], list[str]]:
    """(problems, notes) for the lines that say a time is over a limit: problems in the mode `judge`, notes in the mode `report`."""
    if not report_only():
        return list(lines), []
    return [], [f"reported, not judged (timing mode report): {line}" for line in lines]
