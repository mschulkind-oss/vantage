import React, { memo } from "react";
import { DocumentStatusChip } from "./DocumentStatusChip.js";
import { readVantageFrontmatter } from "./vantageFrontmatter.js";

// Inline FileText icon
const FileTextIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-slate-400"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);

interface FrontmatterDisplayProps {
  frontmatter: Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): React.ReactNode {
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (isPlainObject(value)) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function TagList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function ValueCell({ value }: { value: unknown }) {
  if (isStringArray(value) && value.length > 0) {
    return <TagList items={value} />;
  }
  if (isPlainObject(value)) {
    return (
      <pre className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-xs font-mono overflow-x-auto text-slate-600 dark:text-slate-300">
        {formatValue(value)}
      </pre>
    );
  }
  return <span className="font-medium">{formatValue(value)}</span>;
}

function flattenEntries(entries: [string, unknown][]): [string, unknown][] {
  const result: [string, unknown][] = [];
  for (const [key, value] of entries) {
    // `vantage:` is Vantage's own reserved namespace, and it is chrome rather
    // than metadata. Left in, `ValueCell`'s isPlainObject branch would print it
    // as a monospace JSON blob row — `{"status-chip": "in-review"}` — so the
    // chip would ship alongside the burial it exists to remove. Top level only:
    // a hoisted `extra.vantage` is the user's key, not the reserved one.
    if (key === "vantage") continue;
    if (key === "taxonomies" && isPlainObject(value)) {
      for (const [taxKey, taxVal] of Object.entries(value)) {
        result.push([taxKey, taxVal]);
      }
    } else if (key === "extra" && isPlainObject(value)) {
      for (const [extraKey, extraVal] of Object.entries(value)) {
        result.push([extraKey, extraVal]);
      }
    } else {
      result.push([key, value]);
    }
  }
  return result;
}

const FrontmatterDisplayInner: React.FC<FrontmatterDisplayProps> = ({
  frontmatter,
}) => {
  const entries = flattenEntries(Object.entries(frontmatter));
  // Only the value. `issues` is deliberately not read here: the viewer stays
  // silent on bad chrome (P3) and `vantage-check` is what reports it.
  const { statusChip } = readVantageFrontmatter(frontmatter);

  // Two independent halves now, so both have to be absent for this to render
  // nothing — a document whose only frontmatter key is `vantage:` would
  // otherwise get an empty gradient card wrapped around an empty <table>.
  if (entries.length === 0 && statusChip === undefined) return null;

  return (
    <>
      {statusChip !== undefined && (
        <div className="vantage-chrome">
          <DocumentStatusChip status={statusChip} />
        </div>
      )}
      {entries.length > 0 && (
        <div className="mb-8 rounded-lg overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-800/80 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="px-4 py-2.5 bg-white/60 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <FileTextIcon />
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Metadata
            </span>
          </div>
          <div className="p-4">
            <table className="w-full text-sm">
              <tbody>
                {entries.map(([key, value]) => (
                  <tr
                    key={key}
                    className="border-b border-slate-200/60 dark:border-slate-700/60 last:border-0"
                  >
                    <td className="py-2 pr-4 font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap align-top w-1/4 min-w-[100px]">
                      {key}
                    </td>
                    <td className="py-2 text-slate-800 dark:text-slate-200 align-top">
                      <ValueCell value={value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};

export const FrontmatterDisplay = memo(FrontmatterDisplayInner);
