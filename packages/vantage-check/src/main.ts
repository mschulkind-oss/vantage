#!/usr/bin/env node
/**
 * Process entry point. Everything interesting is in cli.ts, which returns an
 * exit code instead of calling process.exit, so tests can drive the real
 * command surface.
 */
import { run } from "./cli.js";
import { processIo } from "./io.js";
import { EXIT_ENVIRONMENT } from "./exit.js";

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
