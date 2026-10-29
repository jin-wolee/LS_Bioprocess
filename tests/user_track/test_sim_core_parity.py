"""Acceptance test for the author's SimPy core loop, reference/sim_core.py (prompts/60_user_track.md, Card C).

Marker `user_track`: skipped, with a message, while reference/sim_core.py is absent. The test is written by the AI path and
never edited to make the author's code pass. It runs the loop on every trace and compares exactly on integer times:
- the 19 hand traces F1-F7 and variants (tests/fixtures/traces/) against the hand-typed expectation,
- the 20 parity traces (tests/golden/parity/) against the expected_result of the TS core.
"""
import json
import subprocess
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

pytestmark = pytest.mark.user_track

ROOT = Path(__file__).resolve().parents[2]
SIM_CORE = ROOT / "reference" / "sim_core.py"
HAND_TRACES = sorted((ROOT / "tests" / "fixtures" / "traces").glob("*.json"))
PARITY_TRACES = sorted((ROOT / "tests" / "golden" / "parity").glob("parity_*.json"))
HAND_FIXTURES = sorted((ROOT / "tests" / "fixtures" / "hand").glob("F*.json"))


def _validator() -> Draft202012Validator:
    schemas = {p.name: json.loads(p.read_text()) for p in (ROOT / "schemas").glob("*.schema.json")}
    registry = Registry().with_resources((name, Resource.from_contents(doc)) for name, doc in schemas.items())
    return Draft202012Validator(schemas["trace_result.schema.json"], registry=registry)


@pytest.fixture(scope="module")
def sim_core() -> Path:
    if not SIM_CORE.exists():
        pytest.skip("reference/sim_core.py is absent: the SimPy core loop is the author's Card C; this parity test runs once it exists")
    return SIM_CORE


def _run_loop(sim_core: Path, trace_path: Path, tmp_path: Path) -> dict:
    out = tmp_path / "result.json"
    done = subprocess.run(
        ["uv", "run", "python", str(sim_core), str(trace_path), str(out)],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, f"sim_core.py exited {done.returncode}\nstdout: {done.stdout}\nstderr: {done.stderr}"
    return json.loads(out.read_text())


def test_hand_traces_carry_the_hand_typed_expectation() -> None:
    """The expected_result of every hand trace is the `expected.runs` typed in tests/fixtures/hand (not engine output)."""
    expected = {}
    for path in HAND_FIXTURES:
        for case in json.loads(path.read_text())["cases"]:
            expected[case["case"]] = case["expected"]["runs"]
    assert len(expected) == len(HAND_TRACES) == 19
    for path in HAND_TRACES:
        trace = json.loads(path.read_text())
        assert trace["source"] == "hand"
        assert trace["expected_result"]["runs"] == expected[path.stem], path.name


@pytest.mark.parametrize("trace_path", HAND_TRACES + PARITY_TRACES, ids=lambda p: p.stem)
def test_loop_reproduces_expected_result(trace_path: Path, sim_core: Path, tmp_path: Path) -> None:
    trace = json.loads(trace_path.read_text())
    result = _run_loop(sim_core, trace_path, tmp_path)

    errors = sorted(_validator().iter_errors(result), key=lambda e: list(e.path))
    assert not errors, f"{trace_path.name}: output is not a valid trace_result: {errors[0].message}"
    assert result["engine_version"] == trace["engine_version"]
    assert result["seed"] == trace["seed"]
    # exact equality on integer times; runs are sorted by (start_s, analyzer, request_id, attempt)
    assert result["runs"] == trace["expected_result"]["runs"]
