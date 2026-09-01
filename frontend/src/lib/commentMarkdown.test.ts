import { describe, it, expect, afterEach } from "vitest";
import DOMPurify from "dompurify";
import { renderCommentMarkdown } from "./commentMarkdown";

/** Any HTML event-handler attribute, however it is quoted. */
const EVENT_HANDLER = /\son[a-z]+\s*=/i;

describe("renderCommentMarkdown — hostile input", () => {
  it("drops an <img onerror> payload entirely", () => {
    const out = renderCommentMarkdown("<img src=x onerror=alert(1)>");
    expect(out).not.toMatch(EVENT_HANDLER);
    expect(out.toLowerCase()).not.toContain("<img");
  });

  it("drops a javascript: link", () => {
    const out = renderCommentMarkdown("[click](javascript:alert(1))");
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it.each([
    ["JaVaScRiPt:alert(1)", "mixed case"],
    ["java\tscript:alert(1)", "embedded tab"],
    ["java\nscript:alert(1)", "embedded newline"],
    ["  javascript:alert(1)", "leading whitespace"],
    ["&#106;avascript:alert(1)", "entity-encoded first letter"],
    ["vbscript:alert(1)", "vbscript"],
    ["data:text/html;base64,PHNjcmlwdD4=", "data: document"],
  ])("drops a %s URL (%s)", (url) => {
    const out = renderCommentMarkdown(`<a href="${url}">click</a>`);
    const lower = out.toLowerCase().replace(/[\t\n]/g, "");
    expect(lower).not.toContain("javascript:");
    expect(lower).not.toContain("vbscript:");
    expect(lower).not.toContain("data:text/html");
  });

  it("drops <script>", () => {
    const out = renderCommentMarkdown("hi <script>alert(1)</script>");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("drops <iframe>", () => {
    const out = renderCommentMarkdown('<iframe src="https://e.test"></iframe>');
    expect(out.toLowerCase()).not.toContain("<iframe");
  });

  it("drops <svg>", () => {
    const out = renderCommentMarkdown("<svg onload=alert(1)><circle /></svg>");
    expect(out.toLowerCase()).not.toContain("<svg");
    expect(out).not.toMatch(EVENT_HANDLER);
  });

  it.each([
    "<style>body{display:none}</style>",
    "<details><summary>s</summary>body</details>",
    "<form><input value=x></form>",
    "<object data=x></object>",
    "<embed src=x>",
    '<math><mtext><a href="javascript:alert(1)">x</a></mtext></math>',
    "<a href=# onclick=alert(1)>x</a>",
    '<p style="position:fixed;top:0">x</p>',
  ])("neutralises %s", (payload) => {
    const out = renderCommentMarkdown(payload);
    expect(out).not.toMatch(EVENT_HANDLER);
    for (const tag of [
      "<style",
      "<details",
      "<summary",
      "<form",
      "<input",
      "<object",
      "<embed",
      "<math",
      "<mtext",
    ]) {
      expect(out.toLowerCase()).not.toContain(tag);
    }
    expect(out.toLowerCase()).not.toContain("style=");
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("keeps the visible words of a payload it strips", () => {
    // Stripping markup must not silently delete what the reviewer wrote.
    const out = renderCommentMarkdown(
      "please fix <b>this</b> <script>x</script>now",
    );
    expect(out).toContain("please fix");
    expect(out).toContain("now");
  });
});

describe("renderCommentMarkdown — legitimate comment markdown", () => {
  it("keeps emphasis, strong and strikethrough", () => {
    const out = renderCommentMarkdown("**bold** _em_ ~~gone~~");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>em</em>");
    expect(out).toContain("<del>gone</del>");
  });

  it("keeps a code span", () => {
    expect(renderCommentMarkdown("use `foo()` here")).toContain(
      "<code>foo()</code>",
    );
  });

  it("keeps a fenced code block", () => {
    const out = renderCommentMarkdown("```js\nconst a = 1;\n```");
    expect(out).toContain("<pre>");
    expect(out).toContain("<code");
    expect(out).toContain("const a = 1;");
  });

  it("keeps lists", () => {
    const out = renderCommentMarkdown("- one\n- two");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>one</li>");
  });

  it("keeps a blockquote and a horizontal rule", () => {
    const out = renderCommentMarkdown("> quoted\n\n---\n");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<hr>");
  });

  it("keeps a GFM table's cells", () => {
    const out = renderCommentMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<td>1</td>");
  });

  it("keeps a task list's text, without its checkbox", () => {
    // `input` is off the allowlist, so the box goes and the wording stays. This
    // is the one legitimate construct the policy degrades; pinned so the
    // degradation is a decision rather than a surprise.
    const out = renderCommentMarkdown("- [ ] todo\n- [x] done");
    expect(out.toLowerCase()).not.toContain("<input");
    expect(out).toContain("<li>");
    expect(out).toContain("todo");
    expect(out).toContain("done");
  });

  it.each([
    ["https://example.com/x", "absolute https"],
    ["http://example.com/x", "absolute http"],
    ["docs/design/inline-markup.md", "repo-relative"],
    ["./sibling.md", "dot-relative"],
    ["/absolute/path", "root-relative"],
    ["#a-heading", "fragment"],
    ["mailto:someone@example.com", "mailto"],
    ["docs/x.md#anchor", "relative with fragment"],
  ])("keeps a %s link (%s)", (url) => {
    const out = renderCommentMarkdown(`[t](${url})`);
    expect(out).toContain(`href="${url}"`);
    expect(out).toContain(">t</a>");
  });

  it("keeps a link title", () => {
    const out = renderCommentMarkdown('[t](https://e.test "why")');
    expect(out).toContain('title="why"');
  });

  it("unwraps a single paragraph, as the inline surface expects", () => {
    expect(renderCommentMarkdown("just words")).toBe("just words");
  });

  it("keeps paragraph structure when there is more than one", () => {
    const out = renderCommentMarkdown("one\n\ntwo");
    expect(out).toContain("<p>one</p>");
    expect(out).toContain("<p>two</p>");
  });

  it("escapes text that merely looks like markup", () => {
    expect(renderCommentMarkdown("a < b && c > d")).not.toMatch(EVENT_HANDLER);
    expect(renderCommentMarkdown("5 < 6")).toContain("&lt;");
  });
});

describe("renderCommentMarkdown — DOMPurify unusable", () => {
  const sanitize = DOMPurify.sanitize;

  afterEach(() => {
    DOMPurify.isSupported = true;
    DOMPurify.sanitize = sanitize;
  });

  it("falls back to escaped plain text rather than emitting raw HTML", () => {
    // The fail-open branch, measured: with a DOM present but `isSupported`
    // false, `sanitize()` returns its input *unchanged* (purify's own
    // "Return dirty HTML if DOMPurify cannot run"), so a naive call passes the
    // payload through. Pin the closed behaviour: every markup-significant
    // character escaped, so nothing becomes an element.
    DOMPurify.isSupported = false;
    expect(renderCommentMarkdown('<img src="x" onerror=alert(1)>')).toBe(
      "&lt;img src=&quot;x&quot; onerror=alert(1)&gt;",
    );
  });

  it("never reaches `sanitize` — the guard is ahead of the call, not around it", () => {
    // The other branch, which jsdom cannot produce: with no DOM at all purify
    // returns from `createDOMPurify` before assigning `sanitize`, so the call
    // throws `TypeError: DOMPurify.sanitize is not a function` instead of
    // failing open. Simulate that shape — `isSupported` false *and* no
    // `sanitize` — so moving the guard below the call fails here rather than in
    // a DOM-less consumer of this module.
    DOMPurify.isSupported = false;
    DOMPurify.sanitize = undefined as unknown as typeof DOMPurify.sanitize;
    expect(renderCommentMarkdown("<b>x</b> & y")).toBe(
      "&lt;b&gt;x&lt;/b&gt; &amp; y",
    );
  });
});
