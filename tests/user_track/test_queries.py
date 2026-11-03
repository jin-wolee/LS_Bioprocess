"""Acceptance tests for the author's three SQL queries (docs/prompts/60_user_track.md, cards B1 to B3; data_model.md sections 5, 12 and 13).

Marker `user_track`: each test skips, with a message, while its query file under reference/sql/queries/ is absent. Written by the AI path against the contracts of the cards and never edited to make
the author's SQL pass. The schema is the author's reference/sql/schema.sql when it exists, otherwise the minimal fixture schema tests/fixtures/sql/fixture_schema.sql; fixtures insert with explicit
column lists, so both give the same names. Expected answers were computed by hand first and are in tests/fixtures/sql/expected_*.csv, with the arithmetic beside them.

Two kinds of check: the hand fixtures of the cards, and integration checks on the engine's recorded data (one scenario and seed, one noise-free fixture), loaded through a test-only dump
of canonical tables (engine/tests/support/sql_tables_cli.ts). The query parameters are DuckDB named parameters ($decision_time, $max_age_s, $root_id, $max_depth, ...).
"""
import csv
import json
import shutil
import subprocess
import threading
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import pytest

pytestmark = pytest.mark.user_track

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "reference" / "sql" / "schema.sql"
QUERIES = ROOT / "reference" / "sql" / "queries"
FIXTURES = ROOT / "tests" / "fixtures" / "sql"
DUMP_CLI = ROOT / "engine" / "tests" / "support" / "sql_tables_cli.ts"
LOAD_ORDER = ["unit", "operator", "batch", "method", "instrument", "instrument_state", "sample", "aliquot", "analysis_request", "run", "result", "historian_value"]
TIMEOUT_S = 30


# ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

def _query(name: str) -> str:
    path = QUERIES / name
    if not path.exists():
        pytest.skip(f"reference/sql/queries/{name} is absent: it is the author's card ({name}); this acceptance test runs once it exists")
    return path.read_text()


def _expected(name: str) -> list[dict[str, str]]:
    """An expected_*.csv: lines starting with # are the comment that shows the arithmetic."""
    lines = [line for line in (FIXTURES / name).read_text().splitlines() if line and not line.startswith("#")]
    return list(csv.DictReader(lines))


def _ts(text: str) -> datetime:
    return datetime.fromisoformat(text)


def _run(con: duckdb.DuckDBPyConnection, sql: str, params: dict) -> tuple[list[str], list[tuple]]:
    """Runs a query with named parameters; a query that does not finish in TIMEOUT_S seconds is interrupted and fails the test (a recursion that does not terminate)."""
    timer = threading.Timer(TIMEOUT_S, con.interrupt)
    timer.start()
    try:
        cursor = con.execute(sql, params)
        return [d[0] for d in cursor.description], cursor.fetchall()
    except duckdb.InterruptException:
        pytest.fail(f"the query did not finish within {TIMEOUT_S} s (a recursion that does not terminate?)")
    finally:
        timer.cancel()


def _rows(names: list[str], rows: list[tuple]) -> list[dict]:
    return [dict(zip(names, r)) for r in rows]


def _load_dump(con: duckdb.DuckDBPyConnection, directory: Path) -> None:
    for table in LOAD_ORDER:
        path = directory / f"{table}.csv"
        header = path.read_text().splitlines()[0] if path.exists() else ""
        if header and len(path.read_text().splitlines()) > 1:
            con.execute(f"COPY {table} ({header}) FROM '{path}' (HEADER true)")


@pytest.fixture
def con():
    connection = duckdb.connect(":memory:")
    connection.execute(SCHEMA.read_text() if SCHEMA.exists() else (FIXTURES / "fixture_schema.sql").read_text())
    yield connection
    connection.close()


def _dump(tmp_path_factory, which: str, query: str) -> Path:
    _query(query)  # skip first: no dump is made while the author's query is absent
    if shutil.which("node") is None:
        pytest.skip("node is not on the PATH: the engine dump of the integration checks cannot run")
    out = tmp_path_factory.mktemp(f"dump_{which}")
    # ADR-0016: the engine's Node flags (engine/tests/support/node_flags.ts); the CLI exits 2 without them, tests/test_node_flags.py checks this copy
    subprocess.run(["node", "--no-maglev-escape-analysis", str(DUMP_CLI), str(out), which], cwd=ROOT, check=True, capture_output=True, timeout=300)
    return out


@pytest.fixture(scope="module")
def scenario_dump(tmp_path_factory) -> Path:
    return _dump(tmp_path_factory, "scenario", "asof_join.sql")


@pytest.fixture(scope="module")
def sc4_dump(tmp_path_factory) -> Path:
    return _dump(tmp_path_factory, "sc4", "bridging_offset.sql")


# ---- Card B1: asof_join.sql -------------------------------------------------------------------------------------------------------------------------------------------------------

ASOF_COLUMNS = ["request_id", "analyte", "version", "tag", "ctx_ts", "ctx_value"]


def _asof_cases() -> list[tuple[str, int, list[dict[str, str]]]]:
    grouped: dict[tuple[str, int], list[dict[str, str]]] = defaultdict(list)
    for r in _expected("expected_asof_join.csv"):
        grouped[(r["decision_time"], int(r["max_age_s"]))].append(r)
    return [(d, m, rows) for (d, m), rows in grouped.items()]


@pytest.mark.parametrize("decision,max_age,expected", _asof_cases(), ids=[f"{d} max_age_s={m}" for d, m, _ in _asof_cases()])
def test_asof_join_hand_fixture(con, decision: str, max_age: int, expected: list[dict[str, str]]) -> None:
    sql = _query("asof_join.sql")
    con.execute((FIXTURES / "asof_join_fixture.sql").read_text())
    names, rows = _run(con, sql, {"decision_time": _ts(decision), "max_age_s": max_age})
    assert names == ASOF_COLUMNS, "the output columns of Card B1, in this order"
    got = {(r["request_id"], r["analyte"]): r for r in _rows(names, rows)}
    want = [r for r in expected if r["request_id"]]
    assert len(rows) == int(expected[0]["n_rows"]) == len(want), f"one row per (request_id, analyte) known at {decision} (and per tag of its unit)"
    for e in want:
        g = got[(e["request_id"], e["analyte"])]
        assert g["version"] == int(e["version"]), f"{e['request_id']}: the latest version with available_at <= {decision}"
        assert g["tag"] == e["tag"]
        if e["ctx_ts"] != "*":
            assert g["ctx_ts"] == (_ts(e["ctx_ts"]) if e["ctx_ts"] else None), f"{e['request_id']}: ctx_ts"
        assert g["ctx_value"] == (float(e["ctx_value"]) if e["ctx_value"] else None), f"{e['request_id']}: ctx_value"
    assert all(r["ctx_value"] != 5.0 for r in _rows(names, rows)), "5.0 is what a join on measured_at would return"


def test_asof_join_never_shows_a_future_version(con) -> None:
    sql = _query("asof_join.sql")
    con.execute((FIXTURES / "asof_join_fixture.sql").read_text())
    for decision in ("2030-01-07 09:30:00", "2030-01-07 10:29:59"):  # version 2 of RQ-1 is available at 10:30:00
        names, rows = _run(con, sql, {"decision_time": _ts(decision), "max_age_s": 3600})
        assert [r["version"] for r in _rows(names, rows) if r["request_id"] == "RQ-1"] == [1], f"at {decision} the correction is not yet available"


def test_asof_join_on_the_engine_export(con, scenario_dump: Path) -> None:
    """One scenario and seed (the default scenario at the small size, architecture C, released rows only): one row per result known at the decision time and per tag of its unit,
    no result version with available_at after the decision time, no historian row with ingested_at after it, and the context is the last historian row at or before sampled_at."""
    sql = _query("asof_join.sql")
    _load_dump(con, scenario_dump)
    decision = _ts(json.loads((scenario_dump / "facts.json").read_text())["anchor"]) + timedelta(days=4, hours=9)
    names, rows = _run(con, sql, {"decision_time": decision, "max_age_s": 10 * 86400})
    got = _rows(names, rows)

    # expected, computed in Python from the loaded tables (no SQL): the latest version per (request, analyte) with available_at <= decision, then one row per tag of the unit
    known: dict[tuple[str, str], tuple] = {}
    for rid, analyte, version, avail in con.execute("SELECT request_id, analyte, version, available_at FROM result").fetchall():
        if avail is not None and avail <= decision and ((rid, analyte) not in known or version > known[(rid, analyte)][0]):
            known[(rid, analyte)] = (version, avail)
    unit_of = {rid: u for rid, u in con.execute("SELECT r.request_id, s.unit_id FROM analysis_request r JOIN aliquot a ON a.aliquot_id = r.aliquot_id JOIN sample s ON s.sample_id = a.sample_id").fetchall()}
    sampled = {sid: t for sid, t in con.execute("SELECT s.sample_id, s.sampled_at FROM sample s").fetchall()}
    series: dict[str, list[tuple]] = defaultdict(list)
    for tag, ts, value, ing in con.execute("SELECT tag, ts, value, ingested_at FROM historian_value ORDER BY tag, ts").fetchall():
        series[tag].append((ts, value, ing))
    tags_of = {u: sorted(t for t in series if t.startswith(f"{u}.")) for u in set(unit_of.values())}
    assert known, "the decision time must lie inside the run"
    assert len(got) == sum(len(tags_of[unit_of[rid]]) for (rid, _a) in known), "one row per result known at the decision time and per tag of its unit"
    assert {(r["request_id"], r["analyte"]) for r in got} == set(known)
    for r in got:
        assert r["version"] == known[(r["request_id"], r["analyte"])][0], "the latest version known at the decision time"
        t = sampled[r["request_id"]]
        prior = [row for row in series[r["tag"]] if row[0] <= t and row[2] <= decision]
        assert r["ctx_ts"] == prior[-1][0] and r["ctx_value"] == prior[-1][1], f"{r['request_id']} {r['tag']}: the last row at or before sampled_at, ingested by the decision time"
        assert r["ctx_ts"] <= t


# ---- Card B2: lineage_recursive.sql -----------------------------------------------------------------------------------------------------------------------------------------------

def _lineage_cases() -> list[tuple[str, int, list[tuple[str, int]]]]:
    grouped: dict[tuple[str, int], list[tuple[str, int]]] = defaultdict(list)
    for r in _expected("expected_lineage.csv"):
        grouped[(r["fixture"], int(r["max_depth"]))].append((r["ancestor_id"], int(r["depth"])))
    return [(f, m, rows) for (f, m), rows in grouped.items()]


@pytest.mark.parametrize("fixture,max_depth,expected", _lineage_cases(), ids=[f"{f} max_depth={m}" for f, m, _ in _lineage_cases()])
def test_lineage_recursive_hand_fixture(con, fixture: str, max_depth: int, expected: list[tuple[str, int]]) -> None:
    sql = _query("lineage_recursive.sql")
    con.execute((FIXTURES / "lineage_fixture.sql").read_text())
    if fixture == "lineage_cycle":
        con.execute((FIXTURES / "lineage_cycle_edge.sql").read_text())  # the bad edge P2 > P1: the query must still terminate
    names, rows = _run(con, sql, {"root_id": "P2", "max_depth": max_depth})
    assert names == ["ancestor_id", "depth"], "the output columns of Card B2"
    assert [tuple(r) for r in rows] == expected, "one row per distinct ancestor at its minimum depth, ordered by depth, ancestor_id; the root is not its own ancestor"


# ---- Card B3: bridging_offset.sql -------------------------------------------------------------------------------------------------------------------------------------------------

BRIDGING_COLUMNS = ["request_id", "analyte", "version", "instrument_id", "value_raw", "offset_applied", "value_corrected", "n_controls"]
TOLERANCE = 1e-9


def _number(text: str) -> float | None:
    return float(text) if text else None


def _close(got: float | None, want: float | None, what: str) -> None:
    assert (got is None) == (want is None), f"{what}: NULL where a number is expected, or the other way round (got {got}, expected {want})"
    if want is not None:
        assert got == pytest.approx(want, abs=TOLERANCE), what


def test_bridging_offset_hand_fixture(con) -> None:
    sql = _query("bridging_offset.sql")
    con.execute((FIXTURES / "bridging_fixture.sql").read_text())
    names, rows = _run(con, sql, {"reference_instrument": "REF", "target_instrument": "TGT", "changeover_at": _ts("2030-01-10 00:00:00")})
    assert names == BRIDGING_COLUMNS, "the output columns of Card B3, in this order"
    got = {r["request_id"]: r for r in _rows(names, rows)}
    for e in _expected("expected_bridging.csv"):
        g = got[e["request_id"]]
        assert (g["analyte"], g["version"], g["instrument_id"]) == (e["analyte"], int(e["version"]), e["instrument_id"])
        _close(g["value_raw"], _number(e["value_raw"]), f"{e['request_id']} value_raw")
        _close(g["offset_applied"], _number(e["offset_applied"]), f"{e['request_id']} offset_applied")
        _close(g["value_corrected"], _number(e["value_corrected"]), f"{e['request_id']} value_corrected")
        if e["n_controls"] != "*":
            assert g["n_controls"] == int(e["n_controls"]), f"{e['request_id']} n_controls: the number of controls behind the offset"
    # a target result before the changeover (RQ-O3) and a reference result (RQ-O4) are unchanged: absent, or present with no correction
    for unchanged in ("RQ-O3", "RQ-O4"):
        if unchanged in got:
            assert got[unchanged]["offset_applied"] in (None, 0) or got[unchanged]["offset_applied"] == pytest.approx(0, abs=TOLERANCE), f"{unchanged} is not corrected"
            assert got[unchanged]["value_corrected"] in (None, got[unchanged]["value_raw"]), f"{unchanged} keeps its raw value"


def test_bridging_offset_recovers_the_injected_bias_exactly_on_sc4(con, sc4_dump: Path) -> None:
    """The noise-free SC4 fixture (engine/tests/sc04.test.ts, between analyzers): AN-2 reads the true value plus 0.5. The control pair CTL-1 (B1 on AN-1 reads 4.0, B2 on AN-2 reads 4.5) gives the offset, and
    the corrected AN-2 samples S3 and S4 equal their true values 4.0 and 5.0 exactly (every number is binary-exact, so the comparison has no tolerance)."""
    sql = _query("bridging_offset.sql")
    _load_dump(con, sc4_dump)
    facts = json.loads((sc4_dump / "facts.json").read_text())
    names, rows = _run(con, sql, {"reference_instrument": "AN-1", "target_instrument": "AN-2", "changeover_at": _ts(facts["anchor"])})
    got = {r["request_id"]: r for r in _rows(names, rows)}
    for sample in ("S3", "S4"):
        assert got[sample]["offset_applied"] == facts["injected_bias"], f"{sample}: the recovered offset is exactly the injected bias"
        assert got[sample]["value_corrected"] == facts["true_values"][sample], f"{sample}: the corrected value is the true value"
        assert got[sample]["n_controls"] == 1
    for sample in ("S1", "S2"):  # AN-1 is the reference instrument: unchanged, or absent
        assert sample not in got or got[sample]["value_corrected"] in (None, got[sample]["value_raw"])
