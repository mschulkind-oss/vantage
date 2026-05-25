import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { ReviewComment } from "../types";

interface ReviewStripeProps {
  scrollRef: RefObject<HTMLElement | null>;
  comments: ReviewComment[];
}

export function ReviewStripe({ scrollRef, comments }: ReviewStripeProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [viewportPct, setViewportPct] = useState({ top: 0, height: 100 });
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [dragging, setDragging] = useState(false);

  const active = comments.filter((c) => !c.resolved);
  const hasReaction = (c: ReviewComment) =>
    (c.reactions ?? []).some((r) => r.actor === "agent");

  const getPositions = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || active.length === 0) return [];

    const positions: { id: string; top: number }[] = [];
    for (const comment of active) {
      const target = scrollEl.querySelector(
        `[data-review-inline-comment="${comment.id}"]`,
      );
      if (target) {
        positions.push({
          id: comment.id,
          top: (target as HTMLElement).offsetTop,
        });
      }
    }
    positions.sort((a, b) => a.top - b.top);
    return positions;
  }, [scrollRef, active]);

  const updateCurrentIdx = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const positions = getPositions();
    if (positions.length === 0) {
      setCurrentIdx(-1);
      return;
    }

    const scrollTop = scrollEl.scrollTop;
    const clientHeight = scrollEl.clientHeight;
    const viewCenter = scrollTop + clientHeight / 2;

    let closest = 0;
    let closestDist = Math.abs(positions[0].top - viewCenter);
    for (let i = 1; i < positions.length; i++) {
      const dist = Math.abs(positions[i].top - viewCenter);
      if (dist < closestDist) {
        closest = i;
        closestDist = dist;
      }
    }
    setCurrentIdx(closest);
  }, [scrollRef, getPositions]);

  const scrollToComment = useCallback(
    (commentId: string) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const target = scrollEl.querySelector(
        `[data-review-inline-comment="${commentId}"]`,
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [scrollRef],
  );

  const navigateComment = useCallback(
    (direction: "next" | "prev") => {
      const positions = getPositions();
      if (positions.length === 0) return;

      let nextIdx: number;
      if (currentIdx < 0) {
        nextIdx = 0;
      } else if (direction === "next") {
        nextIdx = (currentIdx + 1) % positions.length;
      } else {
        nextIdx = (currentIdx - 1 + positions.length) % positions.length;
      }

      setCurrentIdx(nextIdx);
      scrollToComment(positions[nextIdx].id);
    },
    [getPositions, currentIdx, scrollToComment],
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

  // Track scroll position for viewport indicator + current index
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight <= 0) return;
      const top = (scrollTop / scrollHeight) * 100;
      const height = (clientHeight / scrollHeight) * 100;
      setViewportPct({ top, height: Math.min(height, 100) });
      updateCurrentIdx();
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);

    return () => {
      scrollEl.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, updateCurrentIdx]);

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

      const trackRect = trackEl.getBoundingClientRect();
      const y = e.clientY - trackRect.top;
      const pct = Math.max(0, Math.min(1, y / trackRect.height));
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      scrollEl.scrollTop = pct * maxScroll;
    },
    [scrollRef],
  );

  // Render markers imperatively after DOM is ready
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const trackEl = trackRef.current;
    if (!scrollEl || !trackEl || active.length === 0) return;

    const raf = requestAnimationFrame(() => {
      const scrollHeight = scrollEl.scrollHeight;
      if (scrollHeight === 0) return;

      trackEl
        .querySelectorAll(".review-stripe-marker")
        .forEach((el) => el.remove());

      for (const comment of active) {
        const target = scrollEl.querySelector(
          `[data-review-inline-comment="${comment.id}"]`,
        );
        if (!target) continue;

        const targetTop = (target as HTMLElement).offsetTop;
        const pct = (targetTop / scrollHeight) * 100;

        const marker = document.createElement("button");
        marker.className = hasReaction(comment)
          ? "review-stripe-marker review-stripe-marker--addressed"
          : "review-stripe-marker";
        marker.style.top = `${pct}%`;
        marker.title = comment.comment.slice(0, 60);
        marker.addEventListener("click", () => scrollToComment(comment.id));
        trackEl.appendChild(marker);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [scrollRef, active, scrollToComment]);

  if (active.length === 0) return null;

  const label =
    currentIdx >= 0
      ? `${currentIdx + 1} / ${active.length}`
      : `${active.length}`;

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
