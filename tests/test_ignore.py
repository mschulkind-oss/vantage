"""Tests for the vantage ignore-file subsystem."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from vantage.services import ignore as ignore_mod
from vantage.services.fs_service import FileSystemService
from vantage.services.ignore import IgnoreMatcher, clear_matcher_cache, get_matcher


@pytest.fixture
def temp_repo(tmp_path: Path) -> Path:
    (tmp_path / "file1.md").write_text("hi")
    (tmp_path / ".yolo").mkdir()
    (tmp_path / ".yolo" / "sessions").mkdir()
    (tmp_path / ".yolo" / "sessions" / "noisy.md").write_text("noise")
    (tmp_path / ".worktrees").mkdir()
    (tmp_path / ".worktrees" / "wt").mkdir()
    (tmp_path / ".worktrees" / "wt" / "notes.md").write_text("wt")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "README.md").write_text("docs")
    return tmp_path


@pytest.fixture(autouse=True)
def _redirect_user_ignore(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point USER_IGNORE_PATH at a tmp file so tests don't read $HOME."""
    user_ignore = tmp_path / "user.ignore"
    monkeypatch.setattr(ignore_mod, "USER_IGNORE_PATH", user_ignore)
    clear_matcher_cache()
    yield
    clear_matcher_cache()


def test_matcher_with_no_files_ignores_nothing(temp_repo: Path):
    m = IgnoreMatcher(temp_repo)
    assert m.is_ignored("anything") is False
    assert m.is_ignored(".yolo/sessions/noisy.md") is False


def test_workspace_ignore_matches_directory(temp_repo: Path):
    (temp_repo / ".vantageignore").write_text(".yolo/\n.worktrees/\n")
    m = IgnoreMatcher(temp_repo)
    assert m.is_ignored(".yolo", is_dir=True)
    assert m.is_ignored(".yolo/sessions/noisy.md")
    assert m.is_ignored(".worktrees/wt/notes.md")
    assert not m.is_ignored("docs/README.md")


def test_user_and_workspace_layer(temp_repo: Path):
    ignore_mod.USER_IGNORE_PATH.write_text(".yolo/\n")
    (temp_repo / ".vantageignore").write_text(".worktrees/\n")
    m = IgnoreMatcher(temp_repo)
    assert m.is_ignored(".yolo/sessions/noisy.md")
    assert m.is_ignored(".worktrees/wt/notes.md")
    assert not m.is_ignored("docs/README.md")


def test_workspace_can_unignore(temp_repo: Path):
    ignore_mod.USER_IGNORE_PATH.write_text("*.md\n")
    (temp_repo / ".vantageignore").write_text("!docs/README.md\n")
    m = IgnoreMatcher(temp_repo)
    assert m.is_ignored("random.md")
    assert not m.is_ignored("docs/README.md")


def test_disabled_matcher_is_noop(temp_repo: Path):
    (temp_repo / ".vantageignore").write_text(".yolo/\n")
    m = IgnoreMatcher(temp_repo, enabled=False)
    assert m.is_ignored(".yolo/sessions/noisy.md") is False


def test_matcher_picks_up_edits(temp_repo: Path):
    ignore_file = temp_repo / ".vantageignore"
    ignore_file.write_text(".yolo/\n")
    m = IgnoreMatcher(temp_repo)
    assert m.is_ignored(".yolo/sessions/noisy.md")
    assert not m.is_ignored(".worktrees/wt/notes.md")

    # Simulate a later edit + bypass the debounce TTL
    ignore_file.write_text(".worktrees/\n")
    future = ignore_file.stat().st_mtime + 5
    os.utime(ignore_file, (future, future))
    m._last_check = 0.0
    assert m.is_ignored(".worktrees/wt/notes.md")
    assert not m.is_ignored(".yolo/sessions/noisy.md")


def test_get_matcher_respects_settings(temp_repo: Path, monkeypatch: pytest.MonkeyPatch):
    (temp_repo / ".vantageignore").write_text(".yolo/\n")
    from vantage.settings import settings

    monkeypatch.setattr(settings, "use_ignore_files", False)
    clear_matcher_cache()
    m = get_matcher(temp_repo)
    assert m.is_ignored(".yolo/sessions/noisy.md") is False

    monkeypatch.setattr(settings, "use_ignore_files", True)
    clear_matcher_cache()
    m = get_matcher(temp_repo)
    assert m.is_ignored(".yolo/sessions/noisy.md")


def test_explain_reports_matched_pattern(temp_repo: Path):
    ignore_mod.USER_IGNORE_PATH.write_text(".yolo/\n")
    (temp_repo / ".vantageignore").write_text(".worktrees/\n*.tmp\n!keep.tmp\n")
    m = IgnoreMatcher(temp_repo)
    assert m.explain(".yolo/sessions/noisy.md") == "user:.yolo/"
    assert m.explain(".worktrees/wt/notes.md") == "workspace:.worktrees/"
    # Direct negation un-matches the same pattern in the same file.
    assert m.explain("keep.tmp") is None
    assert m.explain("scratch.tmp") == "workspace:*.tmp"
    assert m.explain("docs/README.md") is None


def test_fs_list_directory_hides_ignored(temp_repo: Path):
    (temp_repo / ".vantageignore").write_text(".yolo/\n.worktrees/\n")
    fs = FileSystemService(temp_repo)
    names = {n.name for n in fs.list_directory(".")}
    assert ".yolo" not in names
    assert ".worktrees" not in names
    assert "docs" in names


def test_fs_list_all_files_prunes_ignored(temp_repo: Path):
    (temp_repo / ".vantageignore").write_text(".yolo/\n.worktrees/\n")
    fs = FileSystemService(temp_repo)
    files = fs.list_all_files()
    assert all(not f.startswith(".yolo/") for f in files)
    assert all(not f.startswith(".worktrees/") for f in files)
    assert "docs/README.md" in files
