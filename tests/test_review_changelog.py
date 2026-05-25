"""Tests for the server-side review-mode changelog parser."""

from __future__ import annotations

import time

from vantage.schemas.models import (
    CommentAnchor,
    CommentReaction,
    ReviewComment,
    ReviewData,
)
from vantage.services import review_changelog
from vantage.services.review_anchor import (
    fnv1a,
    hash_block_text,
    split_blocks,
    strip_block_text,
)


def test_strip_block_text_canonicalization():
    assert strip_block_text("Hello   World") == "hello world"
    assert strip_block_text("  TRIM\nme  ") == "trim me"
    assert strip_block_text("") == ""


def test_fnv1a_known_values():
    # Smoke test: same hash for same input, different for different input.
    assert fnv1a("") == fnv1a("")
    assert fnv1a("hello") != fnv1a("world")
    # 8-char hex output.
    assert len(fnv1a("anything")) == 8


def test_hash_block_text_is_canonicalized():
    assert hash_block_text("Hello World") == hash_block_text("  hello   world  ")


def test_split_blocks_basic():
    md = "First paragraph.\n\nSecond paragraph here.\n\n## A heading"
    out = split_blocks(md)
    assert [line for line, _ in out] == [1, 3, 5]
    assert "First paragraph" in out[0][1]


def test_split_blocks_preserves_fenced_code():
    md = "Intro line.\n\n```\nfenced\nblock\n\nstill in code\n```\n\nAfter."
    out = split_blocks(md)
    assert len(out) == 3
    fenced_block = out[1][1]
    assert "fenced" in fenced_block
    assert "still in code" in fenced_block


def _build_review(comments: list[ReviewComment]) -> ReviewData:
    return ReviewData(file_path="x.md", snapshots=[], comments=comments)


def _comment(
    *, id_prefix: str = "abcd1234", source_line: int = 5, comment: str = "?"
) -> ReviewComment:
    cid = f"{id_prefix}-0000-0000-0000-000000000000"
    return ReviewComment(
        id=cid,
        comment=comment,
        created_at=time.time(),
        anchor=CommentAnchor(
            source_line=source_line,
            block_text_hash=hash_block_text("Old paragraph."),
            selection_offset=0,
            selection_length=0,
        ),
        fallback_text="Old paragraph.",
        reactions=[],
    )


def test_apply_changelog_writes_reaction(monkeypatch):
    review_changelog._reset_cache_for_tests()
    comment = _comment()
    review = _build_review([comment])

    captured: dict[str, ReviewData] = {}

    def fake_save(_file_path: str, data: ReviewData, repo: str | None = None) -> None:  # noqa: ARG001
        del repo
        captured["data"] = data

    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(review_changelog, "save_review", fake_save)

    # Seed a "before" so the parser can capture it.
    review_changelog.seed_prev_content(
        "x.md",
        "Title\n\nIntro.\n\nOld paragraph.\n",
    )

    new_content = (
        "Title\n\nIntro.\n\nNew, much improved paragraph.\n\n"
        "<!-- changelog -->\n"
        "- [abcd1234] Reworded the paragraph for clarity\n"
    )

    n = review_changelog.apply_changelog("x.md", new_content)
    assert n == 1
    saved = captured["data"]
    assert len(saved.comments[0].reactions) == 1
    r = saved.comments[0].reactions[0]
    assert r.actor == "agent"
    assert r.kind == "addressed"
    assert r.summary == "Reworded the paragraph for clarity"
    assert "old paragraph" in r.before_text
    assert "new" in r.after_text


def test_apply_changelog_dedupes_by_summary(monkeypatch):
    review_changelog._reset_cache_for_tests()
    existing_reaction = CommentReaction(
        actor="agent",
        kind="addressed",
        summary="Already done",
        before_text="x",
        after_text="y",
        timestamp=1.0,
    )
    comment = _comment()
    comment.reactions.append(existing_reaction)
    review = _build_review([comment])

    saved = {"count": 0}
    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(
        review_changelog,
        "save_review",
        lambda *_a, **_kw: saved.__setitem__("count", saved["count"] + 1),
    )

    new_content = "<!-- changelog -->\n- [abcd1234] Already done\n"
    assert review_changelog.apply_changelog("x.md", new_content) == 0
    assert saved["count"] == 0


def test_apply_changelog_ignores_unknown_short_id(monkeypatch):
    review_changelog._reset_cache_for_tests()
    comment = _comment()
    review = _build_review([comment])
    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(review_changelog, "save_review", lambda *_a, **_kw: None)

    new_content = "<!-- changelog -->\n- [deadbeef] Bogus id\n"
    assert review_changelog.apply_changelog("x.md", new_content) == 0


def test_apply_changelog_ignores_ambiguous_short_id(monkeypatch, caplog):
    review_changelog._reset_cache_for_tests()
    a = _comment(id_prefix="abcd1234")
    b = _comment(id_prefix="abcd1234")
    # Override the second to share the same prefix.
    b.id = a.id[:8] + "-deef-0000-0000-000000000000"
    review = _build_review([a, b])
    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(review_changelog, "save_review", lambda *_a, **_kw: None)

    new_content = "<!-- changelog -->\n- [abcd1234] Could be either\n"
    with caplog.at_level("WARNING"):
        assert review_changelog.apply_changelog("x.md", new_content) == 0
    assert "ambiguous" in caplog.text


def test_apply_changelog_strict_grammar(monkeypatch):
    review_changelog._reset_cache_for_tests()
    comment = _comment()
    review = _build_review([comment])
    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(review_changelog, "save_review", lambda *_a, **_kw: None)

    # Marker must be exactly the HTML comment.  "changelog" alone won't match.
    bad = "changelog\n- [abcd1234] No marker\n"
    assert review_changelog.apply_changelog("x.md", bad) == 0


def test_apply_changelog_skips_non_bullet_lines(monkeypatch):
    """Lenient: preamble lines, blank lines, and prose between bullets are skipped, not treated as terminators."""
    review_changelog._reset_cache_for_tests()
    comment = _comment()
    review = _build_review([comment])

    captured: list[ReviewData] = []
    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(
        review_changelog,
        "save_review",
        lambda _fp, data, repo=None: captured.append(data),  # noqa: ARG005
    )

    # Mimics the real-world failure: a preamble bullet without a
    # short_id, then valid bullets with proper short_ids.
    new_content = (
        "<!-- changelog -->\n"
        "- (initial draft, 2026-05-24) Filed per design doc § 8.4.\n"
        "\n"
        "- [abcd1234] Reworded that paragraph\n"
        "  some indented prose continuation\n"
        "- [abcd1234] Second bullet on same comment, different summary\n"
    )
    n = review_changelog.apply_changelog("x.md", new_content)
    assert n == 2
    summaries = [r.summary for r in captured[-1].comments[0].reactions]
    assert "Reworded that paragraph" in summaries
    assert "Second bullet on same comment, different summary" in summaries


def test_apply_changelog_uses_last_block(monkeypatch):
    """If the file has multiple changelog blocks, the latest wins."""
    review_changelog._reset_cache_for_tests()
    comment = _comment()
    review = _build_review([comment])

    captured: dict[str, ReviewData] = {}
    monkeypatch.setattr(review_changelog, "get_review", lambda *_a, **_kw: review)
    monkeypatch.setattr(
        review_changelog,
        "save_review",
        lambda _fp, data, repo=None: captured.__setitem__("d", data),  # noqa: ARG005
    )

    new_content = (
        "<!-- changelog -->\n- [abcd1234] First pass\n\n"
        "<!-- changelog -->\n- [abcd1234] Better summary\n"
    )
    assert review_changelog.apply_changelog("x.md", new_content) == 1
    assert captured["d"].comments[0].reactions[-1].summary == "Better summary"
