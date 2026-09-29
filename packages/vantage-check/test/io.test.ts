import { spawn, type ChildProcess } from "node:child_process";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_OK } from "../src/exit.js";
import { bufferIo, streamWriter, type Io } from "../src/io.js";
import { fullTree } from "./planningTree.js";

/**
 * Writing to a reader that has stopped reading. `vantage-check index | head`
 * is how an agent looks at the first sections, and head closes the pipe once
 * it has its lines, so the command's next write fails with EPIPE. That is the
 * reader's choice, not a failure of the run.
 */

const readers: ChildProcess[] = [];

afterEach(() => {
  while (readers.length > 0) readers.pop()?.kill();
});

/**
 * A real pipe whose reader has gone: the stdin of a child that closes it
 * unread and then stays alive, so the pipe is not torn down with the process
 * and the next write meets the operating system's own EPIPE.
 */
async function pipeWithNoReader(): Promise<NodeJS.WritableStream> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "require('fs').closeSync(0); process.stdout.write('closed'); setTimeout(() => {}, 10000);",
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  readers.push(child);
  await new Promise((resolve) => child.stdout?.once("data", resolve));
  if (child.stdin === null) throw new Error("the child has no stdin");
  return child.stdin;
}

/**
 * Resolves once `stream` has closed. A `close` listener only: `events.once`
 * would add an `error` listener of its own and hide the one under test.
 */
const closed = (stream: NodeJS.WritableStream) =>
  new Promise<void>((resolve) => stream.on("close", () => resolve()));

const errnoError = (code: string) =>
  Object.assign(new Error(`write ${code}`), { code });

describe("streamWriter", () => {
  it("lets index finish with its own exit code when the pipe's reader has gone", async () => {
    const pipe = await pipeWithNoReader();
    const buffer = bufferIo(fullTree());
    const io: Io = { ...buffer, out: streamWriter(pipe) };

    expect(await run(["index"], io)).toBe(EXIT_OK);
    // The EPIPE arrives after the write returns. Unheard, it was an uncaught
    // error that killed the process with a stack trace and exit 1.
    await closed(pipe);
    expect(buffer.stderr).toBe("");
  });

  it("drops every write after an EPIPE", async () => {
    const pipe = await pipeWithNoReader();
    const out = streamWriter(pipe);
    out("the first lines\n");
    await closed(pipe);

    const write = vi.spyOn(pipe, "write");
    out("the rest\n");
    expect(write).not.toHaveBeenCalled();
  });

  it("does not swallow a write error other than EPIPE", () => {
    // A full disk under `index > file` is a broken environment, and the run
    // must not look as if it wrote everything.
    const stream = new Writable({ write: (_chunk, _encoding, done) => done() });
    streamWriter(stream);

    expect(() => stream.emit("error", errnoError("EPIPE"))).not.toThrow();
    expect(() => stream.emit("error", errnoError("ENOSPC"))).toThrow(
      "write ENOSPC",
    );
  });
});
