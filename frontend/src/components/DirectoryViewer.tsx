import React, { useCallback, useEffect, useState } from "react";
import { Folder, File } from "lucide-react";
import { FileNode, FileContent } from "../types";
import { RelativeTime } from "./RelativeTime";
import { MarkdownViewer } from "./MarkdownViewer";
import axios from "axios";
import { useRepoStore } from "../stores/useRepoStore";
import { AppLink } from "./AppLink";

interface DirectoryViewerProps {
  nodes: FileNode[];
  currentPath: string;
}

export const DirectoryViewer: React.FC<DirectoryViewerProps> = ({ nodes }) => {
  const [readme, setReadme] = useState<FileContent | null>(null);
  const isMultiRepo = useRepoStore((state) => state.isMultiRepo);
  const currentRepo = useRepoStore((state) => state.currentRepo);

  // Build path with repo prefix in multi-repo mode
  const buildPath = useCallback(
    (filePath: string): string => {
      if (isMultiRepo && currentRepo) {
        return `/${currentRepo}/${filePath}`;
      }
      return `/${filePath}`;
    },
    [isMultiRepo, currentRepo],
  );

  // Get API base for content requests
  const getApiBase = useCallback((): string => {
    if (isMultiRepo && currentRepo) {
      return `/api/r/${encodeURIComponent(currentRepo)}`;
    }
    return "/api";
  }, [isMultiRepo, currentRepo]);

  useEffect(() => {
    let isMounted = true;
    const readmeNode = nodes.find((n) => n.name.toLowerCase() === "readme.md");
    if (readmeNode) {
      const apiBase = getApiBase();
      axios
        .get<FileContent>(
          `${apiBase}/content?path=${encodeURIComponent(readmeNode.path)}`,
        )
        .then((res) => {
          if (isMounted) setReadme(res.data);
        })
        .catch(() => {
          if (isMounted) setReadme(null);
        });
    } else {
      // Use a microtask to avoid synchronous setState in effect
      Promise.resolve().then(() => {
        if (isMounted) setReadme(null);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [nodes, getApiBase]);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50/80 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">
                Name
              </th>
              <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400">
                Commit Message
              </th>
              <th className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400 text-right">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {nodes.map((node) => (
              <tr
                key={node.path}
                className="hover:bg-blue-50/50 dark:hover:bg-slate-700/50 group transition-colors"
              >
                <td className="px-4 py-2">
                  <AppLink
                    to={buildPath(node.path)}
                    className="flex items-center space-x-3 no-underline"
                  >
                    {node.is_dir ? (
                      <Folder size={18} className="text-blue-400 shrink-0" />
                    ) : (
                      <File size={18} className="text-slate-400 shrink-0" />
                    )}
                    <span className="text-blue-600 dark:text-blue-400 group-hover:underline truncate font-medium">
                      {node.name}
                    </span>
                  </AppLink>
                </td>
                <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                  <span className="truncate block max-w-md">
                    {node.last_commit?.message || (
                      <span className="text-slate-300 dark:text-slate-500">
                        —
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-400 text-right whitespace-nowrap">
                  {node.last_commit?.date ? (
                    <RelativeTime date={node.last_commit.date} />
                  ) : (
                    <span className="text-slate-300 dark:text-slate-500">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {readme && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <div className="bg-slate-50/80 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center space-x-2">
            <File size={16} className="text-slate-400" />
            <span className="font-medium text-slate-700 dark:text-slate-300 text-sm">
              {readme.path.split("/").pop()}
            </span>
          </div>
          <div className="p-4 sm:p-6">
            <MarkdownViewer
              content={readme.content}
              currentPath={readme.path}
            />
          </div>
        </div>
      )}
    </div>
  );
};
