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

  it("still mirrors to the browser console", () => {
    bindLoggerSocket(socket as unknown as WebSocket);
    wsLog.log("[ws] visible-in-devtools");
    expect(consoleLog).toHaveBeenCalledWith("[ws] visible-in-devtools");
  });
});
