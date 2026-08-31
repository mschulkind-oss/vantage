/**
 * Exit codes.
 *
 * The split between 1 and 3 is the whole point of the design's P2: a run that
 * *could not check* must never look like a run that *found nothing*. Callers
 * (and agents) can treat 1 as "fix your document" and 3 as "fix my
 * environment", and neither as green.
 */
export const EXIT_OK = 0;
/** The run produced findings that fail it. */
export const EXIT_FINDINGS = 1;
/** Bad arguments, or a path that does not exist. */
export const EXIT_USAGE = 2;
/** A validator could not run. The document's status is unknown, not clean. */
export const EXIT_ENVIRONMENT = 3;
