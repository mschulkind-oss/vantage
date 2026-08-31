/**
 * The version string, stamped in at compile time by scripts/build.ts.
 *
 * Running from source (tests, `bun src/main.ts`) leaves the defines unset,
 * which is why the `typeof` guards are here rather than bare references.
 */
declare const __VANTAGE_CHECK_VERSION__: string;
declare const __VANTAGE_CHECK_COMMIT__: string;

export const VERSION =
  typeof __VANTAGE_CHECK_VERSION__ === "string"
    ? __VANTAGE_CHECK_VERSION__
    : "0.0.0-dev";

export const COMMIT =
  typeof __VANTAGE_CHECK_COMMIT__ === "string"
    ? __VANTAGE_CHECK_COMMIT__
    : "dev";
