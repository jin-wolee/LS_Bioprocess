from __future__ import annotations

import json
import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
from qa_lab_robust import READY_ROUTES, WORKER_ASSET, nested_actions  # noqa: E402


def test_nested_action_probe_is_a_single_action_with_the_requested_depth():
    assert json.loads(nested_actions(3)) == [{"kind": "add_feed", "extra": [[[0]]]}]
    assert nested_actions().count("[") == 5001


def test_worker_probe_targets_the_bundled_worker_and_every_ready_dependent_route():
    assert WORKER_ASSET.search("http://localhost/assets/worker-abc123.js")
    assert not WORKER_ASSET.search("http://localhost/assets/main.js")
    assert set(READY_ROUTES) == {"home", "setup", "plant", "results", "lineage", "challenge", "breakout", "notes"}
