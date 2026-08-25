/**
 * render/pipeline — run the document through `renderMarkdown`, the exact
 * end-to-end function the viewer calls. If the full pipeline rejects on this
 * document, the viewer would fail to render it, so that is a document finding.
 * (Cheap: we import the function, so this costs one render we would do anyway.)
 */

import { renderMarkdown } from "vantage-md";
import type { Validator } from "./types.js";

export const validatePipeline: Validator = {
  id: "render/pipeline",
  async run(doc) {
    let err: unknown;
    try {
      await renderMarkdown(doc.content);
    } catch (e) {
      err = e;
    }
    if (err === undefined) return [];
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        file: doc.rel,
        rule: "render/pipeline",
        severity: "error",
        line: 0,
        message: `the Vantage render pipeline failed on this document: ${msg
          .replace(/\s+/g, " ")
          .slice(0, 160)}`,
      },
    ];
  },
};
