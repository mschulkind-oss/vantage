"""Vantage ignore-file support.

Vantage reads two optional ignore files, layered like gitignore:

* ``~/.config/vantage/ignore`` — user-level patterns that apply to every
  repo vantage serves.
* ``<repo>/.vantageignore`` — workspace-level patterns checked into the
  project.

Both files use full gitignore syntax (via ``pathspec``).  The workspace
file layers on top of the user file; ``!pattern`` un-ignores entries.

Ignored paths are hidden from three places:

* Recent-files search (``git_service.get_recently_changed_files``)
* Directory listings / sidebar (``fs_service.list_directory``,
  ``fs_service.list_all_files``)
* File-watcher broadcasts (``services.watcher``)

The whole subsystem can be disabled via ``use_ignore_files = false`` in
``~/.config/vantage/config.toml``.  When disabled, matchers act as if
both files were empty.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

from pathspec import GitIgnoreSpec

logger = logging.getLogger(__name__)

USER_IGNORE_PATH: Path = Path("~/.config/vantage/ignore").expanduser()
WORKSPACE_IGNORE_NAME: str = ".vantageignore"

# TTL (seconds) for reparsing ignore files.  We stat every call and
# reparse when mtime changes, but also cap how often we stat to keep
# hot paths cheap.
_RELOAD_CHECK_TTL = 2.0

_MatcherKey = tuple[str, bool]
_matcher_cache: dict[_MatcherKey, IgnoreMatcher] = {}


@dataclass
class _LoadedSpec:
    mtime: float
    path: Path
    lines: list[str]


class IgnoreMatcher:
    """Layered gitignore matcher for one repo root.

    Holds the combined user + workspace ``GitIgnoreSpec`` and exposes
    ``is_ignored(rel_path, is_dir)``.  Automatically reloads the two
    source files when they change on disk.
    """

    def __init__(self, repo_root: Path, *, enabled: bool = True):
        self.repo_root: Path = repo_root.resolve()
        self.enabled: bool = enabled
        self._user_loaded: _LoadedSpec | None = None
        self._workspace_loaded: _LoadedSpec | None = None
        self._combined: GitIgnoreSpec = GitIgnoreSpec.from_lines([])
        self._last_check: float = 0.0
        self._load_all(force=True)

    def is_ignored(self, rel_path: str, *, is_dir: bool = False) -> bool:
        """Return True if *rel_path* (relative to repo root) is ignored."""
        if not self.enabled:
            return False
        self._maybe_reload()
        # pathspec matches directories when the pattern ends with "/".
        # We append "/" for dirs so patterns like ".yolo/" catch them.
        normalized = rel_path.replace(os.sep, "/")
        if is_dir and not normalized.endswith("/"):
            normalized = normalized + "/"
        return self._combined.match_file(normalized)

    def explain(self, rel_path: str, *, is_dir: bool = False) -> str | None:
        """Return the source/pattern that matched *rel_path*, or None.

        Used by the watcher's DEBUG log so it's obvious *why* an event
        was dropped (e.g. ``user:.yolo/`` vs ``workspace:.worktrees/``).
        Applies last-match-wins semantics: a negation pattern (``!``)
        that follows a positive match clears the explanation.
        """
        if not self.enabled:
            return None
        normalized = rel_path.replace(os.sep, "/")
        if is_dir and not normalized.endswith("/"):
            normalized = normalized + "/"
        match: str | None = None
        for source, loaded in (
            ("user", self._user_loaded),
            ("workspace", self._workspace_loaded),
        ):
            if loaded is None:
                continue
            for line in loaded.lines:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if stripped.startswith("!"):
                    # Negation only meaningful when something currently
                    # matches; check the bare pattern against the path.
                    if match is None:
                        continue
                    bare = GitIgnoreSpec.from_lines([stripped[1:]])
                    if bare.match_file(normalized):
                        match = None
                    continue
                spec = GitIgnoreSpec.from_lines([stripped])
                if spec.match_file(normalized):
                    match = f"{source}:{stripped}"
        return match

    def _maybe_reload(self) -> None:
        now = time.monotonic()
        if now - self._last_check < _RELOAD_CHECK_TTL:
            return
        self._last_check = now
        self._load_all(force=False)

    def _load_all(self, *, force: bool) -> None:
        user_changed = self._reload_one(USER_IGNORE_PATH, "_user_loaded", force)
        ws_path = self.repo_root / WORKSPACE_IGNORE_NAME
        ws_changed = self._reload_one(ws_path, "_workspace_loaded", force)
        if force or user_changed or ws_changed:
            lines: list[str] = []
            if self._user_loaded is not None:
                lines.extend(self._user_loaded.lines)
            if self._workspace_loaded is not None:
                lines.extend(self._workspace_loaded.lines)
            # User rules are applied first, workspace rules override (last
            # match wins in gitignore semantics).
            self._combined = GitIgnoreSpec.from_lines(lines)

    def _reload_one(self, path: Path, attr: str, force: bool) -> bool:
        """Load *path* into ``self.<attr>``.  Return True if it changed."""
        current: _LoadedSpec | None = getattr(self, attr)
        try:
            st = path.stat()
        except OSError:
            if current is None:
                return False
            setattr(self, attr, None)
            logger.debug("[ignore] dropped %s (no longer present)", path)
            return True

        mtime = st.st_mtime
        if not force and current is not None and current.mtime == mtime and current.path == path:
            return False

        try:
            text = path.read_text(encoding="utf-8")
        except OSError as err:
            logger.debug("[ignore] failed to read %s: %s", path, err)
            if current is None:
                return False
            setattr(self, attr, None)
            return True

        lines = text.splitlines()
        setattr(self, attr, _LoadedSpec(mtime=mtime, path=path, lines=lines))
        logger.info("[ignore] loaded %s (%d lines)", path, len(lines))
        return True


def get_matcher(repo_root: Path) -> IgnoreMatcher:
    """Return a cached IgnoreMatcher for *repo_root*.

    Respects ``settings.use_ignore_files`` — when disabled, returns a
    no-op matcher.
    """
    # Local import avoids the settings module importing ignore at startup.
    from vantage.settings import settings

    enabled = settings.use_ignore_files
    key: _MatcherKey = (str(repo_root.resolve()), enabled)
    cached = _matcher_cache.get(key)
    if cached is not None:
        return cached
    matcher = IgnoreMatcher(repo_root, enabled=enabled)
    _matcher_cache[key] = matcher
    return matcher


def clear_matcher_cache() -> None:
    """Drop all cached matchers (e.g. after settings reload in tests)."""
    _matcher_cache.clear()
