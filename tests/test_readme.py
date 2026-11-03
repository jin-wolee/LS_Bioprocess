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
SITE = "https://jin-wolee.github.io/LS_Bioprocess/"
REPOSITORY = "LS_Bioprocess"
OLD_REPOSITORY = "Lineage-Simulator-" + "Bioprocessing"  # the earlier name of the repository; in two parts so that this file is not a hit itself
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


def test_it_names_neither_the_earlier_repository_nor_a_pages_address_of_another_repository():
    # A2 (2026-11-02): the repository is jin-wolee/LS_Bioprocess; the two addresses are the ones of the README and nothing else
    assert OLD_REPOSITORY not in README
    assert sorted(set(re.findall(r"https://jin-wolee\.github\.io/[^/\s)]+/(?:lab/)?", README))) == [SITE, SITE + "lab/"]


def test_it_does_not_claim_the_wrong_tube_or_who_changed_a_result():
    # audit F8 and F13, the author's decisions of 2026-11-02: a correct barcode on the wrong tube is not modelled, and the audit trail keeps what changed and when, not who changed it or why
    compared = section(README, "What is compared")
    assert "stuck on the wrong tube is not modelled" in compared
    assert "Some errors remain even here" not in compared
    row = re.search(r"^\| `audit_trail` \| (.+) \|$", compared, re.M)
    assert row and "who changed what" not in row.group(1)
    assert "not who changed a result or why" in row.group(1) and "the old and the new value" in row.group(1)


def test_it_reads_the_comparison_as_a_constructive_example_and_the_spread_as_variation_of_the_inputs():
    reading = section(README, "How to read the comparison")
    flat = " ".join(reading.split())
    assert "zero by construction" in flat and "constructive example" in flat
    assert "not a measure of the quality, the efficiency or the return of real spreadsheets or laboratory systems" in flat
    assert "not the uncertainty of the model" in flat and "do not change with the seed" in flat
    assert "(A103) is a threshold of the design, not a proof of statistical sufficiency" in flat


def test_it_says_what_the_hold_time_rule_is_and_what_the_break_out_figures_are():
    flat = " ".join(section(README, "How to read the comparison").split())
    assert "a proxy taken from blood-gas handling and applied, as an assumption, to every analyte" in flat
    assert "not the accuracy of a real laboratory" in flat
    assert "a hold is a state of the record and stops no culture" in flat.lower()
    assert "judged by coverage, not by a sensitivity" in flat


def test_it_keeps_the_break_out_screen_back_and_says_why():
    numbers = section(README, "Numbers")
    assert "Break-out screen" in numbers and "held back" in numbers and "re-read" in numbers
    assert "provisional" in numbers and "main-reread" in numbers


def test_it_states_the_two_licences_and_the_files_that_hold_them():
    licences = section(README, "Licences")
    assert "MIT" in licences and "`LICENSE`" in licences and "CC BY 4.0" in licences and "`docs/LICENSE-docs.md`" in licences
    assert (REPO / "LICENSE").is_file() and (REPO / "docs" / "LICENSE-docs.md").is_file()


def test_it_says_the_sql_and_simpy_track_was_written_by_ai_and_where_its_agreement_is_measured():
    how = section(README, "How the work is done")
    flat = " ".join(how.split())
    assert "ADR-0002" in how
    # ADR-0022 (accepted 2026-11-03) supersedes ADR-0010's assignment of the five files to the author: the section names it, says who wrote them and what measures parity
    assert "ADR-0022" in how and "ADR-0010" in how
    assert "were written by AI" in flat and "clean-room from the specification" in flat and "The author did not write them" in flat
    assert "tests/user_track/" in how and "measured" in flat
    assert "The author writes the database schema" not in flat and "personally" not in flat  # the claim of ADR-0010 for these files is gone


def test_it_says_what_the_plant_is_and_what_it_leaves_to_the_local_build():
    # P9 (2026-11-03): the README says what exists. The plant, as built in P3 to P8 (docs/design/plant_ui.md); the Break-out cases in it are in the local build only (they rest on sources below main-reread)
    plant = " ".join(section(README, "The plant in the lab").split())
    for part in ("walk", "clock", "record hall", "lens", "truth overlay", "off until you ask", "simulation's own view", "Operator actions", "rerun the plant", "Lineage", "Results", "Notes",
                 "same instant", "guided scene", "text version"):
        assert part in plant, part
    assert "Break-out case" in plant and "local build only" in plant and "public build" in plant


def test_it_names_the_plant_where_it_describes_the_lab_and_what_is_held_back_in_the_public_build():
    pages = section(README, "The two pages")
    assert "plant" in pages and "walk" in pages
    numbers = section(README, "Numbers")
    assert "Break-out screen" in numbers and "Break-out cases" in numbers and "plant" in numbers


def test_it_says_the_gate_has_a_plant_part_and_the_workflow_runs_the_browser_qa_before_a_deploy():
    run = section(README, "Run it")
    assert "--lab" in run and "--plant" in run
    flat = " ".join(README.split())
    assert "browser checks" in flat and "before it can deploy" in flat


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


def test_sql_and_reference_exist_and_the_map_says_ai_wrote_them_under_adr_0022():
    # ADR-0022: the five files exist and are written by AI from the specification; the map lists both folders and says so
    assert (REPO / "sql" / "schema.sql").is_file() and (REPO / "reference" / "sim_core.py").is_file()
    block = re.search(r"```\n(.*?)```", section(README, "Repository map"), re.S).group(1)
    for folder in ("sql", "reference"):
        line = re.search(rf"^{folder}/\s{{2,}}(.*)$", block, re.M)
        assert line, f"the map does not list {folder}/"
        assert "written by AI" in line.group(1) and "ADR-0022" in line.group(1), line.group(1)
    assert "reserved for the author" not in README and "are not in the repository yet" not in README


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
            if m.group(1) != REPOSITORY:
                bad.append((p, m.group(0)))
    assert bad == []


def test_the_readme_is_english_first_with_a_korean_summary_last():
    headings = re.findall(r"^## (.+)$", README, re.M)
    assert headings[-1] == "한국어 요약"
    assert README.split("## 한국어 요약", 1)[0].isascii()
