"""R4 documentation contracts, derived from the approved audit decisions."""
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]

@pytest.mark.parametrize(('path', 'phrase'), [
    ('README.md', 'recorded verbatim in `docs/adr/review_*.json`'),
    ('README.ko.md', '`docs/adr/review_*.json`에 그대로 기록'),
    ('docs/adr/README.md', 'recorded verbatim in `review_*.json`'),
    ('.claude/CLAUDE.md', 'Outputs appear with their input ids'),
    ('README.md', 'Simulation results appear with their input ids'),
    ('README.ko.md', '시뮬레이션 결과는 입력 id와 함께'),
    ('README.md', 'non-blocking CI step'),
    ('README.ko.md', '배포를 막지 않는 CI 단계'),
    ('README.md', 'The orchestrator runs `bash scripts/check_all.sh --manual` before a commit'),
    ('README.ko.md', '오케스트레이터가 커밋 전에 `bash scripts/check_all.sh --manual`을 실행'),
    ('README.md', '`.guardrails.local.txt` or `GUARDRAIL_TERMS`'),
    ('README.ko.md', '`.guardrails.local.txt` 또는 `GUARDRAIL_TERMS`'),
    ('README.md', 'the one-flag experiment card'),
    ('README.ko.md', '플래그 하나를 끄는 실험 카드'),
    ('README.md', 'the explainer hero picture'),
    ('README.ko.md', 'the explainer hero picture'),
    ('README.md', 'later increments use the scope in `docs/progress.md`'),
    ('README.ko.md', '이후 증분은 `docs/progress.md`에 적힌 범위'),
    ('docs/research/README.md', 'DOE range'),
    ('docs/research/README.md', 'unit is inferred'),
    ('docs/research/README.md', 'distributor specification'),
    ('docs/research/README.md', 'Section 6.13'),
    ('site/infographic/src/body.html', 'distributor specification'),
    ('site/infographic/src/body.html', 'unit is inferred'),
    ('site/infographic/src/body.html', 'one mini-scale system has a working volume'),
    ('site/infographic/src/body.html', 'lists controlled or synchronised clocks'),
    ('site/infographic/src/i18n.js', '단위는 원장에서 추론'),
    ('site/infographic/src/i18n.js', '유통사 사양'),
    ('site/infographic/src/i18n.js', '한 미니 규모 시스템의 작업 용량'),
    ('site/infographic/src/i18n.js', '가능하게 하는 요소로 열거'),
    ('site/infographic/src/body.html', 'The matrix below has no row for that'),
    ('README.md', 'Local build only'),
    ('README.ko.md', '로컬 빌드에서만 있으며 공개 빌드에는 없습니다'),
])
def test_approved_wording(path, phrase):
    assert phrase in (ROOT / path).read_text(encoding='utf-8')


def test_spec_parks_unverified_run_interpretation():
    spec = (ROOT / 'docs/design/simulation_spec.md').read_text(encoding='utf-8')
    assert 'First reading of the run' not in spec
    assert 'The report counts the offline values held' in spec


def test_readmes_do_not_restore_the_overstated_claims():
    english = (ROOT / 'README.md').read_text(encoding='utf-8')
    korean = (ROOT / 'README.ko.md').read_text(encoding='utf-8')
    for old in ('Every number on the pages carries', 'Only main-reread sources back a figure',
                'Each increment passes `scripts/check_all.sh`', 'all of its tests pass'):
        assert old not in english
    for old in ('페이지의 모든 수치에는', '공개 페이지의 수치는 main-reread 출처만',
                '각 증분은 커밋 전에', '테스트는 모두 통과합니다'):
        assert old not in korean
