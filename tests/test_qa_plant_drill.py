"""Pure helpers of scripts/qa_plant_drill_helpers.py (the check `drilldown` of the headless QA of the plant, docs/design/plant_ui.md section 10, P5c).

Expected values are hand arithmetic on a plan and on messages typed by hand, never taken from the code under test. The browser check itself runs through `uv run python scripts/qa_plant.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_plant_drill_helpers as qd  # noqa: E402


def _plan():
    def sample(id_, unit, drawn, skipped=False):
        return {"id": id_, "unit": unit, "drawn_s": drawn, "skipped": skipped}

    return {
        "units": [{"id": "U01"}, {"id": "U02"}],
        "samples": [
            sample("U01-D00-1", 0, 1000),
            sample("U01-D00-2", 0, 2000),
            sample("U02-D00-1", 1, 3000),
            sample("U01-D01-1", 0, 4000, skipped=True),  # a skipped draw is no sample
            sample("U01-D01-2", 0, None),  # never drawn
            sample("U01-D01-3", 0, 2000),  # drawn at the same second as D00-2, later in the plan
        ],
    }


def test_the_newest_sample_of_a_unit_is_the_last_drawn_by_the_instant_and_the_later_one_of_a_tie():
    plan = _plan()
    assert qd.newest_sample(plan, "U01", 1500) == "U01-D00-1"
    assert qd.newest_sample(plan, "U01", 2000) == "U01-D01-3"
    assert qd.newest_sample(plan, "U01", 9999) == "U01-D01-3"
    assert qd.newest_sample(plan, "U02", 2999) is None
    assert qd.newest_sample(plan, "U02", 3000) == "U02-D00-1"


def test_the_plant_link_of_the_default_plant_at_an_instant_is_typed_from_the_keys_of_the_section():
    assert qd.plant_hash(305626, "9.9.9") == "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&t=305626&schema=1&engine=9.9.9"
    assert qd.plant_hash(None, "9.9.9") == "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&schema=1&engine=9.9.9"
    feed = [{"kind": "add_feed", "at": 723600, "unit_id": "U10"}]
    assert qd.plant_hash(5, "9.9.9", feed) == "#/plant?scenario=default&arch=a_manual,b_lims_lite,c_context&seed=1&actions=%5B%7B%22kind%22%3A%22add_feed%22%2C%22at%22%3A723600%2C%22unit_id%22%3A%22U10%22%7D%5D&t=5&schema=1&engine=9.9.9"
    assert qd.read_hash(qd.plant_hash(5, "9.9.9", feed))[1]["actions"] == '[{"kind":"add_feed","at":723600,"unit_id":"U10"}]'


def test_a_hash_is_read_as_a_screen_and_its_query_with_the_plant_value_decoded():
    got = qd.read_hash("#/lineage?from=plant&sample=U03-D03-1&plant=scenario%3Ddefault%26seed%3D1%26t%3D5")
    assert got == ("lineage", {"from": "plant", "sample": "U03-D03-1", "plant": "scenario=default&seed=1&t=5"})
    assert qd.read_hash("#/plant") == ("plant", {})


def test_the_drill_link_problems_name_what_a_link_lacks():
    ok = "#/lineage?from=plant&sample=U03-D03-1&plant=scenario%3Ddefault%26arch%3Da_manual%26seed%3D1%26t%3D5%26schema%3D1%26engine%3D9.9.9"
    assert qd.link_problems(ok, "lineage", sample="U03-D03-1", t=5) == []
    assert qd.link_problems(ok, "setup", sample="U03-D03-1", t=5) == ["the link opens lineage, expected setup"]
    assert qd.link_problems(ok, "lineage", sample="U03-D03-2", t=5) == ["the link names the sample U03-D03-1, expected U03-D03-2"]
    assert qd.link_problems(ok, "lineage", sample="U03-D03-1", t=6) == ["the plant in the link is at t=5, expected 6"]
    assert qd.link_problems("#/lineage?sample=U03-D03-1", "lineage", sample="U03-D03-1", t=5)[0].startswith("the link does not say it came from the plant")


def test_the_lineage_request_the_page_sent_names_the_sample_the_seed_and_the_actions_of_the_plant():
    sent = [
        {"type": "plant_run", "epoch": 1}, {"type": "lineage", "pick": {"sample_id": "A"}, "actions": 0, "seed": 1},
        {"type": "plant_record", "epoch": 1}, {"type": "lineage", "pick": {"sample_id": "B"}, "actions": 1, "seed": 1},
    ]
    assert qd.lineage_problems(sent, "B", actions=1, seed=1) == []
    assert qd.lineage_problems(sent, "A", actions=1, seed=1) == ["the last lineage request names the sample B, expected A"]
    assert qd.lineage_problems(sent, "B", actions=0, seed=1) == ["the last lineage request carries 1 actions, expected 0"]
    assert qd.lineage_problems([{"type": "lineage", "pick": {"sample_id": "B"}, "actions": None, "seed": 1}], "B", actions=0, seed=1) == ["the lineage request carries no actions field: the plant's actions are always sent, an empty list included"]
    assert qd.lineage_problems([], "B", actions=0, seed=1) == ["the page sent no lineage request"]
    assert qd.lineage_problems(sent, "B", actions=1, seed=2) == ["the last lineage request is for seed 1, expected 2"]


def test_plant_runs_are_counted_in_what_the_page_sent():
    sent = [{"type": "plant_run"}, {"type": "plant_record"}, {"type": "plant_run"}, {"type": "lineage"}]
    assert qd.count(sent, "plant_run") == 2
    assert qd.count(sent, "breakout") == 0


def test_back_to_the_plant_lands_on_the_same_instant_and_lens_paused_and_asks_for_no_run():
    before = {"t": "305626", "lens": "c_context", "epoch": "1", "playing": "false"}
    assert qd.back_problems(before, dict(before), runs_before=1, runs_after=1) == []
    moved = {**before, "t": "305700"}
    assert qd.back_problems(before, moved, 1, 1) == ["Back landed on t=305700, the reader left at 305626"]
    assert qd.back_problems(before, {**before, "lens": "a_manual"}, 1, 1) == ["Back landed on the lens a_manual, the reader left on c_context"]
    assert qd.back_problems(before, {**before, "playing": "true"}, 1, 1) == ["the clock plays after Back; it opens paused at the instant"]
    assert qd.back_problems(before, dict(before), 1, 2) == ["Back sent a plant_run: 2 in all, 1 before"]
    assert qd.back_problems(before, {**before, "epoch": "2"}, 1, 1) == ["Back changed the epoch of the plan on screen from 1 to 2"]


def test_a_bad_link_is_expected_to_say_which_keys_it_fell_back_on():
    assert qd.BAD_LINK_NOTES == ["scenario", "seed", "t_range", "engine"]
    assert qd.bad_link("0.0.0") == "#/plant?scenario=nonesuch&seed=abc&t=99999999&schema=1&engine=0.0.0"
