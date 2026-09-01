import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Render a review comment body — a comment, or an agent's reaction summary — to
 * HTML that is safe to assign to `innerHTML`.
 *
 * ## Why this is sanitised at all
 *
 * `marked` does not sanitise: it passes raw HTML straight through and does not
 * inspect link protocols, so `<img src=x onerror=alert(1)>` and
 * `[click](javascript:alert(1))` both survive verbatim. The inline review
 * surface assigns this string to `innerHTML`, where an `onerror` fires. Comment
 * text is written by whoever can write the review file, and the `oq` button
 * lets *document content* mint a comment — the same untrusted input the
 * markup design's threat model already assumes ("anyone who can put a file in a
 * served repository").
 *
 * ## Why DOMPurify rather than the document pipeline's `rehype-sanitize`
 *
 * The repo already has one sanitisation policy — `sanitizeSchema` in
 * `vantage-md` — and drift between policies is a real cost, so this is a
 * deliberate second one:
 *
 * - **Different medium.** That schema describes a *document*: MathML, KaTeX's
 *   span/style scaffolding, `details`, tables, ids for anchors. A comment card
 *   is UI chrome a few lines long. Reusing the document schema here would grant
 *   a review comment the whole KaTeX and MathML surface for nothing.
 * - **Different sink.** `rehype-sanitize` cleans a hast *tree* inside an async
 *   unified run; this path needs a synchronous string→string clean at an
 *   `innerHTML` sink. Doing it with hast would mean pulling in `hast-util-from-html`
 *   *and* `hast-util-to-html` (the latter is not even resolved in this tree) and
 *   sanitising a re-parsed tree — more moving parts guarding a smaller surface.
 * - **Right tool for this sink.** DOMPurify sanitises in the same DOM that will
 *   host the result, which is what makes it robust against the mutation-XSS
 *   class that string-into-`innerHTML` invites. It is already resolved in this
 *   tree (mermaid depends on it) and declared in `packages/vantage-check`, so
 *   declaring it here adds a manifest entry, not a new download.
 *
 * ## The allowlist
 *
 * Tight, and derived from what `.review-inline-comment-text` / `.review-thread-text`
 * actually style (see `index.css`): paragraphs, emphasis, code spans, fenced
 * code, links, lists, blockquotes, plus GFM tables so a pasted table does not
 * come apart. Deliberately absent:
 *
 * - `img` — the demonstrated vector's tag; unstyled here, and a remote fetch
 *   triggered by document content is a beacon even with handlers stripped.
 * - `svg`, `math`/MathML, `iframe`, `object`, `embed`, `script`, `style`,
 *   `form`, `details`/`summary` — none of them mean anything in a comment card.
 * - `input`, and with it a GFM task list's checkbox. A form control that a
 *   document can put inside the app's own chrome is UI-spoofing surface for no
 *   gain; the list item's text still renders, only the box is gone.
 * - `class` and `style` attributes — a comment must not be able to reach into
 *   the app's own styling. (The only class `marked` emits here is
 *   `language-*` on fenced code, and comment bodies are not highlighted.)
 * - Headings — `h1`-`h6` would inherit the prose container's typography and
 *   render a comment card as a document. The heading's text survives.
 */
export function renderCommentMarkdown(text: string): string {
  // Two measured failure modes, one guard, and it has to come *before* the call.
  // With a DOM but `isSupported` false (a degenerate `document.implementation`)
  // `sanitize()` returns its input *unchanged* — purify's own
  // `/* Return dirty HTML if DOMPurify cannot run */` — so it fails open. With no
  // DOM at all the module never assigns `sanitize`, so calling it throws a
  // TypeError and takes the render pass with it. Degrade to plain escaped text
  // instead: no markup, but nothing executable either.
  if (!DOMPurify.isSupported) return escapeHtml(text);

  const rendered = (marked.parse(text, MD_OPTIONS) as string).trim();
  const clean = DOMPurify.sanitize(rendered, COMMENT_POLICY).trim();

  // A one-paragraph comment renders inline, without the block wrapper. The
  // guard matters: `<p>a</p>\n<p>b</p>` also matches the outer shape, and
  // unwrapping it would hand `innerHTML` an unbalanced fragment that the
  // browser re-parses into different markup than the one just sanitised.
  const singleParagraph = ONE_PARAGRAPH.exec(clean);
  if (singleParagraph && !singleParagraph[1].includes("</p>")) {
    return singleParagraph[1];
  }
  return clean;
}

const MD_OPTIONS = { breaks: false, gfm: true };

const ONE_PARAGRAPH = /^<p>([\s\S]*)<\/p>$/;

/**
 * Absolute `http(s)`/`mailto` and relative URLs only — the shape of DOMPurify's
 * own default, minus the protocols a review comment has no business using
 * (`ftp`, `tel`, `sms`, `callto`, `cid`, `xmpp`, `matrix`). The two alternatives
 * after the scheme list are what keep `docs/design/x.md`, `./sibling.md`,
 * `/abs/path` and `#anchor` working: a value whose first colon is preceded by
 * something that cannot be a scheme is a relative reference.
 */
const SAFE_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const COMMENT_POLICY = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "b",
    "i",
    "del",
    "s",
    "code",
    "pre",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  ALLOWED_ATTR: [
    "href",
    "title",
    // `<ol start="3">`, `<th align="right">` — `marked`'s own output.
    "start",
    "align",
  ],
  ALLOWED_URI_REGEXP: SAFE_URI,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
