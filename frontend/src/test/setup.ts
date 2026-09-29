import "@testing-library/jest-dom";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeEach } from "vitest";

// jsdom does no layout, so Element.scrollIntoView does not exist at all — a
// component that keeps its selection visible (both pickers, the contents panel)
// throws "not a function" the moment a test renders it with rows. In a browser
// it is real; in a test it has nothing to do.
Element.prototype.scrollIntoView = () => {};

// A test answers every request it sends, because nothing else will: there is no
// server behind jsdom's origin (http://localhost:3000). A request left to the
// network failed a few milliseconds later — by then usually after the test that
// sent it had ended — and what its store logged about the failure landed in a
// later test or, after the file's last one, in a worker already closing its
// channel to the runner. A log still in flight then fails the whole run with
// `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`,
// however green every test was, which is how the check job went red on CI at
// random. Here such a request is opened but never sent, so it cannot fail late,
// and the test that sent it fails at once, naming it.
const unansweredRequests: string[] = [];
const openRequest = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  ...args: Parameters<XMLHttpRequest["open"]>
) {
  unansweredRequests.push(`${args[0]} ${String(args[1])}`);
  return openRequest.apply(this, args);
} as XMLHttpRequest["open"];
XMLHttpRequest.prototype.send = () => {};
afterEach(() => {
  if (unansweredRequests.length === 0) return;
  const sent = unansweredRequests.splice(0);
  throw new Error(
    `sent ${sent.length} request(s) that no server is here to answer: ` +
      `${sent.join(", ")}. Answer each one in the test — spy on axios, or ` +
      `swap the store action that sends it — or hold it pending.`,
  );
});

// Whatever else a test leaves running can fail the run the same way once it
// logs: a timer, a promise chain, a render that settles late. So the file's
// last test is followed for a short while, and anything logged after it fails
// the file, naming what was logged. What lands later than the wait is missed,
// and how much of the rest arrives in time is up to the machine's load, so this
// narrows the random red run rather than ruling it out. The wait is on Node's
// own clock, which a test's vi.useFakeTimers() does not replace, so a file that
// leaves fake timers on cannot stall it.
//
// "After the last test" relies on hook order: vitest runs after-hooks in the
// reverse of the order they were registered (`sequence.hooks: "stack"`, its
// default), and this file registers before any test file does, so the
// afterEach below runs once every test file's own afterEach has, and the
// afterAll once every afterAll has.
const LATE_LOG_WAIT_MS = 50;
const consoleMethods = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
] as const;
const originalConsole = Object.fromEntries(
  consoleMethods.map((method) => [method, console[method]]),
) as Pick<Console, (typeof consoleMethods)[number]>;
/** What was logged since the last test ended; `null` while a test runs. */
let loggedSinceLastTest: string[] | null = null;
for (const method of consoleMethods) {
  console[method] = function (this: Console, ...args: unknown[]) {
    loggedSinceLastTest?.push(`console.${method}: ${format(...args)}`);
    return originalConsole[method].apply(this, args);
  };
}
beforeEach(() => {
  loggedSinceLastTest = null;
});
afterEach(() => {
  loggedSinceLastTest = [];
});
afterAll(async () => {
  await sleep(LATE_LOG_WAIT_MS);
  const late = loggedSinceLastTest ?? [];
  loggedSinceLastTest = null;
  Object.assign(console, originalConsole);
  if (late.length === 0) return;
  throw new Error(
    `logged ${late.length} time(s) after the last test had ended, from work ` +
      `a test left running — settle it or cancel it before the test ends:\n` +
      late.map((line) => `  ${line.slice(0, 300)}`).join("\n"),
  );
});
