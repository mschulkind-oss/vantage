import { useEffect, useRef, useCallback, type RefObject } from "react";
import type { ReviewComment } from "../types";

interface ReviewStripeProps {
  scrollRef: RefObject<HTMLElement | null>;
  comments: ReviewComment[];
}

export function ReviewStripe({ scrollRef, comments }: ReviewStripeProps) {
  const stripeRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const stripeEl = stripeRef.current;
    if (!scrollEl || !stripeEl || active.length === 0) return;

    // Defer one frame so comment blocks are rendered before measuring.
    const raf = requestAnimationFrame(() => {
      const scrollHeight = scrollEl.scrollHeight;
      if (scrollHeight === 0) return;

      stripeEl.innerHTML = "";
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
        stripeEl.appendChild(marker);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [scrollRef, active, scrollToComment]);

  if (active.length === 0) return null;

  return (
    <div ref={stripeRef} className="review-stripe" data-review-stripe="" />
  );
}
