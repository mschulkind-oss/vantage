/**
 * Compile-time-stamped version and commit.
 *
 * `scripts/build.ts` passes these to `bun build --define`, which inlines the
 * string literals at compile time — the binary carries its version with no
 * runtime environment. When running unbuilt (`bun src/main.ts` in dev), the
 * `process.env.*` expressions are live lookups and fall back to dev values.
 */
export const VERSION: string = process.env.VANTAGE_CHECK_VERSION ?? "0.0.0-dev";
export const COMMIT: string = process.env.VANTAGE_CHECK_COMMIT ?? "dev";
