/**
 * React markdown viewer component.
 *
 * Renders markdown with the full Vantage pipeline: GFM, math, syntax
 * highlighting, mermaid diagrams, line anchors, and frontmatter display.
 *
 * This is a standalone component with no dependency on Vantage's stores,
 * router, or review system.
 */

import React, { memo, useCallback, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeSourceLines from "./rehypeSourceLines.js";
import { sanitizeSchema } from "./sanitize.js";
import { parseFrontmatter } from "./frontmatter.js";
import { MermaidDiagram } from "./MermaidDiagram.js";
import { FrontmatterDisplay } from "./FrontmatterDisplay.js";
import { useLineAnchor } from "./useLineAnchor.js";

export interface MarkdownViewerProps {
  /** Markdown content to render */
  content: string;
  /** Current file path (used for resolving relative links and images) */
  currentPath?: string;
  /** URL hash for line anchor highlighting (e.g. "#L42") */
  hash?: string;
  /** Base URL for resolving relative links */
  baseUrl?: string;
  /** Base URL for loading images via API (e.g. "/api") */
  imageApiBase?: string;
  /** Additional CSS class names */
  className?: string;
  /** Callback when an internal link is clicked */
  onNavigate?: (path: string) => void;
}

const MarkdownViewerInner: React.FC<MarkdownViewerProps> = ({
  content,
  currentPath = "",
  hash = "",
  baseUrl = "/",
  imageApiBase,
  className,
  onNavigate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Line anchor highlighting
  useLineAnchor(containerRef, hash);

  // Parse frontmatter from content
  const { frontmatter, body, bodyLineOffset } = useMemo(() => {
    return parseFrontmatter(content);
  }, [content]);

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // Anchor links within the same doc
      if (href.startsWith("#")) {
        e.preventDefault();
        const id = href.slice(1);
        const el = document.getElementById(id);
        if (el) {
          const scrollContainer =
            el.closest("[data-content-scroll]") ||
            el.closest(".overflow-y-auto");
          if (scrollContainer) {
            const offset =
              el.getBoundingClientRect().top -
              scrollContainer.getBoundingClientRect().top +
              scrollContainer.scrollTop;
            scrollContainer.scrollTo({ top: offset - 16 });
          } else {
            el.scrollIntoView();
          }
        }
        return;
      }

      // External links — let the browser handle them
      if (href.startsWith("http") || href.startsWith("mailto:")) return;

      // Internal links — delegate to onNavigate if provided
      if (onNavigate) {
        // Respect Ctrl+click, Cmd+click
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        e.preventDefault();
        const [pathPart, hashPart] = href.split("#");
        const parts = currentPath.split("/");
        parts.pop();
        const dir = parts.join("/");
        const cleanHref = pathPart.replace(/^\.\//, "");
        const resolvedPath = dir ? `${dir}/${cleanHref}` : cleanHref;
        onNavigate(resolvedPath + (hashPart ? `#${hashPart}` : ""));
      }
    },
    [currentPath, onNavigate],
  );

  const resolveHref = useCallback(
    (href: string | undefined): string => {
      if (!href) return "";
      if (
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("#") ||
        href.startsWith("/")
      ) {
        return href;
      }

      const [pathPart, hashPart] = href.split("#");
      const parts = currentPath.split("/");
      parts.pop();
      const dir = parts.join("/");
      const cleanHref = pathPart.replace(/^\.\//, "");
      const resolvedPath = dir ? `${dir}/${cleanHref}` : cleanHref;
      return `${baseUrl}${resolvedPath}${hashPart ? `#${hashPart}` : ""}`;
    },
    [currentPath, baseUrl],
  );

  const transformImageUri = useCallback(
    (uri: string, key?: string) => {
      if (key === "href") return uri;
      if (uri.startsWith("http") || uri.startsWith("data:")) return uri;

      // Resolve relative path based on currentPath
      const parts = currentPath.split("/");
      parts.pop();
      const dir = parts.join("/");
      const resolvedPath = dir ? `${dir}/${uri}` : uri;

      if (imageApiBase) {
        return `${imageApiBase}/content?path=${encodeURIComponent(resolvedPath)}`;
      }
      return `${baseUrl}${resolvedPath}`;
    },
    [currentPath, baseUrl, imageApiBase],
  );

  const markdownComponents = useMemo(
    () => ({
      a({
        href,
        children,
        ...props
      }: {
        href?: string;
        children?: React.ReactNode;
      } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
        const resolvedHref = resolveHref(href);
        return (
          <a
            href={resolvedHref}
            onClick={(e) => href && handleLinkClick(e, href)}
            {...props}
          >
            {children}
          </a>
        );
      },
      code(
        props: {
          children?: React.ReactNode;
          className?: string;
        } & React.HTMLAttributes<HTMLElement>,
      ) {
        const { children, className: codeClassName, ...rest } = props;
        const match = /language-(\w+)/.exec(codeClassName || "");
        if (match && match[1] === "mermaid") {
          return <MermaidDiagram code={String(children).replace(/\n$/, "")} />;
        }
        return (
          <code className={codeClassName} {...rest}>
            {children}
          </code>
        );
      },
    }),
    [handleLinkClick, resolveHref],
  );

  const proseClasses = [
    "prose prose-slate dark:prose-invert max-w-none",
    "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-slate-100",
    "prose-h1:text-[2em] prose-h1:mb-3 prose-h1:pb-[0.3em] prose-h1:border-b prose-h1:border-slate-200 dark:prose-h1:border-slate-700",
    "prose-h2:text-[1.5em] prose-h2:mt-6 prose-h2:mb-3 prose-h2:pb-[0.3em] prose-h2:border-b prose-h2:border-slate-200 dark:prose-h2:border-slate-700",
    "prose-h3:text-[1.25em] prose-h3:mt-6 prose-h3:mb-2",
    "prose-h4:text-[1em] prose-h4:mt-6 prose-h4:mb-2",
    "prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-p:leading-[1.5] prose-p:my-[16px]",
    "prose-ul:my-[16px] prose-ul:list-disc prose-li:my-0.5 prose-li:marker:text-slate-900 dark:prose-li:marker:text-slate-300",
    "prose-ol:my-[16px] prose-li:marker:text-slate-900 dark:prose-li:marker:text-slate-300",
    "prose-pre:bg-slate-50 dark:prose-pre:bg-slate-800 prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-slate-700 prose-pre:p-4 prose-pre:rounded-md prose-pre:text-[85%] prose-pre:leading-[1.45]",
    "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
    "prose-img:rounded-lg prose-img:my-4",
    "prose-blockquote:border-l-[0.25em] prose-blockquote:border-slate-300 dark:prose-blockquote:border-slate-600 prose-blockquote:pl-4 prose-blockquote:text-slate-600 dark:prose-blockquote:text-slate-400 prose-blockquote:italic",
    "prose-code:before:content-none prose-code:after:content-none",
    "prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:px-[0.4em] prose-code:py-[0.2em] prose-code:rounded-md prose-code:text-slate-800 dark:prose-code:text-slate-200 prose-code:font-mono prose-code:text-[85%] prose-code:font-normal prose-code:border prose-code:border-slate-200/50 dark:prose-code:border-slate-700/50",
    "prose-table:text-sm",
    "prose-th:px-3 prose-th:py-1.5 prose-th:border prose-th:border-slate-200 dark:prose-th:border-slate-700",
    "prose-td:px-3 prose-td:py-1.5 prose-td:border prose-td:border-slate-200 dark:prose-td:border-slate-700",
  ].join(" ");

  return (
    <div
      ref={containerRef}
      className={className ? `${proseClasses} ${className}` : proseClasses}
    >
      <FrontmatterDisplay frontmatter={frontmatter} />
      <ReactMarkdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          [remarkMath, { singleDollarTextMath: false }],
        ]}
        rehypePlugins={[
          rehypeRaw,
          // Offset by the frontmatter so `data-source-line` counts file lines.
          [rehypeSourceLines, { offset: bodyLineOffset }],
          [rehypeSanitize, sanitizeSchema],
          rehypeSlug,
          rehypeHighlight,
          rehypeKatex,
        ]}
        urlTransform={transformImageUri}
        components={markdownComponents}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownViewer = memo(
  MarkdownViewerInner,
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.currentPath === nextProps.currentPath &&
    prevProps.hash === nextProps.hash &&
    prevProps.className === nextProps.className,
);
