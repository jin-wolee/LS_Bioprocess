"""The name and the mark (B1): what stays when the author adjusts the drawing.

The name is the product's, so it is not translated: the lab's Korean `app.title` equals the English (a deliberate exception; the parity count of scripts/qa/qa_checks.py leaves that one key out and says why),
the explainer writes the English name in both languages, and both tab titles say it. The mark is one drawing in one file, docs/media/mark.svg (a sample tube, its liquid, and one line from its foot that
branches into the three records A, B and C: a circle, a square and a triangle, so the shape says which and the colour only repeats it, ADR-0011). It is made for this project in code under its licence and
no image file, font or icon set comes from anywhere else (ADR-0021's asset rule). Both pages inline that file in their header (decoration: `aria-hidden`, the name beside it stays text) and use it as their icon;
the READMEs show it beside the title. The page recolours it from its own theme tokens; the file carries a palette of its own (light and dark) for the places that cannot restyle it.

The expected values are typed here by hand. The browser side (the header in both themes, no overflow, the contrast and `ko` checks, the explainer's QA) is the QA scripts' and the screenshots of the report.
src/ui/mark.test.ts holds the lab's component; this file holds the rest.
"""
from __future__ import annotations

import html
import importlib.util
import re
import subprocess
import sys
import urllib.parse

import pytest

from helpers import REPO

sys.path.insert(0, str(REPO / "scripts" / "qa"))
import qa_checks as qc  # noqa: E402

MARK = REPO / "docs" / "media" / "mark.svg"
LAB_INDEX = REPO / "src" / "index.html"
LAB_CSS = REPO / "src" / "ui" / "style.css"
LAB_APP = REPO / "src" / "ui" / "App.tsx"
EXPLAINER = REPO / "site" / "infographic"
NAME = "Sample Lineage Lab"
MARK_LIMIT = 2048  # bytes: one small drawing
PALETTE = re.compile(r"<style>[\s\S]*?</style>\s*")


def mark() -> str:
    return MARK.read_text(encoding="utf-8")


def inline(text: str) -> str:
    """The drawing without the palette of the file: what a page inlines (the page's own stylesheet colours the three classes)."""
    return PALETTE.sub("", text).strip()


def build_module():
    spec = importlib.util.spec_from_file_location("infographic_build", EXPLAINER / "build.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    return build


def block(css: str, opening: str) -> str:
    """The declarations of the first rule that opens with `opening` (a selector as the stylesheet writes it, up to the brace)."""
    m = re.search(re.escape(opening) + r"\s*\{([^}]*)\}", css)
    assert m, f"no rule {opening!r}"
    return m.group(1)


def token(declarations: str, name: str) -> tuple[int, int, int]:
    m = re.search(rf"{re.escape(name)}\s*:\s*#([0-9a-fA-F]{{6}})", declarations)
    assert m, name
    h = m.group(1)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def hexes(text: str) -> list[tuple[int, int, int]]:
    return [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in re.findall(r"#([0-9a-fA-F]{6})", text)]


# ---- the drawing: one file, small, made in code ----------------------------------------------------------


def test_the_mark_is_one_small_svg_made_in_code_with_nothing_from_elsewhere():
    text = mark()
    assert len(text.encode("utf-8")) <= MARK_LIMIT
    assert text.startswith("<svg ") and text.rstrip().endswith("</svg>") and 'xmlns="http://www.w3.org/2000/svg"' in text
    assert not re.search(r"<(image|text|script|foreignObject|use)\b|href=|url\(|@import|@font-face|data:", text)  # no raster, no font, no icon set, no other file
    assert not (set(re.findall(r"<(\w+)", text)) - {"svg", "style", "path", "circle", "rect"})  # paths and basic shapes written for this project


def test_the_drawing_is_a_tube_its_liquid_and_a_line_that_branches_into_a_circle_a_square_and_a_triangle():
    body = inline(mark())
    assert len(re.findall(r'<path class="lm-l"', body)) == 1  # the liquid, in the accent
    assert len(re.findall(r'<path class="lm-i"', body)) == 1  # the tube and the line, one stroke
    assert re.findall(r'<(\w+) [^>]*class="lm-k"', body) == ["circle", "rect", "path"]  # the three ends, three shapes
    assert 'viewBox="0 0 24 24"' in body


def test_the_drawing_has_one_source_no_other_file_holds_its_shapes():
    shape = re.search(r'<path class="lm-i"[^>]* d="([^"]+)"', mark()).group(1)
    listed = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    holders = sorted(f for f in listed if f.endswith((".html", ".svg", ".ts", ".tsx", ".js", ".css", ".md", ".py")) and shape in (REPO / f).read_text(encoding="utf-8", errors="ignore"))
    # the file itself and the page the explainer's build writes from it (site/infographic/index.html); the lab reads the file at build time, the READMEs name it
    assert holders == ["docs/media/mark.svg", "site/infographic/index.html"]


# ---- the colours: the file's own palette, and the pages' tokens, each at 3:1 against its background ----------


def test_the_palette_of_the_file_is_legible_on_a_light_and_on_a_dark_page():
    text = mark()
    light = block(text, ".lm")
    dark = re.search(r"prefers-color-scheme:dark\)\{\.lm\{([^}]*)\}", text).group(1)
    white, night = (255, 255, 255), token(block(LAB_CSS.read_text(encoding="utf-8"), ':root[data-theme="dark"]'), "--bg")
    for name in ("--ink", "--accent"):
        assert qc.contrast_ratio(token(light, name), white) >= 3.0, name
        assert qc.contrast_ratio(token(dark, name), night) >= 3.0, name
    assert token(light, "--ink") != token(dark, "--ink")  # the dark version is a different palette


def test_the_lab_colours_the_mark_from_its_tokens_and_the_tokens_hold_3_to_1_in_every_theme():
    css = LAB_CSS.read_text(encoding="utf-8")
    assert re.search(r"\.mark \.lm-i\s*\{\s*stroke:\s*var\(--fg\);\s*\}", css)
    assert re.search(r"\.mark \.lm-k\s*\{\s*fill:\s*var\(--fg\);\s*\}", css)
    assert re.search(r"\.mark \.lm-l\s*\{\s*fill:\s*var\(--accent\);\s*\}", css)
    assert re.search(r"\.mark svg\s*\{\s*width:\s*24px;\s*height:\s*24px;\s*\}", css)
    for opening in (":root", ':root[data-theme="dark"]'):
        tokens = block(css, opening)
        for name in ("--fg", "--accent"):
            assert qc.contrast_ratio(token(tokens, name), token(tokens, "--bg")) >= 3.0, (opening, name)


def test_the_explainer_colours_the_mark_from_its_tokens_and_the_tokens_hold_3_to_1_in_every_theme():
    css = (EXPLAINER / "src" / "style.css").read_text(encoding="utf-8")
    assert re.search(r"\.brand \.lm-i\s*\{\s*stroke:\s*var\(--fg\);\s*\}", css)
    assert re.search(r"\.brand \.lm-k\s*\{\s*fill:\s*var\(--fg\);\s*\}", css)
    assert re.search(r"\.brand \.lm-l\s*\{\s*fill:\s*var\(--pen1\);\s*\}", css)
    for opening in (":root", ':root[data-theme="dark"]', ':root[data-skin="neon"]'):
        tokens = block(css, opening)
        for name in ("--fg", "--pen1"):
            assert qc.contrast_ratio(token(tokens, name), token(tokens, "--bg")) >= 3.0, (opening, name)


# ---- the name: the product's, not translated ---------------------------------------------------------------


def lab_title(path: str) -> str:
    return re.search(r'"app\.title":\s*"([^"]*)"', (REPO / "src" / "i18n" / path).read_text(encoding="utf-8")).group(1)


def test_the_lab_keeps_the_english_name_in_korean():
    assert lab_title("en.ts") == NAME
    assert lab_title("ko.ts") == NAME


def test_the_parity_count_leaves_that_one_key_out_and_still_counts_every_other_equal_text():
    assert qc.KEPT_IN_ENGLISH == {"app.title"}
    en = {"app.title": NAME, "nav.home": "Home", "nav.setup": "Setup"}
    assert qc.unchanged_keys(en, {"app.title": NAME, "nav.home": "홈", "nav.setup": "Setup"}) == ["nav.setup"]
    assert qc.unchanged_keys(en, {"app.title": "샘플 계보 랩", "nav.home": "홈", "nav.setup": "설정"}) == []  # the key is out of the count in either case
    assert "KEPT_IN_ENGLISH" in (REPO / "src" / "i18n" / "ko.ts").read_text(encoding="utf-8")  # and the dictionary says where the exception is counted


def test_the_old_korean_spellings_of_the_name_are_gone_from_the_pages_and_the_readmes():
    for path in (LAB_INDEX, LAB_APP, EXPLAINER / "src" / "body.html", EXPLAINER / "src" / "i18n.js", EXPLAINER / "index.html", REPO / "README.md", REPO / "README.ko.md", REPO / "src" / "i18n" / "ko.ts"):
        text = path.read_text(encoding="utf-8")
        assert "샘플 계보" not in text and "심플계보" not in text, path.name


# ---- the lab: icon and header --------------------------------------------------------------------------------


def test_the_lab_page_links_the_mark_as_its_icon_and_is_titled_with_the_name():
    page = LAB_INDEX.read_text(encoding="utf-8")
    icons = re.findall(r'<link rel="icon"[^>]*>', page)
    assert len(icons) == 1 and 'type="image/svg+xml"' in icons[0]
    href = re.search(r'href="([^"]+)"', icons[0]).group(1)
    assert (LAB_INDEX.parent / href).resolve() == MARK  # the one file, not a copy
    assert f"<title>{NAME}</title>" in page


def test_the_lab_header_holds_the_mark_before_the_name_and_the_name_stays_text_from_the_dictionary():
    app = LAB_APP.read_text(encoding="utf-8")
    header = re.search(r'<header class="top">\s*(<div class="logo">.*?</div>)', app, re.S).group(1)
    assert re.sub(r"\s+", " ", header) == '<div class="logo"> <Mark /> <T as="strong" k="app.title" class="brand" /> </div>'
    assert "<img" not in app and "<svg" not in app  # the drawing is not written into the header: the component reads the file (src/ui/Mark.tsx)
    component = (REPO / "src" / "ui" / "Mark.tsx").read_text(encoding="utf-8")
    assert 'aria-hidden="true"' in component and "docs/media/mark.svg?raw" in component


# ---- the explainer: icon, header, titles ---------------------------------------------------------------------


def explainer() -> str:
    return (EXPLAINER / "index.html").read_text(encoding="utf-8")


def test_the_explainer_page_links_the_mark_as_its_icon_and_is_titled_with_the_name():
    page = explainer()
    icons = re.findall(r'<link rel="icon"[^>]*>', page)
    assert len(icons) == 1 and 'type="image/svg+xml"' in icons[0]
    href = html.unescape(re.search(r'href="([^"]+)"', icons[0]).group(1))
    assert href.startswith("data:image/svg+xml,")
    assert urllib.parse.unquote(href[len("data:image/svg+xml,"):]).strip() == mark().strip()  # the file as it is, with its palette: a tab cannot restyle it
    assert f"<title>{NAME}</title>" in page


def test_the_explainer_header_holds_the_mark_hidden_from_readers_and_the_name_as_text_in_both_languages():
    page = explainer()
    brand = re.search(r'<p class="brand" lang="en">(.*?)</p>', page, re.S).group(1)
    drawing, name = brand.rsplit("</svg>", 1)
    assert (drawing + "</svg>") == inline(mark()).replace("<svg ", '<svg aria-hidden="true" ', 1)
    assert name == NAME  # text, right after the drawing
    assert "data-i18n" not in re.search(r'<p class="brand"[^>]*>', page).group(0) and 'data-i18n="brand' not in page  # no Korean text for it
    source = (EXPLAINER / "src" / "body.html").read_text(encoding="utf-8")
    assert re.search(r'<p class="brand" lang="en"><!--MARK-->' + NAME + "</p>", source)  # the source names the place; the build fills it from the file
    assert not re.search(r"<p class=\"brand\"><svg", source)


def test_the_build_writes_the_icon_and_the_header_mark_from_the_file_and_the_committed_page_is_that_output():
    build = build_module()
    page, fragment, errors = build.render()
    assert errors == []
    assert page == explainer()
    assert inline(mark()).replace("<svg ", '<svg aria-hidden="true" ', 1) in fragment and "<title>" + NAME + "</title>" in fragment


@pytest.mark.parametrize("path", ["README.md", "README.ko.md"])
def test_each_readme_shows_the_mark_beside_the_title(path):
    first = (REPO / path).read_text(encoding="utf-8").splitlines()[0]
    assert first == f"# ![](docs/media/mark.svg) {NAME}"
