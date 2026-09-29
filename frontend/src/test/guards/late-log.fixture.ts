import { it } from "vitest";

it("ends with a timer still to fire, which logs", () => {
  setTimeout(() => console.error("logged by the timer a test left"), 5);
});
