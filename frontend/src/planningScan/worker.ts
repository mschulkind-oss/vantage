/**
 * The scan worker (`docs/design/planning-index-at-scale.md` §7): one dedicated
 * worker per tab, running the scanner's core over the scan cache in
 * IndexedDB. A thin `onmessage` adapter; everything it does is `core.ts`'s.
 *
 * A worker of this chunk is a **helper** instead (§7.5) when its first message
 * is a `helper` start: it then scans what comes in through that message's port
 * and does nothing else. It never makes the core, so it never opens the cache
 * or posts to the page. The two share one chunk, so a helper runs exactly the
 * code whose scanner id the results are stored under.
 *
 * Every module it imports sits in this directory or in `packages/vantage-md/`,
 * which the scanner id hashes, and the production build fails if one does not
 * (`scannerId.ts`).
 */

import { sourceHash } from "virtual:planning-scanner-id";
import { scanCache, scannerIdOf } from "./cache";
import {
  messageYield,
  scanWorkerHandler,
  scannerCore,
  serveHelper,
  type HelperStart,
  type WorkerReply,
  type WorkerRequest,
} from "./core";
import { setPlanningLimitsForTests, type PlanningLimits } from "./limits";
import { idbScanStore } from "./store";

/**
 * This worker's own limits, configured down. A worker has its own copy of the
 * limits module, which no override made on the page reaches, so the dev
 * server's end-to-end tests send this. A production build ignores it.
 */
interface LimitsForTests {
  type: "limits";
  limits: Partial<PlanningLimits>;
}

/**
 * The little of a dedicated worker's global scope this uses. The app compiles
 * against the `DOM` library, whose `self` is a window, and adding `WebWorker`
 * beside it clashes.
 */
interface ScanWorkerScope {
  onmessage:
    | ((
        event: MessageEvent<WorkerRequest | HelperStart | LimitsForTests>,
      ) => void)
    | null;
  postMessage(reply: WorkerReply): void;
}

const scope = self as unknown as ScanWorkerScope;
const post = (reply: WorkerReply) => scope.postMessage(reply);

const scanWorker = (): ((request: WorkerRequest) => void) =>
  scanWorkerHandler(
    scannerCore({
      cache: scanCache(
        idbScanStore(),
        scannerIdOf(sourceHash, navigator.userAgent),
      ),
      yieldNow: messageYield(),
      helpers: {
        cores: navigator.hardwareConcurrency,
        ask: (repo, seq, count) => post({ type: "helpers", repo, seq, count }),
      },
    }),
    post,
  );

/** Made on the first request: a helper never makes it. */
let handle: ((request: WorkerRequest) => void) | null = null;

scope.onmessage = ({ data }) => {
  if (data.type === "helper") {
    scope.onmessage = null;
    serveHelper(data.port);
    return;
  }
  if (data.type === "limits") {
    if (import.meta.env.DEV) setPlanningLimitsForTests(data.limits);
    return;
  }
  handle ??= scanWorker();
  handle(data);
};
