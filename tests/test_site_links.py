"""The link from the infographic to the lab (docs/design/lab_ui.md section 13; the S3a ruling, Open item 6: a link-only change under site/infographic/).

The Pages site holds the infographic at its root and the lab under lab/, so the link is the relative address `lab/` and works under any Pages path. The lab's way back (`../`) is tested in
src/ui/site_link.test.ts. scripts/qa/qa_site.py clicks both links on the assembled folder.
"""
from __future__ import annotations

import re

from helpers import REPO

INFOGRAPHIC = REPO / "site" / "infographic"
LINK = re.compile(r'<a\b[^>]*\bhref="lab/"[^>]*>(.*?)</a>', re.S)


def test_the_source_page_has_one_link_to_the_lab_with_a_relative_address():
    body = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    links = re.findall(r'<a\b[^>]*\bhref="(?!#)[^"]*"[^>]*>', body)
    to_lab = [a for a in links if 'href="lab/"' in a]
    assert len(to_lab) == 1
    assert 'data-i18n="ui.lab"' in to_lab[0]
    assert "target=" not in to_lab[0]


def test_the_link_text_is_in_english_in_the_page_and_in_korean_in_the_dictionary():
    body = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    assert LINK.search(body).group(1) == "Open the lab"
    ko = (INFOGRAPHIC / "src" / "i18n.js").read_text(encoding="utf-8")
    assert '"ui.lab": "랩 열기",' in ko


def test_the_committed_page_carries_the_link_and_its_korean_text():
    page = (INFOGRAPHIC / "index.html").read_text(encoding="utf-8")
    assert len(LINK.findall(page)) == 1
    assert '"ui.lab": "랩 열기"' in page


def test_nothing_else_of_the_page_changed_its_links():
    # the other addresses of the page: in-page anchors and the cited sources (https), plus the one link to the lab
    page = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    others = {h for h in re.findall(r'<a\b[^>]*\bhref="([^"]*)"', page) if not h.startswith(("#", "https://", "http://"))}
    assert others == {"lab/"}
