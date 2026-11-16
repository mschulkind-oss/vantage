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
 *  - Transport messages are truncated and backlog batches split to keep each
 *    JSON frame below the backend's 32 KiB read limit. Console output stays full.
 *  - flush() drains buffered entries in order on the next reconnect.
 *  - Entries that have been shipped are dropped from the buffer so we
 *    don't replay the same line twice on a reconnect.
 */

const MAX_BUFFER = 500;
// Leave room below coder/websocket's default 32 KiB inbound message limit.
// Limits count UTF-8 bytes of serialized JSON, not JavaScript string length.
const MAX_FRAME_BYTES = 16 * 1024;
const MAX_MESSAGE_BYTES = 8 * 1024;
const encoder = new TextEncoder();
const TRUNCATED = " … [truncated]";

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** Bound the transported message, including JSON escaping and the marker. */
function boundedMessage(message: string): string {
  if (byteLength(JSON.stringify(message)) <= MAX_MESSAGE_BYTES) return message;
  let low = 0;
  let high = message.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      byteLength(JSON.stringify(message.slice(0, middle) + TRUNCATED)) <=
      MAX_MESSAGE_BYTES
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  // A UTF-16 slice may end halfway through a supplementary Unicode character.
  const prefix = message.slice(0, low).replace(/[\uD800-\uDBFF]$/u, "");
  return prefix + TRUNCATED;
}

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
  const msg = boundedMessage(format(fmt, args));
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
  // Split by encoded frame size: 500 buffered entries can otherwise exceed
  // the read limit, close the live-update socket, and fail again on reconnect.
  const prefix = '{"type":"client_log_batch","entries":[';
  const suffix = "]}";
  let index = 0;
  while (index < pending.length) {
    const start = index;
    const entries: string[] = [];
    let bytes = byteLength(prefix + suffix);
    while (index < pending.length) {
      const entry = pending[index];
      const encoded = JSON.stringify({
        level: entry.level,
        ts: entry.ts,
        msg: entry.msg,
      });
      const extraBytes = byteLength(encoded) + (entries.length ? 1 : 0);
      if (bytes + extraBytes > MAX_FRAME_BYTES) break;
      entries.push(encoded);
      bytes += extraBytes;
      index++;
    }
    try {
      ws.send(prefix + entries.join(",") + suffix);
      for (let i = start; i < index; i++) pending[i].shipped = true;
    } catch {
      // Completed batches stay shipped; only unsent entries retry next bind.
      return;
    }
  }
}

/** Test-only: clear state between cases. */
export function _resetWsLogger(): void {
  buffer = [];
  socket = null;
}
