"""Server-side changelog parser for review-mode reactions.

Watches `<!-- changelog -->` blocks at the end of reviewed markdown
files.  When a new bullet appears for a comment id we know about, the
parser writes a reaction record (kind=``addressed``, actor=``agent``)
including a before/after capture of the affected block.

Why server-side: the agent may edit a file while the browser is closed
(see review-mode design Q3).  The watcher already sees every file
change; piggybacking the parser on it means the loop closes without
the reviewer needing to be online.

Grammar (load-bearing — this is the only agent → reviewer channel):
- The marker line must be exactly ``<!-- changelog -->`` (with optional
  surrounding whitespace).
- Each entry is a single bullet on its own line:
  ``- [<short_id>] <summary>``.  ``<short_id>`` is a hex prefix that
  must uniquely identify a comment (we enforce ≥4 chars).
- Stop on blank line, EOF, or any non-bullet line.

Idempotency: bullets are deduped by ``(comment_id, summary)`` — the
same line in the same file won't produce a second reaction.
"""

from __future__ import annotations

import logging
import re
import time

from vantage.schemas.models import (
    CommentReaction,
    ReviewComment,
)
from vantage.services.review_anchor import find_block_at_line, strip_block_text
from vantage.services.review_service import get_review, save_review

logger = logging.getLogger(__name__)

# In-memory cache of the previously-seen content for each (repo, path).
# Used to capture the "before" text for a reaction when the file
# changes; a server-only mechanism so reactions get recorded even when
# no browser is open.  Keyed by a stable string (we don't keep Path
# objects around because the watcher passes string paths).
_prev_content_cache: dict[tuple[str | None, str], str] = {}

_MARKER_RE = re.compile(r"^\s*<!--\s*changelog\s*-->\s*$")
_BULLET_RE = re.compile(r"^\s*-\s*\[([0-9a-fA-F]{4,})\]\s*(.+?)\s*$")


def _parse_changelog(content: str) -> list[tuple[str, str]]:
    """Find the LAST changelog block and return [(short_id, summary), ...].

    Multiple blocks: the last one wins (agents may append on each
    iteration; only the most recent is authoritative).

    Lenient line handling within a block:
    - Lines matching ``- [<short_id>] <summary>`` are recorded.
    - Other lines (preamble bullets, blank lines, prose, nested
      bullets) are *skipped*, not treated as terminators.
    - Stop only at end-of-file or at the next ``<!-- changelog -->``
      marker (which we already located).

    Why lenient: in practice agents annotate the block with a leading
    "what I did this iteration" bullet or leave a blank line between
    sections.  Strict-stop-on-malformed silently dropped *every*
    well-formed bullet that came after such a line — the worst
    possible failure mode.  Skipping is one extra ``continue`` and
    keeps the protocol forgiving.
    """
    lines = content.splitlines()
    last_marker: int | None = None
    for i, raw in enumerate(lines):
        if _MARKER_RE.match(raw):
            last_marker = i

    if last_marker is None:
        return []

    out: list[tuple[str, str]] = []
    for j in range(last_marker + 1, len(lines)):
        line = lines[j]
        # A new changelog marker terminates the previous block.  We
        # already picked the last marker, so this shouldn't normally
        # fire, but be defensive.
        if _MARKER_RE.match(line):
            break
        m = _BULLET_RE.match(line)
        if not m:
            continue
        short_id, summary = m.group(1).lower(), m.group(2).strip()
        if not summary:
            continue
        out.append((short_id, summary))
    return out


def _resolve_comment_id(comments: list[ReviewComment], short_id: str) -> str | None:
    """Return the unique comment id that starts with *short_id*, or None.

    Ambiguous matches (two comments sharing the prefix) → log warn and
    skip; the agent should use a longer prefix to disambiguate.
    """
    matches = [c.id for c in comments if c.id.startswith(short_id)]
    if not matches:
        return None
    if len(matches) > 1:
        logger.warning(
            "[review_changelog] short id %s is ambiguous (%d matches) — skipping",
            short_id,
            len(matches),
        )
        return None
    return matches[0]


def _block_text_at(content: str, source_line: int | None) -> str:
    """Return the canonicalized block text at *source_line*.

    Falls back to an empty string when the block can't be located —
    caller can still record a reaction; the diff just won't be useful.
    """
    if not source_line:
        return ""
    block = find_block_at_line(content, source_line, radius=0)
    if block is None:
        block = find_block_at_line(content, source_line, radius=10)
    if block is None:
        return ""
    return strip_block_text(block[1])


def apply_changelog(
    file_path: str,
    new_content: str,
    *,
    repo: str | None = None,
) -> int:
    """Parse new_content for a changelog block and persist any new reactions.

    Returns the count of reactions written (zero if no changelog
    block, no matching comments, or every bullet was already
    recorded).

    The "before" text comes from the in-memory cache of the previous
    seen content for this (repo, path); the "after" text is the
    current content.  First seen → no before-text capture, but the
    bullet is still recorded so the reviewer can see what the agent
    summarized.
    """
    review = get_review(file_path, repo=repo)
    if review is None or not review.comments:
        # Still update the cache so the next edit has a "before".
        _prev_content_cache[(repo, file_path)] = new_content
        return 0

    bullets = _parse_changelog(new_content)
    if not bullets:
        _prev_content_cache[(repo, file_path)] = new_content
        return 0

    prev_content = _prev_content_cache.get((repo, file_path), "")

    written = 0
    now = time.time()
    for short_id, summary in bullets:
        cid = _resolve_comment_id(review.comments, short_id)
        if cid is None:
            logger.debug(
                "[review_changelog] no comment matches short_id=%s in %s",
                short_id,
                file_path,
            )
            continue
        comment = next(c for c in review.comments if c.id == cid)
        # Idempotency: if a reaction with this (kind,summary) already
        # exists for this comment, skip.  Bullet text is the dedupe
        # key — agents should iterate by editing the bullet text if
        # they re-act on the same comment.
        already = any(
            r.actor == "agent" and r.kind == "addressed" and r.summary == summary
            for r in comment.reactions
        )
        if already:
            continue

        anchor_line = comment.anchor.source_line if comment.anchor else None
        before = _block_text_at(prev_content, anchor_line) if prev_content else ""
        after = _block_text_at(new_content, anchor_line)

        comment.reactions.append(
            CommentReaction(
                actor="agent",
                kind="addressed",
                summary=summary,
                before_text=before,
                after_text=after,
                timestamp=now,
            )
        )
        written += 1
        logger.info(
            "[review_changelog] +reaction for %s in %s: %s",
            cid[:8],
            file_path,
            summary,
        )

    if written:
        save_review(file_path, review, repo=repo)
    _prev_content_cache[(repo, file_path)] = new_content
    return written


def seed_prev_content(file_path: str, content: str, *, repo: str | None = None) -> None:
    """Manually seed the prev-content cache (e.g. on watcher startup).

    Prevents the first edit after restart from being seen as "no before
    text" when in fact the file had been read.  Cheap and idempotent.
    """
    _prev_content_cache[(repo, file_path)] = content


def _reset_cache_for_tests() -> None:
    """Test-only hook to clear the prev-content cache."""
    _prev_content_cache.clear()
