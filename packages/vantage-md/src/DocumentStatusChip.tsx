import React, { memo } from "react";
import { DOC_STATUS_TONES, type DocStatus } from "./vantageFrontmatter.js";

/**
 * The document's lifecycle status, as a chip.
 *
 * Non-interactive on purpose. D4 says a control that cannot work must not
 * render, and the cheapest way to satisfy that in *every* rendering — the app,
 * the package's exported viewer, an exported static site — is not to be a
 * control at all. So there is no `onClick`, no `<button>` and no
 * `isStaticMode()` gate: gating it would delete the chip from every exported
 * site, which is the one place D5 costs nothing.
 *
 * The text is the token verbatim, lowercase. No display map (`"In review"`) —
 * that is a second vocabulary that drifts from the first, and the visual
 * flourish belongs in CSS, where `text-transform` cannot change what the
 * document's text content is.
 *
 * Styling comes entirely from `styles/directives.css` — `.vantage-chip` for the
 * geometry, shared by selector list with the `badge=` pseudo-element, and
 * `.vantage-chip--<tone>` for the colours. No Tailwind utility appears here, so
 * the chip survives in a consumer that does not run Tailwind and no class name
 * has to be discovered by a content scan.
 */
const DocumentStatusChipInner: React.FC<{ status: DocStatus }> = ({
  status,
}) => (
  <span
    className={`vantage-chip vantage-chip--${DOC_STATUS_TONES[status]}`}
    data-vantage-status={status}
    title={`Document status: ${status}`}
  >
    {status}
  </span>
);

export const DocumentStatusChip = memo(DocumentStatusChipInner);
