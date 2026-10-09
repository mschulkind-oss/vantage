/**
 * The planning page's two folded groups (`docs/design/planning-to-do-list.md`
 * §3.4): *Blocked*, and *Maintenance* with one sub-list per kind. Each is a
 * heading line with its count, closed until the reader opens it, its state
 * remembered in this browser per group. Opened, a group lists one row per
 * item, never a card, the first `groupRows` of each list and then *Show all
 * N*; each kind with an agent request keeps Copy agent request on its
 * sub-heading.
 *
 * The rows are the layout's (§4): a row whose item has gone since is marked
 * *Done* and stays, and the counts are the data in hand's, changing live in
 * slots kept for them, so a new item counts before it is listed.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  badgeFor,
  findDocument,
  isPlanningRequestId,
  type DependsOn,
  type PlanningIndex,
  type PlanningRequestId,
} from "vantage-md/planning";
import { MARK_LABELS, itemKey } from "../lib/planningLayout";
import {
  MAINTENANCE_TITLES,
  type CardEntry,
  type MaintenanceKind,
  type MaintenanceKindId,
  type PlanningLayout,
  type QuestionEntry,
} from "../lib/planningPages";
import { planningCardId } from "../lib/planningCardId";
import { planningRowId } from "../lib/planningOutline";
import { planningLimits } from "../planningScan/limits";
import { AppLink } from "./AppLink";
import { CopyRequestButton } from "./CopyRequestButton";
import { PlanningBadgeChip } from "./PlanningBadge";
import { LiveCount } from "./PlanningNeedsYou";

export type GroupId = "blocked" | "maintenance";

/** What each kind is called in *Maintenance*'s heading line. */
const SUMMARY_WORDS: Readonly<Record<MaintenanceKindId, string>> = {
  unrouted: "not on a roadmap",
  ready: "ready to build",
  graduate: "to graduate",
  disagrees: "stage conflict",
  compact: "to fold into the ledger",
  skipped: "too large",
  "could-not-read": "unreadable",
};

/** A size in the units the limits are written in. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

/**
 * What a Stage conflict row's stage claims, in the checker's word for the same
 * finding (`planning/stage-disagrees`).
 */
function builtOrDecided(index: PlanningIndex, path: string): string {
  const stages = index.config.stages;
  const stage = findDocument(index, path)?.stage;
  if (!stages || !stage || !Object.hasOwn(stages, stage)) return "decided";
  return stages[stage] === "built" ? "built" : "decided";
}

/** The parts of every row. */
const ROW =
  "flex min-w-0 items-baseline gap-x-2 overflow-hidden py-0.5 text-sm whitespace-nowrap";

const Done: React.FC<{ gone: boolean }> = ({ gone }) =>
  gone ? (
    <span
      data-planning-mark="done"
      className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400"
    >
      {MARK_LABELS.done}
    </span>
  ) : null;

/** A question, by its document, id and title, each a link (§3.4). */
const QuestionRow: React.FC<{
  entry: QuestionEntry;
  href: (path: string) => string;
  gone: boolean;
  onOpenHere?: () => void;
}> = ({ entry, href, gone, onOpenHere }) => {
  const { question } = entry;
  return (
    <li
      id={planningCardId(question.path, question.id, question.unitLine)}
      data-planning-item={itemKey(question)}
      data-planning-group-question={question.id ?? ""}
      aria-label={question.title}
      className={ROW}
    >
      <AppLink
        to={href(question.path)}
        onBeforeNavigate={() => onOpenHere?.()}
        className="shrink-0 text-blue-600 no-underline hover:underline dark:text-blue-400"
      >
        {question.path}
      </AppLink>
      {question.id !== null && (
        <AppLink
          to={`${href(question.path)}#${question.id}`}
          onBeforeNavigate={() => onOpenHere?.()}
          className="shrink-0 font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {question.id}
        </AppLink>
      )}
      <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
        {question.marker ? `${question.marker} ` : ""}
        {question.title}
      </span>
      <Done gone={gone} />
    </li>
  );
};

/** A document, by its path and its stage, with what a section adds. */
const DocumentRow: React.FC<{
  section: string;
  path: string;
  index: PlanningIndex;
  href: (path: string) => string;
  gone: boolean;
  onOpenHere?: () => void;
  children?: React.ReactNode;
}> = ({ section, path, index, href, gone, onOpenHere, children }) => {
  const badge = badgeFor(index, "", { path, fragment: null });
  return (
    <li
      id={planningRowId(section as never, path)}
      data-planning-document={path}
      className={ROW}
    >
      <AppLink
        to={href(path)}
        onBeforeNavigate={() => onOpenHere?.()}
        className="shrink-0 font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
      >
        {path}
      </AppLink>
      {badge !== null && <PlanningBadgeChip badge={badge} />}
      {children}
      <Done gone={gone} />
    </li>
  );
};

/** What a blocked document waits on, inline: each entry, linked. */
const WaitingOn: React.FC<{
  from: string;
  entries: readonly DependsOn[];
  index: PlanningIndex;
  href: (path: string) => string;
}> = ({ from, entries, index, href }) => (
  <span className="min-w-0 truncate text-[13px] text-slate-600 dark:text-slate-400">
    blocked on{" "}
    {entries.map((entry, at) => {
      const badge =
        entry.target === null
          ? null
          : badgeFor(index, from, {
              path: entry.target,
              fragment: entry.fragment,
            });
      return (
        <React.Fragment key={`${entry.raw}\n${entry.line}`}>
          {at > 0 && ", "}
          {entry.target === null ? (
            <code>{entry.raw}</code>
          ) : (
            <AppLink
              to={`${href(entry.target)}${entry.fragment ? `#${entry.fragment}` : ""}`}
              className="text-blue-600 no-underline hover:underline dark:text-blue-400"
            >
              {entry.raw}
            </AppLink>
          )}
          {badge !== null && <PlanningBadgeChip badge={badge} />}
        </React.Fragment>
      );
    })}
  </span>
);

/** A list of rows: the first `groupRows`, then *Show all N*. */
function Capped<T>({
  items,
  row,
  label,
}: {
  items: readonly T[];
  row: (item: T) => React.ReactNode;
  label: string;
}) {
  const [all, setAll] = useState(false);
  const cap = planningLimits.groupRows;
  const shown = all ? items : items.slice(0, cap);
  return (
    <>
      <ul className="space-y-0.5">{shown.map(row)}</ul>
      {items.length > shown.length && (
        <button
          type="button"
          data-planning-show-all
          aria-label={`Show all ${items.length.toLocaleString("en-US")} of ${label}`}
          onClick={() => setAll(true)}
          className="mt-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Show all {items.length.toLocaleString("en-US")}
        </button>
      )}
    </>
  );
}

/** A group's heading line: a button that opens and closes it, with counts. */
const GroupHeading: React.FC<{
  id: string;
  title: string;
  count: number;
  open: boolean;
  controls: string;
  onToggle: () => void;
  children?: React.ReactNode;
}> = ({ id, title, count, open, controls, onToggle, children }) => (
  <h2
    id={id}
    tabIndex={-1}
    className="flex min-w-0 scroll-mt-4 items-baseline text-sm font-semibold whitespace-nowrap uppercase tracking-wider text-slate-500 dark:text-slate-400"
  >
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex shrink-0 items-center gap-1 uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-200"
    >
      {open ? (
        <ChevronDown size={14} aria-hidden="true" />
      ) : (
        <ChevronRight size={14} aria-hidden="true" />
      )}
      {title}{" "}
      <span className="font-normal">
        <LiveCount n={count} room={1} testId={`${id}-count`} />
      </span>
    </button>
    {children}
  </h2>
);

export const PlanningGroups: React.FC<{
  /** The layout on screen, which the rows are drawn from. */
  layout: PlanningLayout;
  index: PlanningIndex;
  href: (path: string) => string;
  open: Readonly<Record<GroupId, boolean>>;
  onToggle: (group: GroupId) => void;
  /** The counts in hand: *Blocked*'s, and each kind's. */
  counts: {
    blocked: number;
    kinds: ReadonlyMap<MaintenanceKindId, number>;
  };
  /** Whether an item listed is gone from the data in hand, by its group key. */
  gone: (key: string) => boolean;
  /** Each kind's line under its sub-heading. */
  explanationOf: (id: MaintenanceKindId | "waiting") => string;
  /** The agent request of a kind that has one, generated when pressed. */
  requestOf: (ids: readonly PlanningRequestId[]) => string | null;
  onOpenHere?: () => void;
}> = ({
  layout,
  index,
  href,
  open,
  onToggle,
  counts,
  gone,
  explanationOf,
  requestOf,
  onOpenHere,
}) => {
  const kindsTotal = [...counts.kinds.values()].reduce((n, k) => n + k, 0);
  const blockedRow = (entry: CardEntry) =>
    entry.kind === "question" ? (
      <QuestionRow
        key={`q\n${itemKey(entry.question)}`}
        entry={entry}
        href={href}
        gone={gone(itemKey(entry.question))}
        onOpenHere={onOpenHere}
      />
    ) : (
      <DocumentRow
        key={`d\n${entry.path}`}
        section="waiting"
        path={entry.path}
        index={index}
        href={href}
        gone={gone(`doc\n${entry.path}`)}
        onOpenHere={onOpenHere}
      >
        <WaitingOn
          from={entry.path}
          entries={entry.waitingOn}
          index={index}
          href={href}
        />
      </DocumentRow>
    );
  const kindRows = (kind: MaintenanceKind) => {
    const key = (k: string) => gone(`${kind.id}\n${k}`);
    const title = MAINTENANCE_TITLES[kind.id];
    switch (kind.kind) {
      case "questions":
        return (
          <Capped
            items={kind.items}
            label={title}
            row={(entry) => (
              <QuestionRow
                key={itemKey(entry.question)}
                entry={entry}
                href={href}
                gone={key(itemKey(entry.question))}
                onOpenHere={onOpenHere}
              />
            )}
          />
        );
      case "documents":
        return (
          <Capped
            items={kind.items}
            label={title}
            row={(path) => (
              <DocumentRow
                key={path}
                section={kind.id}
                path={path}
                index={index}
                href={href}
                gone={key(path)}
                onOpenHere={onOpenHere}
              >
                {kind.id === "disagrees" && (
                  <span className="min-w-0 truncate text-[13px] text-slate-600 dark:text-slate-400">
                    Its stage says it is {builtOrDecided(index, path)}, and it
                    still has open questions.
                  </span>
                )}
              </DocumentRow>
            )}
          />
        );
      case "skipped":
        return (
          <Capped
            items={kind.items}
            label={title}
            row={({ path, size }) => (
              <li key={path} className={ROW}>
                <code>{path}</code>{" "}
                <span className="truncate text-slate-500 dark:text-slate-400">
                  {formatSize(size)}, over max-file-bytes (
                  {formatSize(index.config.maxFileBytes)})
                </span>
                <Done gone={key(path)} />
              </li>
            )}
          />
        );
      case "unreadable":
        return (
          <Capped
            items={kind.items}
            label={title}
            row={({ path, reason }) => (
              <li key={path} className={ROW}>
                <code>{path}</code>{" "}
                <span className="truncate text-slate-500 dark:text-slate-400">
                  {reason}
                </span>
                <Done gone={key(path)} />
              </li>
            )}
          />
        );
    }
  };
  return (
    <>
      {/* Which groups there are is the layout's: a group that comes after it
          is counted in the updates slot until the next (§4.2). */}
      {layout.blocked.length > 0 && (
        <section
          aria-labelledby="waiting"
          aria-describedby={open.blocked ? "about-waiting" : undefined}
          className="mb-6"
        >
          <GroupHeading
            id="waiting"
            title="Blocked"
            count={counts.blocked}
            open={open.blocked}
            controls="group-blocked"
            onToggle={() => onToggle("blocked")}
          />
          {open.blocked && (
            <div id="group-blocked" className="mt-2 pl-5">
              <p
                id="about-waiting"
                data-planning-section-about
                className="mb-2 text-[13px] text-slate-500 dark:text-slate-400"
              >
                {explanationOf("waiting")}
              </p>
              <Capped items={layout.blocked} label="Blocked" row={blockedRow} />
            </div>
          )}
        </section>
      )}
      {layout.maintenance.length > 0 && (
        <section aria-labelledby="maintenance" className="mb-6">
          <GroupHeading
            id="maintenance"
            title="Maintenance"
            count={kindsTotal}
            open={open.maintenance}
            controls="group-maintenance"
            onToggle={() => onToggle("maintenance")}
          >
            {/* The layout's kinds, with their numbers in hand: a kind that
                comes after the layout waits for the next, and the line
                never wraps to a second one. */}
            <span
              data-testid="maintenance-kinds"
              className="ml-1 min-w-0 truncate font-normal tracking-normal normal-case"
            >
              {layout.maintenance.map(({ id }) => (
                <React.Fragment key={id}>
                  {" · "}
                  <LiveCount n={counts.kinds.get(id) ?? 0} room={1} />{" "}
                  {SUMMARY_WORDS[id]}
                </React.Fragment>
              ))}
            </span>
          </GroupHeading>
          {open.maintenance && (
            <div id="group-maintenance" className="mt-2 space-y-4 pl-5">
              {layout.maintenance.map((kind) => {
                const title = MAINTENANCE_TITLES[kind.id];
                const count = counts.kinds.get(kind.id) ?? 0;
                return (
                  <section
                    key={kind.id}
                    aria-labelledby={kind.id}
                    aria-describedby={`about-${kind.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-3">
                      <h3
                        id={kind.id}
                        tabIndex={-1}
                        className="scroll-mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300"
                      >
                        {title}{" "}
                        <span className="ml-1 font-normal">
                          <LiveCount n={count} room={1} />
                        </span>
                      </h3>
                      {isPlanningRequestId(kind.id) && (
                        <CopyRequestButton
                          label="Copy agent request"
                          name={`Copy agent request for ${title}`}
                          hint={`Copy an instruction for an agent covering ${count === 1 ? "the 1 entry" : `all ${count.toLocaleString("en-US")} entries`} of ${title}`}
                          done={`Copied the agent request for ${title}.`}
                          request={() =>
                            requestOf([kind.id as PlanningRequestId])
                          }
                          className="-my-1 ml-auto"
                        />
                      )}
                    </div>
                    <p
                      id={`about-${kind.id}`}
                      data-planning-section-about
                      className="mt-0.5 mb-1.5 text-[13px] text-slate-500 dark:text-slate-400"
                    >
                      {explanationOf(kind.id)}
                    </p>
                    {kindRows(kind)}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
};
