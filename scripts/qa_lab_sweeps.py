"""The checks that visit the four screens of the lab page by language and theme for scripts/qa_lab.py: numbers (invariant 3), ko, matrix and contrast (docs/design/lab_ui.md sections 6, 10 and 12).

The contrast and viewport helpers come from qa_checks.py and qa_infographic.py (AHA: the sweeps over the theme matrix are a second copy here; a third copy would be extracted).
"""
from __future__ import annotations

from pathlib import Path

from qa_checks import KO_LIMIT, VIEWPORTS, Result, first_line, fmt_ratio, unchanged_keys
from qa_infographic import CONTRAST_JS, contrast_rows
from qa_lab_browser import NUMBERS_JS, apply_state, go, open_lab, prepare_page, set_lang, shown_screens, wait_final
from qa_lab_helpers import LAB_THEMES, LANGS, SCREENS, alter_reference, number_offenders


def check_numbers(browser, url) -> Result:
    """Every text node with a digit sits under a data-ref (an input with its ledger id), a data-result (an output) or a data-label (an identifier or count): invariant 3. All four screens,
    in both languages; the screens that need something to show (Results, Lineage, Challenge) after the small run, a lineage view and a started challenge."""
    offenders: list[dict] = []
    seen = refs = 0
    bad_ids: list[str] = []
    with open_lab(browser, url) as (page, _, _):
        wait_final(page)
        prepare_page(page)
        for lang in LANGS:
            set_lang(page, lang)
            for screen in shown_screens(page):
                go(page, screen)
                nodes = page.evaluate(NUMBERS_JS)
                seen += len(nodes)
                offenders += [{**o, "lang": lang, "screen": screen} for o in number_offenders(nodes)]
                bad_ids += page.evaluate("[...document.querySelectorAll('[data-ref]')].map(e => e.dataset.ref).filter(r => !/^([AS]\\d{3})( [AS]\\d{3})*$/.test(r))")
                refs += page.evaluate("document.querySelectorAll('[data-ref]').length")
    problems = [f"{o['lang']} {o['screen']} {o['where']}: '{o['text']}'" for o in offenders] + [f"malformed data-ref '{r}'" for r in bad_ids]
    return Result("numbers", not problems and refs > 0, f"{seen} text nodes with a digit on {len(SCREENS)} screens in two languages, {len(offenders)} outside a data-ref, data-result or data-label; {refs} inputs with a ledger id"
                  + (f" | {problems[0]}" if problems else ""), {"offenders": offenders})


def check_ko(browser, url) -> Result:
    text_js = "() => Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(e => [e.dataset.i18n, e.textContent.trim()]))"
    texts: dict[str, dict] = {}
    with open_lab(browser, url) as (page, _, _):
        wait_final(page)
        prepare_page(page)
        for lang in LANGS:
            set_lang(page, lang)
            texts[lang] = {}
            for screen in shown_screens(page):
                go(page, screen)
                texts[lang].update(page.evaluate(text_js))
    wide = 0
    with open_lab(browser, url, VIEWPORTS["390"]) as (page, _, _):
        wait_final(page)
        prepare_page(page)
        set_lang(page, "ko")
        for screen in shown_screens(page):
            go(page, screen)
            wide = max(wide, page.evaluate("document.documentElement.scrollWidth - window.innerWidth"))
    en, ko = texts["en"], texts["ko"]
    same = unchanged_keys(en, ko)
    frac = len(same) / len(en) if en else 1.0
    listed = ", ".join(same[:12]) + (" ..." if len(same) > 12 else "")
    detail = f"{len(same)}/{len(en)} [data-i18n] unchanged in KO over {len(SCREENS)} screens ({frac:.1%}, limit {KO_LIMIT:.0%})" + (f": {listed}" if same else "") + f"; horizontal overflow at 390px in KO: {max(wide, 0)} px"
    return Result("ko", bool(en) and frac <= KO_LIMIT and wide <= 0, detail, {"unchanged": same, "total": len(en)})


def run_cell(browser, url, out: Path, vp: str, label: str, theme: str, scheme: str, lang: str) -> dict:
    name = f"{vp}_{label}_{lang}"
    problems: list[str] = []
    bg = ""
    try:
        with open_lab(browser, url, VIEWPORTS[vp], scheme) as (page, errors, _):
            wait_final(page)
            prepare_page(page)
            problems += apply_state(page, theme, lang)
            for screen in shown_screens(page):
                go(page, screen)
                m = page.evaluate("({sw: document.documentElement.scrollWidth, iw: window.innerWidth, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()})")
                bg = m["bg"]
                if m["sw"] > m["iw"]:
                    problems.append(f"{screen}: horizontal scroll: scrollWidth {m['sw']} > innerWidth {m['iw']}")
                page.bring_to_front()  # a new context can hang the screenshot without it
                # the pages of Results, Lineage, Challenge and Break-out are tens of thousands of pixels tall at the narrow viewport: their picture is the first screen of each
                page.screenshot(path=str(out / "shots" / f"{name}_{screen}.png"), full_page=screen not in ("results", "lineage", "challenge", "breakout"))
            problems += [f"console: {e[:160]}" for e in errors]
    except Exception as e:
        problems.append(first_line(e))
    return {"cell": name, "vp": vp, "label": label, "lang": lang, "bg": bg, "problems": problems}


def check_matrix(browser, url, out: Path) -> Result:
    cells = [run_cell(browser, url, out, vp, label, theme, scheme, lang) for vp in VIEWPORTS for label, theme, scheme in LAB_THEMES for lang in LANGS]
    for vp in VIEWPORTS:  # `auto` must follow the emulated system scheme
        for lang in LANGS:
            bgs = {c["label"]: c["bg"] for c in cells if c["vp"] == vp and c["lang"] == lang and c["label"].startswith("auto")}
            if len(bgs) == 2 and bgs["auto-light"] == bgs["auto-dark"]:
                cells[0]["problems"].append(f"auto does not follow prefers-color-scheme at {vp}/{lang} (--bg '{bgs['auto-light']}' in both)")
    bad = [c for c in cells if c["problems"]]
    shown = "; ".join(f"{c['cell']}: {c['problems'][0]}" for c in bad[:4])
    return Result("matrix", not bad, f"{len(cells) - len(bad)}/{len(cells)} cells clean over {len(SCREENS)} screens" + (f" | {shown}" if bad else ""), {"cells": cells})


# the same page in the three settled states of the check: the colours of the chip and the banner differ per state, so each is swept; the other screens only in the state identical
STATES = [("identical", None), ("failed", "altered"), ("error", 404)]


def check_contrast(browser, url, root: Path) -> Result:
    altered = alter_reference((root / "reference.json").read_text(encoding="utf-8"))
    parts, ok = [], True
    for state, how in STATES:
        reference = altered if how == "altered" else how
        for label, theme, scheme in LAB_THEMES:
            with open_lab(browser, url, scheme=scheme, reference=reference) as (page, _, _):
                final = wait_final(page)
                apply_state(page, theme, "en")
                swept = {"home": page.evaluate(CONTRAST_JS)}
                if state == "identical":
                    prepare_page(page)
                    for screen in shown_screens(page)[1:]:
                        go(page, screen)
                        swept[screen] = page.evaluate(CONTRAST_JS)
            for screen, data in swept.items():
                token_ratio, _, rows = contrast_rows(data)
                low = sorted((r for r in rows if r["ratio"] < r["need"]), key=lambda r: r["ratio"])
                tokens_ok = bool(data["tokens"]["fgToken"] and data["tokens"]["bgToken"])
                cell_ok = final["state"] == state and token_ratio >= 4.5 and not low and tokens_ok
                ok &= cell_ok
                worst = f", worst {fmt_ratio(low[0]['ratio'])} {low[0]['sel']} '{low[0]['text']}'" if low else ""
                parts.append(f"{state}/{label}/{screen}: --fg/--bg {fmt_ratio(token_ratio)}, {len(low)}/{len(rows)} text colours below AA{worst}" + ("" if final["state"] == state else f" [state was {final['state']}]"))
    failed = [p for p in parts if " 0/" not in p or "[state was" in p]
    return Result("contrast", ok, " | ".join((failed or parts)[:3]) + f" | ... {len(parts)} cells", {"cells": parts})
