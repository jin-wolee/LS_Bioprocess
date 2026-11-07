"""Korean screenshot plans are tested without starting a browser or creating media."""
from contextlib import contextmanager
import inspect
from unittest.mock import Mock
import sys

from helpers import REPO

sys.path.insert(0, str(REPO / 'scripts' / 'media'))
sys.path.insert(0, str(REPO / 'scripts' / 'qa'))
import make_media  # noqa: E402
import media_files  # noqa: E402
import media_shots  # noqa: E402


def test_make_shots_requests_results_and_breakout_in_both_languages(monkeypatch, tmp_path):
    calls = []
    for name in ('plant_shot', 'tour_table_shot', 'lineage_shot', 'results_shot', 'breakout_shot'):
        monkeypatch.setattr(make_media, name, lambda browser, url, path, lang="en", name=name: calls.append((name, path.name, lang)))
    make_media.make_shots(object(), 'local', tmp_path)
    for kind in ('results', 'breakout'):
        for lang in ('en', 'ko'):
            assert (f'{kind}_shot', f'{kind}_{lang}.png', lang) in calls


def test_new_korean_screenshots_use_the_existing_size_limits():
    names = ['results_ko.png', 'breakout_ko.png']
    assert set(names) <= set(media_files.SHOTS_KO)
    found = [media_files.Found('results_ko.png', media_files.SHOT_MAX_BYTES + 1, 1280, 720)]
    problems = media_files.size_problems(found, names)
    assert any('results_ko.png' in p and 'limit' in p for p in problems)
    assert any('breakout_ko.png' in p and 'missing' in p for p in problems)


def test_screenshot_flows_apply_the_requested_language(monkeypatch, tmp_path):
    page = Mock()
    page.evaluate.return_value = None
    languages = []
    monkeypatch.setattr(media_shots, 'apply_state', lambda page, theme, lang: languages.append((theme, lang)) or [])
    @contextmanager
    def fake_lab(*args, **kwargs):
        yield page, [], []
    @contextmanager
    def fake_link(*args, **kwargs):
        yield page, []
    monkeypatch.setattr(media_shots, 'open_lab', fake_lab)
    monkeypatch.setattr(media_shots, 'open_link', fake_link)
    for name in ('go', 'wait_run', 'wait_scene', 'pause', 'seek', 'scroll_plant', 'settle_camera', 'save'):
        monkeypatch.setattr(media_shots, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(media_shots, 'state', lambda page: {'epoch': 1})
    monkeypatch.setattr(media_shots, 'plant_messages', lambda page: [])
    monkeypatch.setattr(media_shots, 'plan_from_messages', lambda *args: {})
    monkeypatch.setattr(media_shots, 'instants_of', lambda plan: {'results': 1})
    assert 'lang' in inspect.signature(media_shots.results_shot).parameters
    assert 'lang' in inspect.signature(media_shots.breakout_shot).parameters
    media_shots.results_shot(object(), 'local', tmp_path / 'results_ko.png', 'ko')
    media_shots.breakout_shot(object(), 'local', tmp_path / 'breakout_ko.png', 'ko')
    assert languages == [('light', 'ko'), ('light', 'ko')]
    assert any(call.args[0] == '[data-result][data-report]' for call in page.wait_for_selector.call_args_list)
    assert any(call.args[0] == '[data-plant-panel]' for call in page.wait_for_selector.call_args_list)


def test_media_build_delegates_to_shared_local_build(monkeypatch):
    monkeypatch.setattr(make_media, 'build_local_lab', lambda: 37, raising=False)
    if hasattr(make_media, 'subprocess'):
        monkeypatch.setattr(make_media.subprocess, 'run', lambda *args, **kwargs: Mock(returncode=0))
    assert make_media.build() == 37
