"""Check exception handling and the infographic/site QA report format."""
from __future__ import annotations

import json
from pathlib import Path

from qa_checks import Result, first_line


def guarded(name: str, fn) -> Result:
    try:
        return fn()
    except Exception as e:  # a crashed check is a failed check, not a crashed run
        return Result(name, False, f"crashed: {first_line(e)}")


def verdict(result: Result) -> str:
    """Report the existing result and metadata without changing its success value."""
    if not result.ok:
        return "FAIL"
    if result.data.get("skipped"):
        return "SKIP"
    if (result.data.get("qa_retry") or {}).get("flaky"):
        return "FLAKY"
    return "PASS"


def report(results: list[Result], out: Path, title: str) -> str:
    rows = [(f"{i} {r.name}", verdict(r), r.detail) for i, r in enumerate(results, 1)]
    width = max(len(r[0]) for r in rows)
    table = "\n".join(f"{n:<{width}}  {s}  {d}" for n, s, d in rows)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], indent=2, ensure_ascii=False), encoding="utf-8")
    md = "| check | result | detail |\n|---|---|---|\n" + "\n".join(f"| {n} | {s} | {d.replace('|', '/')} |" for n, s, d in rows)
    (out / "summary.md").write_text(f"# {title}\n\n{md}\n", encoding="utf-8")
    return table
