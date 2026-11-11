import { useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { ReservedLabel } from "./ReservedLabel";
import type { PlanningQuestion } from "vantage-md/planning";
import { AnchoredMenu } from "./AnchoredMenu";
import {
  UNRESOLVED_TITLES,
  unassignedRequestsText,
  type CommentOwnership,
  type UnresolvedKind,
} from "../lib/questionOwnership";
import { copyTextOrWarn } from "../lib/clipboard";

const KINDS: readonly UnresolvedKind[] = [
  "unassigned",
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
 * "M with unresolved ownership" (`planning-question-state.md` §4): the pending
 * comments no question owns — Unassigned, Ambiguous, Removed or Unknown —
 * counted apart from the answers, listed with the quote they were filed on,
 * and copied only by their own button, never with Copy answers. While the
 * reviews are not all read the count reads "unknown", never zero.
 */
export function PlanningUnresolved({
  groups,
  known,
  questionsOf,
  onAttach,
  refusals = {},
}: {
  groups: Readonly<Record<UnresolvedKind, readonly CommentOwnership[]>>;
  known: boolean;
  /** The document's questions that name exactly one question each (unique ids). */
  questionsOf?: (path: string) => readonly PlanningQuestion[];
  /** Attach `entry`'s comment to `question`; resolves to a refusal message or null. */
  onAttach?: (
    entry: CommentOwnership,
    question: PlanningQuestion,
  ) => Promise<string | null>;
  /** Refusals of automatic binds, by `path\ncomment id`, in plain words. */
  refusals?: Readonly<Record<string, string>>;
}) {
  const [open, setOpen] = useState(false);
  // The comment being attached, its chosen target (none until chosen) and the
  // last refusal of an attach.
  const [attaching, setAttaching] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [attachRefusal, setAttachRefusal] = useState<
    Readonly<Record<string, string>>
  >({});
  const anchorRef = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const total = KINDS.reduce((n, k) => n + groups[k].length, 0);
  const refused = Object.entries(refusals);
  // Keep the same toolbar room through Unknown -> known, including zero.
  // Removing the control let header labels expand and moved painted buttons.
  const shown = !known || total > 0 || refused.length > 0;
  const label =
    total === 0 && known
      ? `${refused.length} not attached`
      : `${known ? total : "Unknown"} with unresolved ownership`;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="unresolved-ownership"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-hidden={shown ? undefined : true}
        tabIndex={shown ? undefined : -1}
        disabled={!known || !shown}
        onClick={() => {
          anchor.current = anchorRef.current;
          setOpen((v) => !v);
        }}
        className={
          "inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700" +
          (shown ? "" : " invisible")
        }
      >
        <ReservedLabel
          icon={<Link2 size={14} aria-hidden="true" />}
          label={label}
          reserve={["Unknown with unresolved ownership", "9999 not attached"]}
          labelClassName="hdr-label hdr-label-minor"
        />
      </button>
      <AnchoredMenu
        open={open && shown}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        width={440}
        aria-label="Comments with unresolved ownership"
      >
        <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
          <p className="font-semibold">Comments with unresolved ownership</p>
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
            Copy unassigned requests
          </button>
        </div>
      </AnchoredMenu>
    </>
  );
}
