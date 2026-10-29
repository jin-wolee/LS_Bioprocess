"""Tests of docs/design/data_dictionary.yaml (prompts/20 Step 9; data_model.md sections 6 and 9).

The dictionary is read with PyYAML (already a dependency, as for the ledgers); the engine side is the output of engine/tests/support/dictionary_cli.ts: the recorders, the validation rules,
the review step and the export run on hand-built streams under every architecture and on the default scenario at the small size. Expected sets that are typed here are typed by hand from the
design (the state diagrams of data_model section 6 and the review step of section 7), never copied from the output they check.
"""
import json
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
DICTIONARY = ROOT / "docs" / "design" / "data_dictionary.yaml"
CLI = ROOT / "engine" / "tests" / "support" / "dictionary_cli.ts"

COLUMN_KEYS = {"name", "type", "nullable", "unit", "values", "time", "visibility", "default", "description"}
OPTIONAL_KEYS = {"unit_by", "unit_map"}
TYPES = {"string", "integer", "number", "boolean", "array", "object"}
UCUM = {"s", "uL", "g/L", "mmol/L", "10*6/mL", "%", "[pH]", "Cel", "L"}  # the codes of data_model section 9 and the units of the profile settings
ROLES_OF_SECTION_6 = {"sampler", "analyst", "reviewer", "approver", "administrator"}


@pytest.fixture(scope="module")
def d() -> dict:
    return yaml.safe_load(DICTIONARY.read_text())


@pytest.fixture(scope="module")
def engine() -> dict:
    out = subprocess.run(["node", str(CLI)], cwd=ROOT, check=True, capture_output=True, text=True, timeout=300).stdout
    return json.loads(out)


def columns(d: dict, entity: str) -> dict[str, dict]:
    return {c["name"]: c for c in d["entities"][entity]["columns"]}


def emitted(d: dict) -> list[str]:
    return [e for e, v in d["entities"].items() if v["emitted"] and v["columns"]]


# ---- the shape of the dictionary --------------------------------------------------------------------------------------------------------------------------------------------------

def test_every_column_has_the_attributes_of_section_9(d: dict) -> None:
    names = set()
    for entity, spec in d["entities"].items():
        seen = set()
        for c in spec["columns"]:
            where = f"{entity}.{c.get('name')}"
            assert COLUMN_KEYS <= set(c) <= COLUMN_KEYS | OPTIONAL_KEYS, f"{where}: attributes {sorted(set(c) ^ COLUMN_KEYS)}"
            assert c["name"] not in seen, f"{where} is listed twice"
            seen.add(c["name"])
            names.add(c["name"])
            assert c["type"] in TYPES, where
            assert isinstance(c["nullable"], bool), where
            assert c["unit"] is None or c["unit"] in UCUM, f"{where}: unit {c['unit']!r} is not a UCUM code of the dictionary"
            assert c["time"] in {"valid", "transaction", "neither"}, where
            assert c["visibility"] in {"observable", "hidden"}, where
            assert c["values"] is None or isinstance(c["values"], list) or set(c["values"]) <= {"min", "max"}, where
            assert c["default"] is None or set(c["default"]) == {"value", "ledger"}, where
            assert c["description"].strip(), where
            if c["time"] != "neither":
                assert c["unit"] == "s", f"{where}: a time column holds integer seconds"
            for code in (c.get("unit_map") or {}).values():
                assert code in UCUM, where
    for spec in d["entities"].values():
        for c in spec["columns"]:
            assert "unit_by" not in c or c["unit_by"] in names, f"{c['name']}: unit_by names no column"


def test_hidden_columns_are_exactly_the_hidden_fields_of_the_event_schema(d: dict) -> None:
    schema = json.loads((ROOT / "schemas" / "event.schema.json").read_text())
    annotated = {(event, field) for event, body in schema["$defs"].items() for field, spec in body.get("properties", {}).items() if spec.get("x-visibility") == "hidden"}
    in_dictionary = {(entity.removeprefix("truth_"), c["name"]) for entity, spec in d["entities"].items() if entity.startswith("truth_") and entity != "truth_operator" for c in spec["columns"] if c["visibility"] == "hidden"}
    assert in_dictionary == annotated
    for entity, spec in d["entities"].items():
        assert all((c["visibility"] == "hidden") == entity.startswith("truth_") for c in spec["columns"]), f"{entity}: visibility follows the truth_ prefix"


def test_analytes_master_data_is_the_unit_table_of_the_export(d: dict, engine: dict) -> None:
    assert {a: v["unit"] for a, v in d["analytes"].items()} == engine["analyte_units"]
    assert set(columns(d, "result")["analyte"]["values"]) == set(d["analytes"])


def test_the_controller_side_of_the_raw_layer_is_described_as_entries_and_the_rest_stays_a_marked_placeholder(d: dict, engine: dict) -> None:
    # S2e2 (data_model sections 16.4 and 16.5): alarm_event, batch_phase_record and the layer-on historian_value are entries with a state machine each. What no run emits yet (the columns of
    # section 16.2 below) stays a placeholder and is not an entry: none of those columns is listed in an entity, and none was emitted by any run
    assert {"alarm_event", "batch_phase_record", "historian_value"} <= set(d["entities"])
    assert all(d["entities"][e]["emitted"] for e in ("alarm_event", "batch_phase_record", "historian_value"))
    assert {"alarm_event", "batch_phase_record"} <= set(d["state_machines"])
    assert d["raw_layer"]["status"] == "placeholder"
    assert set(d["raw_layer"]["new_columns"]) == {"result.range_flag", "run.started_at_derived", "instrument.adapter_id", "unit.controller_adapter_id"}
    for qualified in d["raw_layer"]["new_columns"]:
        entity, name = qualified.split(".")
        assert name not in columns(d, entity) if entity in d["entities"] else True, qualified
    assert "raw_ref" in columns(d, "historian_value")  # the one column of the old placeholder that S2e2 emits


def test_the_controller_entities_are_what_the_adapter_parsed(d: dict, engine: dict) -> None:
    assert engine["tables"]["historian_value"]["raw_ref"]["types"] == ["object"]
    assert set(columns(d, "adapter")["device_class"]["values"]) == {"analyzer", "controller"}
    assert {"ctrl_neutral", "ctrl_bench"} <= set(columns(d, "adapter")["dialect_id"]["values"])
    assert {"tag_value", "alarm_transition", "phase_transition"} <= set(columns(d, "raw_record")["record_kind"]["values"])
    assert "unknown_name" in columns(d, "parse_error")["code"]["values"]
    # both families land in the canonical form unit_tag.signal.role (data_model 16.4); the historian carries no other form with the layer on
    assert engine["tables"]["historian_value"]["tag"]["types"] == ["string"]


def test_the_analyzer_side_of_the_raw_layer_is_described_as_entries(d: dict) -> None:
    assert {"adapter", "raw_file", "raw_record", "parse_error"} <= set(d["entities"])  # data_model section 16.1
    assert all(d["entities"][e]["emitted"] for e in ("adapter", "raw_file", "raw_record", "parse_error"))
    assert {"capture_path", "entered_by", "raw_ref", "unit_original", "unit_ucum", "dilution_factor", "time_resolution_s"} <= set(columns(d, "result"))  # data_model section 16.2
    assert set(columns(d, "result")["capture_path"]["values"]) == {"manual_transcription", "adapter_ingest"}
    assert set(d["dataset"]["other"]) >= {"capture", "raw"}


# ---- what the engine emits is in the dictionary -----------------------------------------------------------------------------------------------------------------------------------

OBSERVED_AS = {"integer": {"integer"}, "number": {"integer", "number"}, "string": {"string"}, "boolean": {"boolean"}, "array": {"array"}, "object": {"object"}}


def test_every_column_the_recorders_and_the_export_emit_exists_with_matching_type_nullability_and_values(d: dict, engine: dict) -> None:
    for entity in emitted(d):
        assert entity in engine["tables"], f"{entity}: listed as emitted but no run produced a row"
        got = engine["tables"][entity]
        want = columns(d, entity)
        assert set(got) <= set(want), f"{entity}: emitted columns missing from the dictionary: {sorted(set(got) - set(want))}"
        assert set(want) <= set(got), f"{entity}: dictionary columns that no run emitted: {sorted(set(want) - set(got))}"
        for name, seen in got.items():
            col = want[name]
            non_null = set(seen["types"]) - {"null"}
            assert non_null <= OBSERVED_AS[col["type"]], f"{entity}.{name}: emitted {sorted(non_null)}, dictionary says {col['type']}"
            assert "null" not in seen["types"] or col["nullable"], f"{entity}.{name}: a null was emitted, the dictionary says not nullable"
            if isinstance(col["values"], list) and seen["values"]:
                assert set(seen["values"]) <= set(col["values"]), f"{entity}.{name}: emitted values outside the allowed list: {sorted(set(seen['values']) - set(col['values']))}"


def test_the_recorded_dataset_has_no_member_the_dictionary_does_not_know(d: dict, engine: dict) -> None:
    assert set(engine["tables"]["dataset"]) == set(d["dataset"]["tables"]) | set(d["dataset"]["other"])
    assert all(t in d["entities"] and d["entities"][t]["emitted"] for t in d["dataset"]["tables"])


def test_the_export_table_schema_is_the_export_entity(d: dict, engine: dict) -> None:
    code = engine["export_fields"]
    spec = d["entities"]["export_result"]["columns"]
    assert [c["name"] for c in spec] == [f["name"] for f in code]
    for c, f in zip(spec, code, strict=True):
        assert c["type"] == f["type"], c["name"]
        assert c["nullable"] == (not f["required"]), c["name"]
        assert c["unit"] == f.get("ucum"), c["name"]
        assert c.get("unit_by") == f.get("ucum_column"), c["name"]


# ---- no hidden column in any recorded or exported output -------------------------------------------------------------------------------------------------------------------------

def test_no_hidden_column_appears_in_any_recorded_or_exported_output(d: dict, engine: dict) -> None:
    hidden = {c["name"] for e, spec in d["entities"].items() if e.startswith("truth_") for c in spec["columns"]}
    observable = {c["name"] for e, spec in d["entities"].items() if not e.startswith("truth_") for c in spec["columns"]}
    assert not (hidden - observable) & set(engine["keys"]), f"a hidden field occurs in recorded or exported output: {sorted((hidden - observable) & set(engine['keys']))}"
    # a name that is hidden on the truth side and observable on the recorded side (qualified) may occur only in the entities that declare it observable
    for name in hidden & observable:
        holders = {e for e, spec in d["entities"].items() if not e.startswith("truth_") for c in spec["columns"] if c["name"] == name}
        assert {t for t, cols in engine["tables"].items() if name in cols and t != "dataset"} <= holders, f"{name}: a hidden name occurs in a table that does not declare it observable"


# ---- state machines ------------------------------------------------------------------------------------------------------------------------------------------------------------------------

def test_the_state_machines_are_well_formed(d: dict) -> None:
    roles = set(d["roles"])
    assert ROLES_OF_SECTION_6 <= roles and roles - ROLES_OF_SECTION_6 == {"rule"}, "the five roles of data_model section 6 and the automatic actor kind of S2d"
    for entity, m in d["state_machines"].items():
        states = set(columns(d, entity)[m.get("state_column", "state")]["values"])  # the controller records keep the state of an instance in to_state (S2e2)
        edges = [(t["from"], t["to"]) for t in m["transitions"]]
        assert len(edges) == len(set(edges)), f"{entity}: a transition is listed twice"
        assert {s for e in edges for s in e} == states, f"{entity}: the states of the transitions are exactly the allowed values of the state column"
        assert m["initial"] in states and set(m["terminal"]) <= states
        assert not [e for e in edges if e[0] in m["terminal"]], f"{entity}: a terminal state has an outgoing transition"
        assert set(m["emitted_states"]) <= states
        for t in m["transitions"]:
            assert t["by"] and set(t["by"]) <= roles, f"{entity} {t['from']} -> {t['to']}: roles"
            assert t["basis"] in {"diagram", "default"}
        reachable, queue = {m["initial"]}, [m["initial"]]
        while queue:
            here = queue.pop()
            for a, b in edges:
                if a == here and b not in reachable:
                    reachable.add(b)
                    queue.append(b)
        assert reachable == states, f"{entity}: unreachable states {sorted(states - reachable)}"


def test_the_transition_table_of_the_code_is_the_one_of_the_dictionary(d: dict, engine: dict) -> None:
    as_set = lambda ts: {(t["from"], t["to"], tuple(sorted(t["by"]))) for t in ts}  # noqa: E731
    assert set(engine["transition_table"]) == set(d["state_machines"]) == {"sample", "result", "alarm_event", "batch_phase_record"}
    for entity in d["state_machines"]:
        assert as_set(d["state_machines"][entity]["transitions"]) == as_set(engine["transition_table"][entity]), entity
    assert set(engine["roles"]) == set(d["roles"])


def test_every_state_emitted_belongs_to_its_machine_and_the_emitted_ones_are_declared(d: dict, engine: dict) -> None:
    for entity in ("sample", "result"):
        seen = set(engine["tables"][entity]["state"]["values"])
        machine = d["state_machines"][entity]
        assert seen <= {t["to"] for t in machine["transitions"]}, f"{entity}: a state emitted that the machine does not reach"
        assert seen == set(machine["emitted_states"]), f"{entity}: declared emitted_states differ from what the runs emitted"


def test_every_state_a_controller_log_carried_belongs_to_its_machine_and_every_transition_logged_is_listed(d: dict, engine: dict) -> None:
    # S2e2: the controller records are not performed by the recorder but parsed from a log; the states the runs parsed are declared, and each (from, to) pair is a listed transition
    for entity in ("alarm_event", "batch_phase_record"):
        machine = d["state_machines"][entity]
        listed = {(t["from"], t["to"]) for t in machine["transitions"]}
        to_seen = set(engine["tables"][entity]["to_state"]["values"])
        assert to_seen == set(machine["emitted_states"]), f"{entity}: declared emitted_states differ from what the runs parsed"
        assert set(engine["tables"][entity]["from_state"]["values"]) <= {s for e in listed for s in e}
        pairs = {(x["from"], x["to"]) for x in engine["logged"] if x["entity"] == entity}
        assert pairs and pairs <= listed, f"{entity}: a logged transition that the machine does not list: {sorted(pairs - listed)}"


def test_the_roles_of_the_controller_machines_are_those_of_the_stand_in_rule(d: dict) -> None:
    # a step the process causes takes rule, a step an operator causes takes analyst (data_model section 7, S2e2 table); typed by hand
    alarm = {(t["from"], t["to"]): t["by"] for t in d["state_machines"]["alarm_event"]["transitions"]}
    assert alarm[("normal", "unacknowledged")] == ["rule"] and alarm[("unacknowledged", "acknowledged")] == ["analyst"]
    assert alarm[("acknowledged", "normal")] == ["rule"] and alarm[("rtn_unacknowledged", "normal")] == ["analyst"]
    phase = {(t["from"], t["to"]): t["by"] for t in d["state_machines"]["batch_phase_record"]["transitions"]}
    assert phase[("idle", "running")] == ["analyst"] and phase[("running", "complete")] == ["rule"]
    assert phase[("running", "holding")] == ["analyst"] and phase[("holding", "held")] == ["rule"] and phase[("held", "restarting")] == ["analyst"]
    assert len(alarm) == 11 and len(phase) == 21, "the 11 transitions of the alarm diagram and the 21 of the phase diagram (data_model 16.5)"
    assert ("held", "running") not in phase and ("acknowledged", "unacknowledged") not in alarm, "the two transitions that VR-025 holds"


def test_every_transition_performed_is_listed_and_its_role_is_permitted(d: dict, engine: dict) -> None:
    for p in engine["performed"]:
        match = [t for t in d["state_machines"][p["entity"]]["transitions"] if t["from"] == p["from"] and t["to"] == p["to"]]
        assert match, f"performed but not listed: {p}"
        assert p["by"] in match[0]["by"], f"performed by a role that may not cause it: {p}"


def test_the_transitions_the_pipeline_performs_are_the_ones_the_design_gives_it(engine: dict) -> None:
    performed = {(p["entity"], p["from"], p["to"], p["by"]) for p in engine["performed"]}
    # typed by hand from data_model sections 6 and 7: a validation rule holds or quarantines a measured row; the review passes it through under_review, the approver releases, the reviewer rejects;
    # the volume budget skips a planned draw
    assert performed == {
        ("result", "measured", "held", "rule"), ("result", "measured", "quarantined", "rule"),
        ("result", "held", "under_review", "reviewer"), ("result", "quarantined", "under_review", "reviewer"),
        ("result", "under_review", "released", "approver"), ("result", "under_review", "rejected", "reviewer"),
        ("sample", "planned", "skipped", "rule"),
    }


def test_the_transitions_no_run_performs_are_listed_so_the_gap_is_visible(d: dict, engine: dict) -> None:
    performed = {(p["entity"], p["from"], p["to"]) for p in engine["performed"]}
    # the machines of sample and result are the ones the pipeline performs; the controller records are parsed, not performed (above)
    never = {(e, t["from"], t["to"]) for e, m in d["state_machines"].items() if e in ("sample", "result") for t in m["transitions"]} - performed
    assert never == {
        # the recorder models no sample state beyond skipped (data_model section 7, S2a)
        ("sample", "planned", "drawn"), ("sample", "drawn", "in_transit"), ("sample", "in_transit", "received"), ("sample", "received", "aliquoted"), ("sample", "aliquoted", "closed"),
        ("sample", "drawn", "quarantined"), ("sample", "received", "quarantined"), ("sample", "quarantined", "received"), ("sample", "quarantined", "discarded"),
        # VR-014 rejects at ingest but cannot fire in any architecture (S2b); an unheld row is not reviewed (review by exception); a later version is a new row and the old state is not changed
        ("result", "measured", "rejected"), ("result", "measured", "under_review"), ("result", "released", "superseded"),
    }


@pytest.mark.parametrize("entity,pair", [("result", ("released", "held")), ("result", ("rejected", "released")), ("result", ("held", "released")), ("sample", ("closed", "drawn")), ("alarm_event", ("acknowledged", "unacknowledged")), ("batch_phase_record", ("held", "running"))])
def test_a_transition_not_in_the_table_is_not_in_the_dictionary(d: dict, entity: str, pair: tuple[str, str]) -> None:
    assert pair not in {(t["from"], t["to"]) for t in d["state_machines"][entity]["transitions"]}
