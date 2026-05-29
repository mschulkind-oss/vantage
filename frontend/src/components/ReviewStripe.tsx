import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { ReviewComment } from "../types";
import { useReviewStore } from "../stores/useReviewStore";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";

interface ReviewStripeProps {
  scrollRef: RefObject<HTMLElement | null>;
  comments: ReviewComment[];
}

interface MarkerInfo {
  id: string;
  topPct: number;
  heightPct: number;
  addressed: boolean;
}

export function ReviewStripe({ scrollRef, comments }: ReviewStripeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [viewportPct, setViewportPct] = useState({ top: 0, height: 100 });
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [visibleSet, setVisibleSet] = useState<Set<number>>(new Set());
  const [markers, setMarkers] = useState<MarkerInfo[]>([]);
  const [dragging, setDragging] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number } | null>(null);
  const setHoveredCommentId = useReviewStore((s) => s.setHoveredCommentId);
  const hoveredCommentId = useReviewStore((s) => s.hoveredCommentId);

  const active = comments.filter((c) => !c.resolved);
  const hasReaction = (c: ReviewComment) =>
    (c.reactions ?? []).some((r) => r.actor === "agent");

  const [changeMarkers, setChangeMarkers] = useState<
    { topPct: number; heightPct: number }[]
  >([]);

  const measureChangeMarkers = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !hoveredCommentId) {
      setChangeMarkers([]);
      return;
    }

    const comment = comments.find((c) => c.id === hoveredCommentId);
    const creationHashes = comment?.block_hashes_at_creation;
    if (!creationHashes || Object.keys(creationHashes).length === 0) {
      setChangeMarkers([]);
      return;
    }

    const scrollHeight = scrollEl.scrollHeight;
    if (scrollHeight === 0) {
      setChangeMarkers([]);
      return;
    }

    const result: { topPct: number; heightPct: number }[] = [];
    const blocks = scrollEl.querySelectorAll<HTMLElement>("[data-source-line]");
    for (const block of blocks) {
      const line = block.getAttribute("data-source-line");
      if (!line) continue;
      const currentHash = hashBlockText(blockVisibleText(block));
      const creationHash = creationHashes[line];
      if (creationHash && creationHash !== currentHash) {
        const top = block.offsetTop;
        const height = block.offsetHeight;
        result.push({
          topPct: (top / scrollHeight) * 100,
          heightPct: Math.max((height / scrollHeight) * 100, 0.5),
        });
      }
    }
    setChangeMarkers(result);
  }, [scrollRef, hoveredCommentId, comments]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      measureChangeMarkers();
    });
    return () => cancelAnimationFrame(raf);
  }, [measureChangeMarkers]);

  const measureMarkers = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || active.length === 0) {
      setMarkers([]);
      return;
    }

    const scrollHeight = scrollEl.scrollHeight;
    if (scrollHeight === 0) {
      setMarkers([]);
      return;
    }

    const result: MarkerInfo[] = [];
    for (const comment of active) {
      const target = scrollEl.querySelector(
        `[data-review-inline-comment="${comment.id}"]`,
      ) as HTMLElement | null;
      if (!target) continue;

      const top = target.offsetTop;
      const height = target.offsetHeight;
      result.push({
        id: comment.id,
        topPct: (top / scrollHeight) * 100,
        heightPct: Math.max((height / scrollHeight) * 100, 0.8),
        addressed: hasReaction(comment),
      });
    }
    result.sort((a, b) => a.topPct - b.topPct);
    setMarkers(result);
  }, [scrollRef, active]);

  const updateVisibility = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || markers.length === 0) {
      setCurrentIdx(-1);
      setVisibleSet(new Set());
      return;
    }

    const scrollTop = scrollEl.scrollTop;
    const clientHeight = scrollEl.clientHeight;
    const scrollHeight = scrollEl.scrollHeight;

    const viewTop = (scrollTop / scrollHeight) * 100;
    const viewBottom = ((scrollTop + clientHeight) / scrollHeight) * 100;

    const visible = new Set<number>();
    let first = -1;
    for (let i = 0; i < markers.length; i++) {
      const mTop = markers[i].topPct;
      const mBottom = mTop + markers[i].heightPct;
      if (mBottom >= viewTop && mTop <= viewBottom) {
        visible.add(i);
        if (first < 0) first = i;
      }
    }

    setVisibleSet(visible);
    if (first >= 0) {
      setCurrentIdx(first);
    } else {
      let closest = 0;
      for (let i = markers.length - 1; i >= 0; i--) {
        if (markers[i].topPct < viewTop) {
          closest = i;
          break;
        }
      }
      setCurrentIdx(closest);
    }
  }, [scrollRef, markers]);

  const scrollToMarker = useCallback(
    (idx: number) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl || idx < 0 || idx >= markers.length) return;

      const marker = markers[idx];
      const scrollHeight = scrollEl.scrollHeight;
      const clientHeight = scrollEl.clientHeight;
      const targetTop = (marker.topPct / 100) * scrollHeight;
      const scrollTarget = targetTop - clientHeight / 3;
      scrollEl.scrollTo({
        top: Math.max(0, scrollTarget),
        behavior: "smooth",
      });
      setCurrentIdx(idx);
    },
    [scrollRef, markers],
  );

  const navigateComment = useCallback(
    (direction: "next" | "prev") => {
      if (markers.length === 0) return;

      let nextIdx: number;
      if (currentIdx < 0) {
        nextIdx = 0;
      } else if (direction === "next") {
        nextIdx = (currentIdx + 1) % markers.length;
      } else {
        nextIdx = (currentIdx - 1 + markers.length) % markers.length;
      }

      scrollToMarker(nextIdx);
    },
    [markers, currentIdx, scrollToMarker],
  );

  // Keyboard shortcuts: ] for next, [ for prev
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (active.length === 0) return;
      if (e.key === "]") {
        e.preventDefault();
        navigateComment("next");
      } else if (e.key === "[") {
        e.preventDefault();
        navigateComment("prev");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active.length, navigateComment]);

  // Track scroll position for viewport indicator + visibility
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight <= 0) return;
      const top = (scrollTop / scrollHeight) * 100;
      const height = (clientHeight / scrollHeight) * 100;
      setViewportPct({ top, height: Math.min(height, 100) });
      updateVisibility();
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);

    return () => {
      scrollEl.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, updateVisibility]);

  // Measure markers after DOM settles
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || active.length === 0) return;

    const raf = requestAnimationFrame(() => {
      measureMarkers();
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollRef, active, measureMarkers]);

  // Draggable viewport handle
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const scrollEl = scrollRef.current;
      const trackEl = trackRef.current;
      if (!scrollEl || !trackEl) return;

      setDragging(true);
      const trackRect = trackEl.getBoundingClientRect();

      const onMove = (ev: MouseEvent) => {
        const y = ev.clientY - trackRect.top;
        const pct = Math.max(0, Math.min(1, y / trackRect.height));
        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
        scrollEl.scrollTop = pct * maxScroll;
      };

      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [scrollRef],
  );

  // Click on track to jump
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      const scrollEl = scrollRef.current;
      const trackEl = trackRef.current;
      if (!scrollEl || !trackEl) return;
      if ((e.target as HTMLElement).closest(".review-stripe-viewport")) return;
      if ((e.target as HTMLElement).closest(".review-stripe-marker")) return;

      const trackRect = trackEl.getBoundingClientRect();
      const y = e.clientY - trackRect.top;
      const pct = Math.max(0, Math.min(1, y / trackRect.height));
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      scrollEl.scrollTo({ top: pct * maxScroll, behavior: "smooth" });
    },
    [scrollRef],
  );

  const handleMarkerHover = useCallback((idx: number, e: React.MouseEvent) => {
    const trackEl = trackRef.current;
    if (!trackEl) return;
    const trackRect = trackEl.getBoundingClientRect();
    const markerRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const top = markerRect.top - trackRect.top + markerRect.height / 2;
    setHoveredIdx(idx);
    setTooltipPos({ top });
  }, []);

  if (active.length === 0) {
    return (
      <div className="review-stripe review-stripe--empty" data-review-stripe="">
        <div className="review-stripe-header">
          <span className="review-stripe-count">0</span>
        </div>
        <div className="review-stripe-track" />
      </div>
    );
  }

  const label =
    currentIdx >= 0
      ? `${currentIdx + 1} / ${markers.length}`
      : `${active.length}`;

  const hoveredComment =
    hoveredIdx !== null
      ? active.find((c) => c.id === markers[hoveredIdx]?.id)
      : null;

  return (
    <div className="review-stripe" data-review-stripe="">
      {/* Header with N of M */}
      <div className="review-stripe-header">
        <span className="review-stripe-count">{label}</span>
      </div>

      {/* Prev button */}
      <button
        className="review-stripe-nav"
        onClick={() => navigateComment("prev")}
        title="Previous comment ( [ )"
      >
        <ChevronUp size={16} />
      </button>

      {/* Track with viewport + markers */}
      <div
        ref={trackRef}
        className="review-stripe-track"
        onClick={handleTrackClick}
      >
        <div
          className={`review-stripe-viewport${dragging ? " review-stripe-viewport--dragging" : ""}`}
          style={{
            top: `${viewportPct.top}%`,
            height: `${viewportPct.height}%`,
          }}
          onMouseDown={handleDragStart}
        />
        {markers.map((m, i) => (
          <button
            key={m.id}
            className={[
              "review-stripe-marker",
              m.addressed && "review-stripe-marker--addressed",
              visibleSet.has(i) && "review-stripe-marker--visible",
              i === currentIdx && "review-stripe-marker--active",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              top: `${m.topPct}%`,
              height: `${m.heightPct}%`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              scrollToMarker(i);
            }}
            onMouseEnter={(e) => {
              handleMarkerHover(i, e);
              setHoveredCommentId(m.id);
            }}
            onMouseLeave={() => {
              setHoveredIdx(null);
              setTooltipPos(null);
              setHoveredCommentId(null);
            }}
          />
        ))}

        {/* Change markers — shown on hover to indicate blocks that changed */}
        {changeMarkers.map((cm, i) => (
          <div
            key={`chg-${i}`}
            className="review-stripe-change-marker"
            style={{
              top: `${cm.topPct}%`,
              height: `${cm.heightPct}%`,
            }}
          />
        ))}

        {/* Tooltip */}
        {hoveredComment && tooltipPos && (
          <div
            className="review-stripe-tooltip"
            style={{ top: tooltipPos.top }}
          >
            <div className="review-stripe-tooltip-comment">
              {hoveredComment.comment.length > 120
                ? hoveredComment.comment.slice(0, 120) + "…"
                : hoveredComment.comment}
            </div>
            {hoveredComment.reactions &&
              hoveredComment.reactions.length > 0 && (
                <div className="review-stripe-tooltip-reaction">
                  {hoveredComment.reactions[
                    hoveredComment.reactions.length - 1
                  ].summary.slice(0, 80)}
                </div>
              )}
            {hoveredComment.fallback_text && (
              <div className="review-stripe-tooltip-context">
                &ldquo;
                {hoveredComment.fallback_text.length > 60
                  ? hoveredComment.fallback_text.slice(0, 60) + "…"
                  : hoveredComment.fallback_text}
                &rdquo;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Next button */}
      <button
        className="review-stripe-nav"
        onClick={() => navigateComment("next")}
        title="Next comment ( ] )"
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );
}
