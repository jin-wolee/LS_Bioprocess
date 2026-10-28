import pytest

from helpers import Repo


@pytest.fixture
def repo(tmp_path):
    return Repo(tmp_path / "repo")
