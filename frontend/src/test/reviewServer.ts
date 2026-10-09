/**
 * A review server in memory, behind a mocked `axios`, for tests of the comment
 * boxes: a box shows nothing in the review store until the server answers a
 * save (`stores/useReviewStore.ts`, `boxWrite`), so a test needs a server
 * that answers the way the real one does (`internal/review/commands.go`),
 * including a repeated create and a reply edited by its id.
 *
 * The test file must `vi.mock("axios")` itself; this installs implementations
 * on that mock. The review starts as the store's comments when it is called.
 */
import axios from "axios";
import { vi } from "vitest";
import { useReviewStore } from "../stores/useReviewStore";
import type { ReviewComment, ReviewData } from "../types";

export interface ReviewServer {
  comments: ReviewComment[];
  /** Every write, as `METHOD url`, in order. */
  writes: string[];
  /** While set, every write fails as a server that is down would. */
  down: boolean;
}

export function installReviewServer(
  initial: ReviewComment[] = useReviewStore.getState().comments,
): ReviewServer {
  const server: ReviewServer = {
    comments: structuredClone(initial),
    writes: [],
    down: false,
  };
  const now = () => Date.now() / 1000;
  const answer = (): { data: ReviewData } => ({
    data: { file_path: "doc.md", comments: structuredClone(server.comments) },
  });
  const find = (id: string) => server.comments.find((c) => c.id === id);
  const fail = (status: number) =>
    Object.assign(new Error(`HTTP ${status}`), {
      response: { status, data: { error: "No comment found" } },
    });
  const write = (method: string, url: string, body: unknown) => {
    server.writes.push(`${method} ${url}`);
    if (server.down) return Promise.reject(new Error("Network Error"));
    const parts = url.split("/review/comments")[1] ?? "";
    const [, id, sub, replyId] = parts.split("/").map(decodeURIComponent);
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === "POST" && !id) {
      const held = find(b.id as string);
      if (held) {
        if (held.comment !== b.comment) {
          held.comment = b.comment as string;
          held.edited_at = now();
        }
      } else {
        server.comments.push({
          id: b.id as string,
          comment: b.comment as string,
          anchor: b.anchor as ReviewComment["anchor"],
          fallback_text: b.fallback_text as string,
          created_at: b.created_at as number,
          reactions: [],
        });
      }
      return Promise.resolve(answer());
    }
    const c = id ? find(id) : undefined;
    if (!c) return Promise.reject(fail(404));
    if (method === "DELETE") {
      server.comments = server.comments.filter((x) => x !== c);
      return Promise.resolve(answer());
    }
    if (method === "PATCH" && !sub) {
      if (typeof b.comment === "string") {
        c.comment = b.comment;
        c.edited_at = now();
      }
      if (typeof b.resolved === "boolean") c.resolved = b.resolved;
      return Promise.resolve(answer());
    }
    const reactions = (c.reactions ??= []);
    if (method === "PATCH" && sub === "replies") {
      const r = reactions.find((x) => x.id === replyId);
      if (!r) return Promise.reject(fail(404));
      r.summary = b.text as string;
      r.edited_at = now();
      return Promise.resolve(answer());
    }
    if (sub === "reopen-reply") c.resolved = false;
    const held = reactions.find((x) => b.id && x.id === b.id);
    if (held) held.summary = b.text as string;
    else
      reactions.push({
        id: b.id as string | undefined,
        actor: "reviewer",
        kind: "needs_clarification",
        summary: b.text as string,
        before_text: "",
        after_text: "",
        timestamp: now(),
      });
    return Promise.resolve(answer());
  };
  vi.mocked(axios.post).mockImplementation((url, body) =>
    write("POST", url, body),
  );
  vi.mocked(axios.patch).mockImplementation((url, body) =>
    write("PATCH", url, body),
  );
  vi.mocked(axios.delete).mockImplementation((url) =>
    write("DELETE", url, undefined),
  );
  return server;
}
