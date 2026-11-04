/**
 * What the user sees of a server-held editing session
 * (`lib/commentSession.ts`, `docs/design/planning-question-state.md` §7): the
 * confirmation before Escape/× undoes a session, the report of a restore that
 * is retrying, refused or in conflict (it outlives the box, so it is drawn by
 * the app shell), and the buffer a stale begin set apart.
 */
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { copyText } from "../lib/clipboard";
import {
  cancelWords,
  sessionsToReport,
  sessionsVersion,
  subscribeSessions,
  type CommentSession,
} from "../lib/commentSession";
import type { CommentBox } from "../lib/commentAutosave";
import { useCommentBox } from "../hooks/useCommentBox";

/** *Restore what you opened?* / *Discard this new answer?*, focused on Keep editing. */
export const CancelConfirm: React.FC<{
  session: CommentSession;
  onKeep: () => void;
  onConfirm: () => void;
}> = ({ session, onKeep, onConfirm }) => {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  const words = cancelWords(session);
  return (
    <div
      role="alertdialog"
      aria-label={words.label}
      className="comment-box-foot flex-wrap"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onKeep();
        }
      }}
    >
      <span className="font-medium">{words.question}</span>
      <button
        ref={keep}
        type="button"
        className="comment-box-close"
        onClick={onKeep}
      >
        Keep editing
      </button>
      <button type="button" className="comment-box-close" onClick={onConfirm}>
        {words.confirm}
      </button>
    </div>
  );
};

/** Text typed before a stale begin ack, kept apart: Insert / Copy. */
export const StaleBuffer: React.FC<{ box: CommentBox }> = ({ box }) => {
  const { buffer } = useCommentBox(box);
  if (buffer === null) return null;
  return (
    <div role="status" className="comment-box-foot flex-wrap">
      <span>
        This answer changed before the box opened; what you typed is kept apart:
      </span>
      <p className="w-full whitespace-pre-wrap break-words opacity-80">
        {buffer}
      </p>
      <button
        type="button"
        className="comment-box-close"
        onClick={() => box.insertBuffer()}
      >
        Insert
      </button>
      <button
        type="button"
        className="comment-box-close"
        onClick={() => void box.copyBuffer()}
      >
        Copy
      </button>
      <button
        type="button"
        className="comment-box-close"
        onClick={() => box.dismissBuffer()}
      >
        Dismiss
      </button>
    </div>
  );
};

function useSession(session: CommentSession): void {
  useSyncExternalStore(session.subscribe, session.snapshotVersion);
}

/** One pending or refused restore, with the text it holds. */
const SessionReport: React.FC<{ session: CommentSession }> = ({ session }) => {
  useSession(session);
  const [, tick] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const retrying = session.phase === "restore-retrying";
  useEffect(() => {
    if (!retrying) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [retrying]);
  const copy = (
    <button
      type="button"
      className="comment-box-close"
      onClick={() => void copyText(session.heldText)}
    >
      Copy text
    </button>
  );
  const conflict = session.conflict;
  return (
    <li className="rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-800 dark:bg-slate-900/60">
      {session.phase === "restoring" && <p role="status">Restoring…</p>}
      {retrying && (
        <>
          <p role="status">
            Restore failed — retrying in{" "}
            {Math.max(1, Math.ceil((session.retryInMs ?? 0) / 1000))}s
          </p>
          <button
            type="button"
            className="comment-box-close"
            onClick={() => session.retryRestoreNow()}
          >
            Retry now
          </button>
          {copy}
        </>
      )}
      {session.phase === "gone" && (
        <>
          <p role="status">
            This answer is gone from the server; your text is kept here.
          </p>
          {copy}
          <button
            type="button"
            className="comment-box-close"
            onClick={() => session.dismiss()}
          >
            Close
          </button>
        </>
      )}
      {session.phase === "conflict" && conflict !== null && (
        <div role="alertdialog" aria-label="Changed outside this box">
          <p className="font-medium">Changed outside this box</p>
          <p>Theirs now:</p>
          <pre className="whitespace-pre-wrap">
            {conflict.theirs?.comment ?? "(could not be read)"}
          </pre>
          <p>Yours:</p>
          <pre className="whitespace-pre-wrap">{conflict.yours}</pre>
          <p>Opened:</p>
          <pre className="whitespace-pre-wrap">{conflict.opened}</pre>
          <label className="block">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I have compared these versions
          </label>
          {copy}
          <button
            type="button"
            className="comment-box-close"
            disabled={!confirmed || conflict.theirs === null}
            onClick={() => void session.replaceWithMine()}
          >
            Replace with mine
          </button>
          <button
            type="button"
            className="comment-box-close"
            onClick={() => session.dismiss()}
          >
            Close without saving
          </button>
        </div>
      )}
    </li>
  );
};

/** The app shell's list of restores that are not done (they outlive their boxes). */
export const SessionReports: React.FC = () => {
  useSyncExternalStore(subscribeSessions, sessionsVersion);
  const pending = sessionsToReport();
  if (pending.length === 0) return null;
  return (
    <div
      data-session-reports
      role="region"
      aria-label="Answers being restored"
      className="fixed bottom-4 right-4 z-[95] w-80 max-w-[calc(100vw-32px)] rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 shadow-lg dark:border-amber-700 dark:bg-slate-800 dark:text-slate-100"
    >
      <ul className="space-y-2">
        {pending.map((s) => (
          <SessionReport key={s.id} session={s} />
        ))}
      </ul>
    </div>
  );
};
