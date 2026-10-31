"""The language choice is carried between the two pages (S3h3; docs/design/lab_ui.md section 13; ADR-0006 keeps English the default).

On Pages the infographic (at the root) and the lab (under lab/) are one origin, so one localStorage key carries the choice. The infographic's script prefixes every key with `sll.`; the lab names its key
in src/i18n/index.ts. The expected key is typed by hand: `sll.lang`. src/i18n/lang_key.test.ts tests the lab's reading and writing; scripts/qa_site.py carries a choice across the click in a browser.
"""
from __future__ import annotations

import re

from helpers import REPO

KEY = "sll.lang"
APP_JS = REPO / "site" / "infographic" / "src" / "app.js"
PAGE = REPO / "site" / "infographic" / "index.html"
LAB_I18N = REPO / "src" / "i18n" / "index.ts"


def infographic_key(script: str) -> str:
    """The key the infographic reads and writes the language under: its storage prefix plus the name it passes to store.get and store.set."""
    prefix = re.search(r"localStorage\.getItem\('([^']*)' \+ k\)", script)
    reads = set(re.findall(r"store\.get\('(lang)'\)", script))
    writes = set(re.findall(r"store\.set\('(lang)', ", script))
    assert prefix and reads == writes == {"lang"}, "the infographic's language reads and writes no longer go through store.get('lang') and store.set('lang', ...)"
    return prefix.group(1) + "lang"


def lab_key(source: str) -> str:
    m = re.search(r'const STORAGE_KEY = "([^"]+)";', source)
    assert m, "src/i18n/index.ts no longer names STORAGE_KEY as a string constant"
    return m.group(1)


def test_the_infographic_keeps_its_language_under_the_shared_key():
    assert infographic_key(APP_JS.read_text(encoding="utf-8")) == KEY


def test_the_committed_page_keeps_its_language_under_the_shared_key():
    assert infographic_key(PAGE.read_text(encoding="utf-8")) == KEY


def test_the_lab_keeps_its_language_under_the_same_key():
    assert lab_key(LAB_I18N.read_text(encoding="utf-8")) == KEY


def test_the_two_pages_agree_without_the_hand_typed_value():
    assert infographic_key(APP_JS.read_text(encoding="utf-8")) == lab_key(LAB_I18N.read_text(encoding="utf-8"))


def test_the_lab_names_no_second_language_key():
    # one key carries the choice: another string constant under the lab's own prefix would split it again
    sources = [p for p in (REPO / "src").rglob("*.ts*") if ".test." not in p.name and "generated" not in p.parts]
    stray = [p.relative_to(REPO).as_posix() for p in sources if re.search(r"""['"]lab\.lang['"]""", p.read_text(encoding="utf-8"))]
    assert stray == []
