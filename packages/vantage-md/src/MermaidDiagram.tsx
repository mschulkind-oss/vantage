import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  useSyncExternalStore,
  memo,
} from "react";
import { getCachedSvg, setCachedSvg } from "./mermaidCache.js";
import { getMermaid } from "./mermaidLoader.js";
import { currentMermaidTheme } from "./mermaidTheme.js";
import type { MermaidThemeName } from "./mermaidTheme.js";

// Inline SVG icons to avoid lucide-react dependency
const AlertTriangleIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4 shrink-0"
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-3 h-3"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const ChevronUpIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-3 h-3"
  >
    <path d="m18 15-6-6-6 6" />
  </svg>
);

const MaximizeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4 text-gray-600 dark:text-slate-200"
  >
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" x2="14" y1="3" y2="10" />
    <line x1="3" x2="10" y1="21" y2="14" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-5 h-5"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

const MinusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <path d="M5 12h14" />
  </svg>
);

const ResetIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

/**
 * Zoom + pan viewport for the maximized diagram. Wheel/buttons zoom (anchored
 * on the cursor), drag pans, double-click resets, and it fills whatever space
 * the modal gives it.
 */
function ZoomableSvg({ svg }: { svg: string }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
        if (next === prev) return prev;
        // Keep the anchor point (cursor, or viewport center) stationary.
        const rect = viewportRef.current?.getBoundingClientRect();
        if (rect) {
          const ax = (anchor?.x ?? rect.width / 2) - rect.width / 2;
          const ay = (anchor?.y ?? rect.height / 2) - rect.height / 2;
          setOffset((o) => ({
            x: ax - ((ax - o.x) * next) / prev,
            y: ay - ((ay - o.y) * next) / prev,
          }));
        }
        return next;
      });
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = viewportRef.current?.getBoundingClientRect();
      const anchor = rect
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : undefined;
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, anchor);
    },
    [zoomBy],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({
      x: d.originX + (e.clientX - d.startX),
      y: d.originY + (e.clientY - d.startY),
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released
      }
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <div className="relative w-full h-full">
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={reset}
        className="w-full h-full overflow-hidden touch-none select-none"
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div
          className="mermaid-zoom flex items-center justify-center w-full h-full"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.08s ease-out",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {/* The controls float over the diagram, so they carry their own surface
          in both themes — a white bar over a dark page was the one piece of
          chrome that never followed the theme. */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-lg bg-white/95 dark:bg-slate-800/95 shadow-md border border-gray-200 dark:border-slate-600 px-1.5 py-1">
        <button
          onClick={() => zoomBy(1 / 1.3)}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-200"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <MinusIcon />
        </button>
        <button
          onClick={reset}
          className="px-2 py-1 text-xs font-medium rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-200 min-w-[3rem]"
          title="Reset zoom (or double-click)"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={() => zoomBy(1.3)}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-200"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <PlusIcon />
        </button>
        <div className="w-px h-5 bg-gray-200 dark:bg-slate-600 mx-0.5" />
        <button
          onClick={reset}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-200"
          aria-label="Reset view"
          title="Reset view"
        >
          <ResetIcon />
        </button>
      </div>
    </div>
  );
}

interface MermaidDiagramProps {
  code: string;
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    const parseMatch = msg.match(
      /(?:Parse error|Syntax error|Error).*?(?:line \d+.*)/i,
    );
    if (parseMatch) return parseMatch[0];
    return msg.split("\n")[0].slice(0, 200);
  }
  if (typeof err === "string") return err.split("\n")[0].slice(0, 200);
  return "Unknown error";
}

/** Simple modal for expanding diagrams */
function DiagramModal({
  isOpen,
  onClose,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {/* overflow-hidden keeps the header's border from poking past the rounded corners */}
      <div
        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg shadow-xl w-[96vw] h-[94vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700 shrink-0">
          <h2 className="text-lg font-semibold">Mermaid Diagram</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors"
            aria-label="Close modal"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-slate-800">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The palette the page is asking for, re-read whenever `<html>`'s class list
 * changes.
 *
 * A diagram is an SVG baked at render time, so unlike everything else on the
 * page it does not restyle when the theme flips — it has to be drawn again. The
 * observer is what notices; the effect below is what redraws. Without it a
 * session that started in light mode kept white boxes with black ink on the
 * dark page for as long as it lived.
 *
 * `useSyncExternalStore` rather than state plus an effect: the class list *is*
 * an external store, and reading it in an effect would both miss a flip that
 * landed before the effect ran and set state synchronously inside one.
 */
function subscribeToTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** Server render has no `<html>` to read, and no diagram to draw either. */
const serverTheme = (): MermaidThemeName => "default";

function useMermaidTheme(): MermaidThemeName {
  return useSyncExternalStore(
    subscribeToTheme,
    currentMermaidTheme,
    serverTheme,
  );
}

const MermaidDiagramInner: React.FC<MermaidDiagramProps> = ({ code }) => {
  const theme = useMermaidTheme();
  const [showSource, setShowSource] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [minHeight, setMinHeight] = useState<string>("auto");
  const containerRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number | null>(null);

  /**
   * What this render produced, and which (code, theme) it was for.
   *
   * Keyed rather than plain, and read past the cache rather than instead of it,
   * because a theme flip has to invalidate both: the cache is a miss in the new
   * palette, and last render's SVG is the wrong palette. Deriving `svg` here
   * rather than mirroring the cache into state is also what keeps a cache hit
   * from being a `setState` inside an effect.
   */
  const [rendered, setRendered] = useState<{ key: string; svg: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);

  const stableId = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `mermaid-${Math.abs(hash).toString(36)}`;
  }, [code]);

  const attempt = `${theme} ${stableId}`;
  const svg =
    getCachedSvg(code, theme) ??
    (rendered?.key === attempt ? rendered.svg : "");
  const errorMessage = failure?.key === attempt ? failure.message : null;
  const isLoading = svg === "" && errorMessage === null;

  useEffect(() => {
    // The cache is keyed by theme, so a flip is a miss and re-renders; a flip
    // back is a hit and costs nothing.
    if (getCachedSvg(code, theme) !== undefined) return;

    let mounted = true;
    const key = `${theme} ${stableId}`;

    const renderDiagram = async () => {
      try {
        if (containerRef.current) {
          const height = containerRef.current.offsetHeight;
          lastHeightRef.current = height;
          setMinHeight(`${height}px`);
        }

        const m = await getMermaid();
        const id = `${stableId}-${Date.now()}`;
        const { svg: renderedSvg } = await m.render(id, code);

        if (mounted) {
          setCachedSvg(code, renderedSvg, theme);
          setRendered({ key, svg: renderedSvg });
        }
      } catch (err) {
        console.error("Mermaid render error:", err);
        if (mounted) setFailure({ key, message: extractErrorMessage(err) });
      }
    };

    renderDiagram();
    return () => {
      mounted = false;
    };
  }, [code, stableId, theme]);

  if (errorMessage) {
    return (
      <div
        data-testid="mermaid-container"
        className="my-4 rounded-md border border-yellow-300/40 bg-yellow-50/50 dark:border-yellow-700/40 dark:bg-yellow-950/20 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-yellow-800 dark:text-yellow-200">
          <AlertTriangleIcon />
          <span className="font-medium">Diagram syntax error</span>
          <span className="text-yellow-700/70 dark:text-yellow-300/60">
            — {errorMessage}
          </span>
        </div>
        <div className="border-t border-yellow-300/30 dark:border-yellow-700/30">
          <button
            onClick={() => setShowSource(!showSource)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-yellow-700/60 dark:text-yellow-400/50 hover:text-yellow-800 dark:hover:text-yellow-300 transition-colors w-full"
          >
            {showSource ? <ChevronUpIcon /> : <ChevronDownIcon />}
            {showSource ? "Hide source" : "Show source"}
          </button>
          {showSource && (
            <pre className="px-4 pb-3 text-xs font-mono text-yellow-800/70 dark:text-yellow-200/60 overflow-auto whitespace-pre-wrap">
              {code}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        data-testid="mermaid-container"
        className="relative group inline-block max-w-full"
        style={{ minHeight: isLoading ? minHeight : "auto" }}
      >
        <div
          className={`mermaid flex justify-center my-4 overflow-x-auto transition-opacity duration-150 ${isLoading ? "opacity-50" : "opacity-100"}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {svg && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="absolute top-2 right-2 p-2 bg-white/90 dark:bg-slate-800/90 shadow-sm border border-gray-200 dark:border-slate-600 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-50 dark:hover:bg-slate-700"
            aria-label="Maximize diagram"
          >
            <MaximizeIcon />
          </button>
        )}
      </div>

      <DiagramModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <ZoomableSvg svg={svg} />
      </DiagramModal>
    </>
  );
};

export const MermaidDiagram = memo(
  MermaidDiagramInner,
  (prevProps, nextProps) => prevProps.code === nextProps.code,
);
