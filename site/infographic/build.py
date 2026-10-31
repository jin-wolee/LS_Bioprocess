#!/usr/bin/env python3
"""Build the infographic from site/infographic/src into two files (stdlib only).

    uv run python site/infographic/build.py

  site/infographic/index.html         full standalone document (GitHub Pages)
  site/infographic/dist/artifact.html body-only fragment for the Artifact viewer (gitignored)

While assembling, the ledgers are read so that every `data-src` element gets its grade chip and any
citation of a source below `main-reread` without `data-status="provisional"` fails the build.
"""
from __future__ import annotations

import gzip
import html
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SRC = HERE / "src"
FONTS = ("https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800"
         "&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap")
DESCRIPTION = ("An explainer of how results lose their process context when N bioreactors send samples to two shared analyzers, "
               "with a link to the lab that runs the synthetic plant. Synthetic data; this page states no simulation result.")
RANK = {g: i for i, g in enumerate("SPDA")}
LABELS = {"S": ("sourced", "출처 확인"), "P": ("proxy", "대리지표"), "D": ("derived", "유도"), "A": ("assumed", "가정")}
PROVISIONAL = ("provisional", "잠정")


def unquote(v: str) -> str:
    v = v.strip()
    return v[1:-1] if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'" else v


def read_ledgers() -> tuple[dict, dict]:
    """Minimal line reader for the two ledger files (their layout is fixed by the ledger schema check)."""
    assumptions: dict[str, dict] = {}
    sources: dict[str, dict] = {}
    for path, store, prefix in (("assumptions.yaml", assumptions, "A"), ("sources.yaml", sources, "S")):
        cur = None
        for line in (REPO / "docs/research" / path).read_text(encoding="utf-8").splitlines():
            m = re.match(rf"  - id: ({prefix}\d{{3}})\s*$", line)
            if m:
                cur = store.setdefault(m.group(1), {})
                continue
            m = re.match(r"    (\w+): (.*)$", line)
            if cur is not None and m:
                key, val = m.groups()
                cur[key] = ([unquote(x) for x in val.strip()[1:-1].split(",") if x.strip()]
                            if key == "sources" else unquote(val))
    return assumptions, sources


def unverified(ref: str, assumptions: dict, sources: dict) -> list[str]:
    behind = [ref] if ref.startswith("S") else assumptions[ref].get("sources", [])
    return [s for s in behind if sources[s].get("verification") != "main-reread"]


def annotate(body: str, assumptions: dict, sources: dict, errors: list[str]) -> str:
    """Add data-grade and chip labels to every data-src element; enforce the provisional rule per element."""
    def one(m: re.Match) -> str:
        start = body.rfind("<", 0, m.start())
        tag = body[start:body.find(">", m.end())]
        prov = 'data-status="provisional"' in tag
        ids = m.group(1).split()
        line_no = body.count("\n", 0, m.start()) + 1
        unknown = [i for i in ids if i not in assumptions and i not in sources]
        if unknown:
            errors.append(f"body.html:{line_no}: unknown ledger id {unknown}")
            return m.group(0)
        weak = [i for i in ids if unverified(i, assumptions, sources)]
        if weak and not prov:
            errors.append(f"body.html:{line_no}: {weak} rest on a source below main-reread; add data-status=\"provisional\"")
        if prov and not weak:
            errors.append(f"body.html:{line_no}: marked provisional but {ids} are all main-reread")
        grades = [assumptions[i]["grade"] for i in ids if i.startswith("A")]
        grade = max(grades, key=RANK.get) if grades else ""
        en = [LABELS[grade][0]] if grade else []
        ko = [LABELS[grade][1]] if grade else []
        if prov:
            en.append(PROVISIONAL[0]); ko.append(PROVISIONAL[1])
        gl = lambda parts: "".join(f" · {p}" for p in parts)
        extra = (f' data-grade="{grade}"' if grade else "") + f' data-gl="{gl(en)}" data-gl-ko="{gl(ko)}"'
        return m.group(0) + extra
    return re.sub(r'data-src="([^"]+)"', one, body)


def source_list(sources: dict) -> str:
    rows = []
    for sid, s in sources.items():
        if s.get("verification") != "main-reread":
            continue
        title, pub, url = (html.escape(s.get(k, ""), quote=True) for k in ("title", "publisher", "url"))
        rows.append(f'<li data-src="{sid}" class="nochip"><span class="sid">{sid}</span>'
                    f'<span><a href="{url}" rel="noopener">{title}</a> <span class="pub">{pub}</span></span></li>')
    return "\n".join(rows)


def check_i18n(body: str, i18n: str, errors: list[str]) -> None:
    keys = set(re.findall(r'data-i18n(?:-aria)?="([^"]+)"', body))
    have = set(re.findall(r'^"([^"]+)":', i18n, re.M))
    for k in sorted(keys - have):
        errors.append(f"i18n.js: missing Korean for {k}")
    for k in sorted(have - keys):
        errors.append(f"i18n.js: unused key {k}")


def main() -> int:
    assumptions, sources = read_ledgers()
    body = (SRC / "body.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    i18n = (SRC / "i18n.js").read_text(encoding="utf-8")
    app = (SRC / "app.js").read_text(encoding="utf-8")
    errors: list[str] = []
    body = annotate(body, assumptions, sources, errors)
    body = body.replace("<!--SOURCES-->", source_list(sources))
    check_i18n(body, i18n, errors)
    if errors:
        print("\n".join(f"ERROR {e}" for e in errors), file=sys.stderr)
        return 1
    script = f"<script>\n{i18n}\n{app}</script>"
    page = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"<title>Sample Lineage Lab</title>\n<meta name=\"description\" content=\"{html.escape(DESCRIPTION, quote=True)}\">\n"
        "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n"
        "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n"
        f"<link rel=\"stylesheet\" href=\"{FONTS}\">\n<style>\n{css}</style>\n</head>\n<body>\n{body}{script}\n</body>\n</html>\n"
    )
    fragment = (
        "<title>Sample Lineage Lab</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n"
        f"<style>\n@import url('{FONTS}');\n{css}</style>\n{body}{script}\n"
    )
    (HERE / "dist").mkdir(exist_ok=True)
    (HERE / "index.html").write_text(page, encoding="utf-8")
    (HERE / "dist/artifact.html").write_text(fragment, encoding="utf-8")
    for p in (HERE / "index.html", HERE / "dist/artifact.html"):
        raw = p.read_bytes()
        print(f"{p.relative_to(REPO)}: {len(raw) / 1024:.1f} KB raw, {len(gzip.compress(raw, 9, mtime=0)) / 1024:.1f} KB gzip")
    return 0


if __name__ == "__main__":
    sys.exit(main())
