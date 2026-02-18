import React from "react";
import { useDrawing } from "../../hooks/useDrawing";
import { TextEditor } from "./TextEditor";
import { cn } from "../../lib/cn";
import type { AnnotationOperation, AnnotationTool } from "../../types";

interface AnnotationOverlayProps {
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
}

function getPreviewStyle(tool: AnnotationTool) {
  switch (tool) {
    case "highlight":
      return { fill: "rgba(250, 204, 21, 0.3)", stroke: "rgba(250, 204, 21, 0.8)", strokeWidth: 1 };
    case "shape":
      return { fill: "none", stroke: "#a855f7", strokeWidth: 2, strokeDasharray: "6 3" };
    case "redaction":
      return { fill: "rgba(0, 0, 0, 0.5)", stroke: "#000", strokeWidth: 1 };
    default:
      return { fill: "rgba(59, 130, 246, 0.2)", stroke: "#3b82f6", strokeWidth: 1 };
  }
}

function AnnotationShape({ op, zoom, isHovered = false }: { op: AnnotationOperation; zoom: number; isHovered?: boolean }) {
  const { x, y, w, h } = op.bounds;
  const sx = x * zoom, sy = y * zoom, sw = w * zoom, sh = h * zoom;

  const shape = (() => {
    switch (op.opType) {
      case "highlight":
        return <rect x={sx} y={sy} width={sw} height={sh} fill="rgba(250, 204, 21, 0.35)" stroke="none" />;
      case "shape":
        return <rect x={sx} y={sy} width={sw} height={sh} fill="none" stroke="#a855f7" strokeWidth={2} />;
      case "redaction":
        return <rect x={sx} y={sy} width={sw} height={sh} fill="rgba(0, 0, 0, 0.85)" stroke="none" />;
      case "ink": {
        if (op.payload?.points && Array.isArray(op.payload.points)) {
          const pts = (op.payload.points as Array<{ x: number; y: number }>)
            .map((p) => `${p.x * zoom},${p.y * zoom}`)
            .join(" ");
          return (
            <polyline
              points={pts}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        return <rect x={sx} y={sy} width={sw} height={sh} fill="none" stroke="#3b82f6" strokeWidth={2} />;
      }
      case "text":
        return (
          <>
            <rect
              x={sx} y={sy} width={sw} height={sh}
              fill="rgba(74, 222, 128, 0.15)"
              stroke="#22c55e"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
            <text x={sx + 4} y={sy + 14} fontSize={12} fill="#166534">
              {(op.payload?.text as string) || "Text"}
            </text>
          </>
        );
      default:
        return null;
    }
  })();

  if (!shape) return null;

  return (
    <g pointerEvents="none">
      {shape}
      {isHovered && (
        <rect
          x={sx - 2}
          y={sy - 2}
          width={sw + 4}
          height={sh + 4}
          fill="rgba(239, 68, 68, 0.15)"
          stroke="#ef4444"
          strokeWidth={2}
          strokeDasharray="4 2"
          rx={2}
        />
      )}
    </g>
  );
}

export function AnnotationOverlay({
  annotations,
  currentPage,
  zoom,
  activeTool,
  onAnnotationCreated,
  onAnnotationErased,
  onAnnotationUpdated,
}: AnnotationOverlayProps) {
  const {
    svgRef,
    isDrawing,
    previewRect,
    inkPoints,
    textInputPos,
    hoveredOpId,
    editingOpId,
    setEditingOpId,
    handlers,
    submitText,
    cancelText,
    cursorClass,
  } = useDrawing(activeTool, zoom, currentPage, onAnnotationCreated, annotations, onAnnotationErased);

  const pageOps = annotations.filter((op) => op.page === currentPage);
  const editingOp = editingOpId ? annotations.find((o) => o.opId === editingOpId) : null;

  return (
    <>
      <svg
        ref={svgRef}
        className={cn("absolute inset-0 z-20 h-full w-full", cursorClass)}
        style={{ touchAction: "none" }}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
      >
        {pageOps.map((op) => (
          <AnnotationShape
            key={op.opId}
            op={op}
            zoom={zoom}
            isHovered={activeTool === "eraser" && hoveredOpId === op.opId}
          />
        ))}

        {isDrawing && previewRect && activeTool !== "ink" && (
          <rect
            x={previewRect.x * zoom}
            y={previewRect.y * zoom}
            width={previewRect.w * zoom}
            height={previewRect.h * zoom}
            {...getPreviewStyle(activeTool)}
          />
        )}

        {isDrawing && inkPoints.length > 1 && (
          <polyline
            points={inkPoints.map((p) => `${p.x * zoom},${p.y * zoom}`).join(" ")}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {textInputPos && (
        <TextEditor
          position={textInputPos}
          zoom={zoom}
          initialText={editingOp ? (editingOp.payload?.text as string) ?? "" : ""}
          isEditing={!!editingOp}
          onSubmit={(text) => {
            if (editingOp && onAnnotationUpdated) {
              onAnnotationUpdated(editingOp.opId, { payload: { text } });
            } else {
              submitText(text);
            }
            setEditingOpId(null);
          }}
          onCancel={() => {
            cancelText();
            setEditingOpId(null);
          }}
        />
      )}
    </>
  );
}
