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
 *
 * **Late items** (a term this module coins) are the exception to fitting
 * afresh. An item the viewer marks `hdr-late` is one whose data arrived after
 * the document's first paint: its commit, its history, its date, the Path
 * button's root (`docs/reference/planning-index.md` §12.2). It may take
 * only the room the header has left: it is drawn once a fit finds it room at
 * the steps the header already had, plus any further steps that act on late
 * items alone (the subject, say, when only the late commit button has one),
 * without anything already drawn moving or changing size. Until then it is
 * not drawn at all, and it is tried again at every later fit, so a wider
 * window can still bring it in; a step that would move what the reader is
 * looking at is never taken for it. Once drawn it is an ordinary item.
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

/** The class the viewer gives a late item (see "Late items" above). */
export const LATE_CLASS = "hdr-late";

/** Set on a late item once a fit has found it room; the stylesheet draws it. */
export const PLACED_ATTR = "data-hdr-placed";

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

/** Where an item's room starts, likewise. */
function roomLeft(item: Element): number {
  return (
    item.getBoundingClientRect().left -
    (parseFloat(getComputedStyle(item).marginLeft) || 0)
  );
}

/**
 * The items `parent` lays out: its children, with any child that lays out no
 * box of its own (`display: contents`, as the actions' wrappers are until the
 * actions fold) replaced by its own items.
 */
function rowItems(parent: Element): Element[] {
  return Array.from(parent.children).flatMap((child) =>
    getComputedStyle(child).display === "contents" ? rowItems(child) : [child],
  );
}

/**
 * Whether the header, laid out as it is now, fits: no item's room reaches past
 * its content box, and the subject (while it is still shown) is not below its
 * floor. `taken` is how many steps are currently taken.
 *
 * Every toolbar item but the commit button is rigid, and the leading half is
 * rigid until the last step, so anything that does not fit shows up as an item
 * whose room passes the header's content edge — or, where the toolbar's
 * `safe` end-packing is not supported, one whose room starts before the
 * toolbar does.
 */
function fitsNow(header: HTMLElement, taken: number): boolean {
  const lead = header.querySelector(".hdr-lead");
  const tools = header.querySelector(".hdr-tools");
  const edge =
    header.getBoundingClientRect().right -
    (parseFloat(getComputedStyle(header).paddingRight) || 0);
  const toolItems = tools ? rowItems(tools) : [];
  for (const item of [lead, ...toolItems]) {
    if (item && roomRight(item) > edge + 0.5) return false;
  }
  if (tools) {
    const start = tools.getBoundingClientRect().left;
    for (const item of toolItems) {
      if (item.getClientRects().length > 0 && roomLeft(item) < start - 0.5) {
        return false;
      }
    }
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
 * the first that fits. Returns that count. Then gives any late item not yet
 * drawn the room it can have (see "Late items" above).
 *
 * Starting from none every time, rather than from the current count, is what
 * lets a widening header take steps back: the fit is decided afresh for the
 * width and content it has now, never relative to what it had. Each try is one
 * forced layout of the header, one per step short of the name.
 */
export function fitHeader(header: HTMLElement): number {
  // A mark outlives its class on a node React kept; it means nothing there,
  // and must not let the node skip the check if it is ever late again.
  for (const el of header.querySelectorAll(
    `[${PLACED_ATTR}]:not(.${LATE_CLASS})`,
  )) {
    el.removeAttribute(PLACED_ATTR);
  }
  // Late items not yet placed are not drawn, so this fits what is.
  const count = fewestSteps((n) => {
    setYield(header, n);
    return fitsNow(header, n);
  });
  setYield(header, count);
  const late = Array.from(
    header.querySelectorAll<HTMLElement>(
      `.${LATE_CLASS}:not([${PLACED_ATTR}])`,
    ),
  );
  return late.length === 0 ? count : placeLate(header, late, count);
}

/** Where each of `elements` is, and how big: a snapshot to compare against. */
function boxesOf(elements: readonly HTMLElement[]): DOMRect[] {
  return elements.map((el) => el.getBoundingClientRect());
}

function sameBoxes(a: readonly DOMRect[], b: readonly DOMRect[]): boolean {
  const near = (x: number, y: number) => !(Math.abs(x - y) > 0.5);
  return a.every(
    (box, i) =>
      near(box.left, b[i].left) &&
      near(box.top, b[i].top) &&
      near(box.right, b[i].right) &&
      near(box.bottom, b[i].bottom),
  );
}

/**
 * Draw `late`, which arrived after the header painted at `count` steps, if it
 * fits without moving anything drawn: at `count`, or at a further step that
 * acts on late items alone. Never at the name's step, which would narrow the
 * name. Otherwise leaves it undrawn and the header as it was. Returns the
 * count the header is left at.
 */
function placeLate(
  header: HTMLElement,
  late: readonly HTMLElement[],
  count: number,
): number {
  const drawn = Array.from(header.querySelectorAll("*")).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !late.some((item) => item.contains(el)),
  );
  const before = boxesOf(drawn);
  // The steps past `count` that change nothing drawn: measured with the late
  // items still out, so what each step does to them cannot hide what it does
  // to the rest.
  const last = YIELD_STEPS.length - 1;
  let most = count;
  while (most < last) {
    setYield(header, most + 1);
    if (!sameBoxes(before, boxesOf(drawn))) break;
    most++;
  }
  for (const item of late) item.setAttribute(PLACED_ATTR, "");
  for (let n = count; n <= Math.min(most, last); n++) {
    setYield(header, n);
    if (fitsNow(header, n) && sameBoxes(before, boxesOf(drawn))) return n;
  }
  for (const item of late) item.removeAttribute(PLACED_ATTR);
  setYield(header, count);
  return count;
}
