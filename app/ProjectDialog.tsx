"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { fileSize } from "../lib/session-file";

export function ProjectDialog({
  mode,
  name,
  size,
  onName,
  onCancel,
  onConfirm,
}: {
  mode: "new" | "save";
  name: string;
  size: number;
  onName: (name: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    form.current
      ?.querySelector<HTMLElement>(mode === "save" ? "input" : "[data-cancel]")
      ?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [mode]);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        ref={form}
        className="project-dialog"
        role={mode === "new" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        aria-describedby={mode === "new" ? "new-project-warning" : undefined}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
          if (e.key !== "Tab") return;
          const items = form.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input",
          );
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id="project-dialog-title">
            {mode === "new" ? "New project?" : "Save project"}
          </h2>
          <button
            type="button"
            aria-label="Close project dialog"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        {mode === "new" ? (
          <p id="new-project-warning">
            Start fresh? Your current project will be replaced. Save it first if
            you want to keep a file.
          </p>
        ) : (
          <>
            <label className="project-name-field">
              Name
              <input
                aria-label="Project name"
                value={name}
                maxLength={80}
                onChange={(e) => onName(e.target.value)}
              />
            </label>
            <div className="project-file-size">
              <span>File size</span>
              <output
                aria-label="JSON file size"
                title={`${size.toLocaleString()} bytes`}
                aria-live="polite"
              >
                {fileSize(size)}
              </output>
            </div>
          </>
        )}
        <div className="dialog-buttons">
          <button type="button" data-cancel onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {mode === "new" ? "New project" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
