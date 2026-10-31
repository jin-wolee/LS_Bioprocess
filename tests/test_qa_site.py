"""Pure helper of scripts/qa_site.py (the headless QA of the assembled site folder, docs/design/lab_ui.md section 13).

The expected problems are typed by hand from the rule of the design: the folder holds the infographic page at its root, the lab under lab/ and an empty .nojekyll, and nothing of site/infographic/
besides its index.html. The browser checks run through `uv run python scripts/qa_site.py`.
"""
from __future__ import annotations

import sys

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts"))
import qa_site as qs  # noqa: E402

GOOD = [".nojekyll", "index.html", "lab/assets/main-1a2b.js", "lab/index.html", "lab/reference.json"]


def test_the_folder_the_design_describes_has_no_problem():
    assert qs.folder_problems(GOOD, nojekyll_bytes=0) == []


def test_each_required_file_is_named_when_it_is_missing():
    for gone in (".nojekyll", "index.html", "lab/index.html", "lab/reference.json"):
        problems = qs.folder_problems([f for f in GOOD if f != gone], nojekyll_bytes=0)
        assert len(problems) == 1 and gone in problems[0], (gone, problems)


def test_anything_at_the_top_besides_the_page_the_lab_and_nojekyll_is_a_problem():
    for extra in ("build.py", "src/body.html", "dist/artifact.html", "lab-public/reference.json", "README.md"):
        problems = qs.folder_problems([*GOOD, extra], nojekyll_bytes=0)
        assert len(problems) == 1 and extra in problems[0], (extra, problems)


def test_nojekyll_must_be_empty():
    problems = qs.folder_problems(GOOD, nojekyll_bytes=3)
    assert len(problems) == 1 and ".nojekyll" in problems[0]


def test_a_request_of_the_served_origin_outside_the_path_of_the_site_is_found():
    # a root-absolute address (/assets/x.js) works at the root of a server and fails under /<repository>/; other origins and data: URLs are not this check's business
    base = "http://127.0.0.1:8000/sample-lineage-lab/"
    urls = [
        base + "lab/index.html",
        base + "lab/assets/main-1a2b.js",
        "http://127.0.0.1:8000/assets/main-1a2b.js",
        "http://127.0.0.1:8000/favicon.ico",
        "https://fonts.googleapis.com/css2",
        "data:,",
    ]
    assert qs.outside_base(urls, base) == ["http://127.0.0.1:8000/assets/main-1a2b.js", "http://127.0.0.1:8000/favicon.ico"]
