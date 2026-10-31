"""The public README (S3h3): what it must say, what it must not, and that what it points at exists.

Expected values are typed by hand from the brief and the design: the Pages address after the repository rename, the ten flags of ADR-0005, ADR-0017 and ADR-0020, the three presets, the
rule of invariant 3 (a number carries an id; the README states no result figure) and ADR-0006 (English first). The commands and paths in the README are checked against the files they name.
"""
from __future__ import annotations

import json
import re
import subprocess

from helpers import REPO

README = (REPO / "README.md").read_text(encoding="utf-8")
SITE = "https://jin-wolee.github.io/Lineage-Simulator-Bioprocessing/"
FLAGS = [
    "system_issued_id", "two_clocks", "available_at", "instrument_state_snapshot", "append_only_versions",
    "write_time_keys", "ingest_idempotency", "audit_trail", "material_lot_links", "equipment_links",
]
OLD_NAME = "Lineage-" + "simulatior"  # the misspelt repository name; written in two parts so that this file is not a hit itself
RANKING = r"\b(better|best|worse|worst|wins?|winner|ahead|superior|inferior|outperforms?|beats?)\b"


def inventory() -> list[str]:
    """Every file git sees that is not ignored, tracked or not (CLAUDE.md: git ls-files -co --exclude-standard)."""
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if line]


def prose(text: str) -> str:
    """The README without fenced code blocks and inline code."""
    return re.sub(r"`[^`\n]*`", "", re.sub(r"```.*?```", "", text, flags=re.S))


def section(text: str, heading: str) -> str:
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    assert m, f"no section {heading!r}"
    return m.group(1)


# ---- what it says ---------------------------------------------------------------------------------


def test_it_names_the_two_pages_at_the_new_address_and_says_the_site_is_not_live_yet():
    assert f"]({SITE})" in README
    assert f"]({SITE}lab/)" in README
    assert "goes live when the author publishes it" in README


def test_it_says_the_language_choice_is_kept_between_the_pages_and_english_is_the_default():
    pages = section(README, "The two pages")
    assert "open in English" in pages and "Korean toggle" in pages and "kept when you follow the link" in pages


def test_it_opens_in_two_sentences_with_the_synthetic_data_and_no_prediction():
    lead = README.split("\n## ", 1)[0].split("\n\n", 1)[1].strip()
    sentences = re.split(r"(?<=[.])\s+(?=[A-Z])", lead)
    assert len(sentences) == 2, sentences
    assert "synthetic" in lead and "predicts a real plant" in lead and "data architectures" in lead


def test_it_names_the_ten_flags_and_the_three_presets():
    compared = section(README, "What is compared")
    for flag in FLAGS:
        assert f"`{flag}`" in compared, flag
    found = re.findall(r"^\| `(\w+)` \|", compared, re.M)
    assert found == FLAGS
    assert re.search(r"^- A, manual or Excel", compared, re.M)
    assert re.search(r"^- B, LIMS-lite: `system_issued_id`, `ingest_idempotency`, `audit_trail` and `equipment_links`", compared, re.M)
    assert re.search(r"^- C, context-preserving: all ten", compared, re.M)
    for adr in ("ADR-0005", "ADR-0017", "ADR-0020"):
        assert adr in compared


def test_its_flag_list_is_the_one_of_the_specification():
    spec = (REPO / "docs" / "design" / "simulation_spec.md").read_text(encoding="utf-8")
    table = spec.split("## 5. Data architecture = feature flags", 1)[1].split("Planned time is separate", 1)[0]
    assert re.findall(r"^\| `(\w+)` \|", table, re.M) == FLAGS


def test_it_keeps_the_break_out_screen_back_and_says_why():
    numbers = section(README, "Numbers")
    assert "Break-out screen" in numbers and "held back" in numbers and "re-read" in numbers
    assert "provisional" in numbers and "main-reread" in numbers


def test_it_states_the_two_licences_and_the_files_that_hold_them():
    licences = section(README, "Licences")
    assert "MIT" in licences and "`LICENSE`" in licences and "CC BY 4.0" in licences and "`docs/LICENSE-docs.md`" in licences
    assert (REPO / "LICENSE").is_file() and (REPO / "docs" / "LICENSE-docs.md").is_file()


def test_it_says_where_the_author_wrote_and_where_the_tools_did_not():
    how = section(README, "How the work is done")
    assert "ADR-0002" in how and "ADR-0010" in how
    assert "unproven" in how  # ADR-0010: until the author's files exist, parity is not claimed


# ---- what it must not say -------------------------------------------------------------------------


def test_it_does_not_rank_the_architectures():
    assert re.findall(RANKING, README, re.I) == []


def test_it_no_longer_calls_the_project_a_design_phase_without_an_engine():
    for old in ("design phase", "Design phase", "No engine code exists yet", "there are no simulation results"):
        assert old not in README


def test_it_states_no_result_figure_and_every_remaining_number_is_an_id_a_time_or_a_name():
    # invariant 3 and 9: no percentage, and after removing code, ledger ids, ADR numbers, times of day, "section N" and the licence name no digit is left
    text = prose(README)
    assert "%" not in text
    rest = re.sub(r"ADR-\d{4}|\b[AS]\d{3}\b|\b\d{2}:\d{2}\b|section \d+|CC BY 4\.0", "", text)
    assert re.findall(r"\d+", rest) == []


def test_every_ledger_id_it_cites_exists():
    sources = (REPO / "docs" / "research" / "sources.yaml").read_text(encoding="utf-8")
    assumptions = (REPO / "docs" / "research" / "assumptions.yaml").read_text(encoding="utf-8")
    for ref in set(re.findall(r"\b[AS]\d{3}\b", README)):
        assert re.search(rf"\bid: {ref}\b", sources if ref[0] == "S" else assumptions), ref


# ---- what it points at ----------------------------------------------------------------------------


def test_the_repository_map_names_every_folder_and_file_of_the_root():
    block = re.search(r"```\n(.*?)```", section(README, "Repository map"), re.S).group(1)
    mapped = {m.group(1).rstrip("/") for m in re.finditer(r"^(\S+?/?)\s{2,}\S", block, re.M)}
    project_files = set(re.findall(r"`([^`]+)`", section(README, "Repository map").split("The root also holds", 1)[1].split("`sql/`", 1)[0]))
    named = {n.rstrip("/").split("/")[0] for n in mapped} | project_files
    top = {p.split("/")[0] for p in inventory()} - {"README.md", ".gitignore"}
    assert top - named == set(), f"the map lacks: {sorted(top - named)}"
    for name in mapped:
        assert (REPO / name).exists(), name


def test_sql_and_reference_are_not_listed_as_existing_while_they_do_not_exist():
    assert not (REPO / "sql").exists() and not (REPO / "reference").exists()
    assert not re.search(r"^(sql|reference)/\s", section(README, "Repository map"), re.M)


def test_the_commands_name_scripts_and_npm_scripts_that_exist():
    code = "\n".join(re.findall(r"```bash\n(.*?)```", README, re.S))
    scripts = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]
    for path in re.findall(r"\b(scripts/[\w./-]+|site/infographic/build\.py)", code):
        if path.endswith("git-hooks"):
            assert (REPO / path).is_dir(), path
        else:
            assert (REPO / path).is_file(), path
    for name in re.findall(r"npm run (\S+)", code):
        assert name in scripts, name
    assert "npm ci" in code and "uv sync --frozen" in code


def test_the_files_it_names_in_prose_exist():
    for path in re.findall(r"`((?:docs|prompts|scripts)/[\w./-]+)`", README):
        assert (REPO / path).exists(), path


# ---- the old repository name ----------------------------------------------------------------------


def test_the_misspelt_repository_name_occurs_in_no_file_except_the_history_log():
    hits = [p for p in inventory() if p != "docs/progress.md" and (REPO / p).is_file() and OLD_NAME.lower() in (REPO / p).read_text(encoding="utf-8", errors="ignore").lower()]
    assert hits == []


def test_every_pages_address_in_the_repository_uses_the_new_repository_name():
    bad = []
    for p in inventory():
        f = REPO / p
        if p == "docs/progress.md" or not f.is_file() or f.suffix in {".png", ".jpg", ".woff", ".woff2", ".lock"} or p == "package-lock.json":
            continue
        for m in re.finditer(r"https://jin-wolee\.github\.io/([^/\s\"')]+)", f.read_text(encoding="utf-8", errors="ignore")):
            if m.group(1) != "Lineage-Simulator-Bioprocessing":
                bad.append((p, m.group(0)))
    assert bad == []


def test_the_readme_is_english_first_with_a_korean_summary_last():
    headings = re.findall(r"^## (.+)$", README, re.M)
    assert headings[-1] == "한국어 요약"
    assert README.split("## 한국어 요약", 1)[0].isascii()
