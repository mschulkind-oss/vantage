import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /**
   * "default" centers a comfortably-sized card; "full" expands to nearly the
   * whole viewport — useful for content that needs room (diagrams, tables).
   */
  size?: "default" | "full";
  /** Extra classes for the scrollable body wrapper (e.g. remove default padding). */
  bodyClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = "default",
  bodyClassName,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses =
    size === "full"
      ? "w-[96vw] h-[94vh] max-w-none max-h-none"
      : "w-full max-w-5xl max-h-[90vh]";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      {/* overflow-hidden keeps the header's border from poking past the rounded corners */}
      <div
        className={`bg-white dark:bg-slate-800 rounded-lg shadow-xl flex flex-col overflow-hidden ${sizeClasses}`}
        role="dialog"
        aria-modal="true"
        ref={modalRef}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-slate-700 shrink-0">
          <h2 className="text-lg font-semibold dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className={bodyClassName ?? "p-4 overflow-auto flex-1"}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
