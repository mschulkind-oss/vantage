/**
 * Which release this build is, stamped in at compile time by scripts/build.ts.
 *
 * Only the release workflow knows a release's version. It stamps the tag into
 * package.json (`npm version`, in publish.yml) and then builds, and build.ts
 * inlines what the manifest says. Every other build — `just cli`, `npm run
 * build`, a checkout run from source — has only the manifest's placeholder,
 * which is not a release, so it is a **development build** and says so wherever
 * a version would be printed (`docs/design/checker-version-skew.md` §4.2).
 * Printing the placeholder instead made a local build claim to be 0.1.0, a
 * release older than every feature it checks.
 *
 * Running from source (tests, `bun src/main.ts`) leaves the defines unset,
 * which is why the `typeof` guards are here rather than bare references.
 */
declare const __VANTAGE_CHECK_VERSION__: string;
declare const __VANTAGE_CHECK_COMMIT__: string;

/**
 * The version package.json carries between releases. Nothing reads it as a
 * release: the manifest never decides a version, the tag does, and CI stamps
 * the tag over this before it builds. A test pins the manifest to it, so the
 * two cannot drift apart and turn every local build into a false release.
 */
export const MANIFEST_PLACEHOLDER = "0.1.0";

/** How a build that is not a release names itself, in place of a version. */
export const DEVELOPMENT_BUILD = "development build";

/**
 * What build.ts inlines for a manifest version: that version when the release
 * workflow stamped one, and `""` — a development build — when the manifest
 * still carries its placeholder.
 */
export function stampFor(manifestVersion: string): string {
  return manifestVersion === MANIFEST_PLACEHOLDER ? "" : manifestVersion;
}

/** The release this build is, or `undefined` for a development build. */
export const RELEASE: string | undefined =
  typeof __VANTAGE_CHECK_VERSION__ === "string" &&
  __VANTAGE_CHECK_VERSION__ !== ""
    ? __VANTAGE_CHECK_VERSION__
    : undefined;

export const COMMIT =
  typeof __VANTAGE_CHECK_COMMIT__ === "string"
    ? __VANTAGE_CHECK_COMMIT__
    : "dev";

/**
 * The version, wherever one is printed as a value: `0.8.0` for a release, and
 * `development build` for anything else, in the JSON reports as in the text.
 */
export const VERSION = RELEASE ?? DEVELOPMENT_BUILD;

/**
 * The commit a development build names beside itself, when the build knows
 * one. Running from source knows none (`dev`), and neither does a build made
 * outside a git checkout (`unknown`).
 */
export function knownCommit(commit: string = COMMIT): string | undefined {
  return commit === "dev" || commit === "unknown" || commit === ""
    ? undefined
    : commit;
}

/**
 * The checker, named mid-sentence: `vantage-check 0.8.0`, or `this development
 * build of vantage-check`.
 */
export function checkerName(release: string | undefined = RELEASE): string {
  return release === undefined
    ? `this ${DEVELOPMENT_BUILD} of vantage-check`
    : `vantage-check ${release}`;
}

/**
 * A viewer at this checker's version, named mid-sentence: `a Vantage 0.8.0
 * viewer`, or `a viewer from this development build`. A checker's vocabulary is
 * the viewer's of the same release, because both are built from one
 * `vantage-md` source, so this is who a finding about unknown markup describes.
 */
export function viewerName(release: string | undefined = RELEASE): string {
  return release === undefined
    ? `a viewer from this ${DEVELOPMENT_BUILD}`
    : `a Vantage ${release} viewer`;
}
