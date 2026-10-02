/**
 * The notation this tree's style guide teaches, read by the previous release.
 *
 * `just compat-previous` runs this suite, and CI runs it as a job of its own.
 * It picks the previous release (`src/compat/previousRelease.ts`), installs
 * that release's published `vantage-md` into a directory of its own under the
 * system's temporary directory, and runs `src/compat/notation.ts` over every
 * example the guide shows, every directive form this tree's vocabulary accepts,
 * and every `vantage:` frontmatter value. Each is a test, and a failing one
 * lists every misreading it found. The package is never a dependency of this
 * workspace: the lockfile is not touched, and nothing installed outlives the
 * run.
 *
 * Offline it skips and says why. Where `CI=true`, a fetch that fails is a
 * failure instead, so the job cannot go green by checking nothing.
 *
 * `VANTAGE_COMPAT_PREVIOUS`, which is the recipe's argument, names a release
 * to compare with instead: `just compat-previous 0.7.0`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  frontmatterExamples,
  guideExamples,
  misreadings,
  vocabularyExamples,
  type NotationExample,
  type Release,
} from "../../compat/notation";
import { pickPreviousRelease } from "../../compat/previousRelease";

const REPO = resolve(import.meta.dirname, "../../../..");
const REQUIRED = process.env.CI === "true";

/**
 * npm settings that say where a project is. `npx` exports the workspace's own,
 * `npm_config_local_prefix` among them, and an install that read one would
 * write into this workspace instead of the scratch directory.
 */
const PLACES = new Set([
  "npm_config_local_prefix",
  "npm_config_prefix",
  "npm_config_global",
  "npm_config_location",
  "npm_config_workspace",
  "npm_config_workspaces",
  "npm_config_include_workspace_root",
]);

/**
 * The environment npm and git run in: every npm setting but those, so a
 * registry, a cache or a proxy someone set still applies, and nothing of the
 * npm or git process that started this run (`npm_package_*`, `GIT_DIR`).
 */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("GIT_") &&
      (!key.startsWith("npm_") ||
        (key.startsWith("npm_config_") && !PLACES.has(key))),
  ),
);

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    env: ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
}

/**
 * Why a command failed, in a line: npm's first two `npm error` lines, which are
 * its code and its reason, or else whatever it said last.
 */
function why(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text =
    typeof stderr === "string" && stderr.trim() !== "" ? stderr : String(error);
  const lines = text.trim().split("\n");
  const npm = lines.filter((line) => line.startsWith("npm error"));
  return (npm.length > 0 ? npm.slice(0, 2) : lines.slice(-2)).join(" / ");
}

type Previous =
  | {
      kind: "ready";
      release: Release;
      /** For the suite's title: which release, and why that one. */
      title: string;
      dir: string;
    }
  /** No network: skipped locally, failed in CI. */
  | { kind: "unreachable"; reason: string }
  /** Nothing to compare with, or not what was asked for: always a failure. */
  | { kind: "broken"; reason: string };

async function loadPrevious(): Promise<Previous> {
  let tags: string[] = [];
  try {
    tags = run("git", ["tag", "--list", "v[0-9]*"], REPO).split("\n");
  } catch {
    // Not a clone, or no git: CHANGELOG.md is the other list.
  }
  const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
  const requested = process.env.VANTAGE_COMPAT_PREVIOUS;

  let published: string[];
  try {
    published = JSON.parse(
      run(
        "npm",
        [
          "view",
          "vantage-md",
          "versions",
          "--json",
          // The question that finds out whether there is a network, so an
          // offline run says so in seconds rather than after npm's backoff.
          "--fetch-retries=1",
          "--fetch-retry-mintimeout=1000",
          "--fetch-retry-maxtimeout=3000",
        ],
        REPO,
      ),
    ) as string[];
  } catch (error) {
    // Name the version it would have fetched where the tags can say which:
    // CHANGELOG.md alone cannot, since its newest section may be unreleased.
    const guess = pickPreviousRelease({
      tags,
      changelog: "",
      published: [requested ?? "", ...tags].map((v) =>
        v.trim().replace(/^v/, ""),
      ),
      requested,
    });
    const which =
      guess.kind === "found" ? `vantage-md@${guess.version}` : "vantage-md";
    return {
      kind: "unreachable",
      reason: `npm could not be reached to fetch ${which} (${why(error)})`,
    };
  }

  const picked = pickPreviousRelease({
    tags,
    changelog,
    published,
    requested,
  });
  if (picked.kind === "none") {
    return { kind: "broken", reason: `no previous release: ${picked.reason}` };
  }
  const { version } = picked;

  const dir = mkdtempSync(join(tmpdir(), "vantage-compat-"));
  // A project root of its own, so nothing npm does can reach for another.
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "vantage-compat-previous", "private": true }\n',
  );
  try {
    run(
      "npm",
      [
        "install",
        "--prefix",
        dir,
        "--no-save",
        "--no-package-lock",
        // mermaid: the renderer imports it lazily, and only in a browser.
        "--omit=optional",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        // Never --prefer-offline: it resolves a range against whatever
        // metadata npm's cache holds, however old. A cache that last saw katex
        // at 0.18.6 answered 0.7.1's `katex@^0.18.7` with ETARGET, and the
        // release refused to tag over a registry it never asked.
        `vantage-md@${version}`,
      ],
      dir,
    );
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    return {
      kind: "unreachable",
      reason: `npm could not install vantage-md@${version} (${why(error)})`,
    };
  }

  const root = join(dir, "node_modules", "vantage-md");
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as {
    version: string;
    module?: string;
    exports?: { ".": { import?: { default?: string } } };
  };
  if (manifest.version !== version) {
    rmSync(dir, { recursive: true, force: true });
    return {
      kind: "broken",
      reason: `asked npm for vantage-md@${version} and got ${manifest.version}`,
    };
  }
  const entry =
    manifest.exports?.["."].import?.default ??
    manifest.module ??
    "dist/index.js";
  const md = (await import(pathToFileURL(join(root, entry)).href)) as Record<
    string,
    unknown
  >;

  const names = (md.DIRECTIVE_NAMES as readonly string[] | undefined) ?? [];
  const parseDirective = md.parseVantageDirective as
    ((inner: string) => { kind: string; name?: string } | null) | undefined;
  const release: Release = {
    name: `vantage-md@${version}`,
    renderMarkdown: md.renderMarkdown as Release["renderMarkdown"],
    parseFrontmatter: md.parseFrontmatter as Release["parseFrontmatter"],
    // Every release with a `vantage:` key exports its reader; one without has
    // no chip to show.
    readVantageFrontmatter:
      (md.readVantageFrontmatter as Release["readVantageFrontmatter"]) ??
      (() => ({})),
    oqHostTargets: md.VANTAGE_OQ_HOST_TARGETS as readonly string[] | undefined,
    // Both read off the release itself where it exports them: the state a
    // marker means to it, and from 0.8.0 on, whether its app offers a take.
    oqStatus: md.vantageOqStatus as Release["oqStatus"],
    offersTake: md.questionOffersTake as Release["offersTake"],
    appliesDirective: (inner) => {
      const parsed = parseDirective?.(inner);
      return parsed?.kind === "directive" && names.includes(parsed.name ?? "");
    },
  };

  const passedOver =
    picked.unpublished.length > 0
      ? `, passing over ${picked.unpublished.join(", ")}, which npm does not have yet`
      : "";
  return {
    kind: "ready",
    release,
    title: `${release.name} (${picked.source}${passedOver})`,
    dir,
  };
}

const previous = await loadPrevious();

async function expectNoMisreadings(example: NotationExample, release: Release) {
  const found = await misreadings(example, release);
  expect(found.map((m) => `${m.kind}: ${m.message}`)).toEqual([]);
}

if (previous.kind === "unreachable" && !REQUIRED) {
  const reason = `${previous.reason}. Run it again with the network; in CI, where CI=true, this is a failure.`;
  console.warn(`compat-previous skipped: ${reason}`);
  it.skip(`skipped, because ${reason}`, () => {});
} else if (previous.kind !== "ready") {
  it("finds and installs the previous release", () => {
    throw new Error(previous.reason);
  });
} else {
  const { release } = previous;
  afterAll(() => rmSync(previous.dir, { recursive: true, force: true }));

  describe(`what ${previous.title} makes of this tree's notation`, () => {
    describe("every example the style guide shows", () => {
      for (const example of guideExamples()) {
        it(example.origin, () => expectNoMisreadings(example, release));
      }
    });

    describe("every directive form this tree's vocabulary accepts", () => {
      for (const example of vocabularyExamples()) {
        it(example.origin, () => expectNoMisreadings(example, release));
      }
    });

    describe("every value of every vantage: frontmatter key", () => {
      for (const example of frontmatterExamples()) {
        it(example.origin, () => expectNoMisreadings(example, release));
      }
    });
  });

  // The check proved against the real release rather than a stand-in: each of
  // these is a document the suite above has to fail on, or pass.
  describe(`what the check catches, read by ${release.name}`, () => {
    const blocked = (directive: string, marker = "\u{1F512}") =>
      [
        `1. ${marker} **OQ-10: How large is the retry budget?**`,
        "",
        `   ${directive}`,
        "",
        "   Waits on the load test.",
        "",
      ].join("\n");

    // A release that predates `question` offers Take this leaning on every
    // `oq`; from 0.8.0 on, a release reads the marker and withholds it there.
    const predatesQuestion = !(
      release.appliesDirective?.(" vantage: question ") ?? false
    );

    it(
      predatesQuestion
        ? "an oq directive on a 🔒 question, which 0.8.0's guide first taught, is offered an answer"
        : "an oq directive on a 🔒 question is offered nothing, by its marker",
      async () => {
        const found = await misreadings(
          {
            origin: "a test",
            source: blocked("<!-- vantage: oq id=OQ-10 -->"),
          },
          release,
        );
        expect(found.map((m) => m.kind)).toEqual(
          predatesQuestion ? ["affordance"] : [],
        );
      },
    );

    it(
      predatesQuestion
        ? "an oq directive on a ✅ question is offered an answer"
        : "an oq directive on a ✅ question is offered nothing, by its marker",
      async () => {
        const found = await misreadings(
          {
            origin: "a test",
            source: blocked("<!-- vantage: oq id=OQ-10 -->", "\u2705"),
          },
          release,
        );
        expect(found.map((m) => m.kind)).toEqual(
          predatesQuestion ? ["affordance"] : [],
        );
      },
    );

    it("a question directive on a ✅ question, leaning and all, offers nothing", async () => {
      await expectNoMisreadings(
        {
          origin: "a test",
          source: blocked(
            '<!-- vantage: question id=OQ-10 leaning="Wait for the test." -->',
            "\u2705",
          ),
        },
        release,
      );
    });

    it("an oq or a question directive on a 💬 🤷 question is no misreading: it is open", async () => {
      for (const directive of [
        '<!-- vantage: oq id=OQ-10 leaning="Either." -->',
        '<!-- vantage: question id=OQ-10 leaning="Either." -->',
      ]) {
        await expectNoMisreadings(
          {
            origin: `a test: ${directive}`,
            source: blocked(directive, "\u{1F4AC} \u{1F937}"),
          },
          release,
        );
      }
    });

    it("a question directive on the same question, leaning and all, offers nothing: the fix", async () => {
      await expectNoMisreadings(
        {
          origin: "a test",
          source: blocked(
            '<!-- vantage: question id=OQ-10 leaning="Wait for the test." -->',
          ),
        },
        release,
      );
    });

    it("a question directive on an open question is no misreading, whether the release drops it or answers it", async () => {
      await expectNoMisreadings(
        {
          origin: "a test",
          source: blocked(
            '<!-- vantage: question id=OQ-10 leaning="Wait for the test." -->',
          ).replace("\u{1F512}", "\u{1F4AC}"),
        },
        release,
      );
    });

    it("a `-->` inside a value spills the rest of the directive onto the page", async () => {
      const found = await misreadings(
        {
          origin: "a test",
          source:
            '<!-- vantage: oq id=OQ-1 leaning="Keep A --> B as it is." -->\n\nText.\n',
        },
        release,
      );
      expect(found.map((m) => m.kind)).toContain("spill");
    });
  });
}
