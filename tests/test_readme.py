"""The public README (S3h3, rewritten in R2): what it must say, what it must not, and that what it points at exists.

Expected values are typed by hand from the brief and the design: the Pages address after the repository rename, the ten flags of ADR-0005, ADR-0017 and ADR-0020, the three presets, the sections the
author asked for (the top block with the language row and the tour, a table of contents, what you can do with the screenshots, how it works, the quick start, the usage, what it compares, how to read it,
where things are, how it was made, the licence), the rule of invariant 3 (a number carries an id; the README states no
result figure) and ADR-0006 (English first; README.ko.md is the Korean one, tests/test_readme_ko.py). The commands and paths in the README are checked against the files they name; the pictures it names
are checked in tests/test_media.py.
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
SECTIONS = ["What you can do", "How it works", "Quick start", "Usage", "What it compares", "How to read it", "Where things are", "How the work is done", "Licence"]
SUBSECTIONS = ["Break-out cases locally", "Checks and pictures", "The plant", "The other screens", "Numbers"]
# the ten folders of the root, one line each in "Where things are" (R1: .claude .github data docs engine reference scripts site src tests)
FOLDERS = [".claude", ".github", "data", "docs", "engine", "reference", "scripts", "site", "src", "tests"]
PICTURES = ["plant_en.png", "tour_table_en.png", "lineage_en.png", "results_en.png", "action.gif", "breakout_en.png"]  # one for each row of "What you can do", in order


def inventory() -> list[str]:
    """Every file git sees that is not ignored, tracked or not (CLAUDE.md: git ls-files -co --exclude-standard)."""
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True).stdout
    return [line for line in out.splitlines() if line]


def prose(text: str) -> str:
    """The README without fenced code blocks and inline code."""
    return re.sub(r"`[^`\n]*`", "", re.sub(r"```.*?```", "", text, flags=re.S))


def section(text: str, heading: str) -> str:
    """A `## ` section, with its `### ` subsections."""
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    assert m, f"no section {heading!r}"
    return m.group(1)


def subsection(text: str, heading: str) -> str:
    m = re.search(rf"^### {re.escape(heading)}\n(.*?)(?=^##+ |\Z)", text, re.S | re.M)
    assert m, f"no subsection {heading!r}"
    return m.group(1)


def slug(heading: str) -> str:
    """The anchor GitHub makes of a heading: lower case, anything but letters, digits, spaces, hyphens and underscores dropped, spaces to hyphens."""
    return re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", heading.strip().lower()))


def top(text: str) -> list[str]:
    """The blocks of the top of the page, before the first section: the title, the tagline, the language row, the tour, the lead and the table of contents."""
    return text.split("\n## ", 1)[0].strip().split("\n\n")


def lead(text: str) -> str:
    """The paragraph that says what the project is: the one after the tour."""
    return top(text)[4]


# ---- the shape the author asked for ---------------------------------------------------------------


def test_it_has_the_sections_the_author_asked_for_in_order_with_their_subsections():
    assert re.findall(r"^## (.+)$", README, re.M) == SECTIONS
    assert re.findall(r"^### (.+)$", README, re.M) == SUBSECTIONS


def test_it_opens_with_the_title_a_tagline_the_language_row_the_tour_the_lead_and_a_table_of_contents():
    head = top(README)
    assert len(head) == 6
    assert head[0] == "# ![](docs/media/mark.svg) Sample Lineage Lab"  # B1: the mark beside the name; the alt text is empty because the name is right beside it
    assert re.fullmatch(r"[^.\n]+\.", head[1]) and "data architectures" in head[1]  # one sentence
    assert head[2] == "**English** | [한국어](README.ko.md)"  # the current language bold and not linked, the other one linked
    assert re.fullmatch(r"!\[[^\]]+\]\(docs/media/tour\.gif\)", head[3])
    assert "badge" not in README.lower() and "img.shields.io" not in README  # no service behind the page


def test_the_table_of_contents_links_every_section_by_the_anchor_of_its_heading():
    toc = re.findall(r"^- \[([^\]]+)\]\((#[^)]+)\)$", top(README)[5], re.M)
    assert [name for name, _ in toc] == SECTIONS
    assert [anchor for _, anchor in toc] == ["#what-you-can-do", "#how-it-works", "#quick-start", "#usage", "#what-it-compares", "#how-to-read-it", "#where-things-are", "#how-the-work-is-done", "#licence"]
    assert [anchor for _, anchor in toc] == ["#" + slug(h) for h in SECTIONS]


def test_it_opens_with_the_synthetic_data_and_no_prediction_in_the_lead():
    sentences = re.split(r"(?<=[.])\s+(?=[A-Z])", lead(README))
    assert len(sentences) == 3, sentences  # the situation, what is compared, the synthetic data and no prediction
    assert "synthetic" in lead(README) and "predicts a real plant" in lead(README) and "data architectures" in lead(README) and "(ADR-0001)" in lead(README)


def test_what_you_can_do_has_a_picture_for_each_row_in_order_and_says_nothing_about_the_pictures_themselves():
    section_text = section(README, "What you can do")
    rows = re.findall(r"^\| ([^|]+) \| !\[[^\]]+\]\(docs/media/([^)]+)\) \|$", section_text, re.M)
    assert [name for _, name in rows] == PICTURES
    assert 4 <= len(rows) <= 6 and all(text.strip().endswith(".") for text, _ in rows)  # four to six items, a sentence each
    assert "Local build only" in rows[-1][0] and "public build" in rows[-1][0]
    assert section_text.rstrip().endswith("|")  # the table is the section: no sentence that describes the pictures (humanizer, pattern 25); each row says what its picture shows
    assert "README.ko.md" not in section_text and "screenshots are" not in section_text


def test_how_it_works_has_a_small_diagram_of_the_truth_the_three_records_the_evaluator_and_the_worker():
    how = section(README, "How it works")
    diagram = re.search(r"```mermaid\n(.*?)```", how, re.S).group(1)
    assert diagram.startswith("flowchart LR") and len(diagram.splitlines()) <= 20  # small
    for node in ("Truth", "RA", "RB", "RC", "Eval", "Page", "subgraph Worker"):
        assert node in diagram, node
    assert diagram.count("observable events only") == 3 and "-.->" in diagram  # the records see observable events only; the truth reaches the evaluator on its own line
    flat = " ".join(how.split())
    assert "records only the observable events of the run" in flat and "nothing from the truth" in flat
    assert "imports no engine code and computes no result itself" in flat and "the same seed gives the same run every time" in flat


def test_usage_has_a_table_of_keys_that_the_code_binds_and_a_line_for_every_other_screen():
    plant = subsection(README, "The plant")
    keys = re.findall(r"^\| ([^|]+) \| ([^|]+) \|$", plant, re.M)[1:]  # past the header (the rule under it has no cells to match)
    assert len(keys) == 9, keys
    clock = (REPO / "src" / "plant" / "keys.ts").read_text(encoding="utf-8")
    for key in ('" "', '","', '"."', '"["', '"]"', '"{"', '"}"', '"f"'):
        assert key in clock, key  # Space, the commas and brackets, F: the keys of the clock
    controls = (REPO / "src" / "plant" / "controls.ts").read_text(encoding="utf-8")
    for key in ('"q"', '"e"', '"r"', '"t"', '"+"', '"-"', '"w"', '"a"', '"s"', '"d"', '"ArrowUp"'):
        assert key in controls, key  # turn, tilt, zoom, walk
    assert "SPEEDS = [30, 120, 600, 3600]" in (REPO / "src" / "plant" / "clock.ts").read_text(encoding="utf-8")  # `1` to `4` pick one of four speeds
    row = {k.strip(): v.strip() for k, v in keys}
    assert row["`Space`"] == "Play or pause the clock" and row["`F`"] == "Follow the tube of the picked sample" and "`1` to `4`" in row
    screens = subsection(README, "The other screens")
    for screen in ("Home", "Setup", "Results", "Lineage", "Challenge", "Break-out", "Notes"):
        assert re.search(rf"^\| {screen} \| ", screens, re.M), screen


def test_quick_start_gives_the_address_first_then_one_block_to_paste_and_names_where_the_versions_are():
    run = section(README, "Quick start")
    assert run.index("jin-wolee.github.io") < run.index("```bash")  # the live address first
    assert "`engines`" in run and "`requires-python`" in run and "`.nvmrc`" not in run and "`.python-version`" not in run  # R3: the versions live in package.json and pyproject.toml
    assert not (REPO / ".nvmrc").exists() and not (REPO / ".python-version").exists()
    first = re.search(r"```bash\n(.*?)```", run, re.S).group(1)
    assert [line.split()[0:2] for line in first.splitlines()] == [["npm", "ci"], ["uv", "sync"], ["npm", "run"]]
    scripts = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert "npm run preview" in first and "preview" in scripts
    # one command: it assembles dist/site/ (the explainer at the root, the lab under lab/) and serves that folder on the loopback address
    assert "scripts/assemble_site.py" in scripts["preview"] and "--directory dist/site" in scripts["preview"] and "--bind 127.0.0.1" in scripts["preview"]
    assert "http://127.0.0.1:8000/lab/" in run and "VITE_LAB_LOCAL=1 npm run build:lab" in subsection(README, "Break-out cases locally")


# ---- what it says ---------------------------------------------------------------------------------


def test_it_names_the_two_pages_at_the_new_address_and_says_the_site_is_not_live_yet():
    assert f"]({SITE})" in README
    assert f"]({SITE}lab/)" in README
    assert "goes live when the author publishes it" in README


def test_it_says_the_language_choice_is_kept_between_the_pages_and_english_is_the_default():
    pages = section(README, "Usage")
    assert "open in English" in pages and "Korean toggle" in pages and "kept when you follow the link" in pages


def test_it_names_the_ten_flags_and_the_three_presets():
    compared = section(README, "What it compares")
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


def test_it_points_at_the_design_notes_instead_of_repeating_them():
    compared = section(README, "What it compares")
    for note in ("docs/design/simulation_spec.md", "docs/design/data_model.md"):
        assert f"`{note}`" in compared and (REPO / note).is_file()
    assert README.rstrip().endswith("For more depth, read the [design notes](docs/design/) and the [decisions](docs/adr/).")  # the last line
    assert (REPO / "docs" / "design").is_dir() and (REPO / "docs" / "adr").is_dir()


def test_it_names_neither_the_earlier_repository_nor_a_pages_address_of_another_repository():
    # A2 (2026-11-02): the repository is jin-wolee/LS_Bioprocess; the two addresses are the ones of the README and nothing else
    assert OLD_REPOSITORY not in README
    assert sorted(set(re.findall(r"https://jin-wolee\.github\.io/[^/\s)]+/(?:lab/)?", README))) == [SITE, SITE + "lab/"]


def test_it_does_not_claim_the_wrong_tube_or_who_changed_a_result():
    # audit F8 and F13, the author's decisions of 2026-11-02: a correct barcode on the wrong tube is not modelled, and the audit trail keeps what changed and when, not who changed it or why
    compared = section(README, "What it compares")
    assert "stuck on the wrong tube is not modelled" in compared
    assert "Some errors remain even here" not in compared
    row = re.search(r"^\| `audit_trail` \| (.+) \|$", compared, re.M)
    assert row and "who changed what" not in row.group(1)
    assert "not who changed a result or why" in row.group(1) and "the old and the new value" in row.group(1)


def test_it_reads_the_comparison_as_a_constructive_example_and_the_spread_as_variation_of_the_inputs():
    reading = section(README, "How to read it")
    flat = " ".join(reading.split())
    assert "zero by construction" in flat and "constructive example" in flat
    assert "not a measure of the quality, the efficiency or the return of real spreadsheets or laboratory systems" in flat
    assert "not the uncertainty of the model" in flat and "do not change with the seed" in flat
    assert "(A103) is a threshold of the design, not a proof of statistical sufficiency" in flat


def test_it_says_what_the_hold_time_rule_is_and_what_the_break_out_figures_are():
    flat = " ".join(section(README, "How to read it").split())
    assert "a proxy taken from blood-gas handling and applied, as an assumption, to every analyte" in flat
    assert "not the accuracy of a real laboratory" in flat
    assert "a hold is a state of the record and stops no culture" in flat.lower()
    assert "judged by coverage, not by a sensitivity" in flat


def test_it_keeps_the_break_out_screen_back_and_says_why():
    numbers = subsection(README, "Numbers")
    assert "Break-out screen" in numbers and "held back" in numbers and "re-read" in numbers
    assert "provisional" in numbers and "main-reread" in numbers


def test_it_states_the_two_licences_and_the_files_that_hold_them():
    licences = section(README, "Licence")
    assert "MIT" in licences and "`LICENSE`" in licences and "CC BY 4.0" in licences and "`docs/LICENSE-docs.md`" in licences
    assert "`docs/media/`" in licences  # the pictures are figures of docs/
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
    plant = " ".join(subsection(README, "The plant").split())
    usage = " ".join(section(README, "Usage").split())
    for part in ("walk", "clock", "record hall", "lens", "truth overlay", "off until you ask", "simulation's own view", "Operator actions", "rerun the plant", "Lineage", "Results", "Notes",
                 "same instant", "guided scene"):
        assert part.lower() in plant.lower(), part
    assert "text version" in usage
    assert "Break-out case" in plant and "local build only" in plant and "public build" in plant
    assert "five steps" in plant and "skipped at any step" in plant  # the guided scene: five steps (plant_ui.md section 3.5), skippable


def test_it_names_the_plant_where_it_describes_the_lab_and_what_is_held_back_in_the_public_build():
    pages = section(README, "Quick start")
    assert "plant" in pages and "walk" in pages
    numbers = subsection(README, "Numbers")
    assert "Break-out screen" in numbers and "Break-out cases" in numbers and "plant" in numbers


def test_it_says_the_gate_has_a_plant_part_and_the_workflow_runs_the_browser_qa_before_a_deploy():
    run = section(README, "Quick start")
    assert "--lab" in run and "--plant" in run
    flat = " ".join(README.split())
    assert "browser checks" in flat and "before it can deploy" in flat


# ---- what it must not say -------------------------------------------------------------------------


def test_it_does_not_rank_the_architectures():
    assert re.findall(RANKING, README, re.I) == []


# The wording the author asked for (2026-11-03, the humanizer rules): plain prose, no dashes, no decorative bold, sentence-case headings without emoji, none of the stock words of AI text.
STOCK_WORDS = ["crucial", "delve", "showcase", "showcasing", "seamless", "seamlessly", "pivotal", "tapestry", "vibrant", "intricate", "meticulous", "underscore", "testament", "landscape", "serves as",
               "stands as", "boasts", "robust", "comprehensive", "leverage", "furthermore", "additionally", "game-changing", "cutting-edge", "powerful"]


def test_the_prose_has_no_dash_no_decorative_bold_no_stock_word_and_no_emoji():
    text = prose(README)
    assert not re.search(r"[\u2014\u2013]| -- ", text)
    assert re.findall(r"\*\*[^*]+\*\*", text) == ["**English**"]  # the current language in the language row, nothing else
    for word in STOCK_WORDS:
        assert not re.search(rf"\b{re.escape(word)}\b", text, re.I), word
    assert not re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF\u2190-\u21FF]", README)  # no emoji and no arrows
    for heading in re.findall(r"^#{2,3} (.+)$", README, re.M):
        assert all(word[0].islower() or word == "Break-out" for word in heading.split()[1:]), heading  # sentence case


def test_it_no_longer_calls_the_project_a_design_phase_without_an_engine():
    for old in ("design phase", "Design phase", "No engine code exists yet", "there are no simulation results"):
        assert old not in README


def test_it_states_no_result_figure_and_every_remaining_number_is_an_id_a_time_or_a_name():
    # invariant 3 and 9: no percentage, and after removing code, ledger ids, ADR numbers, times of day, "section N" and the licence name no digit is left. A command, a version, a port, a key or a file
    # name is code (a fenced block or an inline span) and so is not a number of the domain; the rule stands as it was in R2 and the Korean README is held to it in tests/test_readme_ko.py
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


def where_things_are() -> dict[str, str]:
    """The rows of the table of "Where things are": the folder (without the slash) to what its row says."""
    return {m.group(1).rstrip("/"): m.group(2) for m in re.finditer(r"^\| `([^`]+/)` \| (.+) \|$", section(README, "Where things are"), re.M)}


def test_the_map_has_one_row_for_each_of_the_ten_folders_and_names_every_folder_and_file_of_the_root():
    mapped = where_things_are()
    assert list(mapped) == FOLDERS
    for name in mapped:
        assert (REPO / name).is_dir(), name
    project_files = set(re.findall(r"`([^`]+)`", section(README, "Where things are").split("The root also holds", 1)[1]))
    top_level = {p.split("/")[0] for p in inventory()} - {"README.md", "README.ko.md", ".gitignore"}
    assert top_level - set(mapped) - project_files == set(), f"the map lacks: {sorted(top_level - set(mapped) - project_files)}"
    for name in project_files:
        assert (REPO / name).exists(), name


def test_sql_and_reference_exist_and_the_map_says_ai_wrote_them_under_adr_0022():
    # ADR-0022: the five files exist and are written by AI from the specification; the map lists the folder and says so
    assert (REPO / "reference" / "sql" / "schema.sql").is_file() and (REPO / "reference" / "simpy" / "sim_core.py").is_file()
    line = where_things_are()["reference"]
    assert "written by AI" in line and "ADR-0022" in line and "sql/" in line and "simpy/" in line, line
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
    assert "npm ci" in code and "uv sync --frozen" in code and "scripts/media/make_media.py" in code


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
        if p == "docs/progress.md" or not f.is_file() or f.suffix in {".png", ".jpg", ".gif", ".woff", ".woff2", ".lock"} or p == "package-lock.json":
            continue
        for m in re.finditer(r"https://jin-wolee\.github\.io/([^/\s\"')]+)", f.read_text(encoding="utf-8", errors="ignore")):
            if m.group(1) != REPOSITORY:
                bad.append((p, m.group(0)))
    assert bad == []


def test_the_english_readme_is_english_with_no_korean_but_the_name_of_the_other_language():
    # ADR-0006: the Korean README is the author's later decision of 2026-11-03 and a file of its own; this one is English first and holds no Korean text but the switch
    assert README.replace("[한국어](README.ko.md)", "").isascii()
    assert "한국어 요약" not in README  # the old Korean summary is README.ko.md now
