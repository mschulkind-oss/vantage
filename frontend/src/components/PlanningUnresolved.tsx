import { useState } from "react";
import type { PlanningQuestion } from "vantage-md/planning";
import { GroupHeading } from "./PlanningGroups";
import {
  UNRESOLVED_TITLES,
  unassignedRequestsText,
  type CommentOwnership,
  type UnresolvedKind,
} from "../lib/questionOwnership";
import { copyTextOrWarn } from "../lib/clipboard";

/** The group's heading id, which a link to `#unattached` opens. */
export const UNATTACHED_ID = "unattached";

const KINDS: readonly UnresolvedKind[] = [
  "unassigned",
  "note",
  "ambiguous",
  "removed",
  "unknown",
  "compacted",
];

/** The kinds a person may attach: ownership is known to be unresolved, not unread. */
const ATTACHABLE: ReadonlySet<UnresolvedKind> = new Set([
  "unassigned",
  "ambiguous",
  "removed",
  "compacted",
]);

/** One unit's text as the proof shows it: whitespace collapsed, bounded. */
const proofText = (q: PlanningQuestion): string =>
  q.unitText.replace(/\s+/g, " ").trim().slice(0, 400);

/**
 * **Comments without a question (N)**
 * (`docs/design/planning-page-freshness.md` §4.3): the pending comments no
 * question owns, and the notes on text outside every question, as a section
 * group after the page's others. Each is listed with the reason in plain
 * words and the quote it was filed on, offered **Attach to question…** unless
 * it is a note, and copied only by **Copy requests**, never with Copy answers.
 * Automatic binds the server refused are listed on their own.
 *
 * The page decides whether the group is drawn: never while it is empty, and
 * once drawn it stays, at 0, until the next layout, so nothing painted moves.
 */
export function PlanningUnresolved({
  groups,
  questionsOf,
  onAttach,
  refusals = {},
  open,
  onToggle,
}: {
  groups: Readonly<Record<UnresolvedKind, readonly CommentOwnership[]>>;
  /** The document's questions that name exactly one question each (unique ids). */
  questionsOf?: (path: string) => readonly PlanningQuestion[];
  /** Attach `entry`'s comment to `question`; resolves to a refusal message or null. */
  onAttach?: (
    entry: CommentOwnership,
    question: PlanningQuestion,
  ) => Promise<string | null>;
  /** Refusals of automatic binds, by `path\ncomment id`, in plain words. */
  refusals?: Readonly<Record<string, string>>;
  open: boolean;
  onToggle: () => void;
}) {
  // The comment being attached, its chosen target (none until chosen) and the
  // last refusal of an attach.
  const [attaching, setAttaching] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [attachRefusal, setAttachRefusal] = useState<
    Readonly<Record<string, string>>
  >({});
  const total = KINDS.reduce((n, k) => n + groups[k].length, 0);
  const refused = Object.entries(refusals);
  const count = total > 0 ? total : refused.length;
  return (
    <section
      aria-labelledby={UNATTACHED_ID}
      className="mb-6"
      data-testid="unattached-group"
    >
      <GroupHeading
        id={UNATTACHED_ID}
        title="Comments without a question"
        count={count}
        open={open}
        controls="group-unattached"
        onToggle={onToggle}
      />
      {open && (
        <div
          id="group-unattached"
          className="mt-2 text-sm text-slate-600 dark:text-slate-300"
        >
          <p>
            No question owns these, so Copy answers does not carry them and no
            card counts them.
          </p>
          {refused.length > 0 && (
            <section data-testid="unresolved-refused">
              <p className="mt-2 font-semibold">Not attached automatically</p>
              <ul>
                {refused.map(([key, message]) => (
                  <li key={key} className="mt-1">
                    <span className="font-mono">{key.split("\n")[0]}</span>
                    <div
                      role="alert"
                      className="text-red-600 dark:text-red-400"
                    >
                      {message}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {KINDS.filter((k) => groups[k].length > 0).map((kind) => (
            <section key={kind} data-testid={`unresolved-${kind}`}>
              <p className="mt-2 font-semibold">
                {UNRESOLVED_TITLES[kind]} ({groups[kind].length})
              </p>
              {kind === "note" && (
                <p>
                  Comments on text outside every question. Nothing is wrong and
                  there is nothing to attach; Copy requests below sends them to
                  the agent.
                </p>
              )}
              {kind === "compacted" && (
                <p>
                  The question ID is recorded in the Decision Ledger, not newly
                  unanswered. Its review comment still awaits an agent reply;
                  the ledger entry is not a delivery receipt.
                </p>
              )}
              <ul>
                {groups[kind].map((entry) => {
                  const { path, comment, reason } = entry;
                  const key = `${path}\n${comment.id}`;
                  const targets = questionsOf?.(path) ?? [];
                  const target = targets.find((q) => q.id === chosen);
                  const refusal = attachRefusal[key] ?? refusals[key];
                  return (
                    <li
                      key={key}
                      className="mt-1"
                      data-testid="unresolved-item"
                    >
                      <span className="font-mono">{path}</span>
                      {reason && <span> — {reason}</span>}
                      {comment.fallback_text && (
                        <blockquote className="border-l-2 pl-2 italic">
                          {comment.fallback_text}
                        </blockquote>
                      )}
                      <div>{comment.comment}</div>
                      {refusal && (
                        <div
                          role="alert"
                          className="text-red-600 dark:text-red-400"
                        >
                          {refusal}
                        </div>
                      )}
                      {onAttach &&
                        ATTACHABLE.has(kind) &&
                        entry.reading &&
                        targets.length > 0 &&
                        (attaching === key ? (
                          <div data-testid="attach-panel" className="mt-1">
                            <label>
                              Attach to question
                              <select
                                value={chosen}
                                onChange={(e) => setChosen(e.target.value)}
                                className="ml-1 max-w-full rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                              >
                                <option value="">Choose a question…</option>
                                {targets.map((q) => (
                                  <option key={q.id} value={q.id ?? ""}>
                                    {q.id}: {q.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {target && (
                              <div data-testid="attach-proof">
                                <p className="mt-1 font-semibold">
                                  The comment was filed on
                                </p>
                                <blockquote className="border-l-2 pl-2 italic">
                                  {comment.fallback_text || "(no quote kept)"}
                                </blockquote>
                                <p className="mt-1 font-semibold">
                                  {target.id} reads now
                                </p>
                                <blockquote className="border-l-2 pl-2">
                                  {proofText(target)}
                                </blockquote>
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={target === undefined}
                              onClick={() => {
                                if (!target) return;
                                void onAttach(entry, target).then((message) => {
                                  setAttachRefusal((held) => {
                                    const { [key]: _gone, ...rest } = held;
                                    return message === null
                                      ? rest
                                      : { ...rest, [key]: message };
                                  });
                                  if (message === null) setAttaching(null);
                                });
                              }}
                              className="mt-1 rounded-md border border-slate-300 px-2 py-1 font-medium disabled:opacity-40 dark:border-slate-600"
                            >
                              Confirm attach
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttaching(null)}
                              className="ml-1 mt-1 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAttaching(key);
                              setChosen("");
                            }}
                            className="mt-1 rounded-md border border-slate-300 px-2 py-1 font-medium dark:border-slate-600"
                          >
                            Attach to question…
                          </button>
                        ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <button
            type="button"
            data-testid="copy-unassigned"
            className="mt-2 rounded-md border border-slate-300 px-2 py-1 font-medium dark:border-slate-600"
            onClick={() => {
              const text = unassignedRequestsText(groups);
              if (text !== null) void copyTextOrWarn(text);
            }}
          >
            Copy requests
          </button>
        </div>
      )}
    </section>
  );
}
