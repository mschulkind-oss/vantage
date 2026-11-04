/**
 * Binds a legacy comment to its question when the shared scan proves it
 * (`docs/design/planning-question-state.md` §4, "Legacy backfill"): the
 * comment's block hash is one block of its whole document, that block lies in
 * exactly one question's unit, and that unit's id is unique. The ownership map
 * names such a comment's question (`CommentOwnership.candidate`); this asks the
 * server to bind it, carrying the reading the proof came from as preconditions,
 * so a stale mapper is refused rather than trusted.
 *
 * Each (comment, reading) is tried once. A refusal is kept, in the server's
 * words, for the page to show; nothing retries until a new coherent reading
 * arrives, which is a new key.
 */
import { useEffect, useRef, useState } from "react";
import {
  bindCommentQuestion,
  bindRefusal,
  commandErrorMessage,
} from "../stores/useReviewStore";
import { questionQuote, type CommentOwnership } from "../lib/questionOwnership";
import type { ReviewData } from "../types";

export const bindKey = (e: CommentOwnership): string =>
  `${e.path}\n${e.comment.id}`;

export function useLegacyAutoBind(
  entries: readonly CommentOwnership[],
  options: {
    enabled: boolean;
    /** Take the review the server returned for `path`, as a filed comment's echo is. */
    adopt(path: string, data: ReviewData | null): void;
  },
): { refusals: Readonly<Record<string, string>> } {
  const { enabled, adopt } = options;
  const tried = useRef(new Set<string>());
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>(
    {},
  );
  useEffect(() => {
    if (!enabled) return;
    for (const entry of entries) {
      const { candidate, reading } = entry;
      if (!candidate?.id || !reading || reading.sample_changed) continue;
      const attempt = `${bindKey(entry)}\n${reading.boot_id}\n${reading.document_generation}\n${reading.mutation_revision}`;
      if (tried.current.has(attempt)) continue;
      tried.current.add(attempt);
      void bindCommentQuestion(
        entry.path,
        entry.comment.id,
        {
          questionId: candidate.id,
          unitFingerprint: candidate.unitFingerprint,
          selectedQuote: questionQuote(candidate),
        },
        reading,
      ).then(
        (data) => {
          adopt(entry.path, data);
          setRefusals((held) => {
            const { [bindKey(entry)]: _gone, ...rest } = held;
            return rest;
          });
        },
        (e: unknown) => {
          const message =
            bindRefusal(e) ?? commandErrorMessage(e, "Could not attach");
          setRefusals((held) => ({ ...held, [bindKey(entry)]: message }));
        },
      );
    }
  }, [entries, enabled, adopt]);
  return { refusals };
}
