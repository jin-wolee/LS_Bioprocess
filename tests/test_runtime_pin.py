"""The ADR-0016 runtime is reproducible in installs and CI alike."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_manifest_and_lock_pin_the_same_node_runtime():
    package = json.loads((ROOT / 'package.json').read_text())
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    assert package['engines']['node'] == '25.6.1'
    assert lock['packages']['']['engines']['node'] == package['engines']['node']
