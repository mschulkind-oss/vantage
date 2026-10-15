import type { ReactNode, RefCallback } from "react";
import { ChevronRight } from "lucide-react";
import { AppLink } from "./AppLink";
import { CollapsedFolders } from "./CollapsedFolders";
import { OpenSidebarButton } from "./AppShell";
import type { ShellControls } from "../hooks/useShellPage";
import { planningPath } from "../lib/planningRoute";
import { workPath } from "../lib/workRoute";

type PlanningView = "overview" | "questions";

interface PlanningViewsHeaderProps {
  activeView: PlanningView;
  isMultiRepo: boolean;
  repoName: string;
  showSidebar: boolean;
  shell: ShellControls;
  title: string;
  headerRef?: RefCallback<HTMLElement>;
  testId?: string;
  pending?: boolean;
  leadingControls?: ReactNode;
  tools?: ReactNode;
}

const viewLinks: { id: PlanningView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "questions", label: "Questions" },
];

export function PlanningViewsHeader({
  activeView,
  isMultiRepo,
  repoName,
  showSidebar,
  shell,
  title,
  headerRef,
  testId,
  pending = false,
  leadingControls,
  tools,
}: PlanningViewsHeaderProps) {
  const crumb = isMultiRepo
    ? repoName === ""
      ? { label: "Projects", href: "/" }
      : { label: repoName, href: `/${encodeURIComponent(repoName)}` }
    : { label: "root", href: "/" };

  return (
    <header
      ref={headerRef}
      data-testid={testId}
      className="viewer-header relative z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-800 md:px-6"
    >
      <div className="hdr-lead flex min-w-0 items-center gap-2">
        {showSidebar && <OpenSidebarButton shell={shell} />}
        {leadingControls}
        {isMultiRepo && (
          <nav
            aria-label="Repository breadcrumb"
            aria-hidden={pending || undefined}
            className={`hdr-crumbs flex min-w-0 items-center gap-1 overflow-hidden text-sm ${pending ? "invisible" : ""}`}
          >
            <AppLink
              to={crumb.href}
              className="hdr-repo max-w-28 truncate font-medium text-slate-500 no-underline transition-colors hover:text-blue-600 dark:text-slate-400"
              title={crumb.label}
            >
              {crumb.label}
            </AppLink>
            <ChevronRight
              size={14}
              aria-hidden="true"
              className="hdr-repo-separator shrink-0 text-slate-500 dark:text-slate-400"
            />
            <span className="hdr-dirs-collapsed hdr-no-dirs flex shrink-0 items-center gap-1">
              <CollapsedFolders
                root={crumb}
                dirs={[]}
                hrefFor={() => crumb.href}
              />
            </span>
          </nav>
        )}
        <h1 className="sr-only">{title}</h1>
        <nav
          aria-label="Planning views"
          aria-hidden={pending || undefined}
          className={`flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-700 ${pending ? "invisible" : ""}`}
        >
          {viewLinks.map(({ id, label }) => {
            const active = activeView === id;
            return (
              <AppLink
                key={id}
                to={
                  id === "overview"
                    ? workPath(isMultiRepo, repoName || null)
                    : planningPath(isMultiRepo, repoName || null)
                }
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2 py-1.5 font-medium no-underline transition-colors ${
                  active
                    ? "bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:text-blue-700 dark:text-slate-300 dark:hover:text-blue-400"
                }`}
              >
                {label}
              </AppLink>
            );
          })}
        </nav>
      </div>
      <div
        aria-hidden={pending || undefined}
        className={`hdr-tools flex shrink-0 items-center gap-2 ${pending ? "invisible" : ""}`}
      >
        {tools}
      </div>
    </header>
  );
}
