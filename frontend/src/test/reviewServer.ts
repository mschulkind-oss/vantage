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
  /** Every session command, as `route session_id`, in order (not in `writes`). */
  sessionCalls: string[];
  /** The editing sessions the server holds (`internal/review/sessions.go`). */
  sessions: Record<
    string,
    {
      comment_id: string;
      state: "open" | "closed";
      outcome?: string;
      baseline: { did_not_exist?: boolean; text?: string; version?: string };
      external?: boolean;
    }
  >;
  /** While set, session commands (not text writes) fail as a server that is down would. */
  sessionsDown: boolean;
}

export function installReviewServer(
  initial: ReviewComment[] = useReviewStore.getState().comments,
): ReviewServer {
  const server: ReviewServer = {
    comments: structuredClone(initial),
    writes: [],
    down: false,
    sessionCalls: [],
    sessions: {},
    sessionsDown: false,
  };
  let versions = 0;
  const version = (c: ReviewComment) => {
    (c as ReviewComment & { root_text_version?: string }).root_text_version =
      `v${++versions}`;
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
  const sessionCommand = (url: string, body: Record<string, unknown>) => {
    const route = url.split("/review/")[1];
    const sid = body.session_id as string;
    server.sessionCalls.push(`${route} ${sid}`);
    if (server.sessionsDown) return Promise.reject(new Error("Network Error"));
    const cid = body.comment_id as string;
    const c = find(cid);
    const reply = (stale = false) => ({
      data: {
        session: {
          session_id: sid,
          comment_id: cid,
          state: server.sessions[sid].state,
          outcome: server.sessions[sid].outcome,
          root_text_version: c?.root_text_version ?? "",
          stale,
          comment: c ? structuredClone(c) : undefined,
        },
        review: answer().data,
      },
    });
    if (route === "begin-comment-session") {
      if (!server.sessions[sid]) {
        server.sessions[sid] = {
          comment_id: cid,
          state: "open",
          baseline: c
            ? { text: c.comment, version: c.root_text_version }
            : { did_not_exist: true },
        };
      }
      return Promise.resolve(
        reply(!!c && body.shown_root_version !== (c.root_text_version ?? "")),
      );
    }
    const sess = server.sessions[sid];
    if (!sess) return Promise.reject(fail(404));
    if (sess.state === "closed") return Promise.resolve(reply());
    if (route === "finish-comment-session") {
      sess.state = "closed";
      sess.outcome = "kept";
      return Promise.resolve(reply());
    }
    if (sess.external) {
      return Promise.reject(
        Object.assign(new Error("HTTP 409"), {
          response: { status: 409, data: { reason: "external_text_edit" } },
        }),
      );
    }
    // A root deleted by someone else: nothing to restore (§7 step 2).
    if (!c && !sess.baseline.did_not_exist) return Promise.reject(fail(404));
    sess.state = "closed";
    if (sess.baseline.did_not_exist) {
      server.comments = server.comments.filter((x) => x.id !== cid);
      sess.outcome = "discarded";
    } else if (c) {
      c.comment = sess.baseline.text ?? "";
      c.root_text_version = sess.baseline.version;
      sess.outcome = "restored";
    }
    return Promise.resolve(reply());
  };
  const write = (method: string, url: string, body: unknown) => {
    if (url.includes("-comment-session")) {
      return sessionCommand(url, (body ?? {}) as Record<string, unknown>);
    }
    server.writes.push(`${method} ${url}`);
    if (server.down) return Promise.reject(new Error("Network Error"));
    const parts = url.split("/review/comments")[1] ?? "";
    const [, id, sub, replyId] = parts.split("/").map(decodeURIComponent);
    const b = (body ?? {}) as Record<string, unknown>;
    const textWrite =
      (method === "POST" && !id) || (method === "PATCH" && !sub);
    if (textWrite) {
      const cid = (id ?? b.id) as string;
      const sid = b.session_id as string | undefined;
      if (sid) {
        const sess = server.sessions[sid];
        if (!sess || sess.comment_id !== cid || sess.state !== "open") {
          return Promise.reject(fail(404));
        }
      } else {
        for (const x of Object.values(server.sessions)) {
          if (x.comment_id === cid && x.state === "open") x.external = true;
        }
      }
    }
    if (method === "POST" && !id) {
      const held = find(b.id as string);
      if (held) {
        if (held.comment !== b.comment) {
          held.comment = b.comment as string;
          held.edited_at = now();
          version(held);
        }
      } else {
        server.comments.push({
          id: b.id as string,
          comment: b.comment as string,
          anchor: b.anchor as ReviewComment["anchor"],
          fallback_text: b.fallback_text as string,
          question_id: b.question_id as string | undefined,
          created_at: b.created_at as number,
          reactions: [],
        });
        version(server.comments[server.comments.length - 1]);
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
        version(c);
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
