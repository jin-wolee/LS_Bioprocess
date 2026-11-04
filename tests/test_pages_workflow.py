"""The Pages workflow (.github/workflows/pages.yml, docs/design/lab_ui.md section 13).

The workflow is written here and run only by the author. These tests read the file: the trigger, the default of the one input, the pins of the actions, what gets uploaded and which steps run in
which order. They cannot run the workflow; scripts/assemble_site.py and scripts/qa/qa_site.py check the folder it uploads.
"""
from __future__ import annotations

import json
import re
from datetime import date

import pytest
import yaml

from helpers import REPO

WORKFLOW = REPO / ".github" / "workflows" / "pages.yml"

# Read from the public release lists and tags of each action on 2026-10-31 (api.github.com/repos/<owner>/<repo>/releases and /commits/<tag>); the release date is the one of the release page.
# The rule (the Preact rule of docs/prompts/30): a pinned release is at least two weeks old on the day it is pinned. Moving a pin means reading the new tag and date and changing this table first.
READ_ON = date(2026, 10, 31)
PINS = {
    "actions/checkout": ("v7.0.1", "3d3c42e5aac5ba805825da76410c181273ba90b1", date(2026, 7, 20)),
    "actions/setup-node": ("v7.1.0", "949feb2413d6458794dcd2491c4babbbce0c15c1", date(2026, 10, 8)),
    "astral-sh/setup-uv": ("v10.3.0", "1c37ad07a6a961277cf70c0d37d6f313000f5884", date(2026, 10, 9)),
    "actions/upload-pages-artifact": ("v5.0.0", "fc324d3547104276b827a68afc52ff2a11cc49c9", date(2026, 4, 10)),
    "actions/deploy-pages": ("v5.0.1", "368f82528645a54fb793d4d04e342629a3f51346", date(2026, 9, 1)),
}


@pytest.fixture(scope="module")
def text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def wf(text) -> dict:
    return yaml.safe_load(text)


def triggers(wf: dict) -> dict:
    """YAML 1.1 reads the key `on` as the boolean True."""
    return wf["on"] if "on" in wf else wf[True]


def steps(wf: dict, job: str) -> list[dict]:
    return wf["jobs"][job]["steps"]


def uses(wf: dict) -> list[dict]:
    return [s for job in wf["jobs"] for s in steps(wf, job) if "uses" in s]


def runs(wf: dict, job: str) -> list[str]:
    return [s["run"] for s in steps(wf, job) if "run" in s]


# ---------- the trigger ----------
def test_the_only_trigger_is_workflow_dispatch(wf):
    assert set(triggers(wf)) == {"workflow_dispatch"}


def test_the_one_input_is_a_boolean_that_defaults_to_false(wf):
    inputs = triggers(wf)["workflow_dispatch"]["inputs"]
    assert set(inputs) == {"deploy"}
    assert inputs["deploy"]["type"] == "boolean"
    assert inputs["deploy"]["default"] is False


def test_the_deploy_job_runs_only_when_the_input_is_true(wf):
    deploy = wf["jobs"]["deploy"]
    assert deploy["needs"] == "build"
    assert re.fullmatch(r"\$\{\{\s*inputs\.deploy\s*\}\}|inputs\.deploy", str(deploy["if"]).strip())


def test_there_are_exactly_the_build_and_the_deploy_job(wf):
    assert set(wf["jobs"]) == {"build", "deploy"}


# ---------- nothing is written to GitHub except by the deploy job ----------
def test_the_build_job_can_only_read(wf):
    assert wf["permissions"] == {"contents": "read"}
    assert "permissions" not in wf["jobs"]["build"]


def test_only_the_deploy_job_may_write_pages(wf):
    deploy = wf["jobs"]["deploy"]
    assert deploy["permissions"] == {"pages": "write", "id-token": "write"}
    assert deploy["environment"]["name"] == "github-pages"


def test_no_step_pushes_or_calls_the_github_cli(wf):
    commands = [c for job in wf["jobs"] for c in runs(wf, job)]
    assert not [c for c in commands if re.search(r"\bgit\s+push\b|\bgh\s|\bcurl\b", c)]


def test_the_checkout_keeps_no_token(wf):
    checkout = next(s for s in uses(wf) if s["uses"].startswith("actions/checkout@"))
    assert checkout["with"]["persist-credentials"] is False


# ---------- the pins ----------
def test_every_action_is_pinned_by_a_full_commit_sha_with_its_release_in_a_comment(text):
    lines = [ln.strip() for ln in text.splitlines() if re.match(r"\s*-?\s*uses:", ln)]
    assert lines, "no uses: lines found"
    for ln in lines:
        assert re.fullmatch(r"-?\s*uses:\s+[\w.-]+/[\w./-]+@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+", ln), ln


def test_the_pins_are_the_ones_read_on_the_dates_of_the_table(text):
    found = {action: (tag, sha) for action, sha, tag in re.findall(r"uses:\s+([\w.-]+/[\w./-]+)@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)", text)}
    assert found == {action: (tag, sha) for action, (tag, sha, _) in PINS.items()}


@pytest.mark.parametrize("action", sorted(PINS))
def test_each_pinned_release_was_at_least_two_weeks_old_when_it_was_read(action):
    assert (READ_ON - PINS[action][2]).days >= 14


# ---------- what is built, checked and uploaded ----------
def test_node_comes_from_package_json_and_nothing_is_cached(wf):
    node = next(s for s in uses(wf) if s["uses"].startswith("actions/setup-node@"))
    assert node["with"]["node-version-file"] == "package.json"  # R3: setup-node reads `engines.node` there
    assert json.loads((REPO / "package.json").read_text(encoding="utf-8"))["engines"]["node"] == "25"  # ADR-0016: Node stays at 25
    assert node["with"]["package-manager-cache"] is False
    uv = next(s for s in uses(wf) if s["uses"].startswith("astral-sh/setup-uv@"))
    assert uv["with"]["enable-cache"] is False


def test_uv_is_the_version_of_the_lockfile_toolchain(wf):
    uv = next(s for s in uses(wf) if s["uses"].startswith("astral-sh/setup-uv@"))
    assert re.fullmatch(r"\d+\.\d+\.\d+", str(uv["with"]["version"]))


def test_the_build_steps_run_in_this_order(wf):
    # P9 (audit item 21): the browser QA runs before anything is uploaded. The lab and plant QA build the lab as a local build into dist/lab, so the public build of assemble_site.py comes after them,
    # and the site QA checks that assembled folder, which is the one the upload step takes.
    wanted = ["npm ci", "uv sync --frozen", "check_docs.py --all --ci", "pytest -q", "npm run check", "playwright install", "scripts/qa/qa_lab.py", "scripts/qa/qa_plant.py", "scripts/assemble_site.py", "scripts/qa/qa_site.py"]
    commands = runs(wf, "build")
    at = []
    for fragment in wanted:
        hit = [i for i, c in enumerate(commands) if fragment in c]
        assert len(hit) == 1, f"{fragment!r} must be run by exactly one step, found {len(hit)}"
        at.append(hit[0])
    assert at == sorted(at)
    every = steps(wf, "build")
    uploads = [i for i, s in enumerate(every) if str(s.get("uses", "")).startswith("actions/upload-pages-artifact@")]
    assert len(uploads) == 1 and uploads[0] > max(i for i, s in enumerate(every) if "scripts/qa/qa_site.py" in s.get("run", ""))


def test_the_banned_token_list_comes_from_the_secret_in_one_step_only(wf):
    holders = [s for job in wf["jobs"] for s in steps(wf, job) if "GUARDRAIL_TERMS" in (s.get("env") or {})]
    assert len(holders) == 1
    assert holders[0]["env"]["GUARDRAIL_TERMS"] == "${{ secrets.GUARDRAIL_TERMS }}"
    assert "check_docs.py --all --ci" in holders[0]["run"]
    assert "env" not in wf  # no workflow-wide environment that every step would inherit


def test_the_uploaded_folder_is_the_assembled_one_and_never_site(wf):
    upload = next(s for s in uses(wf) if s["uses"].startswith("actions/upload-pages-artifact@"))
    assert upload["with"]["path"] == "dist/site"
    paths = [str(s["with"]["path"]).rstrip("/") for s in uses(wf) if "path" in (s.get("with") or {})]
    assert "site" not in paths
    assert not [c for job in wf["jobs"] for c in runs(wf, job) if re.search(r"(^|\s)site/?(\s|$)", c)]


def test_the_upload_keeps_the_hidden_file_nojekyll(wf):
    # upload-pages-artifact leaves out every dot file unless asked (its README, `include-hidden-files`)
    upload = next(s for s in uses(wf) if s["uses"].startswith("actions/upload-pages-artifact@"))
    assert upload["with"]["include-hidden-files"] is True


# ---------- the browser QA before a deploy (P9, audit item 21; the author's decision of 2026-11-03) ----------
def step_running(wf: dict, fragment: str) -> dict:
    found = [s for s in steps(wf, "build") if fragment in s.get("run", "")]
    assert len(found) == 1, fragment
    return found[0]


def test_chromium_is_installed_through_uv_from_the_lockfile_and_only_chromium(wf):
    # Playwright's own installer, run by the playwright of uv.lock: the browser build is the one that Playwright version pins. No other browser: the lab QA's `engines` check is left out of the workflow.
    install = step_running(wf, "playwright install")["run"].split()
    assert install[:3] == ["uv", "run", "--frozen"]
    assert install[3:6] == ["playwright", "install", "--with-deps"]
    assert install[6:] == ["chromium"]


def test_playwright_is_a_dependency_of_the_lockfile():
    lock = (REPO / "uv.lock").read_text(encoding="utf-8")
    assert re.search(r'^name = "playwright"\nversion = "\d+\.\d+\.\d+"', lock, re.M)


def test_each_browser_qa_runs_in_the_timing_mode_report_and_the_lab_qa_skips_the_other_engines(wf):
    # a CI runner's software renderer is not the machine of the budgets: the times are printed with their conditions and do not fail (scripts/qa/qa_timing.py); every other failure fails the run
    lab = step_running(wf, "scripts/qa/qa_lab.py")["run"]
    plant = step_running(wf, "scripts/qa/qa_plant.py")["run"]
    site = step_running(wf, "scripts/qa/qa_site.py")["run"]
    assert lab.split() == ["uv", "run", "--frozen", "python", "scripts/qa/qa_lab.py", "--timing", "report", "--no-engines"]
    assert plant.split() == ["uv", "run", "--frozen", "python", "scripts/qa/qa_plant.py", "--timing", "report"]
    assert site.split() == ["uv", "run", "--frozen", "python", "scripts/qa/qa_site.py", "--timing", "report"]


def test_no_step_of_the_build_job_may_fail_without_failing_the_job(wf):
    # the deploy job needs the build job, so a failed QA step blocks the deploy only if it fails the job: no continue-on-error, no `|| true`, no `; true`, no condition on a step
    for step in steps(wf, "build"):
        assert "continue-on-error" not in step, step.get("name")
        assert "if" not in step, step.get("name")
        assert not re.search(r"\|\|\s*(true|:|exit\s+0)|;\s*true\b|&\s*$", step.get("run", "")), step.get("name")
    assert "continue-on-error" not in wf["jobs"]["build"] and "continue-on-error" not in wf["jobs"]["deploy"]


def test_the_deploy_job_still_needs_the_build_job_and_the_build_job_cannot_run_for_hours(wf):
    assert wf["jobs"]["deploy"]["needs"] == "build"
    # C1 (the author, 2026-11-04): 90, not 60. On a private repository the runner has 2 CPUs, and the first run was cut off at 45 minutes inside the plant QA (13 min 16 s on 8 local CPUs).
    assert isinstance(wf["jobs"]["build"]["timeout-minutes"], int) and wf["jobs"]["build"]["timeout-minutes"] <= 90


def test_the_qa_steps_do_not_see_the_banned_token_secret(wf):
    for fragment in ("playwright install", "scripts/qa/qa_lab.py", "scripts/qa/qa_plant.py", "scripts/qa/qa_site.py"):
        assert "env" not in step_running(wf, fragment)
