"""The explainer serves its own fonts (S3 hygiene FONT1; docs/design/lab_ui.md section 13).

`site/infographic/` used to load Archivo and IBM Plex Mono from Google, so every visitor's address went to a third party. The page now carries the two families as woff2 files under
`site/infographic/fonts/` (SIL Open Font License 1.1, the licence texts beside the files) and asks no other origin for anything.

The expected values are typed by hand from the brief: Archivo is one variable file per subset (width 62 to 125, weight 400 to 800), IBM Plex Mono has the weights 400, 500, 600 and 700, each family in
the subsets latin and latin-ext, and the Google link and the two preconnects are gone. The headless run of the same rule is `scripts/qa/qa_infographic.py` and `scripts/qa/qa_site.py` (check `origin`).
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import re
import shutil
import sys
from html.parser import HTMLParser

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_infographic as qa  # noqa: E402
import qa_site  # noqa: E402

INFOGRAPHIC = REPO / "site" / "infographic"
PAGE = INFOGRAPHIC / "index.html"
FONTS = INFOGRAPHIC / "fonts"

SUBSETS = {"latin": "U+0000-00FF", "latin-ext": "U+0100-02BA"}  # the first range of each subset
FILES = {
    ("Archivo", "400 800", "latin"): "archivo-latin.woff2",
    ("Archivo", "400 800", "latin-ext"): "archivo-latin-ext.woff2",
    **{("IBM Plex Mono", str(w), s): f"ibm-plex-mono-{w}-{s}.woff2" for w in (400, 500, 600, 700) for s in SUBSETS},
}
LICENCES = {"OFL-Archivo.txt": "Copyright 2020 The Archivo Project Authors", "OFL-IBM-Plex-Mono.txt": "Copyright © 2017 IBM Corp."}


# ---- what a browser fetches while it renders a page ---------------------------------------------------

FETCHING = {"link": "href", "script": "src", "img": "src", "iframe": "src", "source": "src", "video": "src", "audio": "src", "embed": "src", "object": "data", "track": "src", "input": "src"}
REMOTE = re.compile(r"^\s*(?:https?:)?//", re.I)
CSS_REF = re.compile(r"""(?:url\(\s*|@import\s+)["']?\s*((?:https?:)?//[^"')\s]+)""", re.I)


class Fetches(HTMLParser):
    """The addresses of other origins that a render asks for: link, script, image and frame attributes, `url()` and `@import` in style text. A link a reader may click (`<a href>`) is not one."""

    def __init__(self) -> None:
        super().__init__()
        self.found: list[str] = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "style":
            self.in_style = True
        if (value := attrs.get(FETCHING.get(tag, ""))) and REMOTE.match(value):
            self.found.append(value.strip())
        self.found += CSS_REF.findall(attrs.get("style") or "")

    def handle_endtag(self, tag):
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.found += CSS_REF.findall(data)


def other_origins(text: str) -> list[str]:
    scan = Fetches()
    scan.feed(text)
    return scan.found


def build_output():
    spec = importlib.util.spec_from_file_location("infographic_build", INFOGRAPHIC / "build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    page, fragment, errors = build.render()
    assert errors == []
    return page, fragment


def rules(css: str) -> list[dict]:
    """The `@font-face` rules of a style text as {descriptor: value}."""
    out = []
    for body in re.findall(r"@font-face\s*\{(.*?)\}", css, re.S):
        parts = [p.strip() for p in re.split(r";\s*(?=[\w-]+\s*:)", body.strip().rstrip(";")) if p.strip()]
        out.append({k.strip(): v.strip() for k, v in (p.split(":", 1) for p in parts)})
    return out


def key_of(rule: dict) -> tuple[str, str, str]:
    subset = next(name for name, first in SUBSETS.items() if rule["unicode-range"].startswith(first))
    return rule["font-family"].strip("\"'"), rule["font-weight"], subset


# ---- the scan itself ----------------------------------------------------------------------------------


def test_the_scan_finds_what_a_browser_would_fetch_and_not_what_a_reader_may_click():
    sample = (
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">'
        '<link rel="icon" href="//cdn.example.org/i.png">'
        '<style>@import url(\'https://a.example.org/x.css\'); @font-face { src: url(https://b.example.org/f.woff2); } p { background: url(img/a.png) }</style>'
        '<div style="background:url(http://c.example.org/b.png)"></div>'
        '<script src="https://d.example.org/s.js"></script>'
        '<a href="https://doi.org/10.1/x">a cited source</a><a href="lab/">lab</a>'
    )
    assert other_origins(sample) == [
        "https://fonts.googleapis.com", "https://fonts.googleapis.com/css2?family=X", "//cdn.example.org/i.png",
        "https://a.example.org/x.css", "https://b.example.org/f.woff2", "http://c.example.org/b.png", "https://d.example.org/s.js",
    ]


# ---- the page and the fragment ------------------------------------------------------------------------


def test_the_built_explainer_asks_no_other_origin_for_anything():
    assert other_origins(PAGE.read_text(encoding="utf-8")) == []


def test_the_artifact_fragment_asks_no_other_origin_for_anything():
    _, fragment = build_output()
    assert other_origins(fragment) == []


def test_the_committed_page_is_what_build_py_makes():
    page, _ = build_output()
    assert PAGE.read_text(encoding="utf-8") == page


def test_each_font_face_names_a_relative_file_that_exists_in_the_repository():
    faces = rules(PAGE.read_text(encoding="utf-8"))
    assert len(faces) == len(FILES) == 10
    for face in faces:
        m = re.fullmatch(r"url\((fonts/[\w.-]+\.woff2)\)\s+format\(['\"]woff2['\"]\)", face["src"])
        assert m, face["src"]
        assert (INFOGRAPHIC / m.group(1)).read_bytes()[:4] == b"wOF2", m.group(1)
        assert face["font-display"] == "swap"


def test_the_two_families_keep_their_names_axes_and_weights():
    faces = rules(PAGE.read_text(encoding="utf-8"))
    assert {key_of(f) for f in faces} == set(FILES)
    for f in faces:
        assert f["font-style"] == "normal"
        if f["font-family"].strip("\"'") == "Archivo":
            assert f["font-stretch"] == "62% 125%"
        else:
            assert "font-stretch" not in f


def test_each_face_reads_the_file_of_its_family_weight_and_subset():
    faces = rules(PAGE.read_text(encoding="utf-8"))
    assert len(faces) == 10
    for face in faces:
        assert face["src"].startswith(f"url(fonts/{FILES[key_of(face)]})"), (key_of(face), face["src"])


def test_the_style_sheet_still_asks_for_the_same_families_in_the_same_order():
    css = (INFOGRAPHIC / "src" / "style.css").read_text(encoding="utf-8")
    assert '--font-text: "Archivo", "Helvetica Neue", Arial,' in css
    assert '--font-mono: "IBM Plex Mono", ui-monospace,' in css


# ---- the files ----------------------------------------------------------------------------------------


def test_the_folder_holds_ten_fonts_two_licences_and_a_readme_and_nothing_else():
    assert sorted(p.name for p in FONTS.iterdir()) == sorted([*FILES.values(), *LICENCES, "README.md"])


@pytest.mark.parametrize("name, holder", LICENCES.items())
def test_each_licence_is_the_ofl_1_1_with_the_copyright_line_of_its_family(name, holder):
    text = (FONTS / name).read_text(encoding="utf-8")
    assert text.startswith(holder)
    assert "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007" in text
    assert "PERMISSION & CONDITIONS" in text


def test_the_readme_names_the_source_the_version_the_licence_and_the_hash_of_each_file():
    readme = (FONTS / "README.md").read_text(encoding="utf-8")
    assert "SIL Open Font License, Version 1.1" in readme
    for needle in ("Archivo", "2.001", "v25", "IBM Plex Mono", "2.3", "v20", "https://github.com/google/fonts/tree/main/ofl/archivo", "https://github.com/google/fonts/tree/main/ofl/ibmplexmono"):
        assert needle in readme, needle
    for name in FILES.values():
        raw = (FONTS / name).read_bytes()
        rows = [line for line in readme.splitlines() if line.startswith(f"| `{name}`")]
        assert len(rows) == 1, name
        assert hashlib.sha256(raw).hexdigest() in rows[0], name
        assert f" {len(raw)} " in rows[0], name
        assert re.search(r"https://fonts\.gstatic\.com/s/(archivo/v25|ibmplexmono/v20)/[\w-]+\.woff2", rows[0]), name


def test_the_fragment_carries_the_same_files_as_data_addresses():
    _, fragment = build_output()
    carried = []
    for face in rules(fragment):
        m = re.fullmatch(r"url\(data:font/woff2;base64,([A-Za-z0-9+/=]+)\)\s+format\(['\"]woff2['\"]\)", face["src"])
        assert m, face["src"][:80]
        carried.append(hashlib.sha256(base64.b64decode(m.group(1))).hexdigest())
    assert sorted(carried) == sorted(hashlib.sha256((FONTS / n).read_bytes()).hexdigest() for n in FILES.values())


# ---- the headless checks fail when the page asks another origin: needs headless chromium, skipped where it is not installed ----------------

@pytest.fixture(scope="module")
def browser():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        try:
            b = pw.chromium.launch(headless=True)
        except Exception as e:  # browser binary missing
            pytest.skip(f"headless chromium not available: {e}")
        yield b
        b.close()


def copy_page(dst):
    """The committed page with its fonts and its pictures, as the assembled folder holds them."""
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PAGE, dst / "index.html")
    shutil.copytree(FONTS, dst / "fonts")
    shutil.copytree(INFOGRAPHIC / "media", dst / "media")
    return dst / "index.html"


def test_the_infographic_check_passes_on_the_committed_page_and_sees_both_families_load(browser):
    with qa.serve(INFOGRAPHIC) as url:
        res = qa.check_origin(browser, url)
    assert res.ok, res.detail


def test_the_infographic_check_fails_when_the_page_asks_another_origin(browser, tmp_path):
    page = copy_page(tmp_path / "site")
    (tmp_path / "away").mkdir()
    (tmp_path / "away" / "x.css").write_text("/* another origin */")
    with qa.serve(tmp_path / "away") as away, qa.serve(tmp_path / "site") as url:
        page.write_text(page.read_text(encoding="utf-8").replace("<style>", f'<link rel="stylesheet" href="{away}x.css">\n<style>', 1), encoding="utf-8")
        res = qa.check_origin(browser, url)
    assert not res.ok
    assert f"asked another origin for {away}x.css" in res.detail


def test_the_infographic_check_fails_when_a_family_does_not_load(browser, tmp_path):
    page = copy_page(tmp_path / "site")
    page.write_text(page.read_text(encoding="utf-8").replace("url(fonts/archivo-", "url(fonts/gone-"), encoding="utf-8")
    with qa.serve(tmp_path / "site") as url:
        res = qa.check_origin(browser, url)
    assert not res.ok
    assert "Archivo did not load from the page's own files" in res.detail


def test_the_site_check_passes_on_the_page_served_under_the_repository_path(browser, tmp_path):
    copy_page(tmp_path / qa_site.SUBPATH)
    with qa.serve(tmp_path) as origin:
        res = qa_site.check_infographic_origin(browser, f"{origin}{qa_site.SUBPATH}/")
    assert res.ok, res.detail
    assert res.name == "infographic_origin"


def test_the_site_check_fails_on_another_origin_and_on_a_root_absolute_font_address(browser, tmp_path):
    page = copy_page(tmp_path / qa_site.SUBPATH)
    (tmp_path / "away").mkdir()
    (tmp_path / "away" / "x.css").write_text("/* another origin */")
    with qa.serve(tmp_path / "away") as away, qa.serve(tmp_path) as origin:
        text = page.read_text(encoding="utf-8").replace("url(fonts/", "url(/fonts/")  # works at the root of a server, fails under /<repository>/
        page.write_text(text.replace("<style>", f'<link rel="stylesheet" href="{away}x.css">\n<style>', 1), encoding="utf-8")
        res = qa_site.check_infographic_origin(browser, f"{origin}{qa_site.SUBPATH}/")
    assert not res.ok
    assert f"asked another origin for {away}x.css" in res.detail
    assert any("outside" in p and "/fonts/" in p for p in res.data["problems"])
