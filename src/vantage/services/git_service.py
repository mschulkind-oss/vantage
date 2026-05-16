import contextlib
import logging
import os
import re
import stat as stat_module
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from git import Repo

from vantage.schemas.models import DiffHunk, DiffLine, FileDiff, GitCommit
from vantage.services.perf import timed
from vantage.settings import settings

logger = logging.getLogger(__name__)

# Lightweight TTL cache for recent-files results.  Keyed by
# (repo_path, limit, extensions_tuple).  Shared across GitService
# instances so multiple tabs hitting the same repo benefit.
_RecentFilesCacheKey = tuple[str, int, tuple[str, ...], bool, bool]
_recent_files_cache: dict[_RecentFilesCacheKey, tuple[float, list[dict[str, Any]]]] = {}
_RECENT_FILES_TTL = 30.0  # seconds — most expensive call, staleness is acceptable

# TTL cache for git status results.  Keyed by repo_path string.
# This is the single biggest perf win: git status -uall is ~4.5s on
# large repos and was being called 80+ times with no caching.
_status_cache: dict[str, tuple[float, dict[str, str]]] = {}
_STATUS_CACHE_TTL = 3.0  # seconds


def clear_recent_files_cache() -> None:
    """Flush the entire recent-files cache.

    Called by the file watcher when git state changes (commits, branch
    switches, etc.) are detected so the next API call returns fresh data.
    """
    _recent_files_cache.clear()
    logger.debug("Recent-files cache cleared")


def clear_status_cache() -> None:
    """Flush the git-status cache.

    Called by the file watcher alongside ``clear_recent_files_cache``
    so that the next ``get_working_dir_status`` call returns fresh data.
    """
    _status_cache.clear()
    logger.debug("Git-status cache cleared")


class GitService:
    repo_path: Path
    repo: Repo | None
    exclude_dirs: frozenset[str]

    def __init__(self, repo_path: Path, exclude_dirs: frozenset[str] | None = None):
        from vantage.config import DEFAULT_EXCLUDE_DIRS

        self.repo_path = repo_path.resolve()
        self.exclude_dirs = exclude_dirs if exclude_dirs is not None else DEFAULT_EXCLUDE_DIRS
        try:
            self.repo = Repo(repo_path, search_parent_directories=True)
        except Exception:
            self.repo = None

    def _get_repo_relative_path(self, path: str) -> str:
        """Convert a path relative to self.repo_path to be relative to the git repo root."""
        if not self.repo or not self.repo.working_dir:
            return path

        full_path = (self.repo_path / path).resolve()
        try:
            return str(full_path.relative_to(self.repo.working_dir))
        except ValueError:
            # Should not happen if repo_path is inside the git repo
            return path

    def _resolve_child_repo(self, path: str) -> tuple["GitService", str] | None:
        """Find the child git repo that owns *path* and return (service, child_relative_path).

        When ``self.repo_path`` is not a git repo (e.g. ``~/projects``)
        but contains child repos (``project_a/.git``), this lets all git
        operations transparently delegate to the correct child.

        Returns ``None`` if no child repo matches.
        """
        parts = path.replace("\\", "/").split("/")
        if len(parts) < 2:
            return None  # top-level file — no child repo
        child_name = parts[0]
        child_path = self.repo_path / child_name
        if not (child_path / ".git").exists():
            return None
        child_service = GitService(child_path, exclude_dirs=self.exclude_dirs)
        child_rel = "/".join(parts[1:])
        return child_service, child_rel

    @timed("git", "get_history")
    def get_history(self, path: str, limit: int = 10) -> list[GitCommit]:
        """Get commit history for a file using fast git subprocess."""
        if not self.repo or not self.repo.working_dir:
            child = self._resolve_child_repo(path)
            if child:
                return child[0].get_history(child[1], limit=limit)
            return []

        try:
            repo_path = self._get_repo_relative_path(path)
            # Use git log directly - much faster than GitPython's iter_commits
            # Format: hash\x00author_name\x00author_email\x00timestamp\x00subject
            result = subprocess.run(
                [
                    "git",
                    "log",
                    f"--max-count={limit}",
                    "--format=%H%x00%an%x00%ae%x00%ct%x00%s",
                    "--",
                    repo_path,
                ],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if result.returncode != 0:
                return []

            commits: list[GitCommit] = []
            for line in result.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split("\x00", 4)
                if len(parts) < 5:
                    continue
                hexsha, author_name, author_email, timestamp_str, message = parts
                commits.append(
                    GitCommit(
                        hexsha=hexsha,
                        author_name=author_name or "Unknown",
                        author_email=author_email or "",
                        date=datetime.fromtimestamp(int(timestamp_str), tz=UTC),
                        message=message,
                    )
                )
            return commits
        except Exception:
            return []

    def get_last_commit(self, path: str) -> GitCommit | None:
        history = self.get_history(path, limit=1)
        return history[0] if history else None

    @timed("git", "get_last_commits_batch")
    def get_last_commits_batch(self, paths: list[str]) -> dict[str, GitCommit]:
        """Get last commit for multiple paths in a single git log call.

        Much faster than calling get_last_commit N times.
        Returns a dict mapping path -> GitCommit.
        """
        if not self.repo or not self.repo.working_dir or not paths:
            if not paths:
                return {}
            # Delegate to child repos when parent is not a git repo
            child_result: dict[str, GitCommit] = {}
            for p in paths:
                child = self._resolve_child_repo(p)
                if child:
                    commit = child[0].get_last_commit(child[1])
                    if commit:
                        child_result[p] = commit
            return child_result

        result: dict[str, GitCommit] = {}
        remaining = set(paths)

        try:
            # Walk recent commits and match paths as we go
            # This is much faster than N individual git log calls
            repo_paths = {self._get_repo_relative_path(p): p for p in paths}
            proc = subprocess.run(
                [
                    "git",
                    "log",
                    "--max-count=500",
                    "--format=%H%x00%an%x00%ae%x00%ct%x00%s",
                    "--name-only",
                ],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if proc.returncode != 0:
                return {}

            current_commit: GitCommit | None = None
            for line in proc.stdout.splitlines():
                if not line:
                    continue
                if "\x00" in line:
                    # Commit line
                    parts = line.split("\x00", 4)
                    if len(parts) >= 5:
                        hexsha, author_name, author_email, ts, message = parts
                        current_commit = GitCommit(
                            hexsha=hexsha,
                            author_name=author_name or "Unknown",
                            author_email=author_email or "",
                            date=datetime.fromtimestamp(int(ts), tz=UTC),
                            message=message,
                        )
                elif current_commit:
                    # File path line
                    stripped = line.strip()
                    if stripped in repo_paths:
                        orig_path = repo_paths[stripped]
                        if orig_path in remaining:
                            result[orig_path] = current_commit
                            remaining.discard(orig_path)
                            if not remaining:
                                break
        except Exception:
            pass

        return result

    def get_repo_name(self) -> str:
        """Get the repository name from the working directory."""
        return self.repo_path.name

    @timed("git", "get_working_dir_status")
    def get_working_dir_status(self) -> dict[str, str]:
        """Get git status of files in the working directory.

        Returns a dict mapping relative-to-repo_path file paths to a status
        string: 'modified', 'added', 'deleted', or 'untracked'.

        Results are cached with a short TTL.  This is the single biggest
        performance win: ``git status -uall`` costs ~4.5 s on large repos
        and was previously called 80+ times per page load with no caching.

        Uses ``-unormal`` instead of ``-uall`` to avoid enumerating every
        individual untracked file in deeply nested trees (GroundTruthBlobEx2
        with 100K+ files was the production bottleneck).  ``-unormal`` shows
        untracked directories rather than individual files, which is
        sufficient for tree status annotations.
        """
        if not self.repo or not self.repo.working_dir:
            return {}

        cache_key = str(self.repo_path)
        now = time.monotonic()
        cached = _status_cache.get(cache_key)
        if cached is not None:
            ts, data = cached
            if now - ts < _STATUS_CACHE_TTL:
                logger.debug("git-status cache hit (age=%.1fs, entries=%d)", now - ts, len(data))
                return data

        result: dict[str, str] = {}
        try:
            proc = subprocess.run(
                ["git", "status", "--porcelain=v1", "-unormal"],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if proc.returncode != 0:
                return {}

            for line in proc.stdout.splitlines():
                if len(line) < 4:
                    continue
                xy = line[:2]
                file_path = line[3:].strip()
                # Handle renames: "R  old -> new"
                if " -> " in file_path:
                    file_path = file_path.split(" -> ", 1)[1]

                # Convert repo-relative path to our repo_path-relative
                full_path = Path(self.repo.working_dir) / file_path
                try:
                    rel_path = str(full_path.relative_to(self.repo_path))
                except ValueError:
                    continue

                # Map porcelain status codes to our status strings
                if xy == "??":
                    result[rel_path] = "untracked"
                elif "D" in xy:
                    result[rel_path] = "deleted"
                elif "A" in xy:
                    result[rel_path] = "added"
                else:
                    result[rel_path] = "modified"
        except Exception:
            pass

        _status_cache[cache_key] = (now, result)
        return result

    def _find_intent_to_add_files(self, status_output: str | None = None) -> set[str]:
        """Find files that have been staged with ``git add -N`` (intent-to-add).

        These files appear in ``git ls-files`` (so they look tracked) but have
        no commit history and show as ``" A"`` in ``git status --porcelain``.
        Returns a set of resolved absolute paths.

        If *status_output* is provided it is reused instead of running
        ``git status`` again.
        """
        ita_files: set[str] = set()
        if not self.repo or not self.repo.working_dir:
            return ita_files

        raw = status_output if status_output is not None else self._get_git_status_porcelain()
        for line in raw.splitlines():
            if len(line) < 4:
                continue
            xy = line[:2]
            if xy == " A":
                file_path = line[3:].strip()
                full_path = Path(self.repo.working_dir) / file_path
                ita_files.add(str(full_path.resolve()))

        return ita_files

    def _get_git_status_porcelain(self) -> str:
        """Run ``git status --porcelain=v1 -uno`` once and return raw output.

        Uses ``-uno`` (no untracked enumeration) for speed.  Intent-to-add
        files still appear because they are in the index.  Callers that
        need untracked files should use ``git ls-files --others`` instead.
        """
        if not self.repo or not self.repo.working_dir:
            return ""
        with contextlib.suppress(Exception):
            proc = subprocess.run(
                ["git", "status", "--porcelain=v1", "-uno"],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if proc.returncode == 0:
                return proc.stdout
        return ""

    def _find_untracked_md_files(self, status_output: str | None = None) -> list[dict[str, Any]]:
        """Find .md files that are not tracked by git (or are intent-to-add),
        sorted by mtime descending.

        Uses ``git ls-files --others`` for fast C-level directory traversal
        instead of Python ``os.walk``.  Falls back to ``os.walk`` when
        there is no git repository.
        """
        results: list[dict[str, Any]] = []

        if self.repo and self.repo.working_dir:
            # Fast path: git ls-files --others with explicit exclude patterns
            cmd: list[str] = ["git", "ls-files", "--others"]
            for d in self.exclude_dirs:
                cmd.extend(["--exclude", d])
            # Also exclude hidden directories (matches old os.walk behaviour)
            cmd.extend(["--exclude", ".*"])
            # Layer in vantage's user/workspace ignore files so the git
            # walk prunes these subtrees at the C level.
            from vantage.services.ignore import USER_IGNORE_PATH, WORKSPACE_IGNORE_NAME

            if settings.use_ignore_files:
                if USER_IGNORE_PATH.is_file():
                    cmd.extend(["--exclude-from", str(USER_IGNORE_PATH)])
                ws_ignore = self.repo_path / WORKSPACE_IGNORE_NAME
                if ws_ignore.is_file():
                    cmd.extend(["--exclude-from", str(ws_ignore)])

            with contextlib.suppress(Exception):
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    cwd=self.repo_path,
                    timeout=10,
                )
                if proc.returncode == 0:
                    for line in proc.stdout.splitlines():
                        if not line or not line.lower().endswith(".md"):
                            continue
                        full = self.repo_path / line
                        try:
                            mtime = full.stat().st_mtime
                            results.append(
                                {
                                    "path": line,
                                    "date": datetime.fromtimestamp(mtime, tz=UTC).isoformat(),
                                    "author_name": "",
                                    "message": "",
                                    "hexsha": "",
                                    "untracked": True,
                                }
                            )
                        except OSError:
                            continue

            # Intent-to-add files are in the index but have no commit.
            # They don't appear in --others, so detect them separately.
            ita_files = self._find_intent_to_add_files(status_output=status_output)
            seen = {r["path"] for r in results}
            for resolved in ita_files:
                full = Path(resolved)
                if not str(full).lower().endswith(".md"):
                    continue
                try:
                    rel_path = str(full.relative_to(self.repo_path))
                except ValueError:
                    continue
                if rel_path in seen:
                    continue
                parts = rel_path.split("/")
                if any(p in self.exclude_dirs or p.startswith(".") for p in parts[:-1]):
                    continue
                try:
                    mtime = full.stat().st_mtime
                    results.append(
                        {
                            "path": rel_path,
                            "date": datetime.fromtimestamp(mtime, tz=UTC).isoformat(),
                            "author_name": "",
                            "message": "",
                            "hexsha": "",
                            "untracked": True,
                        }
                    )
                except OSError:
                    continue
        else:
            # No git repo – fall back to filesystem walk
            def _on_walk_error(err: OSError) -> None:
                logger.debug("get_recently_changed_files: skipping unreadable path: %s", err)

            for dirpath, dirnames, filenames in os.walk(self.repo_path, onerror=_on_walk_error):
                dirnames[:] = [
                    d for d in dirnames if not d.startswith(".") and d not in self.exclude_dirs
                ]
                for fname in filenames:
                    if not fname.lower().endswith(".md"):
                        continue
                    full = Path(dirpath) / fname
                    try:
                        rel_path = str(full.relative_to(self.repo_path))
                        mtime = full.stat().st_mtime
                        results.append(
                            {
                                "path": rel_path,
                                "date": datetime.fromtimestamp(mtime, tz=UTC).isoformat(),
                                "author_name": "",
                                "message": "",
                                "hexsha": "",
                                "untracked": True,
                            }
                        )
                    except OSError:
                        continue

        results.sort(key=lambda r: r["date"], reverse=True)
        return results

    def _build_tracked_set(self) -> set[str]:
        """Build a set of tracked file paths relative to ``self.repo_path``.

        Uses ``git ls-files`` (typically <20 ms even on large repos).
        The set is used to distinguish untracked files during filesystem
        walks without needing the much slower ``git ls-files --others``.
        """
        tracked: set[str] = set()
        if not self.repo or not self.repo.working_dir:
            return tracked
        with contextlib.suppress(Exception):
            proc = subprocess.run(
                ["git", "ls-files"],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if proc.returncode != 0:
                return tracked
            wd = Path(self.repo.working_dir)
            if self.repo_path == wd or self.repo_path == wd.resolve():
                # Common case – repo_path IS the git root.
                tracked = set(proc.stdout.splitlines())
            else:
                # Subdirectory – filter & convert to repo_path-relative.
                try:
                    prefix = str(self.repo_path.relative_to(wd)) + "/"
                except ValueError:
                    return tracked
                for line in proc.stdout.splitlines():
                    if line.startswith(prefix):
                        tracked.add(line[len(prefix) :])
        return tracked

    def _discover_child_git_repos(self) -> list[Path]:
        """Discover immediate child directories that are git repositories.

        Used when ``self.repo_path`` is not itself a git repo (e.g.
        ``~/projects`` containing ``project_a/.git``, ``project_b/.git``).
        Only checks one level deep — nested repos are handled by the
        per-child ``GitService``.
        """
        child_repos: list[Path] = []
        try:
            scandir_iter = os.scandir(self.repo_path)
        except PermissionError:
            logger.debug("Permission denied scanning for child repos: %s", self.repo_path)
            return child_repos
        except OSError:
            return child_repos
        for entry in scandir_iter:
            try:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                if entry.name.startswith(".") or entry.name in self.exclude_dirs:
                    continue
                git_dir = Path(entry.path) / ".git"
                if git_dir.exists():
                    child_repos.append(Path(entry.path))
            except PermissionError:
                logger.debug("Permission denied on entry: %s", entry.path)
                continue
            except OSError:
                continue
        return child_repos

    def _get_recent_files_from_child_repos(
        self,
        child_repos: list[Path],
        limit: int,
        extensions: list[str] | None,
    ) -> list[dict[str, Any]]:
        """Aggregate recent files from multiple child git repos.

        For each child repo, delegates to a per-repo ``GitService``.
        Also collects top-level .md files and .md files in non-git
        subdirectories as untracked.  All results are merged and sorted
        by date descending.
        """
        if extensions is None:
            extensions = [".md"]
        ext_lower = tuple(e.lower() for e in extensions)

        def _matches_ext(name: str) -> bool:
            return any(name.lower().endswith(e) for e in ext_lower)

        child_repo_names = {p.name for p in child_repos}
        all_results: list[dict[str, Any]] = []

        # Collect results from each child git repo (reuse per-repo logic).
        for child_path in child_repos:
            child_service = GitService(child_path, exclude_dirs=self.exclude_dirs)
            child_results = child_service.get_recently_changed_files(
                limit=limit, extensions=extensions
            )
            prefix = child_path.name + "/"
            for entry in child_results:
                # Prefix paths so they're relative to self.repo_path
                entry["path"] = prefix + entry["path"]
                all_results.append(entry)

        def _on_walk_error(err: OSError) -> None:
            logger.debug("_get_recent_files_from_child_repos: skipping unreadable path: %s", err)

        # Collect .md files from top level and non-git subdirectories.
        try:
            top_entries = list(os.scandir(self.repo_path))
        except PermissionError:
            logger.debug("Permission denied scanning top-level repo: %s", self.repo_path)
            top_entries = []
        except OSError:
            top_entries = []

        for entry in top_entries:
            try:
                if entry.is_symlink():
                    continue  # Skip symlinks in recents
                if entry.is_file(follow_symlinks=True) and _matches_ext(entry.name):
                    try:
                        st = entry.stat()
                        all_results.append(
                            {
                                "path": entry.name,
                                "date": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
                                "author_name": "",
                                "message": "",
                                "hexsha": "",
                                "untracked": True,
                            }
                        )
                    except OSError:
                        continue
                elif entry.is_dir(follow_symlinks=False):
                    if entry.name.startswith(".") or entry.name in self.exclude_dirs:
                        continue
                    if entry.name in child_repo_names:
                        continue  # already handled above
                    # Non-git subdirectory — walk for .md files (all untracked)
                    for dirpath, dirnames, filenames in os.walk(entry.path, onerror=_on_walk_error):
                        dirnames[:] = [
                            d
                            for d in dirnames
                            if not d.startswith(".") and d not in self.exclude_dirs
                        ]
                        for fname in filenames:
                            if not _matches_ext(fname):
                                continue
                            full = Path(dirpath) / fname
                            if full.is_symlink():
                                continue  # Skip symlinks in recents
                            try:
                                rel = str(full.relative_to(self.repo_path))
                                st = full.stat()
                                all_results.append(
                                    {
                                        "path": rel,
                                        "date": datetime.fromtimestamp(
                                            st.st_mtime, tz=UTC
                                        ).isoformat(),
                                        "author_name": "",
                                        "message": "",
                                        "hexsha": "",
                                        "untracked": True,
                                    }
                                )
                            except OSError:
                                continue
            except PermissionError:
                logger.debug("Permission denied on entry: %s", entry.path)
                continue
            except OSError:
                continue

        all_results.sort(key=lambda r: r["date"], reverse=True)
        return all_results[:limit]

    @timed("git", "get_recently_changed_files")
    def get_recently_changed_files(
        self,
        limit: int = 30,
        extensions: list[str] | None = None,
        show_hidden: bool = True,
        show_gitignored: bool = True,
    ) -> list[dict[str, Any]]:
        """Get the most recently changed files across the repo.

        Returns a single list sorted strictly by date descending (most
        recently modified first).  Untracked files and tracked files are
        merged and sorted together so that ordering is always by recency.

        Excludes directories listed in self.exclude_dirs (configurable).
        Results are cached for a short TTL to handle multi-tab request storms.

        Performance
        -----------
        * Untracked-file discovery uses ``git ls-files --others`` which
          delegates the directory walk to git's optimized C implementation.
          This is dramatically faster than Python's ``os.walk`` on large
          repos (100K+ files) since git respects ``.gitignore`` natively
          and avoids per-file Python overhead.
        * ``git log``, ``git status``, and untracked-file listing all run
          concurrently in a single ``ThreadPoolExecutor`` so wall-clock
          time ≈ max(individual tasks).
        * File-existence and mtime checks use a single ``os.stat()``
          call instead of separate ``is_file()`` + ``stat()``.
        """
        if extensions is None:
            extensions = [".md"]

        cache_key = (str(self.repo_path), limit, tuple(extensions), show_hidden, show_gitignored)
        now = time.monotonic()
        cached = _recent_files_cache.get(cache_key)
        if cached is not None:
            ts, data = cached
            if now - ts < _RECENT_FILES_TTL:
                logger.debug("Recent-files cache hit (age=%.1fs, items=%d)", now - ts, len(data))
                return data
            logger.debug("Recent-files cache expired (age=%.1fs)", now - ts)
        else:
            logger.debug("Recent-files cache miss")

        exclude = self.exclude_dirs
        ext_lower = tuple(e.lower() for e in extensions)

        from vantage.services.ignore import get_matcher

        ignore_matcher = get_matcher(self.repo_path)

        def _matches_ext(name: str) -> bool:
            lower = name.lower()
            return any(lower.endswith(e) for e in ext_lower)

        def should_skip(path: str) -> bool:
            """Check if a path falls under an excluded directory or ignore file."""
            parts = path.split("/")
            if any(part in exclude for part in parts):
                return True
            return ignore_matcher.is_ignored(path)

        if not self.repo or not self.repo.working_dir:
            # No git repo at repo_path itself.  Check for child git repos
            # (e.g. ~/projects containing skill_dev/.git, blog/.git, …).
            child_repos = self._discover_child_git_repos()
            if child_repos:
                merged = self._get_recent_files_from_child_repos(child_repos, limit, extensions)
                _recent_files_cache[cache_key] = (time.monotonic(), merged)
                return merged

            # Truly no git – filesystem walk only
            untracked = self._find_untracked_md_files()
            no_git_results = [f for f in untracked if not should_skip(f["path"])]
            no_git_results.sort(key=lambda r: r["date"], reverse=True)
            trimmed = no_git_results[:limit]
            _recent_files_cache[cache_key] = (time.monotonic(), trimmed)
            return trimmed

        working_dir = self.repo.working_dir

        # Extension globs for git ls-files (e.g. ['*.md', '*.markdown'])
        ext_globs = [f"*{e}" for e in ext_lower]

        # ------------------------------------------------------------------
        # Worker: git ls-files --others to find untracked files.
        # Delegates the directory walk to git's optimized C implementation
        # which respects .gitignore natively and is dramatically faster
        # than Python's os.walk on large repos (100K+ files).
        # ------------------------------------------------------------------
        # Pass vantage's ignore files to git ls-files so the C-level walk
        # prunes these subtrees before returning paths.  Without this,
        # git walks the entire repo (incl. .yolo/, .worktrees/, …) and
        # our post-filter only trims the result list — no time is saved.
        from vantage.services.ignore import USER_IGNORE_PATH, WORKSPACE_IGNORE_NAME

        _extra_exclude_args: list[str] = []
        if settings.use_ignore_files:
            if USER_IGNORE_PATH.is_file():
                _extra_exclude_args.extend(["--exclude-from", str(USER_IGNORE_PATH)])
            ws_ignore = self.repo_path / WORKSPACE_IGNORE_NAME
            if ws_ignore.is_file():
                _extra_exclude_args.extend(["--exclude-from", str(ws_ignore)])

        def _git_ls_untracked() -> str:
            timeout = settings.walk_timeout
            with contextlib.suppress(Exception):
                cmd = [
                    "git",
                    "ls-files",
                    "--others",
                    *(["--exclude-standard"] if not show_gitignored else []),
                    *_extra_exclude_args,
                    "--",
                    *ext_globs,
                ]
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    cwd=working_dir,
                    timeout=timeout,
                )
                if proc.returncode == 0:
                    return proc.stdout
            return ""

        # ------------------------------------------------------------------
        # Git helpers executed in the thread pool.
        # ------------------------------------------------------------------
        def _git_log() -> str:
            with contextlib.suppress(Exception):
                proc = subprocess.run(
                    [
                        "git",
                        "log",
                        "--max-count=50",
                        "--format=%H%x00%an%x00%ct%x00%s",
                        "--name-only",
                        "--diff-filter=ACDMR",
                    ],
                    capture_output=True,
                    text=True,
                    cwd=working_dir,
                    timeout=10,
                )
                if proc.returncode == 0:
                    return proc.stdout
            return ""

        def _git_status_ita() -> str:
            with contextlib.suppress(Exception):
                proc = subprocess.run(
                    ["git", "status", "--porcelain=v1", "-uno"],
                    capture_output=True,
                    text=True,
                    cwd=working_dir,
                    timeout=10,
                )
                if proc.returncode == 0:
                    return proc.stdout
            return ""

        # ------------------------------------------------------------------
        # Step 1: run git log, git status, and untracked file listing
        # concurrently.  All three are git subprocess calls, so 3 workers.
        # ------------------------------------------------------------------
        with ThreadPoolExecutor(max_workers=3) as pool:
            fut_log = pool.submit(_git_log)
            fut_ita = pool.submit(_git_status_ita)
            fut_untracked = pool.submit(_git_ls_untracked)

            log_output = fut_log.result(timeout=15)
            status_output = fut_ita.result(timeout=15)
            untracked_output = fut_untracked.result(timeout=settings.walk_timeout + 5)

        # ------------------------------------------------------------------
        # Step 2: process untracked files from git ls-files output
        # ------------------------------------------------------------------
        walk_results: list[dict[str, Any]] = []
        max_depth = settings.walk_max_depth
        for line in untracked_output.splitlines():
            rel_path = line.strip()
            if not rel_path:
                continue
            if should_skip(rel_path):
                continue
            parts = rel_path.split("/")
            if not show_hidden and any(p.startswith(".") for p in parts[:-1]):
                continue
            # Apply optional depth limit
            if max_depth is not None and len(parts) - 1 > max_depth:
                continue
            try:
                full = self.repo_path / rel_path
                st = full.stat()
                if not stat_module.S_ISREG(st.st_mode):
                    continue
                # Skip symlinks — they shouldn't appear in recents
                if full.is_symlink():
                    continue
                walk_results.append(
                    {
                        "path": rel_path,
                        "date": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
                        "author_name": "",
                        "message": "",
                        "hexsha": "",
                        "untracked": True,
                    }
                )
            except OSError:
                continue

        # ------------------------------------------------------------------
        # Step 3: merge untracked files + ITA + tracked git-log
        # ------------------------------------------------------------------
        results: list[dict[str, Any]] = list(walk_results)
        seen_paths: set[str] = {r["path"] for r in results}

        # Intent-to-add files (tracked in index, no commit history)
        ita_files = self._find_intent_to_add_files(status_output=status_output)
        for ita_resolved in ita_files:
            full = Path(ita_resolved)
            try:
                rel_path = str(full.relative_to(self.repo_path))
            except ValueError:
                continue
            if rel_path in seen_paths:
                continue
            if not _matches_ext(rel_path):
                continue
            if should_skip(rel_path):
                continue
            parts = rel_path.split("/")
            if not show_hidden and any(p.startswith(".") for p in parts[:-1]):
                continue
            try:
                st = full.stat()
                results.append(
                    {
                        "path": rel_path,
                        "date": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
                        "author_name": "",
                        "message": "",
                        "hexsha": "",
                        "untracked": True,
                    }
                )
                seen_paths.add(rel_path)
            except OSError:
                continue

        # Tracked files from git log
        current_info: tuple[str, str, str, str] | None = None
        for line in log_output.splitlines():
            if not line:
                continue
            if "\x00" in line:
                parts = line.split("\x00", 3)
                if len(parts) >= 4:
                    current_info = (parts[0], parts[1], parts[2], parts[3])
            elif current_info:
                file_path = line.strip()
                if not file_path:
                    continue

                # Make relative to repo_path
                full_path = Path(working_dir) / file_path
                try:
                    rel_path = str(full_path.relative_to(self.repo_path))
                except ValueError:
                    continue

                if should_skip(rel_path):
                    continue

                if not _matches_ext(rel_path):
                    continue

                if not show_hidden:
                    log_parts = rel_path.split("/")
                    if any(p.startswith(".") for p in log_parts[:-1]):
                        continue

                if rel_path in seen_paths:
                    continue

                # Single stat() call: existence + file type + mtime
                try:
                    entry_path = self.repo_path / rel_path
                    st = entry_path.stat()
                    if not stat_module.S_ISREG(st.st_mode):
                        continue
                    # Skip symlinks — they shouldn't appear in recents
                    if entry_path.is_symlink():
                        continue
                    effective_date = datetime.fromtimestamp(st.st_mtime, tz=UTC)
                except OSError:
                    continue

                seen_paths.add(rel_path)
                hexsha, author_name, ts, message = current_info
                results.append(
                    {
                        "path": rel_path,
                        "date": effective_date.isoformat(),
                        "author_name": author_name or "Unknown",
                        "message": message,
                        "hexsha": hexsha,
                        "untracked": False,
                    }
                )

        # ------------------------------------------------------------------
        # Step 5: catch staged-but-never-committed files.
        # Uses ``git diff --cached --name-only`` which returns ONLY files
        # in the staging area — O(staged files), not O(all tracked files).
        # ------------------------------------------------------------------
        try:
            staged_proc = subprocess.run(
                ["git", "diff", "--cached", "--name-only"],
                capture_output=True,
                text=True,
                cwd=working_dir,
                timeout=5,
            )
            if staged_proc.returncode == 0:
                for staged_file in staged_proc.stdout.splitlines():
                    staged_file = staged_file.strip()
                    if not staged_file:
                        continue
                    full_path = Path(working_dir) / staged_file
                    try:
                        rel_path = str(full_path.relative_to(self.repo_path))
                    except ValueError:
                        continue
                    if rel_path in seen_paths:
                        continue
                    if not _matches_ext(rel_path):
                        continue
                    if should_skip(rel_path):
                        continue
                    parts = rel_path.split("/")
                    if not show_hidden and any(p.startswith(".") for p in parts[:-1]):
                        continue
                    try:
                        st = full_path.stat()
                        if not stat_module.S_ISREG(st.st_mode):
                            continue
                        results.append(
                            {
                                "path": rel_path,
                                "date": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
                                "author_name": "",
                                "message": "",
                                "hexsha": "",
                                "untracked": True,
                            }
                        )
                        seen_paths.add(rel_path)
                    except OSError:
                        continue
        except Exception:
            logger.debug("Failed to check staged files", exc_info=True)

        # Sort all results strictly by date descending, then trim to limit
        results.sort(key=lambda r: r["date"], reverse=True)
        trimmed = results[:limit]

        _recent_files_cache[cache_key] = (time.monotonic(), trimmed)
        return trimmed

    @timed("git", "get_file_diff")
    def get_file_diff(self, path: str, commit_sha: str) -> FileDiff | None:
        """Get the diff for a specific file at a specific commit."""
        if not self.repo:
            child = self._resolve_child_repo(path)
            if child:
                return child[0].get_file_diff(child[1], commit_sha)
            return None

        try:
            commit = self.repo.commit(commit_sha)
            repo_path = self._get_repo_relative_path(path)

            # Get parent commit (if exists)
            if commit.parents:
                parent = commit.parents[0]
                # Get diff between parent and this commit for the specific file
                diffs = parent.diff(commit, paths=repo_path, create_patch=True)
            else:
                # First commit - diff against empty tree using NULL_TREE
                from git import NULL_TREE

                diffs = commit.diff(NULL_TREE, paths=repo_path, create_patch=True)

            if not diffs:
                return None

            diff: Any = diffs[0]
            raw_diff: str = diff.diff.decode("utf-8", errors="replace") if diff.diff else ""

            # Parse the diff into hunks
            hunks = self._parse_diff(raw_diff)

            return FileDiff(
                commit_hexsha=commit.hexsha,
                commit_message=str(commit.summary),
                commit_author=commit.author.name or "Unknown",
                commit_date=datetime.fromtimestamp(commit.committed_date, tz=UTC),
                file_path=path,
                hunks=hunks,
                raw_diff=raw_diff,
            )
        except Exception:
            return None

    def get_working_dir_diff(self, path: str) -> FileDiff | None:
        """Get the uncommitted diff for a file (working directory vs HEAD).

        For tracked+modified files, shows the diff against the last committed
        version. For untracked files, shows the entire file as additions.
        """
        if not self.repo or not self.repo.working_dir:
            child = self._resolve_child_repo(path) if not self.repo else None
            if child:
                return child[0].get_working_dir_diff(child[1])
            return None

        try:
            repo_path = self._get_repo_relative_path(path)
            status = self.get_working_dir_status()
            file_status = status.get(path)

            if not file_status:
                logger.debug("get_working_dir_diff: no working dir changes for %s", path)
                return None

            # Use git diff for tracked files, or show full content for untracked
            if file_status == "untracked":
                raw_diff = self._diff_untracked_file(path)
            else:
                proc = subprocess.run(
                    ["git", "diff", "HEAD", "--", str(repo_path)],
                    capture_output=True,
                    text=True,
                    cwd=self.repo.working_dir,
                    timeout=10,
                )
                raw_diff = proc.stdout if proc.returncode == 0 else ""

            if not raw_diff:
                return None

            hunks = self._parse_diff(raw_diff)

            return FileDiff(
                commit_hexsha="working",
                commit_message=f"Uncommitted changes ({file_status})",
                commit_author="Working directory",
                commit_date=datetime.now(tz=UTC),
                file_path=path,
                hunks=hunks,
                raw_diff=raw_diff,
            )
        except Exception:
            logger.exception("Error getting working dir diff for %s", path)
            return None

    def _diff_untracked_file(self, path: str) -> str:
        """Generate a diff-like output for an untracked file (all additions)."""
        full_path = Path(self.repo_path) / path
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return ""

        lines = content.splitlines()
        diff_lines = [f"@@ -0,0 +1,{len(lines)} @@"]
        diff_lines.extend(f"+{line}" for line in lines)
        return "\n".join(diff_lines)

    def _parse_diff(self, raw_diff: str) -> list[DiffHunk]:
        """Parse a unified diff into hunks with line information."""
        hunks: list[DiffHunk] = []
        current_lines: list[DiffLine] = []
        current_header: str = ""
        old_line_no = 0
        new_line_no = 0

        for line in raw_diff.split("\n"):
            if line.startswith("@@"):
                # Parse hunk header like @@ -1,5 +1,7 @@
                if current_lines:
                    hunks.append(DiffHunk(header=current_header, lines=current_lines))

                current_header = line
                current_lines = []

                # Extract line numbers from header
                match = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
                if match:
                    old_line_no = int(match.group(1))
                    new_line_no = int(match.group(2))

                current_lines.append(
                    DiffLine(
                        type="header",
                        content=line,
                        old_line_no=None,
                        new_line_no=None,
                    )
                )
            elif current_lines:
                if line.startswith("+"):
                    current_lines.append(
                        DiffLine(
                            type="add",
                            content=line[1:],
                            old_line_no=None,
                            new_line_no=new_line_no,
                        )
                    )
                    new_line_no += 1
                elif line.startswith("-"):
                    current_lines.append(
                        DiffLine(
                            type="delete",
                            content=line[1:],
                            old_line_no=old_line_no,
                            new_line_no=None,
                        )
                    )
                    old_line_no += 1
                elif line.startswith(" ") or line == "":
                    current_lines.append(
                        DiffLine(
                            type="context",
                            content=line[1:] if line.startswith(" ") else line,
                            old_line_no=old_line_no,
                            new_line_no=new_line_no,
                        )
                    )
                    old_line_no += 1
                    new_line_no += 1

        if current_lines:
            hunks.append(DiffHunk(header=current_header, lines=current_lines))

        return hunks

    def get_head_commit_hash(self) -> str | None:
        """Get the commit hash of HEAD.

        Returns the short commit hash (7 chars), or None if not a git repo.
        """
        if not self.repo or not self.repo.working_dir:
            return None

        try:
            proc = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if proc.returncode == 0:
                return proc.stdout.strip()
        except Exception:
            pass

        return None

    def is_working_dir_dirty(self) -> bool:
        """Check if the working directory has uncommitted changes.

        Returns True if there are any changes (staged, unstaged, or untracked files).
        """
        if not self.repo or not self.repo.working_dir:
            return False

        try:
            # Check for any changes: staged, unstaged, or untracked
            proc = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True,
                text=True,
                cwd=self.repo.working_dir,
                timeout=10,
            )
            if proc.returncode == 0:
                # If there's any output, the working dir is dirty
                return bool(proc.stdout.strip())
        except Exception:
            pass

        return False
