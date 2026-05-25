"""Canonicalization + hashing for review-mode block anchors.

Mirrors :mod:`frontend/src/lib/reviewAnchor.ts` byte-for-byte: the same
``stripBlockText`` rules and the same FNV-1a 32-bit hash so the
server-side changelog parser can match the per-block hashes the
frontend stored with each comment anchor.
"""

from __future__ import annotations

import re

_FNV_OFFSET = 0x811C9DC5
_FNV_PRIME = 0x01000193
_MASK_32 = 0xFFFFFFFF

_WHITESPACE_RE = re.compile(r"\s+", re.UNICODE)


def strip_block_text(text: str) -> str:
    """Canonical block text: collapse whitespace, trim, lowercase."""
    return _WHITESPACE_RE.sub(" ", text).strip().lower()


def fnv1a(text: str) -> str:
    """FNV-1a 32-bit hash, returned as 8-char lowercase hex.

    Only the low byte of each character is hashed (matches the JS
    implementation's ``charCodeAt(i) & 0xff``).
    """
    h = _FNV_OFFSET
    for ch in text:
        h ^= ord(ch) & 0xFF
        h = (h * _FNV_PRIME) & _MASK_32
    return f"{h:08x}"


def hash_block_text(text: str) -> str:
    """Canonicalize then hash — what the frontend stores in `block_text_hash`."""
    return fnv1a(strip_block_text(text))


def split_blocks(content: str) -> list[tuple[int, str]]:
    """Split a markdown document into (source_line, block_text) tuples.

    The line is 1-based (matching the rehype source-line plugin).  This
    is a *very* rough split — we don't try to mirror remark's parsing —
    but it's enough for the server-side changelog parser to look up the
    block at a given anchor's `source_line` and capture before/after
    text for a reaction record.

    Blocks are separated by blank lines.  Lines inside fenced code
    blocks (``` … ```) are kept together regardless of blank lines.
    """
    lines = content.splitlines()
    blocks: list[tuple[int, str]] = []
    buf: list[str] = []
    buf_start: int | None = None
    in_fence = False
    fence_marker = ""

    def flush() -> None:
        if buf and buf_start is not None:
            text = "\n".join(buf).strip()
            if text:
                blocks.append((buf_start, text))
        buf.clear()

    for idx, raw in enumerate(lines):
        line_no = idx + 1
        stripped = raw.lstrip()
        if not in_fence and (stripped.startswith("```") or stripped.startswith("~~~")):
            if buf_start is None:
                buf_start = line_no
            buf.append(raw)
            in_fence = True
            fence_marker = stripped[:3]
            continue
        if in_fence:
            buf.append(raw)
            if stripped.startswith(fence_marker):
                in_fence = False
                fence_marker = ""
            continue

        if raw.strip() == "":
            flush()
            buf_start = None
        else:
            if buf_start is None:
                buf_start = line_no
            buf.append(raw)

    flush()
    return blocks


def find_block_at_line(
    content: str, source_line: int, *, radius: int = 0
) -> tuple[int, str] | None:
    """Return the block whose start line is closest to *source_line*.

    If *radius* > 0, restricts the search to ±*radius* lines around
    *source_line*; outside that window returns None.  ``radius=0`` means
    return the block whose start line is exactly *source_line*.
    """
    blocks = split_blocks(content)
    if not blocks:
        return None
    best: tuple[int, str] | None = None
    best_dist: int | None = None
    for start, text in blocks:
        dist = abs(start - source_line)
        if radius and dist > radius:
            continue
        if best_dist is None or dist < best_dist:
            best = (start, text)
            best_dist = dist
        if dist == 0:
            break
    return best
