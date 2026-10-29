"""ADR-0016: a Python test that starts Node for engine code passes the engine's Node flags, the same ones as engine/tests/support/node_flags.ts.

The Python spawns repeat the flag as a literal (Python cannot import the TS module), so this test reads the list out of the TS text and checks every `["node", ...]` argument list
in tests/ with the ast module. The CLI check of the engine (require_node_flags.ts) refuses a bare start; this test names the drift before a spawned CLI does.
"""
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"


def ts_flags() -> list[str]:
    text = (ROOT / "engine" / "tests" / "support" / "node_flags.ts").read_text()
    body = re.search(r"ENGINE_NODE_FLAGS: readonly string\[\] = \[(.*?)\];", text, re.S)
    assert body, "ENGINE_NODE_FLAGS not found in node_flags.ts"
    return re.findall(r'"([^"]+)"', body.group(1))


def node_spawns() -> list[tuple[str, int, list[str]]]:
    """Every list literal in tests/ that starts with "node": (file, line, the "--" strings right after "node")."""
    found = []
    for path in sorted(TESTS.rglob("*.py")):
        if path == Path(__file__).resolve():
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.List) and node.elts and isinstance(node.elts[0], ast.Constant) and node.elts[0].value == "node":
                flags = []
                for item in node.elts[1:]:
                    if not (isinstance(item, ast.Constant) and isinstance(item.value, str) and item.value.startswith("--")):
                        break
                    flags.append(item.value)
                found.append((str(path.relative_to(ROOT)), node.lineno, flags))
    return found


def test_the_ts_list_holds_the_flag_of_adr_0016() -> None:
    assert "--no-maglev-escape-analysis" in ts_flags()


def test_the_python_tests_that_start_node_are_found() -> None:
    files = {f for f, _, _ in node_spawns()}
    assert {"tests/test_data_dictionary.py", "tests/user_track/test_queries.py"} <= files


def test_every_python_spawn_of_node_passes_the_flags_of_the_ts_list() -> None:
    wanted = ts_flags()
    wrong = [f"{f}:{line} passes {flags}" for f, line, flags in node_spawns() if flags != wanted]
    assert not wrong, f"expected {wanted} right after \"node\": " + "; ".join(wrong)
