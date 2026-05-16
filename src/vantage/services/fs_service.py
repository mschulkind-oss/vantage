import logging
import os
import subprocess
import time
from pathlib import Path

from vantage.schemas.models import FileContent, FileNode
from vantage.services.git_service import GitService
from vantage.services.perf import timed

logger = logging.getLogger(__name__)

# TTL cache for _dir_has_markdown results.  Avoids repeated os.walk()
# calls per subdirectory listing — the old code walked every subdirectory
# recursively for every list_directory call (50+ walks per page load).
_md_dir_cache: dict[str, tuple[float, bool]] = {}
_MD_DIR_CACHE_TTL = 30.0  # seconds — markdown files rarely appear/disappear


def clear_md_dir_cache() -> None:
    """Flush the _dir_has_markdown cache."""
    _md_dir_cache.clear()
    logger.debug("Markdown-dir cache cleared")


class FileSystemService:
    def __init__(
        self,
        root_path: Path,
        exclude_dirs: frozenset[str] | None = None,
        allowed_read_roots: list[Path] | None = None,
        show_hidden: bool = True,
        show_gitignored: bool = True,
    ):
        from vantage.config import DEFAULT_EXCLUDE_DIRS

        self.root_path: Path = root_path.resolve()
        self.exclude_dirs: frozenset[str] = (
            exclude_dirs if exclude_dirs is not None else DEFAULT_EXCLUDE_DIRS
        )
        self.allowed_read_roots: list[Path] = [p.resolve() for p in (allowed_read_roots or [])]
        self.show_hidden: bool = show_hidden
        self.show_gitignored: bool = show_gitignored
        self._git: GitService | None = None

    @property
    def git(self) -> GitService:
        if self._git is None:
            self._git = GitService(self.root_path, exclude_dirs=self.exclude_dirs)
        return self._git

    def validate_path(self, path: str) -> Path:
        """Validate and resolve a path, ensuring it stays within root_path.

        Rejects:
        - Absolute paths (starting with /)
        - Null bytes
        - Paths into .git directory
        - Any resolved path outside root_path
        """
        if not path or "\x00" in path:
            raise ValueError("Invalid path")

        # Reject absolute paths outright
        if path.startswith("/"):
            raise ValueError("Absolute paths not allowed")

        # Block access to .git internals
        normalized = path.replace("\\", "/")
        parts = normalized.split("/")
        if ".git" in parts:
            raise ValueError("Access to .git directory is not allowed")

        # Normalize and resolve
        full_path = (self.root_path / path).resolve()

        # Must be root_path itself, a child of root_path, or under an allowed root
        try:
            full_path.relative_to(self.root_path)
        except ValueError:
            for allowed_root in self.allowed_read_roots:
                try:
                    full_path.relative_to(allowed_root)
                    break
                except ValueError:
                    continue
            else:
                raise ValueError("Path traversal detected") from None

        return full_path

    @staticmethod
    def _dir_has_markdown(dir_path: Path) -> bool:
        """Check if a directory (recursively) contains any .md files.

        Stops as soon as one is found for speed.
        Results are cached with a TTL to avoid repeated os.walk() calls.
        Respects the walk_max_depth setting when configured.
        """
        from vantage.settings import settings

        cache_key = str(dir_path)
        now = time.monotonic()
        cached = _md_dir_cache.get(cache_key)
        if cached is not None:
            ts, result = cached
            if now - ts < _MD_DIR_CACHE_TTL:
                return result

        max_depth = settings.walk_max_depth
        root_depth = str(dir_path).count(os.sep) if max_depth is not None else 0

        def _on_walk_error(err: OSError) -> None:
            logger.debug("Permission denied / walk error: %s", err)

        try:
            for dirpath, dirnames, filenames in os.walk(dir_path, onerror=_on_walk_error):
                if max_depth is not None and dirpath.count(os.sep) - root_depth >= max_depth:
                    dirnames.clear()
                    continue
                for fname in filenames:
                    if fname.lower().endswith(".md"):
                        _md_dir_cache[cache_key] = (now, True)
                        return True
        except OSError:
            pass
        _md_dir_cache[cache_key] = (now, False)
        return False

    def _get_gitignored_names(self, dir_path: Path) -> set[str]:
        """Return the set of entry names in *dir_path* that are gitignored."""
        try:
            entries = os.listdir(dir_path)
        except OSError:
            return set()
        if not entries:
            return set()
        # git check-ignore expects paths relative to the repo root (or absolute)
        paths = [os.path.join(dir_path, e) for e in entries]
        try:
            proc = subprocess.run(
                ["git", "check-ignore", "--stdin", "-z"],
                input="\0".join(paths),
                capture_output=True,
                text=True,
                cwd=self.root_path,
                timeout=5,
            )
        except Exception:
            return set()
        ignored: set[str] = set()
        for p in proc.stdout.split("\0"):
            p = p.strip()
            if p:
                ignored.add(os.path.basename(p))
        return ignored

    def _ignore_matcher(self):
        from vantage.services.ignore import get_matcher

        return get_matcher(self.root_path)

    @timed("fs", "list_directory")
    def list_directory(self, path: str = ".", include_git: bool = False) -> list[FileNode]:
        """List a directory's contents.

        By default returns just file/folder names (fast, no git calls).
        Set include_git=True to also fetch last_commit per entry (batch git call).

        Symlinks are detected and annotated:
        - Internal symlinks (target inside root_path) are shown with symlink_target set.
        - External or broken symlinks are shown with is_symlink=True but symlink_target=None.
        """
        target_dir = self.validate_path(path)
        if not target_dir.is_dir():
            raise ValueError("Not a directory")

        nodes = []
        rel_paths: list[str] = []
        gitignored_names = (
            self._get_gitignored_names(target_dir) if not self.show_gitignored else set()
        )
        ignore_matcher = self._ignore_matcher()
        try:
            scandir_iter = os.scandir(target_dir)
        except PermissionError:
            logger.debug("Permission denied listing directory: %s", target_dir)
            return []
        for entry in scandir_iter:
            is_symlink = entry.is_symlink()

            # For broken symlinks, is_dir() and is_file() both return False.
            # Detect this early and handle as an error entry.
            if is_symlink:
                try:
                    entry.stat()  # follows symlink — raises if broken
                except OSError:
                    # Broken symlink — show as error if it looks like .md or a dir
                    name = entry.name
                    if not self.show_hidden and name.startswith("."):
                        continue
                    if not self.show_gitignored and name in gitignored_names:
                        continue
                    is_markdown_name = name.lower().endswith(".md")
                    if is_markdown_name or not name.endswith((".",)):
                        rel_path = os.path.relpath(entry.path, self.root_path)
                        nodes.append(
                            FileNode(
                                name=name,
                                path=rel_path,
                                is_dir=not is_markdown_name,
                                has_markdown=False,
                                is_symlink=True,
                                symlink_target=None,
                            )
                        )
                    continue

            is_dir = entry.is_dir()  # follows symlinks
            is_markdown = entry.name.lower().endswith(".md")

            # Skip excluded directories
            if is_dir and entry.name in self.exclude_dirs:
                continue
            # Skip hidden directories/files if configured
            if not self.show_hidden and entry.name.startswith("."):
                continue
            # Skip gitignored files/dirs if configured
            if not self.show_gitignored and entry.name in gitignored_names:
                continue
            # Skip paths matched by vantage's ignore files
            entry_rel = os.path.relpath(entry.path, self.root_path)
            if ignore_matcher.is_ignored(entry_rel, is_dir=is_dir):
                continue

            symlink_target: str | None = None
            symlink_error = False
            if is_symlink:
                try:
                    resolved = Path(entry.path).resolve()
                    resolved.relative_to(self.root_path)
                    symlink_target = str(resolved.relative_to(self.root_path))
                except (ValueError, OSError):
                    # Target is outside root_path or broken
                    symlink_error = True

            if is_dir:
                # Don't recurse into symlinked dirs pointing outside the project
                if is_symlink and symlink_error:
                    rel_path = os.path.relpath(entry.path, self.root_path)
                    nodes.append(
                        FileNode(
                            name=entry.name,
                            path=rel_path,
                            is_dir=True,
                            has_markdown=False,
                            is_symlink=True,
                            symlink_target=None,
                        )
                    )
                    continue

                has_md = self._dir_has_markdown(Path(entry.path))
                rel_path = os.path.relpath(entry.path, self.root_path)
                rel_paths.append(rel_path)
                nodes.append(
                    FileNode(
                        name=entry.name,
                        path=rel_path,
                        is_dir=True,
                        has_markdown=has_md,
                        last_commit=None,
                        is_symlink=is_symlink,
                        symlink_target=symlink_target if is_symlink else None,
                    )
                )
            elif is_markdown:
                # Show broken/external symlink .md files as errors (not navigable)
                if is_symlink and symlink_error:
                    rel_path = os.path.relpath(entry.path, self.root_path)
                    nodes.append(
                        FileNode(
                            name=entry.name,
                            path=rel_path,
                            is_dir=False,
                            has_markdown=True,
                            is_symlink=True,
                            symlink_target=None,
                        )
                    )
                    continue

                rel_path = os.path.relpath(entry.path, self.root_path)
                rel_paths.append(rel_path)
                nodes.append(
                    FileNode(
                        name=entry.name,
                        path=rel_path,
                        is_dir=False,
                        has_markdown=True,
                        last_commit=None,
                        is_symlink=is_symlink,
                        symlink_target=symlink_target if is_symlink else None,
                    )
                )

        # Batch fetch git info in a single call instead of N individual calls
        if include_git and rel_paths:
            commit_map = self.git.get_last_commits_batch(rel_paths)
            for node in nodes:
                if node.path in commit_map:
                    node.last_commit = commit_map[node.path]

        # Annotate git working-directory status (always — it's fast)
        status_map = self.git.get_working_dir_status()
        if status_map:
            for node in nodes:
                if node.is_dir:
                    # Directory contains changes if any status entry is under it
                    prefix = node.path + "/"
                    if any(p.startswith(prefix) or p == node.path for p in status_map):
                        node.git_status = "contains_changes"
                else:
                    if node.path in status_map:
                        node.git_status = status_map[node.path]

        return sorted(nodes, key=lambda x: (not x.is_dir, x.name))

    @timed("fs", "list_all_files")
    def list_all_files(self, extensions: list[str] | None = None) -> list[str]:
        """Recursively list all files under root_path, returning relative paths.

        Fast: pure filesystem walk, no git calls.
        Skips excluded directories (node_modules, .venv, etc.).
        Skips symlinks to avoid duplicates and external references.
        """
        if extensions is None:
            extensions = [".md"]

        results: list[str] = []
        ignore_matcher = self._ignore_matcher()

        def _on_walk_error(err: OSError) -> None:
            logger.debug("list_all_files: skipping unreadable path: %s", err)

        for dirpath, dirnames, filenames in os.walk(
            self.root_path, followlinks=False, onerror=_on_walk_error
        ):
            # Prune excluded and ignored directories (+ optionally hidden).
            # Pruning at dirnames level keeps the walk itself fast — we
            # never descend into .yolo/ or .worktrees/ if ignored.
            kept: list[str] = []
            for d in dirnames:
                if d in self.exclude_dirs:
                    continue
                if not self.show_hidden and d.startswith("."):
                    continue
                sub_rel = os.path.relpath(os.path.join(dirpath, d), self.root_path)
                if ignore_matcher.is_ignored(sub_rel, is_dir=True):
                    continue
                kept.append(d)
            dirnames[:] = kept
            for fname in filenames:
                if extensions and not any(fname.lower().endswith(ext) for ext in extensions):
                    continue
                full = os.path.join(dirpath, fname)
                if os.path.islink(full):
                    continue
                rel = os.path.relpath(full, self.root_path)
                if ignore_matcher.is_ignored(rel):
                    continue
                results.append(rel)

        results.sort()
        return results

    def read_file(self, path: str) -> FileContent:
        target_file = self.validate_path(path)
        if not target_file.is_file():
            raise ValueError("Not a file")

        try:
            with open(target_file, encoding="utf-8") as f:
                content = f.read()
                return FileContent(path=path, content=content, encoding="utf-8")
        except UnicodeDecodeError:
            # Simple binary detection
            return FileContent(path=path, content="", encoding="binary")
