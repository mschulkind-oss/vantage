/**
 * Which release `just compat-previous` compares this tree with.
 *
 * The **previous release** *(coined here)* is the newest Vantage release whose
 * `vantage-md` is on npm. Readers on it are the ones a change to the notation
 * can surprise first: before 0.8.0 is tagged that is 0.7.1, and once it is
 * published it is 0.8.0 itself, which is what `main` has to stay readable by.
 *
 * The release tags say which versions were released, since a tag is cut only
 * by `just release`. A clone without them, such as a shallow checkout, reads
 * the version headings in `CHANGELOG.md` instead. Either list can name a
 * version npm does not have yet, a tag whose publish run is still going or the
 * section written for the release being prepared, so a version counts only
 * once npm has it. npm's own `latest` is not asked: publishing a patch to an
 * older line moves it.
 *
 * Pure, so it is tested without git or the network; the suite in
 * `src/test/compat/` gathers the inputs.
 */

export interface PreviousReleaseInputs {
  /** `git tag --list`, any order; non-release tags are ignored. */
  tags: readonly string[];
  /** The text of `CHANGELOG.md`, read when there are no release tags. */
  changelog: string;
  /** Every version of `vantage-md` npm has published. */
  published: readonly string[];
  /** A version asked for by name, which wins if npm has it. */
  requested?: string;
}

export type PreviousRelease =
  | {
      kind: "found";
      version: string;
      /** Where the version came from, for the run's first line. */
      source: string;
      /** Newer candidates passed over because npm does not have them yet. */
      unpublished: string[];
    }
  | { kind: "none"; reason: string };

const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CHANGELOG_HEADING = /^## \[?v?(\d+\.\d+\.\d+)\]?(?:[ \t]|$)/gm;

function parts(version: string): [number, number, number] {
  const match = RELEASE.exec(version);
  return [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
}

/** Newest first. */
function byVersion(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

/** `v0.7.1` and `0.7.1` both name 0.7.1; `v0.8.0-rc.1` names no release. */
function release(name: string): string | null {
  const trimmed = name.trim();
  return RELEASE.test(trimmed) ? trimmed.replace(/^v/, "") : null;
}

export function pickPreviousRelease(
  inputs: PreviousReleaseInputs,
): PreviousRelease {
  const published = new Set(inputs.published);

  if (inputs.requested !== undefined && inputs.requested.trim() !== "") {
    const asked = release(inputs.requested);
    if (asked === null) {
      return {
        kind: "none",
        reason: `"${inputs.requested}" is not a release version: write it as X.Y.Z`,
      };
    }
    if (!published.has(asked)) {
      return {
        kind: "none",
        reason: `vantage-md@${asked} is not on npm`,
      };
    }
    return {
      kind: "found",
      version: asked,
      source: "asked for",
      unpublished: [],
    };
  }

  const tagged = inputs.tags.flatMap((tag) => release(tag) ?? []);
  const fromTags = tagged.length > 0;
  const candidates = fromTags
    ? tagged
    : [...inputs.changelog.matchAll(CHANGELOG_HEADING)].flatMap(
        (m) => m[1] ?? [],
      );
  const source = fromTags ? "the newest release tag" : "CHANGELOG.md";
  const ordered = [...new Set(candidates)].sort(byVersion);
  if (ordered.length === 0) {
    return {
      kind: "none",
      reason: "no release tag and no version heading in CHANGELOG.md",
    };
  }

  const unpublished: string[] = [];
  for (const version of ordered) {
    if (published.has(version)) {
      return { kind: "found", version, source, unpublished };
    }
    unpublished.push(version);
  }
  return {
    kind: "none",
    reason: `npm has none of the versions ${source} names (${ordered.join(", ")})`,
  };
}
