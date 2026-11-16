import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wsLog, bindLoggerSocket, _resetWsLogger } from "./wsLogger";

interface FakeSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
}

const OPEN = 1;
const CLOSED = 3;

describe("wsLogger", () => {
  let socket: FakeSocket;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWsLogger();
    socket = { readyState: OPEN, send: vi.fn() };
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    _resetWsLogger();
  });

  it("ships log entries over the bound socket", () => {
    bindLoggerSocket(socket as unknown as WebSocket);
    wsLog.log("[ws] hello %s", "world");
    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(socket.send.mock.calls[0][0] as string);
    expect(payload.type).toBe("client_log");
    expect(payload.level).toBe("info");
    expect(payload.msg).toBe("[ws] hello world");
  });

  it("buffers and batch-flushes when no socket is bound", () => {
    wsLog.log("[ws] one");
    wsLog.log("[ws] two");
    wsLog.error("[ws] three");
    expect(socket.send).not.toHaveBeenCalled();

    bindLoggerSocket(socket as unknown as WebSocket);
    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(socket.send.mock.calls[0][0] as string);
    expect(payload.type).toBe("client_log_batch");
    expect(payload.entries).toHaveLength(3);
    expect(payload.entries[0].msg).toBe("[ws] one");
    expect(payload.entries[2].level).toBe("error");
  });

  it("does not replay shipped entries on a second bind", () => {
    bindLoggerSocket(socket as unknown as WebSocket);
    wsLog.log("[ws] live");
    expect(socket.send).toHaveBeenCalledTimes(1);

    // Second socket — no buffered unshipped entries, so no batch flush.
    const socket2: FakeSocket = { readyState: OPEN, send: vi.fn() };
    bindLoggerSocket(socket2 as unknown as WebSocket);
    expect(socket2.send).not.toHaveBeenCalled();
  });

  it("buffers entries written while the bound socket is closed", () => {
    socket.readyState = CLOSED;
    bindLoggerSocket(socket as unknown as WebSocket);
    wsLog.log("[ws] dropped");
    expect(socket.send).not.toHaveBeenCalled();

    // Reconnect with a fresh OPEN socket → the buffered entry flushes.
    const socket2: FakeSocket = { readyState: OPEN, send: vi.fn() };
    bindLoggerSocket(socket2 as unknown as WebSocket);
    expect(socket2.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(socket2.send.mock.calls[0][0] as string);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].msg).toBe("[ws] dropped");
  });

  it.each(["x", "😀", '"\\\n'])(
    "bounds oversized live log frames containing %j without changing console output",
    (character) => {
      bindLoggerSocket(socket as unknown as WebSocket);
      const message = character.repeat(40_000);
      wsLog.log(message);
      const frame = socket.send.mock.calls[0][0] as string;
      expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(
        16_384,
      );
      const payload = JSON.parse(frame);
      expect(payload.msg).toContain("[truncated]");
      expect(payload.msg).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
      expect(consoleLog).toHaveBeenCalledWith(message);
      bindLoggerSocket(socket as unknown as WebSocket);
      expect(socket.send).toHaveBeenCalledTimes(1);
    },
  );

  it("splits a full reconnect backlog into bounded frames in order", () => {
    for (let i = 0; i < 500; i++) wsLog.log(`${i}: ${"😀".repeat(100)}`);
    bindLoggerSocket(socket as unknown as WebSocket);
    expect(socket.send.mock.calls.length).toBeGreaterThan(1);
    const entries = socket.send.mock.calls.flatMap(([frame]) => {
      expect(
        new TextEncoder().encode(frame as string).length,
      ).toBeLessThanOrEqual(16_384);
      return JSON.parse(frame as string).entries as { msg: string }[];
    });
    expect(entries).toHaveLength(500);
    entries.forEach((entry, i) =>
      expect(entry.msg).toBe(`${i}: ${"😀".repeat(100)}`),
    );
    socket.send.mockClear();
    bindLoggerSocket(socket as unknown as WebSocket);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("keeps only unsent batches when a backlog flush fails partway through", () => {
    for (let i = 0; i < 100; i++) wsLog.log(`${i}: ${"x".repeat(1000)}`);
    const frames: string[] = [];
    socket.send.mockImplementation((frame: string) => {
      if (frames.length === 1) throw new Error("socket closed");
      frames.push(frame);
    });
    bindLoggerSocket(socket as unknown as WebSocket);
    expect(socket.send).toHaveBeenCalledTimes(2);
    const next: FakeSocket = { readyState: OPEN, send: vi.fn() };
    bindLoggerSocket(next as unknown as WebSocket);
    frames.push(...next.send.mock.calls.map(([frame]) => frame as string));
    const entries = frames.flatMap(
      (frame) => JSON.parse(frame).entries as { msg: string }[],
    );
    expect(entries).toHaveLength(100);
    entries.forEach((entry, i) =>
      expect(entry.msg).toBe(`${i}: ${"x".repeat(1000)}`),
    );
  });

  it("still mirrors to the browser console", () => {
    bindLoggerSocket(socket as unknown as WebSocket);
    wsLog.log("[ws] visible-in-devtools");
    expect(consoleLog).toHaveBeenCalledWith("[ws] visible-in-devtools");
  });
});
