import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";
import {
  MousePointer2,
  Hand,
  Highlighter,
  Pen,
  Type,
  Square,
  EyeOff,
  Eraser,
  Undo2,
  Redo2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Save,
  Download,
  ScanText,
  Trash2,
} from "lucide-react";
import type { AnnotationTool } from "../../types";

interface ToolbarProps {
  activeTool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  currentPage: number;
  totalPages: number;
  scale: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSave: () => void;
  onExport: () => void;
  onOCR: () => void;
  onClearAnnotations: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isSaving: boolean;
  canEdit: boolean;
}

const tools: { id: AnnotationTool; icon: typeof MousePointer2; label: string; hint: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", hint: "Select — click text to edit" },
  { id: "pan", icon: Hand, label: "Pan", hint: "Pan — scroll the document" },
  { id: "highlight", icon: Highlighter, label: "Highlight", hint: "Highlight — click & drag a region" },
  { id: "ink", icon: Pen, label: "Ink", hint: "Ink — freehand draw" },
  { id: "text", icon: Type, label: "Text", hint: "Text — click to place text" },
  { id: "shape", icon: Square, label: "Shape", hint: "Shape — click & drag a rectangle" },
  { id: "redaction", icon: EyeOff, label: "Redact", hint: "Redact — click & drag to cover" },
  { id: "eraser", icon: Eraser, label: "Eraser", hint: "Eraser — click an annotation to remove" },
];

export function Toolbar({
  activeTool,
  onToolChange,
  currentPage,
  totalPages,
  scale,
  onPrevPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onSave,
  onExport,
  onOCR,
  onClearAnnotations,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isSaving,
  canEdit,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900">
      {/* Tools */}
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
        {tools.map(({ id, icon: Icon, hint }) => (
          <button
            key={id}
            onClick={() => onToolChange(id)}
            disabled={!canEdit && id !== "select" && id !== "pan"}
            title={hint}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              activeTool === id
                ? "bg-white text-brand-600 shadow-sm dark:bg-slate-700 dark:text-brand-400"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
              "disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onUndo}
          disabled={!canUndo || !canEdit}
          title="Undo (Ctrl+Z)"
          className={cn(
            "rounded-md p-1.5 transition-colors",
            "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
            "disabled:opacity-40 disabled:pointer-events-none"
          )}
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo || !canEdit}
          title="Redo (Ctrl+Shift+Z)"
          className={cn(
            "rounded-md p-1.5 transition-colors",
            "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
            "disabled:opacity-40 disabled:pointer-events-none"
          )}
        >
          <Redo2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />

      {/* Page Navigation */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onPrevPage} disabled={currentPage <= 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[4rem] text-center text-xs text-slate-600 dark:text-slate-400">
          {totalPages > 0 ? `${currentPage} / ${totalPages}` : "—"}
        </span>
        <Button variant="ghost" size="sm" onClick={onNextPage} disabled={currentPage >= totalPages}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs text-slate-600 dark:text-slate-400">
          {Math.round(scale * 100)}%
        </span>
        <Button variant="ghost" size="sm" onClick={onZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAnnotations}
          disabled={!canEdit}
          title="Clear annotations"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onOCR}
          disabled={!canEdit}
          title="Run OCR (requires Azure Document Intelligence)"
        >
          <ScanText className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={!canEdit}
          icon={<Download className="h-4 w-4" />}
        >
          Export
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={!canEdit}
          isLoading={isSaving}
          icon={<Save className="h-4 w-4" />}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
