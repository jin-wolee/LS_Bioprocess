#!/usr/bin/env python3
"""Scan built site paths and decoded files using the CI guardrail list."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

from docs_rules import banned_hits, banned_message, load_terms


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ci", action="store_true", required=True)
    parser.parse_args()
    site = Path("dist/site")
    terms = load_terms(Path.cwd(), ci=True)
    if not terms or not site.is_dir():
        print("FAIL  site directory or CI token list missing", file=sys.stderr)
        return 1
    failures = 0
    try:
        for path in site.rglob("*"):
            hits = banned_hits(path.relative_to(site).as_posix(), terms)
            if path.is_file():
                hits = sorted(set(hits + banned_hits(path.read_bytes().decode("utf-8", errors="replace"), terms)))
            if hits:
                print(f"FAIL  site entry {banned_message(hits)}", file=sys.stderr)
                failures += 1
    except OSError:
        print("FAIL  unable to read site entry", file=sys.stderr)
        return 1
    print(f"check_site_tokens: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
