/**
 * Headless stand-in for `dompurify`, bundled in place of the real package in
 * this CLI *only* (never in vantage-md or the frontend, which render in a
 * browser with a real DOM).
 *
 * Why: mermaid's *parse* path runs every flowchart label through its bundled
 * DOMPurify (hook setup + sanitize) even though `mermaid.parse` only validates
 * grammar and never renders HTML. DOMPurify's factory, given no DOM, returns
 * a method-less stub, so the hook setup throws
 * `DOMPurify.addHook is not a function` on the most common diagram syntax
 * (labeled nodes/edges) — see scripts/spike-mermaid.ts. That turned every
 * labeled-flowchart repo into a permanently inconclusive run.
 *
 * This stand-in makes the sanitize step an identity: parse needs the *text*
 * of labels, not a sanitized document, and sanitization is a render-time
 * concern the browser's real DOMPurify handles. It restores grammar
 * validation for labeled flowcharts without faking anything parse can observe
 * differently — the jison grammar check runs exactly as in the browser.
 */

const noHook = () => {};

/** Identity: nothing to sanitize without a DOM, and parse does not render. */
const sanitize = (dirty: string): string => dirty;

const dompurify = {
  version: "0.0.0-vantage-check-headless",
  isSupported: false,
  removed: [] as unknown[],
  sanitize,
  setConfig: noHook,
  clearConfig: noHook,
  isValidAttribute: () => true,
  addHook: noHook,
  removeHook: noHook,
  removeHooks: noHook,
  removeAllHooks: noHook,
};

export default dompurify;
