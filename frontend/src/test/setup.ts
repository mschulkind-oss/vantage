import "@testing-library/jest-dom";
import { afterEach } from "vitest";

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
