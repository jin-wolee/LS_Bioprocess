"""Pure helper of scripts/qa/qa_site.py (the headless QA of the assembled site folder, docs/design/lab_ui.md section 13).

The expected problems are typed by hand from the rule of the design: the folder holds the infographic page at its root, the fonts the page names under fonts/ with their two licences, the lab under
lab/ and an empty .nojekyll, and nothing of site/infographic/ besides its index.html and fonts/. The browser checks run through `uv run python scripts/qa/qa_site.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_site as qs  # noqa: E402

GOOD = [".nojekyll", "fonts/OFL-Archivo.txt", "fonts/OFL-IBM-Plex-Mono.txt", "fonts/README.md", "fonts/archivo-latin.woff2", "index.html", "lab/assets/main-1a2b.js", "lab/index.html", "lab/reference.json"]
PAGE = """<style>
@font-face { font-family: "Archivo"; src: url(fonts/archivo-latin.woff2) format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url(fonts/ibm-plex-mono-400-latin.woff2) format("woff2"); }
body { background: url(img/not-a-font.png) }
</style>"""


def test_the_folder_the_design_describes_has_no_problem():
    assert qs.folder_problems(GOOD, nojekyll_bytes=0) == []


def test_each_required_file_is_named_when_it_is_missing():
    for gone in (".nojekyll", "index.html", "lab/index.html", "lab/reference.json", "fonts/OFL-Archivo.txt", "fonts/OFL-IBM-Plex-Mono.txt"):
        problems = qs.folder_problems([f for f in GOOD if f != gone], nojekyll_bytes=0)
        assert len(problems) == 1 and gone in problems[0], (gone, problems)


def test_anything_at_the_top_besides_the_page_the_lab_and_nojekyll_is_a_problem():
    for extra in ("build.py", "src/body.html", "dist/artifact.html", "lab-public/reference.json", "README.md", "img/a.png"):
        problems = qs.folder_problems([*GOOD, extra], nojekyll_bytes=0)
        assert len(problems) == 1 and extra in problems[0], (extra, problems)


def test_nojekyll_must_be_empty():
    problems = qs.folder_problems(GOOD, nojekyll_bytes=3)
    assert len(problems) == 1 and ".nojekyll" in problems[0]


def test_the_stand_in_project_path_is_the_name_of_the_repository_of_the_pages_addresses():
    # the Pages addresses are https://jin-wolee.github.io/LS_Bioprocess/ and .../lab/ (README.md, tests/test_readme.py): a project site lives under /<repository>/
    assert qs.SUBPATH == "LS_Bioprocess"


def test_a_request_of_the_served_origin_outside_the_path_of_the_site_is_found():
    # a root-absolute address (/assets/x.js) works at the root of a server and fails under /<repository>/; other origins and data: URLs are not this check's business
    base = "http://127.0.0.1:8000/LS_Bioprocess/"
    urls = [
        base + "lab/index.html",
        base + "lab/assets/main-1a2b.js",
        "http://127.0.0.1:8000/assets/main-1a2b.js",
        "http://127.0.0.1:8000/favicon.ico",
        "https://fonts.googleapis.com/css2",
        "data:,",
    ]
    assert qs.outside_base(urls, base) == ["http://127.0.0.1:8000/assets/main-1a2b.js", "http://127.0.0.1:8000/favicon.ico"]


def test_the_fonts_a_page_names_are_the_urls_of_its_font_face_rules_and_nothing_else():
    assert qs.font_urls(PAGE) == ["fonts/archivo-latin.woff2", "fonts/ibm-plex-mono-400-latin.woff2"]
    assert qs.font_urls("<style>body { color: red }</style>") == []


def test_a_font_the_page_names_and_the_folder_lacks_is_a_problem():
    assert qs.font_problems(GOOD, PAGE) == ["the page names fonts/ibm-plex-mono-400-latin.woff2, which the folder does not hold"]
    assert qs.font_problems([*GOOD, "fonts/ibm-plex-mono-400-latin.woff2"], PAGE) == []


# ---- the plant route on the assembled site (P9, docs/design/plant_ui.md section 11): scripts/qa/qa_site_plant.py ----
import qa_site_plant as qp  # noqa: E402

PLANT_CHUNK = "assets/plant_scene-Bq3x9Z.js"
LOADER_CHUNK = "assets/plant-loader-Cr7t2A.js"


def test_home_without_the_plant_chunk_and_an_entry_that_asks_for_it_once_have_no_problem():
    home = {"plant": [], "loader": [LOADER_CHUNK]}
    entered = {"plant": [PLANT_CHUNK], "loader": [LOADER_CHUNK]}
    assert qp.chunk_problems(home, entered) == []


def test_each_way_the_plant_chunk_can_be_requested_wrongly_is_named():
    home = {"plant": [], "loader": [LOADER_CHUNK]}
    entered = {"plant": [PLANT_CHUNK], "loader": [LOADER_CHUNK]}
    asked_on_home = qp.chunk_problems({"plant": [PLANT_CHUNK], "loader": [LOADER_CHUNK]}, entered)
    assert len(asked_on_home) == 1 and "Home requested the plant chunk" in asked_on_home[0]
    never = qp.chunk_problems(home, {"plant": [], "loader": [LOADER_CHUNK]})
    assert len(never) == 1 and "requested 0 plant chunks, expected 1" in never[0]
    twice = qp.chunk_problems(home, {"plant": [PLANT_CHUNK, "assets/plant_scene-Zz.js"], "loader": [LOADER_CHUNK]})
    assert len(twice) == 1 and "requested 2 plant chunks, expected 1" in twice[0]
    no_loader = qp.chunk_problems({"plant": [], "loader": []}, entered)
    assert len(no_loader) == 1 and "loader" in no_loader[0]


def test_the_public_site_offers_no_case_link_and_no_way_to_the_break_out_screen():
    ordinary = ["#/home", "#/plant", "#/plant?scenario=default&t=305626", "../", "#/lineage?from=plant&sample=U03-D10-2&plant=%23%2Fplant%3Fscenario%3Ddefault%26t%3D305626", "#/notes"]
    assert qp.offer_problems({"nav_breakout": False, "hrefs": ordinary, "drill_breakout": 0, "open_plant": False, "host_case": None}) == []


def test_each_trace_of_a_case_or_of_the_break_out_screen_on_the_public_site_is_named():
    clean = {"nav_breakout": False, "hrefs": ["#/plant"], "drill_breakout": 0, "open_plant": False, "host_case": None}
    bad = [
        ({"nav_breakout": True}, "link to the Break-out screen"),
        ({"hrefs": ["#/plant", "#/plant?case=sc12_medium_lot&arch=a_manual&seed=1"]}, "case"),
        ({"hrefs": ["#/lineage?from=plant&plant=%23%2Fplant%3Fcase%3Dsc12_medium_lot"]}, "case"),
        ({"hrefs": ["#/breakout"]}, "Break-out"),
        ({"drill_breakout": 1}, "drill-down"),
        ({"open_plant": True}, "from the Break-out screen"),
        ({"host_case": "sc12_medium_lot"}, "is a case"),
    ]
    for change, word in bad:
        problems = qp.offer_problems({**clean, **change})
        assert len(problems) == 1 and word in problems[0], (change, problems)


def test_where_a_trace_was_found_is_put_before_the_problem_when_it_is_given():
    facts = {"nav_breakout": False, "hrefs": ["#/plant?case=sc12_medium_lot"], "drill_breakout": 0, "open_plant": False, "host_case": None}
    assert qp.offer_problems(facts, "on Home") == ["on Home: the page links to a case: #/plant?case=sc12_medium_lot"]
    assert qp.offer_problems(facts) == ["the page links to a case: #/plant?case=sc12_medium_lot"]
