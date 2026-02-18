import React, { type RefObject } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { AnnotationOverlay } from "./AnnotationOverlay";
import type { AnnotationOperation, AnnotationTool } from "../../types";

interface PDFViewerProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isLoading: boolean;
  hasDocument: boolean;
  annotations: AnnotationOperation[];
  currentPage: number;
  zoom: number;
  activeTool: AnnotationTool;
  onAnnotationCreated: (
    opType: AnnotationOperation["opType"],
    page: number,
    bounds: { x: number; y: number; w: number; h: number },
    payload?: Record<string, unknown>,
  ) => void;
  onAnnotationErased?: (opId: string) => void;
  onAnnotationUpdated?: (opId: string, updates: { payload?: Record<string, unknown> }) => void;
  onClickFeedback?: (message: string) => void;
}

export function PDFViewer({
  canvasRef,
  isLoading,
  hasDocument,
  annotations,
  currentPage,
  zoom,
  activeTool,
  onAnnotationCreated,
  onAnnotationErased,
  onAnnotationUpdated,
  onClickFeedback,
}: PDFViewerProps) {
  if (!hasDocument) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-200 dark:bg-slate-800">
          <FileUp className="h-10 w-10 text-slate-400" />
        </div>
        <div>
          <p className="text-lg font-medium text-slate-600 dark:text-slate-300">No document loaded</p>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
            Upload a PDF from the sidebar to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-start justify-center overflow-auto p-6">
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          </div>
        )}
        <canvas
          ref={canvasRef as React.RefObject<HTMLCanvasElement>}
          className="pdf-canvas rounded-lg shadow-xl ring-1 ring-slate-200 dark:ring-slate-700"
        />
        <AnnotationOverlay
          annotations={annotations}
          currentPage={currentPage}
          zoom={zoom}
          activeTool={activeTool}
          onAnnotationCreated={onAnnotationCreated}
          onAnnotationErased={onAnnotationErased}
          onAnnotationUpdated={onAnnotationUpdated}
          onClickFeedback={onClickFeedback}
        />
      </div>
    </div>
  );
}
