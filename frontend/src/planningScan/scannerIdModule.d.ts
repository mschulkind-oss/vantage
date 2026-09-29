/**
 * The scanner id's source half (`docs/design/planning-index-at-scale.md`
 * §8.2), served by the Vite plugin in `scannerId.ts`. It resolves only under
 * `vite.config.ts`, never in a unit test.
 *
 * Named apart from `scannerId.ts` on purpose: TypeScript drops a `.d.ts` that
 * shares a `.ts` file's base name from a project's files, so a
 * `scannerId.d.ts` would declare nothing.
 */
declare module "virtual:planning-scanner-id" {
  /**
   * SHA-256 over every file the scan worker's code comes from, as 32
   * lowercase hex digits.
   */
  export const sourceHash: string;
}
