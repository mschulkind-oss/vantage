/**
 * The scan worker (`docs/design/planning-index-at-scale.md` §7): one dedicated
 * worker per tab, running the scanner's core over the scan cache in
 * IndexedDB. A thin `onmessage` adapter; everything it does is `core.ts`'s.
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
  type WorkerReply,
  type WorkerRequest,
} from "./core";
import { idbScanStore } from "./store";

/**
 * The little of a dedicated worker's global scope this uses. The app compiles
 * against the `DOM` library, whose `self` is a window, and adding `WebWorker`
 * beside it clashes.
 */
interface ScanWorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
}

const scope = self as unknown as ScanWorkerScope;

const core = scannerCore({
  cache: scanCache(
    idbScanStore(),
    scannerIdOf(sourceHash, navigator.userAgent),
  ),
  yieldNow: messageYield(),
});

const handle = scanWorkerHandler(core, (reply) => scope.postMessage(reply));
scope.onmessage = (event) => handle(event.data);
