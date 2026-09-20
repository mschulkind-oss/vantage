#!/usr/bin/env node
/**
 * Process entry point. Everything interesting is in cli.ts, which returns an
 * exit code instead of calling process.exit, so tests can drive the real
 * command surface.
 *
 * This module is also what a worker thread runs. A parallel check starts more
 * copies of *this file* with `isMainThread` false, rather than a second entry
 * point of its own, because that is the only arrangement that works in the
 * shipped artifact: `bun build --compile` puts every module inside the
 * executable, where a separate `worker.js` is not a path anything can load.
 * Run from source the same trick loads this TypeScript through bun, so the two
 * environments do not diverge.
 */
import { isMainThread } from "node:worker_threads";
import { run } from "./cli.js";
import { setWorkerEntry, serveShards } from "./core/parallel.js";
import { processIo } from "./io.js";
import { EXIT_ENVIRONMENT } from "./exit.js";

if (!isMainThread) {
  serveShards();
} else {
  // Only this module knows which module it is, so only this module can say.
  setWorkerEntry(new URL(import.meta.url));

  run(process.argv.slice(2), processIo())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // An exception that escaped this far is our bug or a broken environment,
      // never a verdict on the document — so it exits 3, not 1.
      const message =
        error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`vantage-check: internal error\n${message}\n`);
      process.exitCode = EXIT_ENVIRONMENT;
    });
}
