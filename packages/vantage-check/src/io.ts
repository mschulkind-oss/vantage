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
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    isTty: Boolean(process.stdout.isTTY),
    env: process.env,
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
