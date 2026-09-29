import { it, vi } from "vitest";

it("logs while it runs, and waits for what it started", async () => {
  console.error("logged inside the test");
  await new Promise((resolve) => setTimeout(resolve, 5));
});

it("ends with fake timers on, which cannot hold up the wait", () => {
  vi.useFakeTimers();
  setTimeout(() => console.error("never fires: the clock is fake"), 5);
});
