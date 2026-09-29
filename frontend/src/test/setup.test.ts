/**
 * The two guards in setup.ts exist to turn a leak — work a test started and
 * left running — into a failure that names it, where it used to be a run that
 * went red at random with every test green. Neither can be seen working from
 * inside the file it guards: the request guard fails the test that sent one,
 * and the late-log guard fails a file only after its last test. So this runs a
 * second vitest over src/test/guards, where each fixture breaks one rule, and
 * reads what that run reports about each file.
 *
 * Both guards lean on things a config change could quietly take away — the
 * order vitest runs after-hooks in, Node's clock staying real under fake
 * timers — and a guard that stopped working would look exactly like a suite
 * with nothing to report.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

interface FileReport {
  name: string;
  status: string;
  message: string;
  assertionResults: {
    title: string;
    status: string;
    failureMessages: string[];
  }[];
}

const guards = join(import.meta.dirname, "guards");
const vitest = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

let reports: Map<string, FileReport>;

beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), "vantage-guards-"));
  try {
    // The run is its own: nothing of this worker's vitest or coverage state
    // may reach it, or it reports into this run instead of its own file.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("VITEST") && key !== "NODE_V8_COVERAGE",
      ),
    );
    const report = join(out, "report.json");
    const run = spawnSync(
      process.execPath,
      [
        vitest,
        "run",
        "--config",
        join(guards, "vitest.config.ts"),
        "--reporter=json",
        `--outputFile=${report}`,
      ],
      { encoding: "utf8", env, timeout: 50_000 },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(1);
    const { testResults } = JSON.parse(readFileSync(report, "utf8")) as {
      testResults: FileReport[];
    };
    reports = new Map(
      testResults.map((file) => [file.name.slice(guards.length + 1), file]),
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 60_000);

describe("the request guard", () => {
  it("fails the test that sent one, naming the request", () => {
    const [test] = reports.get("request.fixture.ts")!.assertionResults;
    expect(test.status).toBe("failed");
    expect(test.failureMessages.join("\n")).toContain(
      "sent 1 request(s) that no server is here to answer: " +
        "GET /api/left-to-the-network",
    );
  });
});

describe("the late-log guard", () => {
  it("fails a file whose test left work behind that logs, naming the log", () => {
    const file = reports.get("late-log.fixture.ts")!;
    // Every test in it passed; it is the file that fails, after them.
    expect(file.assertionResults.map((test) => test.status)).toEqual([
      "passed",
    ]);
    expect(file.status).toBe("failed");
    expect(file.message).toContain(
      "logged 1 time(s) after the last test had ended",
    );
    expect(file.message).toContain(
      "console.error: logged by the timer a test left",
    );
  });

  it("passes a file that logs only inside its tests, even left on fake timers", () => {
    const file = reports.get("settled.fixture.ts")!;
    expect(file.message).toBe("");
    expect(file.status).toBe("passed");
    expect(file.assertionResults.map((test) => test.status)).toEqual([
      "passed",
      "passed",
    ]);
  });
});

describe("the run over the fixtures", () => {
  it("leaves nothing in the source tree", () => {
    // Vite keeps its caches in a node_modules beside the root it is given, and
    // that root is here, in src/.
    expect(existsSync(join(guards, "node_modules"))).toBe(false);
  });
});
