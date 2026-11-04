import React, { useState } from "react";
import { restoreEditingSession, type CommentBox } from "../lib/commentAutosave";
import { CancelConfirm } from "../components/CommentSessionViews";

/**
 * Escape and × on a box that holds an editing session: close it when nothing
 * changed, else ask (§7). `cancel` starts that; `confirmation` is the dialog
 * to draw (null when not asking); `confirming` is true while it is drawn.
 * `leave` closes the box's view; it runs after Restore/Discard too.
 */
export function useBoxCancel(
  box: CommentBox,
  close: () => void,
  leave: () => void,
): {
  cancel: () => void;
  confirming: boolean;
  confirmation: React.ReactNode;
} {
  const [confirming, setConfirming] = useState(false);
  const cancel = () => {
    const session = box.editingSession;
    if (session === null || session.unchanged) {
      close();
      return;
    }
    setConfirming(true);
  };
  const session = box.editingSession;
  const confirmation =
    confirming && session !== null ? (
      <CancelConfirm
        session={session}
        onKeep={() => setConfirming(false)}
        onConfirm={() => {
          restoreEditingSession(box);
          leave();
        }}
      />
    ) : null;
  return { cancel, confirming, confirmation };
}
