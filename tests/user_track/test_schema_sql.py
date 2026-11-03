"""Acceptance test for the author's canonical DDL, reference/sql/schema.sql (docs/prompts/60_user_track.md, Card A; data_model.md sections 4 and 13).

Marker `user_track`: skipped, with a message, while reference/sql/schema.sql is absent. Written by the AI path against the card's acceptance list
and never edited to make the author's DDL pass. DuckDB has no triggers, so the integrity rules are SELECTs of violating rows
(tests/fixtures/sql/integrity/): a good dataset returns no row, a bad dataset at least one, both loaded through the author's schema.
"""
import re
from pathlib import Path

import duckdb
import pytest

pytestmark = pytest.mark.user_track

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "reference" / "sql" / "schema.sql"
FIXTURES = ROOT / "tests" / "fixtures" / "sql"
INTEGRITY = FIXTURES / "integrity"

# Acceptance 2: the minimum names of Card A (tables and columns, data_model sections 2, 3 and 5).
REQUIRED = {
    "unit": ["unit_id", "unit_tag"],
    "batch": ["batch_id", "unit_id", "inoculated_at", "harvested_at"],
    "process_event": ["event_id", "batch_id", "unit_id", "type", "occurred_at"],
    "operator": ["operator_id"],
    "method": ["method_id", "version"],
    "sample": ["sample_id", "unit_id", "batch_id", "sampled_at", "operator_id", "volume_ul", "state"],
    "aliquot": ["aliquot_id", "sample_id", "volume_ul", "state"],
    "analysis_request": ["request_id", "aliquot_id", "method_id", "state", "control_id"],
    "instrument": ["instrument_id"],
    "instrument_state": ["instrument_state_id", "instrument_id", "valid_from", "reagent_lot", "calibration_ref"],
    "run": ["run_id", "instrument_id", "instrument_state_id", "method_id", "started_at", "ended_at", "operator_id"],
    "result": ["result_id", "request_id", "analyte", "version", "run_id", "value", "unit_ucum", "measured_at", "ingested_at", "reviewed_at", "available_at", "state"],
    "lineage_edge": ["edge_id", "from_item_id", "to_item_id", "relation", "occurred_at", "available_at"],
    "historian_value": ["tag", "ts", "value", "ingested_at"],
}
TIME_COLUMN_NAMES = {"ts", "valid_from", "valid_to"}
RESULT_COLUMNS = "result_id, request_id, analyte, version, run_id, value, unit_ucum, measured_at, ingested_at, reviewed_at, available_at, state"

# Acceptance 6: constructs that are not portable (DuckDB-only or Postgres-incompatible).
DENY = {
    "CREATE OR REPLACE": r"\bCREATE\s+OR\s+REPLACE\b",
    "INSTALL": r"\bINSTALL\b",
    "LOAD": r"\bLOAD\b",
    "STRUCT": r"\bSTRUCT\b",
    "MAP(": r"\bMAP\s*\(",
    "LIST(": r"\bLIST\s*\(",
    "array type []": r"\w\s*\[\s*\]",
    "ENUM(": r"\bENUM\s*\(",
    "UNION(": r"\bUNION\s*\(",
    "USING SAMPLE": r"\bUSING\s+SAMPLE\b",
}

# Acceptance 7: (check id, check query, bad-data script). K5, K8 and K13 compare snapshots taken after the good dataset loaded.
CHECKS = [
    ("K5", "k5_sample_keys.sql", "bad_k5.sql"),
    ("K6", "k6_two_open_batches.sql", "bad_k6.sql"),
    ("K7", "k7_run_overlap.sql", "bad_k7.sql"),
    ("K8", "k8_released_result_mutated.sql", "bad_k8.sql"),
    ("K10", "k10_lineage_cycle.sql", "bad_k10.sql"),
    ("K12", "k12_aliquot_volume.sql", "bad_k12.sql"),
    ("K13", "k13_method_mutated.sql", "bad_k13.sql"),
]
SNAPSHOT_TABLES = ["sample", "result", "method"]


@pytest.fixture(scope="module")
def schema_text() -> str:
    if not SCHEMA.exists():
        pytest.skip("reference/sql/schema.sql is absent: the canonical DDL is the author's Card A; this acceptance test runs once it exists")
    return SCHEMA.read_text()


@pytest.fixture
def con(schema_text: str):
    connection = duckdb.connect(":memory:")
    connection.execute(schema_text)  # acceptance 1: executes cleanly in in-memory DuckDB
    yield connection
    connection.close()


def _columns(connection) -> dict[str, dict[str, str]]:
    rows = connection.execute("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main'").fetchall()
    out: dict[str, dict[str, str]] = {}
    for table, column, data_type in rows:
        out.setdefault(table, {})[column] = data_type
    return out


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", sql)


def test_schema_executes_cleanly_in_memory_duckdb(con) -> None:
    assert _columns(con), "the schema created no table"


def test_required_tables_and_columns_exist(con) -> None:
    have = _columns(con)
    missing = [f"{t}.{c}" for t, cols in REQUIRED.items() for c in cols if c not in have.get(t, {})]
    assert not missing, f"missing names required by Card A: {missing}"
    assert "unit_tag" in have["unit"] and "unit_tag" not in have, "unit_tag is a column of unit, not a table"


def test_duplicate_result_version_is_rejected(con) -> None:
    con.execute((FIXTURES / "single_sample.sql").read_text())
    with pytest.raises(duckdb.Error):
        con.execute(
            f"INSERT INTO result ({RESULT_COLUMNS}) "
            "VALUES ('RES-DUP', 'RQ-1', 'glucose', 1, 'RUN-1', 4.3, 'g/L', TIMESTAMP '2030-01-07 09:25:00', "
            "TIMESTAMP '2030-01-07 09:25:30', NULL, TIMESTAMP '2030-01-07 09:30:00', 'measured')"
        )


@pytest.mark.parametrize("column", ["run_id", "measured_at"])
def test_result_without_run_or_measured_time_is_rejected(con, column: str) -> None:
    con.execute((FIXTURES / "single_sample.sql").read_text())
    values = {"run_id": "'RUN-1'", "measured_at": "TIMESTAMP '2030-01-07 09:25:00'"}
    values[column] = "NULL"
    with pytest.raises(duckdb.Error):
        con.execute(
            f"INSERT INTO result ({RESULT_COLUMNS}) "
            f"VALUES ('RES-NULL', 'RQ-1', 'glucose', 2, {values['run_id']}, 4.3, 'g/L', {values['measured_at']}, "
            "TIMESTAMP '2030-01-07 09:25:30', NULL, TIMESTAMP '2030-01-07 09:30:00', 'measured')"
        )


def test_sampled_at_exists_only_on_sample_and_time_columns_are_timestamps(con) -> None:
    have = _columns(con)
    assert [t for t, cols in have.items() if "sampled_at" in cols] == ["sample"]
    wrong = [
        f"{t}.{c}: {dtype}"
        for t, cols in have.items()
        for c, dtype in cols.items()
        if (c.endswith("_at") or c in TIME_COLUMN_NAMES) and not dtype.startswith("TIMESTAMP")
    ]
    assert not wrong, f"time columns that are not TIMESTAMP-typed: {wrong}"


def test_single_sample_fixture_loads_with_explicit_column_lists(con) -> None:
    con.execute((FIXTURES / "single_sample.sql").read_text())
    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ["unit", "sample", "aliquot", "run", "result", "historian_value", "lineage_edge"]}
    assert counts == {"unit": 1, "sample": 1, "aliquot": 1, "run": 1, "result": 1, "historian_value": 2, "lineage_edge": 2}


def test_schema_uses_no_deny_listed_construct(schema_text: str) -> None:
    code = _strip_comments(schema_text)
    hits = [name for name, pattern in DENY.items() if re.search(pattern, code, flags=re.I)]
    assert not hits, f"non-portable constructs in reference/sql/schema.sql: {hits}"


def _load_good_with_snapshots(connection) -> None:
    connection.execute((INTEGRITY / "good.sql").read_text())
    for table in SNAPSHOT_TABLES:
        connection.execute(f"CREATE TABLE before_{table} AS SELECT * FROM {table}")


@pytest.mark.parametrize("check_id,check_file,bad_file", CHECKS, ids=[c[0] for c in CHECKS])
def test_integrity_check_is_silent_on_good_data(con, check_id: str, check_file: str, bad_file: str) -> None:
    _load_good_with_snapshots(con)
    assert con.execute((INTEGRITY / check_file).read_text()).fetchall() == [], f"{check_id} flags the good dataset"


@pytest.mark.parametrize("check_id,check_file,bad_file", CHECKS, ids=[c[0] for c in CHECKS])
def test_integrity_check_flags_bad_data(con, check_id: str, check_file: str, bad_file: str) -> None:
    _load_good_with_snapshots(con)
    con.execute((INTEGRITY / bad_file).read_text())  # the recorded world must be able to hold wrong data so it can be detected
    assert con.execute((INTEGRITY / check_file).read_text()).fetchall(), f"{check_id} misses the bad dataset"
