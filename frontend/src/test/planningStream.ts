/**
 * A fake Vantage server for the scan worker's suites: a `fetch` that answers
 * `POST …/planning/stream` and `GET …/planning/sources?path=` from a tree of
 * path → content, as `internal/planning/stream.go` and `sources.go` answer
 * them (`docs/design/planning-index-at-scale.md` §6.1, §6.2), and
 * `GET …/planning/server-id` with its server id (§6.5).
 *
 * The stream's body is served in chunks of `chunkBytes` bytes of its UTF-8
 * encoding, one chunk per read, so a test decides where lines and characters
 * are cut. A request's `signal` errors the body it is reading, as a real
 * aborted fetch does.
 */
import { isRoadmapPath, type PlanningConfig } from "vantage-md/planning";
import { contentHash, planningConfig } from "./planning";

export interface FakeServerOptions {
  /** The repository's `[planning]` settings, over the defaults. */
  config?: Partial<PlanningConfig>;
  /** Bytes per chunk of the stream's body; the whole body in one by default. */
  chunkBytes?: number;
  /** Paths the server cannot read, and why. */
  unreadable?: Record<string, string>;
  /** The API base it answers under; `/api` by default. */
  apiBase?: string;
  /**
   * The server id it answers, `fake-server` by default; `null` answers
   * `500`, as a server that cannot say would.
   */
  serverId?: string | null;
  /**
   * Answer `same` for a roadmap whose hash `have` names, as a server that
   * disagrees with the worker about which files are roadmaps would. An
   * agreeing server never does (scale design §6.1).
   */
  sameForRoadmaps?: boolean;
}

/** One request the fake server answered, as it arrived. */
export interface FakeRequest {
  method: string;
  url: string;
  /** The parsed body of a POST, `undefined` for a GET or no body. */
  body: unknown;
  signal: AbortSignal | undefined;
}

export interface FakeServer {
  fetch: typeof fetch;
  /** The tree it serves; a test edits it between requests. */
  tree: Record<string, string>;
  /** The server id it answers; a test changes it between requests. */
  serverId: string | null;
  /**
   * The stream and one-path requests it answered, in order. The server id's
   * are counted in `serverIdRequests` instead, so `requests[0]` is still a
   * build's stream.
   */
  requests: FakeRequest[];
  serverIdRequests: number;
  /** The `have` of each stream request, in order: `{}` for none. */
  haves(): Record<string, string>[];
  /** The paths each stream sent as `file`, in order. */
  fileLines: string[][];
  /** The `?path=` requests, by path, in order. */
  pathRequests(): string[];
}

const snakeConfig = (config: PlanningConfig) => ({
  roadmaps: config.roadmaps,
  include: config.include,
  exclude: config.exclude,
  max_file_bytes: config.maxFileBytes,
  max_candidates: config.maxCandidates,
  stages: config.stages,
});

const byteLength = (text: string): number =>
  new TextEncoder().encode(text).length;

/**
 * The planning stream's lines for `tree`, answering `have` (§6.1). Every path
 * of the tree is a candidate, and a roadmap, by the header's own test, is
 * always a `file`.
 */
export function streamLines(
  tree: Record<string, string>,
  have: Record<string, string>,
  options: FakeServerOptions = {},
): string[] {
  const config = planningConfig(options.config);
  const paths = Object.keys(tree).sort();
  const refused = paths.length > config.maxCandidates;
  const lines: unknown[] = [
    {
      kind: "header",
      config: snakeConfig(config),
      candidate_count: paths.length,
      refused,
    },
  ];
  if (!refused) {
    for (const path of paths) {
      const content = tree[path] ?? "";
      const size = byteLength(content);
      const reason = options.unreadable?.[path];
      const hash = contentHash(content);
      if (size > config.maxFileBytes) {
        lines.push({ kind: "skipped", path, size });
      } else if (reason !== undefined) {
        lines.push({ kind: "unreadable", path, reason });
      } else if (
        (options.sameForRoadmaps === true || !isRoadmapPath(config, path)) &&
        have[path] === hash
      ) {
        lines.push({ kind: "same", path, hash });
      } else {
        lines.push({ kind: "file", path, hash, content });
      }
    }
  }
  lines.push({ kind: "end", candidates: paths.length });
  return lines.map((line) => JSON.stringify(line));
}

const abortError = () =>
  new DOMException("The operation was aborted.", "AbortError");

/**
 * A body over `bytes`, `chunkBytes` at a time, pulled one chunk per read. An
 * aborted `signal` errors it.
 */
export function chunkedBody(
  bytes: Uint8Array,
  chunkBytes: number,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  let at = 0;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const onAbort = () => controller?.error(abortError());
  signal?.addEventListener("abort", onAbort, { once: true });
  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    pull(c) {
      if (at >= bytes.length) {
        signal?.removeEventListener("abort", onAbort);
        c.close();
        return;
      }
      c.enqueue(bytes.slice(at, at + chunkBytes));
      at += chunkBytes;
    },
  });
}

/** A `Response` whose body is `text`'s UTF-8 bytes, `chunkBytes` at a time. */
export function chunkedResponse(
  text: string,
  chunkBytes: number,
  signal?: AbortSignal,
  init: ResponseInit = {},
): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    chunkedBody(bytes, Math.max(1, chunkBytes), signal),
    init,
  );
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function fakePlanningServer(
  initial: Record<string, string>,
  options: FakeServerOptions = {},
): FakeServer {
  const apiBase = options.apiBase ?? "/api";
  const server: FakeServer = {
    tree: { ...initial },
    serverId: options.serverId === undefined ? "fake-server" : options.serverId,
    requests: [],
    serverIdRequests: 0,
    fileLines: [],
    haves: () =>
      server.requests
        .filter((r) => r.url.endsWith("/planning/stream"))
        .map((r) => {
          const body = r.body as { have?: Record<string, string> } | undefined;
          return body?.have ?? {};
        }),
    pathRequests: () =>
      server.requests.flatMap((r) => {
        const path = new URL(r.url, "http://vantage.test").searchParams.get(
          "path",
        );
        return path === null ? [] : [path];
      }),
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const signal = init?.signal ?? undefined;
      const text = typeof init?.body === "string" ? init.body : undefined;
      if (method === "GET" && url === `${apiBase}/planning/server-id`) {
        server.serverIdRequests += 1;
        if (signal?.aborted) throw abortError();
        return server.serverId === null
          ? json({ detail: "no" }, 500)
          : json({ server_id: server.serverId });
      }
      server.requests.push({
        method,
        url,
        body: text === undefined ? undefined : JSON.parse(text),
        signal,
      });
      if (signal?.aborted) throw abortError();

      const parsed = new URL(url, "http://vantage.test");
      if (
        method === "POST" &&
        parsed.pathname === `${apiBase}/planning/stream`
      ) {
        const body = (text === undefined ? {} : JSON.parse(text)) as {
          have?: Record<string, string>;
        };
        const lines = streamLines(server.tree, body.have ?? {}, options);
        server.fileLines.push(
          lines.flatMap((line) => {
            const parsedLine = JSON.parse(line) as {
              kind: string;
              path: string;
            };
            return parsedLine.kind === "file" ? [parsedLine.path] : [];
          }),
        );
        const whole = lines.map((line) => `${line}\n`).join("");
        return chunkedResponse(
          whole,
          options.chunkBytes ?? byteLength(whole),
          signal,
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      if (
        method === "GET" &&
        parsed.pathname === `${apiBase}/planning/sources`
      ) {
        const path = parsed.searchParams.get("path");
        if (path === null) return json({ detail: "gone" }, 410);
        const content = server.tree[path];
        if (content === undefined) return json({ kind: "absent", path });
        const size = byteLength(content);
        const reason = options.unreadable?.[path];
        if (size > planningConfig(options.config).maxFileBytes) {
          return json({ kind: "skipped", path, size });
        }
        if (reason !== undefined)
          return json({ kind: "unreadable", path, reason });
        return json({
          kind: "file",
          path,
          content,
          hash: contentHash(content),
        });
      }
      return json({ detail: "not found" }, 404);
    },
  };
  return server;
}
