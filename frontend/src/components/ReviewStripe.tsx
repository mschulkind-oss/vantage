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

  const active = comments.filter((c) => !c.resolved);
  const hasReaction = (c: ReviewComment) =>
    (c.reactions ?? []).some((r) => r.actor === "agent");

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
      const scrollEl = scrollRef.current;
      if (!scrollEl || active.length === 0) return;

      const scrollTop = scrollEl.scrollTop;
      const midpoint = scrollTop + scrollEl.clientHeight / 2;

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
      if (positions.length === 0) return;

      let target: { id: string; top: number } | undefined;
      if (direction === "next") {
        target = positions.find((p) => p.top > midpoint + 10);
        if (!target) target = positions[0];
      } else {
        target = [...positions].reverse().find((p) => p.top < midpoint - 10);
        if (!target) target = positions[positions.length - 1];
      }

      if (target) scrollToComment(target.id);
    },
    [scrollRef, active, scrollToComment],
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

  // Track scroll position for viewport indicator
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight <= 0) return;
      const top = (scrollTop / scrollHeight) * 100;
      const height = (clientHeight / scrollHeight) * 100;
      setViewportPct({ top, height: Math.min(height, 100) });
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);

    return () => {
      scrollEl.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef]);

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

  return (
    <div className="review-stripe" data-review-stripe="">
      {/* Header with count */}
      <div className="review-stripe-header">
        <span className="review-stripe-count">{active.length}</span>
      </div>

      {/* Nav buttons */}
      <button
        className="review-stripe-nav"
        onClick={() => navigateComment("prev")}
        title="Previous comment ( [ )"
      >
        <ChevronUp size={16} />
      </button>

      {/* Track with viewport + markers */}
      <div ref={trackRef} className="review-stripe-track">
        <div
          className="review-stripe-viewport"
          style={{
            top: `${viewportPct.top}%`,
            height: `${viewportPct.height}%`,
          }}
        />
      </div>

      {/* Nav buttons */}
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
