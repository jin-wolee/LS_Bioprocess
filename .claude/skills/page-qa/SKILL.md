---
name: page-qa
description: Run the headless QA script for the infographic page and summarise qa_out/. Use after any change to the public page.
---

# page-qa

1. If `scripts/qa/qa_infographic.py` does not exist yet, say so and stop. Do not write it from this skill.
2. Run `uv run python scripts/qa/qa_infographic.py`. It must run headless. Never open a visible browser, never use `mcp__playwright__*`. If you need to look at the page yourself, use `mcp__playwright-headless__*` and call `browser_close` when done.
3. Summarise `qa_out/`: list the files, then quote each failing check with its selector or `file:line`. Look at screenshots only through the headless tools or the Read tool.
4. Report: pass or fail per check, the failures first, then anything suspicious that did not fail (overflow, empty states, badges without an id).
5. `qa_out/` is gitignored. Do not commit or copy its contents into tracked files.
