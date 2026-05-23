import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import override

from watchfiles import Change, DefaultFilter, watch

from vantage.services.socket_manager import manager
from vantage.settings import get_daemon_config, settings

logger = logging.getLogger(__name__)


def _read_inotify_limit(name: str) -> int | None:
    """Read an inotify sysctl from /proc.  Returns None on non-Linux or errors."""
    try:
        with open(f"/proc/sys/fs/inotify/{name}") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def _count_inotify_usage() -> tuple[int, int] | None:
    """Return (instances, watches) held by the current process.

    Walks ``/proc/self/fd`` looking for ``anon_inode:inotify`` links, then
    counts ``inotify wd:`` lines in each corresponding fdinfo file.  Returns
    None on non-Linux or if /proc is unavailable.
    """
    try:
        fd_dir = "/proc/self/fd"
        entries = os.listdir(fd_dir)
    except OSError:
        return None

    instances = 0
    watches = 0
    for fd in entries:
        try:
            link = os.readlink(os.path.join(fd_dir, fd))
        except OSError:
            continue
        if link != "anon_inode:inotify":
            continue
        instances += 1
        try:
            with open(f"/proc/self/fdinfo/{fd}") as f:
                for line in f:
                    if line.startswith("inotify wd:"):
                        watches += 1
        except OSError:
            continue
    return instances, watches


def _log_inotify_limits() -> None:
    """Log inotify sysctl limits (once, at watcher startup)."""
    max_watches = _read_inotify_limit("max_user_watches")
    max_instances = _read_inotify_limit("max_user_instances")
    if max_watches is None and max_instances is None:
        logger.info("[watcher] inotify limits unavailable (non-Linux or /proc not mounted)")
        return
    logger.info(
        "[watcher] inotify limits: max_user_watches=%s max_user_instances=%s",
        max_watches if max_watches is not None else "?",
        max_instances if max_instances is not None else "?",
    )


def _log_inotify_usage(context: str) -> None:
    """Log current-process inotify usage and warn if close to the ceiling."""
    usage = _count_inotify_usage()
    if usage is None:
        return
    instances, watches = usage
    max_watches = _read_inotify_limit("max_user_watches")
    max_instances = _read_inotify_limit("max_user_instances")
    logger.info(
        "[watcher] inotify usage (%s): instances=%d watches=%d",
        context,
        instances,
        watches,
    )
    # Warn if we're within 10% of either limit — watchfiles fails silently
    # when notify runs out of watches, which manifests as "live reload
    # stopped working for some files".
    if max_watches and watches >= max_watches * 0.9:
        logger.warning(
            "[watcher] inotify watches=%d is ≥90%% of max_user_watches=%d — "
            "file changes in unwatched subtrees will be missed. "
            "Bump with: sudo sysctl fs.inotify.max_user_watches=524288",
            watches,
            max_watches,
        )
    if max_instances and instances >= max_instances * 0.9:
        logger.warning(
            "[watcher] inotify instances=%d is ≥90%% of max_user_instances=%d — "
            "bump with: sudo sysctl fs.inotify.max_user_instances=1024",
            instances,
            max_instances,
        )


# Event used to signal the multi-repo watcher to restart (e.g. when new
# repos are discovered).  The watcher thread checks this periodically.
_watcher_stop_event = threading.Event()


def signal_watcher_restart() -> None:
    """Signal the multi-repo watcher to restart with updated repo list."""
    _watcher_stop_event.set()


# Extensions we care about for live-reload
_WATCHED_EXTENSIONS = {".md"}

# Git internal files whose changes indicate repo state change (commit,
# merge, checkout, rebase, etc.).  Watching these lets us refresh the
# "recently changed" list after ``git commit`` even though no ``.md``
# file content actually changed on disk.
_GIT_STATE_FILES = {"index", "HEAD", "MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD"}

# Quiet period: wait this long after last change before broadcasting,
# to coalesce rapid bursts like git branch switches.
_QUIET_PERIOD_S = 0.1
# Maximum time before forced broadcast even if changes keep arriving.
_MAX_WAIT_S = 1.0

# How often the watcher logs a heartbeat (counts of events seen, kept,
# dropped by extension, dropped by the vantage ignore filter).  This
# makes it possible to tell at a glance whether the inotify thread is
# alive but silent vs. truly dead.
_HEARTBEAT_INTERVAL_S = 60.0


@dataclass
class _WatcherStats:
    """Counters reported by the heartbeat logger.

    Reset at every heartbeat so the numbers describe the most recent
    interval, not the lifetime of the process.
    """

    events_total: int = 0
    kept: int = 0
    dropped_extension: int = 0  # not .md / not a tracked git state file
    dropped_ignore: int = 0  # matched .vantageignore / user ignore
    dropped_outside_repo: int = 0  # event under no watched root

    def reset(self) -> None:
        self.events_total = 0
        self.kept = 0
        self.dropped_extension = 0
        self.dropped_ignore = 0
        self.dropped_outside_repo = 0


class _GitAwareFilter(DefaultFilter):
    """Extends the default watchfiles filter to allow git state-file changes.

    ``DefaultFilter`` excludes the entire ``.git/`` tree.  We override
    ``__call__`` to let through a small set of top-level state files
    (e.g. ``index``, ``HEAD``) that change on commits, branch switches,
    rebases, etc.  The rest of ``.git/`` (objects, refs, logs, …) remains
    filtered to avoid noise.
    """

    @override
    def __call__(self, change: Change, path: str) -> bool:
        # Fast path: let the default filter handle non-.git paths
        parts = path.replace("\\", "/").split("/")
        # Check if any path component is ".git"
        try:
            git_idx = next(i for i, p in enumerate(parts) if p == ".git")
        except StopIteration:
            return super().__call__(change, path)
        # Allow .git/<state_file> (exactly one level deep); reject rest.
        return len(parts) == git_idx + 2 and parts[-1] in _GIT_STATE_FILES


def _classify(path: str, repo_root: Path | None = None) -> tuple[bool, str]:
    """Classify *path* for live-reload.

    Returns ``(keep, reason)`` where reason is one of:
      ``"kept"``               — relevant and not ignored
      ``"dropped_extension"``  — not .md, not a tracked git state file
      ``"dropped_ignore"``     — matched a vantage ignore rule
    """
    lower = path.lower()
    is_md = any(lower.endswith(ext) for ext in _WATCHED_EXTENSIONS)
    normalized = path.replace("\\", "/")
    parts = normalized.split("/")
    is_git_state = len(parts) >= 2 and parts[0] == ".git" and parts[-1] in _GIT_STATE_FILES

    if not (is_md or is_git_state):
        return False, "dropped_extension"

    if repo_root is not None:
        from vantage.services.ignore import get_matcher

        matcher = get_matcher(repo_root)
        if matcher.is_ignored(normalized):
            return False, "dropped_ignore"
    return True, "kept"


def _is_relevant(path: str, repo_root: Path | None = None) -> bool:
    """Back-compat wrapper around _classify for the async-side loop."""
    keep, _ = _classify(path, repo_root)
    return keep


def _is_git_state_change(path: str) -> bool:
    """Return True if the path is a git state file (not a .md content change)."""
    parts = path.replace("\\", "/").split("/")
    return len(parts) >= 2 and parts[0] == ".git" and parts[-1] in _GIT_STATE_FILES


async def _coalesce_and_broadcast(
    pending: set[str],
    repo_name: str | None = None,
) -> None:
    """Send a single batched message for accumulated paths."""
    if not pending:
        return

    # Always invalidate git-status cache on any file change — working
    # directory status reflects file state, not just git state.
    from vantage.services.fs_service import clear_md_dir_cache
    from vantage.services.git_service import clear_recent_files_cache, clear_status_cache

    clear_status_cache()

    # If a .md file was added or removed, clear the dir-has-markdown cache
    if any(p.lower().endswith(".md") for p in pending):
        clear_md_dir_cache()

    # If any pending path is a git state file, also invalidate the
    # recent-files cache so the next API call returns fresh data.
    has_git_change = any(_is_git_state_change(p) for p in pending)
    if has_git_change:
        clear_recent_files_cache()
        logger.debug("Cleared recent-files + git-status caches due to git state change")

    unique_paths = sorted(pending)
    msg: dict[str, object] = {"type": "files_changed", "paths": unique_paths}
    if repo_name:
        msg["repo"] = repo_name
        logger.info(f"Batch ({repo_name}): {len(unique_paths)} file(s) changed")
    else:
        logger.info(f"Batch: {len(unique_paths)} file(s) changed")
    logger.debug("Changed paths: %s", unique_paths)
    await manager.broadcast(msg)


async def watch_repo():
    """Watch single repo (legacy mode) with quiet-period coalescing.

    Uses the synchronous ``watch()`` in a daemon thread so that the
    (potentially slow) inotify initialization never blocks the event loop.
    """
    logger.info(f"Starting watcher for {settings.target_repo}")
    _log_inotify_limits()
    target = settings.target_repo.resolve()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[set[tuple[Change, str]]] = asyncio.Queue()
    stats = _WatcherStats()

    def _run_sync_watcher() -> None:
        logger.info("Initializing file watcher...")
        t0 = time.monotonic()
        first = True
        try:
            for changes in watch(
                target,
                watch_filter=_GitAwareFilter(),
                ignore_permission_denied=True,
            ):
                if first:
                    logger.info(
                        "[startup] file watcher ready (%.0fms)", (time.monotonic() - t0) * 1000
                    )
                    _log_inotify_usage("after startup")
                    first = False
                # Drop ignored paths before queueing so they don't
                # flood the log or wake the async side for nothing.
                filtered: set[tuple[Change, str]] = set()
                for change, path in changes:
                    stats.events_total += 1
                    try:
                        rel = str(Path(path).relative_to(target))
                    except ValueError:
                        stats.dropped_outside_repo += 1
                        continue
                    keep, reason = _classify(rel, repo_root=target)
                    if not keep:
                        if reason == "dropped_extension":
                            stats.dropped_extension += 1
                        else:
                            stats.dropped_ignore += 1
                            # explain() is expensive (walks every ignore line);
                            # only build the reason string when DEBUG is on.
                            if logger.isEnabledFor(logging.DEBUG):
                                from vantage.services.ignore import get_matcher

                                explanation = get_matcher(target).explain(rel) or "?"
                                logger.debug(
                                    "[watcher] DROP %s %s (dropped_ignore:%s)",
                                    change.name,
                                    path,
                                    explanation,
                                )
                        continue
                    stats.kept += 1
                    logger.info("[watcher] %s %s", change.name, path)
                    filtered.add((change, path))
                if filtered:
                    loop.call_soon_threadsafe(queue.put_nowait, filtered)
        except Exception:
            logger.exception("[watcher] watch() thread crashed — live reload will stop")

    thread = threading.Thread(target=_run_sync_watcher, daemon=True)
    thread.start()

    async def _heartbeat() -> None:
        """Periodically log watcher stats so silent failures are visible."""
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL_S)
            alive = thread.is_alive()
            logger.info(
                "[watcher] heartbeat thread=%s events=%d kept=%d "
                "dropped_ext=%d dropped_ignore=%d dropped_outside=%d",
                "alive" if alive else "DEAD",
                stats.events_total,
                stats.kept,
                stats.dropped_extension,
                stats.dropped_ignore,
                stats.dropped_outside_repo,
            )
            if not alive:
                logger.warning("[watcher] inotify thread is not alive — live reload has stopped")
            _log_inotify_usage("heartbeat")
            stats.reset()

    asyncio.create_task(_heartbeat())

    pending: set[str] = set()
    quiet_task: asyncio.Task[None] | None = None
    batch_start: float | None = None

    async def flush() -> None:
        nonlocal batch_start
        paths = set(pending)
        pending.clear()
        batch_start = None
        await _coalesce_and_broadcast(paths)

    while True:
        changes = await queue.get()
        for _change, abs_path in changes:
            try:
                rel_path = str(Path(abs_path).relative_to(target))
            except ValueError:
                continue
            if _is_relevant(rel_path, repo_root=target):
                pending.add(rel_path)

        if not pending:
            continue

        now = asyncio.get_event_loop().time()
        if batch_start is None:
            batch_start = now

        if quiet_task and not quiet_task.done():
            quiet_task.cancel()

        if now - batch_start >= _MAX_WAIT_S:
            await flush()
        else:

            async def _delayed_flush() -> None:
                await asyncio.sleep(_QUIET_PERIOD_S)
                await flush()

            quiet_task = asyncio.create_task(_delayed_flush())


async def watch_multi_repo():
    """Watch multiple repos (daemon mode) with quiet-period coalescing.

    Uses the synchronous ``watch()`` in a daemon thread so that the
    (potentially slow) inotify initialization never blocks the event loop.

    When ``signal_watcher_restart()`` is called (e.g. after new repos are
    discovered), the current watch loop exits and restarts with the
    updated repo list from the daemon config.
    """
    daemon_config = get_daemon_config()
    if not daemon_config:
        await watch_repo()
        return

    _log_inotify_limits()

    loop = asyncio.get_running_loop()
    pending: dict[str, set[str]] = {}  # repo_name -> paths
    batch_start: float | None = None
    stats = _WatcherStats()
    current_thread_holder: dict[str, threading.Thread | None] = {"thread": None}

    async def flush() -> None:
        nonlocal batch_start
        snapshot = {k: set(v) for k, v in pending.items()}
        pending.clear()
        batch_start = None
        for repo_name, paths in snapshot.items():
            await _coalesce_and_broadcast(paths, repo_name)

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL_S)
            t = current_thread_holder["thread"]
            alive = t.is_alive() if t else False
            logger.info(
                "[watcher] heartbeat thread=%s events=%d kept=%d "
                "dropped_ext=%d dropped_ignore=%d dropped_outside=%d",
                "alive" if alive else "DEAD",
                stats.events_total,
                stats.kept,
                stats.dropped_extension,
                stats.dropped_ignore,
                stats.dropped_outside_repo,
            )
            if t is not None and not alive:
                logger.warning("[watcher] inotify thread is not alive — live reload has stopped")
            _log_inotify_usage("heartbeat")
            stats.reset()

    asyncio.create_task(_heartbeat())

    while True:
        _watcher_stop_event.clear()

        watch_paths = []
        path_to_repo: dict[str, str] = {}
        for repo in daemon_config.repos:
            resolved = repo.path.resolve()
            watch_paths.append(resolved)
            path_to_repo[str(resolved)] = repo.name

        logger.info("Starting file watchers for %d repos", len(watch_paths))

        queue: asyncio.Queue[set[tuple[Change, str]] | None] = asyncio.Queue()

        def _start_watcher(
            paths: list[Path], q: asyncio.Queue[set[tuple[Change, str]] | None]
        ) -> None:
            logger.info("Initializing file watchers for %d repos...", len(paths))
            t0 = time.monotonic()
            first = True
            try:
                for changes in watch(
                    *paths,
                    watch_filter=_GitAwareFilter(),
                    stop_event=_watcher_stop_event,
                    ignore_permission_denied=True,
                ):
                    if first:
                        logger.info(
                            "[startup] file watchers ready (%.0fms)",
                            (time.monotonic() - t0) * 1000,
                        )
                        _log_inotify_usage("after startup")
                        first = False
                    # Pre-filter against each repo's ignore files so
                    # noisy subtrees (.yolo/, .worktrees/, …) never
                    # reach the async side or the journal.
                    filtered: set[tuple[Change, str]] = set()
                    for change, path in changes:
                        stats.events_total += 1
                        abs_obj = Path(path)
                        matched_root: Path | None = None
                        rel: str = ""
                        for root in paths:
                            try:
                                rel = str(abs_obj.relative_to(root))
                            except ValueError:
                                continue
                            matched_root = root
                            break
                        if matched_root is None:
                            stats.dropped_outside_repo += 1
                            logger.debug("[watcher] DROP %s (outside repos)", path)
                            continue
                        keep, reason = _classify(rel, repo_root=matched_root)
                        if not keep:
                            if reason == "dropped_extension":
                                stats.dropped_extension += 1
                            else:
                                stats.dropped_ignore += 1
                                if logger.isEnabledFor(logging.DEBUG):
                                    from vantage.services.ignore import get_matcher

                                    explanation = get_matcher(matched_root).explain(rel) or "?"
                                    logger.debug(
                                        "[watcher] DROP %s %s (dropped_ignore:%s)",
                                        change.name,
                                        path,
                                        explanation,
                                    )
                            continue
                        stats.kept += 1
                        logger.info("[watcher] %s %s", change.name, path)
                        filtered.add((change, path))
                    if filtered:
                        loop.call_soon_threadsafe(q.put_nowait, filtered)
            except Exception:
                logger.exception("[watcher] watch() thread crashed — live reload will stop")
            # Signal the async side that the watcher exited
            loop.call_soon_threadsafe(q.put_nowait, None)

        thread = threading.Thread(target=_start_watcher, args=(watch_paths, queue), daemon=True)
        thread.start()
        current_thread_holder["thread"] = thread

        quiet_task: asyncio.Task[None] | None = None
        restarting = False
        while True:
            changes = await queue.get()
            if changes is None:
                # Watcher was stopped — restart with updated repo list
                logger.info("File watcher stopped, restarting with updated repo list")
                restarting = True
                break

            for _change, abs_path in changes:
                abs_path_obj = Path(abs_path)
                for repo_path_str, name in path_to_repo.items():
                    repo_path = Path(repo_path_str)
                    try:
                        rel_path = str(abs_path_obj.relative_to(repo_path))
                    except ValueError:
                        continue
                    if _is_relevant(rel_path, repo_root=repo_path):
                        pending.setdefault(name, set()).add(rel_path)
                    break

            if not pending:
                continue

            now = asyncio.get_event_loop().time()
            if batch_start is None:
                batch_start = now

            if quiet_task and not quiet_task.done():
                quiet_task.cancel()

            if now - batch_start >= _MAX_WAIT_S:
                await flush()
            else:

                async def _delayed_flush() -> None:
                    await asyncio.sleep(_QUIET_PERIOD_S)
                    await flush()

                quiet_task = asyncio.create_task(_delayed_flush())

        if not restarting:
            break
