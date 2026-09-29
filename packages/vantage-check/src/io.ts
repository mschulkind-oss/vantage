/**
 * Everything the commands are allowed to touch in the outside world, in one
 * object, so tests can run the real CLI without a process.
 */
export interface Io {
  /** Write to stdout. The caller supplies its own newlines. */
  out(text: string): void;
  /** Write to stderr. */
  err(text: string): void;
  /** Directory that relative paths resolve against. */
  cwd: string;
  /** Whether stdout is a terminal — decides color when nothing overrides it. */
  isTty: boolean;
  /** The environment. Read for `VANTAGE_CHECK_JOBS`, and nothing else so far. */
  env: Record<string, string | undefined>;
}

/** The real process-backed Io. */
export function processIo(): Io {
  return {
    out: streamWriter(process.stdout),
    err: streamWriter(process.stderr),
    cwd: process.cwd(),
    isTty: Boolean(process.stdout.isTTY),
    env: process.env,
  };
}

/**
 * Write to `stream` until its reader goes away, and drop what comes after.
 *
 * `vantage-check index | head` is how an agent reads the first sections, and
 * head closes the pipe once it has its lines. The next write fails with EPIPE,
 * which a stream reports as an `error` event, and with nothing listening that
 * event killed the process with a stack trace and exit 1: the code that means
 * a check found problems, from a command that never exits 1. A reader that
 * stops reading has not made the run fail, so an EPIPE ends this stream's
 * output, every later write is dropped, and the command exits with the code it
 * would have given a reader that read to the end.
 *
 * Any other write error, such as a full disk under `index > file`, still ends
 * the process, as it always did: output that was lost for a reason nobody
 * chose must not look as if it was written.
 */
export function streamWriter(
  stream: NodeJS.WritableStream,
): (text: string) => void {
  let open = true;
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
    open = false;
  });
  return (text) => {
    if (open) stream.write(text);
  };
}

/**
 * An Io that collects everything written to it, for tests.
 *
 * The environment is empty rather than inherited: a test that asserts what the
 * default is must not get a different answer because whoever ran it had
 * `VANTAGE_CHECK_JOBS` set.
 */
export function bufferIo(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = {},
): Io & {
  stdout: string;
  stderr: string;
} {
  const io = {
    stdout: "",
    stderr: "",
    cwd,
    isTty: false,
    env,
    out(text: string) {
      io.stdout += text;
    },
    err(text: string) {
      io.stderr += text;
    },
  };
  return io;
}
