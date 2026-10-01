import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewComment } from "../types";

// A release viewer: the bundle publish.yml or `just release` built, which bakes
// its release in (src/lib/viewerRelease.ts). Every other test file runs as a
// development build, whose payload keeps the bare command.
vi.mock("../lib/viewerRelease", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/viewerRelease")>()),
  VIEWER_RELEASE: "0.8.0",
}));

const { answersPayload, linesOfText, useReviewStore } =
  await import("./useReviewStore");

const content = "line one\nline two\n";
const comment = (id: string): ReviewComment => ({
  id,
  selected_text: "line two",
  fallback_text: "line two",
  comment: "Tighten this.",
  created_at: 0,
  anchor: {
    selected_text: "line two",
    context_before: "",
    context_after: "",
    source_line: 2,
    occurrence_index: 0,
    selection_length: 0,
  },
  reactions: [],
});

describe("the review payload from a release viewer (checker-version-skew.md §5)", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
    useReviewStore.setState({
      filePath: "docs/design/guide.md",
      lastContent: content,
      comments: [comment("aaaaaaaa-0001")],
    });
  });

  afterEach(() => {
    useReviewStore.setState({
      filePath: null,
      lastContent: null,
      comments: [],
    });
  });

  it("names the viewer's release in front of the checker command", async () => {
    await useReviewStore.getState().copyAllToClipboard();
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain(
      "From the root of this repository run `VANTAGE_VIEWER=0.8.0 uvx vantage-check docs/design/guide.md` — no install, no server — and fix what it reports.",
    );
    expect(payload.match(/VANTAGE_VIEWER/g)).toHaveLength(1);
  });

  it("says the same in one comment's Copy", async () => {
    await useReviewStore.getState().copyCommentToClipboard("aaaaaaaa-0001");
    expect(writeText.mock.calls[0][0]).toContain(
      "`VANTAGE_VIEWER=0.8.0 uvx vantage-check docs/design/guide.md`",
    );
  });

  // The planning page's Copy answers is answersPayload, so for one document it
  // must still be the document's own Copy, byte for byte, release and all.
  it("keeps Copy answers byte-identical to the document's own Copy", async () => {
    await useReviewStore.getState().copyAllToClipboard();
    expect(
      answersPayload([
        {
          path: "docs/design/guide.md",
          comments: [comment("aaaaaaaa-0001")],
          lines: linesOfText(content),
        },
      ]),
    ).toBe(writeText.mock.calls[0][0]);
  });

  it("names it once for several documents", () => {
    const payload = answersPayload([
      {
        path: "a.md",
        comments: [comment("aaaaaaaa-0001")],
        lines: linesOfText(content),
      },
      {
        path: "docs/b.md",
        comments: [comment("bbbbbbbb-0002")],
        lines: linesOfText(content),
      },
    ])!;
    expect(payload).toContain(
      "`VANTAGE_VIEWER=0.8.0 uvx vantage-check a.md docs/b.md`",
    );
    expect(payload.match(/VANTAGE_VIEWER/g)).toHaveLength(1);
  });

  // The agent runs the command as written. In a shell the assignment reaches
  // the checker's environment and no argument, and every path stays one word.
  it("runs as one command that hands the checker the variable and the paths", () => {
    const paths = ["docs/a b.md", "docs/$(touch pwned).md", "plain.md"];
    const payload = answersPayload(
      paths.map((path) => ({
        path,
        comments: [comment("aaaaaaaa-0001")],
        lines: linesOfText(content),
      })),
    )!;
    const command = payload.match(/run `(VANTAGE_VIEWER=[^`]*)` — no/)![1];
    const bin = mkdtempSync(join(tmpdir(), "vantage-viewer-"));
    try {
      writeFileSync(
        join(bin, "uvx"),
        '#!/bin/sh\nprintf \'%s\\0\' "$VANTAGE_VIEWER" "$@"\n',
        { mode: 0o755 },
      );
      const words = execFileSync("sh", ["-c", command], {
        cwd: bin,
        encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` },
      });
      expect(words.split("\0").slice(0, -1)).toEqual([
        "0.8.0",
        "vantage-check",
        ...paths,
      ]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
