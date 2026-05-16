/**
 * In-memory ring buffer for [ws] client-side log lines, plus a transport
 * that ships them to the backend over the WebSocket so they end up in
 * journald alongside the watcher logs.
 *
 * Why: live-reload failures are unpredictable and Chrome only retains
 * console output while DevTools is open.  By forwarding [ws] messages
 * to the server, "give me the last N minutes" becomes a single
 * `journalctl --user -u vantage --since '5 minutes ago'` call.
 *
 * Buffering rules:
 *  - All log() calls write to console (unchanged developer experience).
 *  - Entries are appended to a 500-entry ring.  When the socket is OPEN
 *    we send each one immediately; otherwise it sits in the buffer.
 *  - flush() drains buffered entries in order on the next reconnect.
 *  - Entries that have been shipped are dropped from the buffer so we
 *    don't replay the same line twice on a reconnect.
 */

const MAX_BUFFER = 500;

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: Level;
  ts: number;
  msg: string;
  shipped: boolean;
}

let buffer: LogEntry[] = [];
let socket: WebSocket | null = null;

/** Format console-style printf args into a single string for transport. */
function format(fmt: string, args: unknown[]): string {
  if (args.length === 0) return fmt;
  let i = 0;
  const out = fmt.replace(/%[sdifo]/g, () => {
    if (i >= args.length) return "";
    const v = args[i++];
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });
  // If there are leftover args (e.g. a trailing object), append them.
  const extras = args.slice(i);
  if (extras.length === 0) return out;
  return [
    out,
    ...extras.map((v) => {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }),
  ].join(" ");
}

function ship(entry: LogEntry): void {
  if (entry.shipped) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(
      JSON.stringify({
        type: "client_log",
        level: entry.level,
        ts: entry.ts,
        msg: entry.msg,
      }),
    );
    entry.shipped = true;
  } catch {
    // Ignore transport errors — the buffer keeps the entry for a
    // future flush.  Don't recurse into the logger.
  }
}

function record(level: Level, fmt: string, args: unknown[]): void {
  const msg = format(fmt, args);
  const entry: LogEntry = { level, ts: Date.now(), msg, shipped: false };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) {
    buffer = buffer.slice(buffer.length - MAX_BUFFER);
  }
  // Mirror to console for live DevTools use.
  const consoleFn =
    level === "debug"
      ? console.debug
      : level === "warn"
        ? console.warn
        : level === "error"
          ? console.error
          : console.log;
  consoleFn(fmt, ...args);
  ship(entry);
}

export const wsLog = {
  debug: (fmt: string, ...args: unknown[]) => record("debug", fmt, args),
  log: (fmt: string, ...args: unknown[]) => record("info", fmt, args),
  warn: (fmt: string, ...args: unknown[]) => record("warn", fmt, args),
  error: (fmt: string, ...args: unknown[]) => record("error", fmt, args),
};

/** Register the active WebSocket and flush any buffered entries. */
export function bindLoggerSocket(ws: WebSocket | null): void {
  socket = ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Flush in batch so we don't spam the server with N small frames on
  // reconnect — keeps the journal readable.
  const pending = buffer.filter((e) => !e.shipped);
  if (pending.length === 0) return;
  try {
    ws.send(
      JSON.stringify({
        type: "client_log_batch",
        entries: pending.map((e) => ({
          level: e.level,
          ts: e.ts,
          msg: e.msg,
        })),
      }),
    );
    for (const e of pending) e.shipped = true;
  } catch {
    // Leave shipped=false; another reconnect can retry.
  }
}

/** Test-only: clear state between cases. */
export function _resetWsLogger(): void {
  buffer = [];
  socket = null;
}
