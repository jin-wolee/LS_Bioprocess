"""The links from the infographic to the lab (docs/design/lab_ui.md section 13; the S3a ruling, Open item 6: a link-only change under site/infographic/; P10 added the call to action of the first screen).

The Pages site holds the infographic at its root and the lab under lab/, so a link is the relative address `lab/` and works under any Pages path. The page has two: the one in the header
(`#lab-link`, which scripts/qa/qa_site.py clicks) and the small text link beside the call to action of the first section (`#hero-lab`; P11: the large button `#hero-follow` opens the plant, `lab/#/plant`,
and is tested in tests/test_explainer_visit.py). The lab's way back (`../`) is tested in src/ui/site_link.test.ts. qa_site.py clicks both links
on the assembled folder.
"""
from __future__ import annotations

import re

from helpers import REPO

INFOGRAPHIC = REPO / "site" / "infographic"
LINK = re.compile(r'<a\b[^>]*\bhref="lab/"[^>]*>(.*?)</a>', re.S)


def test_the_source_page_has_two_links_to_the_lab_the_header_one_and_the_call_to_action_both_with_a_relative_address():
    body = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    links = re.findall(r'<a\b[^>]*\bhref="(?!#)[^"]*"[^>]*>', body)
    to_lab = [a for a in links if 'href="lab/"' in a]
    assert len(to_lab) == 2
    assert [re.search(r'\bid="([^"]+)"', a).group(1) for a in to_lab] == ["lab-link", "hero-lab"]
    assert 'data-i18n="ui.lab"' in to_lab[0] and 'data-i18n="p.cta.lab"' in to_lab[1]
    for a in to_lab:
        assert "target=" not in a
    assert body.index('id="lab-link"') < body.index("<main>") < body.index('id="hero-lab"')  # one in the header, one in the first section


def test_the_link_text_is_in_english_in_the_page_and_in_korean_in_the_dictionary():
    body = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    assert [t for t in LINK.findall(body)] == ["Open the lab", "or open the lab"]
    ko = (INFOGRAPHIC / "src" / "i18n.js").read_text(encoding="utf-8")
    assert '"ui.lab": "랩 열기",' in ko and '"p.cta.lab": "랩 홈으로",' in ko


def test_the_committed_page_carries_the_links_and_their_korean_text():
    page = (INFOGRAPHIC / "index.html").read_text(encoding="utf-8")
    assert len(LINK.findall(page)) == 2
    assert '"ui.lab": "랩 열기"' in page and '"p.cta.lab": "랩 홈으로"' in page


def test_nothing_else_of_the_page_changed_its_links():
    # the other addresses of the page: in-page anchors, the cited sources and the repository (https), plus the links to the lab and, since P11, to the plant in it
    page = (INFOGRAPHIC / "src" / "body.html").read_text(encoding="utf-8")
    others = {h for h in re.findall(r'<a\b[^>]*\bhref="([^"]*)"', page) if not h.startswith(("#", "https://", "http://"))}
    assert others == {"lab/", "lab/#/plant"}
