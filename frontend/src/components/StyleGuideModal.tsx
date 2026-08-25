import React, { useState } from "react";
import { Modal } from "./Modal";
import { Check, Copy } from "lucide-react";
import { copyTextOrWarn } from "../lib/clipboard";
import { STYLE_GUIDE_SNIPPET } from "vantage-md";

interface StyleGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Base URL for the Vantage instance (e.g. "http://localhost:7744") */
  baseUrl?: string;
}

// The style guide text lives in the vantage-md package (single source of
// truth shared with the vantage-check CLI). Re-exported here so the existing
// import path — and StyleGuideModal.test.tsx — keep working unchanged.
export { STYLE_GUIDE_SNIPPET };

export const StyleGuideModal: React.FC<StyleGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyTextOrWarn(STYLE_GUIDE_SNIPPET.trim())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Style Guide for Agents">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Copy this snippet into your agent's system prompt or conversation
          context so it writes docs that work well with Vantage.
        </p>

        <div className="relative">
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors z-10"
          >
            {copied ? (
              <>
                <Check size={12} className="text-green-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy snippet
              </>
            )}
          </button>
          <pre className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 pr-28 text-xs text-slate-700 dark:text-slate-300 overflow-auto max-h-[50vh] whitespace-pre-wrap font-mono leading-relaxed">
            {STYLE_GUIDE_SNIPPET.trim()}
          </pre>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
            How to use
          </h3>
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1.5 list-disc pl-5">
            <li>
              Paste into your agent's{" "}
              <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                CLAUDE.md
              </code>
              ,{" "}
              <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                AGENTS.md
              </code>
              , or system prompt
            </li>
            <li>
              Or paste at the start of a conversation when asking an agent to
              write docs
            </li>
            <li>
              Vantage will show gentle tips when it notices docs that could
              benefit from these conventions
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
};
