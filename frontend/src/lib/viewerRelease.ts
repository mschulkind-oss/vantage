/**
 * Which Vantage release this viewer is, baked into the bundle when it is built.
 *
 * The review payload names it, as `VANTAGE_VIEWER=X.Y.Z` in front of the
 * checker command, so that a later checker can write for the release the
 * reader's viewer actually runs (docs/design/checker-version-skew.md §5). It
 * is read from the bundle rather than asked of the server because it has to be
 * the release of the code in this tab, which is the code rendering the
 * document, even in a tab left open across an upgrade.
 *
 * Only the builders of a release bundle know the release, and both pass it as
 * `VANTAGE_RELEASE`: publish.yml, for the bundle in every archive, wheel and
 * formula, and `just release`, for the bundle the tag carries, which is the one
 * `go install` embeds. vite.config.ts turns that into `__VANTAGE_RELEASE__`.
 * Every other build (`just build`, `just deploy`, `just dev`, the tests) has
 * none, so it is a **development build**, at or ahead of every release, and
 * its payload keeps the bare command.
 */
declare const __VANTAGE_RELEASE__: string;

/** A release: X.Y.Z, written without leading zeros, as a version is. */
const RELEASE_FORM = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The release a build names, from what its builder passed: a plain X.Y.Z once
 * one leading `v` is dropped, and `undefined` for anything else. A pre-release,
 * a Go pseudo-version and an empty value are development builds, which name no
 * release (§4.2).
 */
export function releaseFrom(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const version = raw.startsWith("v") ? raw.slice(1) : raw;
  return RELEASE_FORM.test(version) ? version : undefined;
}

/** This viewer's release, or `undefined` for a development build. */
export const VIEWER_RELEASE: string | undefined =
  typeof __VANTAGE_RELEASE__ === "string"
    ? releaseFrom(__VANTAGE_RELEASE__)
    : undefined;
