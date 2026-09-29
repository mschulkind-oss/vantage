/**
 * The viewer header's yield order: which of its items give up their room, and
 * in what order, as the header narrows. The file name is last, because it is
 * the one thing in the header a reader always needs — and until this existed
 * it was the only box in the row allowed to shrink at all, so it was elided to
 * "dur…" while the toolbar kept every label.
 *
 * A **yield step** (a term this module coins) is one of the entries below: a
 * thing the header can give up, all at once, to make room. The header takes
 * the fewest steps, in this order, that let everything it still shows fit on
 * one line:
 *
 * 1. `subject` — the commit-subject chip. Before this step it already shrinks
 *    continuously (CSS: it is the only item in the toolbar that can); the step
 *    hides it once it would be narrower than `SUBJECT_FLOOR_PX`.
 * 2. `date` — the absolute date beside the relative time. The relative time
 *    stays, and the full date is still in the commit button's tooltip.
 * 3. `labels` — every toolbar button's text label, so each is its icon alone.
 *    The label stays in the accessibility tree, so the button keeps its name.
 * 4. `dirs` — the breadcrumb's folders, which collapse into one "…" that
 *    opens a menu of them. The repository and the file name stay.
 * 5. `time` — the relative time, leaving the commit button its clock icon.
 *    The time stays in the accessibility tree, and the full date in the
 *    commit button's tooltip. It
 *    outlasts the date and the labels because it is the one thing in the
 *    toolbar that says something about this file rather than offering an
 *    action on it — and it goes before the name all the same, since the name
 *    is the last thing to give up room. Without this step a narrow header
 *    (a phone, or a laptop with the sidebar open) spent a hundred pixels on
 *    "28 minutes ago" while the name had none.
 * 7. `repo` — the repository's name at the head of the breadcrumb, which
 *    joins the folders behind the "…" (a "…" appears for it even at the
 *    repository root). A daemon's repository can be named at any length, and
 *    while it kept its full width it could leave the file name 3px.
 * 8. `actions` — every toolbar action (history, Path, Raw, and the review
 *    controls), together with the TOC and full-width toggles, folds into one
 *    "⋯" that opens them as a panel, labels and all. What stays in the row is
 *    what says something about this file (its git status and its commit's
 *    clock), the star, and the ways to the sidebar and the "…". These went
 *    last among the rest because they are the header's working controls:
 *    after the other steps, roughly a dozen fixed-width icons still stood
 *    between the name and the room it needed, and at an ordinary laptop width
 *    with the sidebar open they squeezed it to nothing.
 * 9. `name` — the file name itself, which then truncates, keeping its
 *    extension, with the full path in its tooltip. Its stem keeps a floor of
 *    a couple of characters and an ellipsis, and past that the breadcrumb
 *    clips from its start rather than its end, so the extension is the last
 *    of the header to go.
 *
 * The steps are discrete and their thresholds depend on what the header holds
 * — a longer name or subject needs the next step sooner — so no container
 * query can say when to take one; that is the only part measured here. What
 * each step *does* is CSS, keyed on the `data-yield` attribute this module
 * writes (see "The viewer header's yield steps" in `index.css`).
 */
export const YIELD_STEPS = [
  "subject",
  "date",
  "labels",
  "dirs",
  "time",
  "repo",
  "actions",
  "name",
] as const;

export type YieldStep = (typeof YIELD_STEPS)[number];

/**
 * Below this the commit subject is hidden rather than shrunk further: about a
 * dozen characters, the most a stub can show and still say something.
 */
export const SUBJECT_FLOOR_PX = 96;

/**
 * The `data-yield` value with the first `count` steps taken: a space-separated
 * list, so the stylesheet can match each step with `~=`.
 */
export function yieldAttribute(count: number): string {
  return YIELD_STEPS.slice(0, count).join(" ");
}

/**
 * The fewest steps at which `fits(count)` holds, trying them in order. The last
 * step is never tried: once the name itself may truncate, the header fits by
 * construction, so it is what is left when nothing short of it does.
 */
export function fewestSteps(fits: (count: number) => boolean): number {
  for (let count = 0; count < YIELD_STEPS.length; count++) {
    if (fits(count)) return count;
  }
  return YIELD_STEPS.length;
}

/**
 * A file name split so its extension survives truncation of the rest:
 * `"notes.md"` → `["notes", ".md"]`. A leading dot is the name, not an
 * extension (`".env"`), and a "suffix" longer than a real extension ever is
 * belongs to the name too, since keeping it would keep most of the name.
 */
export function splitExtension(name: string): [stem: string, ext: string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1 || name.length - dot > 8) {
    return [name, ""];
  }
  return [name.slice(0, dot), name.slice(dot)];
}

/**
 * Where an item's room in the row ends: its margin box's right edge, which is
 * what flex layout packs against the header's content edge. The border box is
 * not it — the commit button's `-mx-2` bleeds its hover background 8px past
 * the room it takes, so its border box ends 8px past a row that fits exactly.
 */
function roomRight(item: Element): number {
  return (
    item.getBoundingClientRect().right +
    (parseFloat(getComputedStyle(item).marginRight) || 0)
  );
}

/**
 * Whether the header, laid out as it is now, fits: no item's room reaches past
 * its content box, and the subject (while it is still shown) is not below its
 * floor. `taken` is how many steps are currently taken.
 *
 * Every toolbar item but the commit button is rigid, and the leading half is
 * rigid until the last step, so anything that does not fit shows up as an item
 * whose room passes the header's content edge.
 */
function fitsNow(header: HTMLElement, taken: number): boolean {
  const lead = header.querySelector(".hdr-lead");
  const tools = header.querySelector(".hdr-tools");
  const edge =
    header.getBoundingClientRect().right -
    (parseFloat(getComputedStyle(header).paddingRight) || 0);
  const items = [lead, ...(tools ? Array.from(tools.children) : [])];
  for (const item of items) {
    if (item && roomRight(item) > edge + 0.5) return false;
  }
  if (taken === 0) {
    const subject = header.querySelector(".hdr-subject-text");
    if (
      subject &&
      subject.clientWidth + 0.5 <
        Math.min(subject.scrollWidth, SUBJECT_FLOOR_PX)
    ) {
      return false;
    }
  }
  return true;
}

function setYield(header: HTMLElement, count: number) {
  const value = yieldAttribute(count);
  if (header.dataset.yield !== value) header.dataset.yield = value;
}

/**
 * Lays the header out at each step count in turn, from none, and leaves it at
 * the first that fits. Returns that count.
 *
 * Starting from none every time, rather than from the current count, is what
 * lets a widening header take steps back: the fit is decided afresh for the
 * width and content it has now, never relative to what it had. Each try is one
 * forced layout of the header, one per step short of the name.
 */
export function fitHeader(header: HTMLElement): number {
  const count = fewestSteps((n) => {
    setYield(header, n);
    return fitsNow(header, n);
  });
  setYield(header, count);
  return count;
}
