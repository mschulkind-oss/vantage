/**
 * What the harness serves: the production bundle (the Go binary with a freshly
 * built `web/dist` embedded), and for D4 the Vite dev server in front of it.
 * Each on a port the kernel hands out, never one of the ports a developer's
 * own servers or the end-to-end suite use, with a home directory of its own so
 * nothing it writes reaches the developer's.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./fixture.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The production default, the dev pair `just dev` opens, and the e2e suite's. */
const TAKEN = new Set([8000, 8101, 8200, 8201, 5201]);

/** A free port nothing of the developer's uses, as the kernel hands one out. */
export async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
    if (port > 0 && !TAKEN.has(port)) return port;
  }
}

/** The commit the harness runs from, `-dirty` when the tree has changes. */
export function treeCommit(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  return dirty === "" ? sha : `${sha}-dirty`;
}

/**
 * Build the production bundle into `web/dist` (`just web-sync`, which writes
 * only ignored files), unless `rebuild` is false and one is already there,
 * then the binary that embeds it, into `dir`.
 */
export function buildBinary(dir: string, rebuild: boolean): string {
  if (rebuild || !existsSync(path.join(REPO_ROOT, "web/dist/index.html"))) {
    execFileSync("just", ["web-sync"], { cwd: REPO_ROOT, stdio: "inherit" });
  }
  const binary = path.join(dir, "vantage");
  const commit = treeCommit();
  execFileSync(
    "go",
    [
      "build",
      "-ldflags",
      `-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=${commit}`,
      "-o",
      binary,
      "./cmd/vantage",
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  return binary;
}

export interface Running {
  url: string;
  log: string;
  stop(): Promise<void>;
}

const children = new Set<ChildProcess>();

/** Stop every server still running: on exit, and on Ctrl-C. */
export function stopAll(): void {
  for (const child of children) child.kill("SIGTERM");
}

function stopping(child: ChildProcess): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        children.delete(child);
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        console.warn(
          `process ${child.pid} did not stop within 10 s; left running`,
        );
        resolve();
      }, 10_000);
      child.once("exit", () => {
        clearTimeout(timer);
        children.delete(child);
        resolve();
      });
      child.kill("SIGTERM");
    });
}

async function until(url: string, child: ChildProcess, log: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with ${child.exitCode}; see ${log}`);
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`nothing answered ${url} within 120 s; see ${log}`);
}

function launch(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  log: string,
): ChildProcess {
  const out = createWriteStream(log);
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  children.add(child);
  return child;
}

/** `vantage serve <target>` on a free port, with its own home under `scratch`. */
export async function startServer(
  binary: string,
  target: string,
  scratch: string,
): Promise<Running> {
  const home = mkdtempSync(path.join(scratch, "home-"));
  const port = await freePort();
  const log = path.join(scratch, `serve-${port}.log`);
  const child = launch(
    binary,
    ["serve", target, "--port", String(port), "--no-open"],
    {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      VANTAGE_NO_TIPS: "1",
    },
    log,
  );
  const url = `http://127.0.0.1:${port}`;
  await until(`${url}/api/health`, child, log);
  return { url, log, stop: stopping(child) };
}

/**
 * The Vite dev server on a free port, proxying the API to `backend`, with a
 * dependency cache of its own under `scratch`, so it shares nothing with a dev
 * server the developer is running (`devServer.ts`).
 */
export async function startDevServer(
  backend: string,
  scratch: string,
): Promise<Running> {
  const port = await freePort();
  const log = path.join(scratch, `vite-${port}.log`);
  const child = launch(
    process.execPath,
    [
      path.join(here, "devServer.ts"),
      String(port),
      path.join(scratch, "vite-cache"),
    ],
    {
      ...process.env,
      VITE_API_TARGET: backend,
      VITE_WS_TARGET: backend.replace(/^http/, "ws"),
    },
    log,
  );
  const url = `http://127.0.0.1:${port}`;
  await until(`${url}/api/health`, child, log);
  return { url, log, stop: stopping(child) };
}
