/**
 * Run `then` once the frame now being committed has painted: at the next
 * animation frame the browser is about to paint it, and a task queued from
 * there runs after the paint. Work started straight after a commit competes
 * with that paint instead, which then waits for the work to yield.
 *
 * A tab that is not shown paints nothing and gets no animation frame, so
 * there `then` runs in the next task. Returns a function that cancels `then`
 * if it has not run yet.
 */
export function afterNextPaint(then: () => void): () => void {
  if (document.visibilityState === "hidden") {
    const task = setTimeout(then, 0);
    return () => clearTimeout(task);
  }
  let task: ReturnType<typeof setTimeout> | null = null;
  const frame = requestAnimationFrame(() => {
    task = setTimeout(then, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (task !== null) clearTimeout(task);
  };
}
