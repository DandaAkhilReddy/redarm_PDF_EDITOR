import { useState, useCallback, useRef } from "react";
import { hitTestAnnotation } from "../lib/hitTest";
import type { AnnotationOperation, AnnotationTool } from "../types";

type Point = { x: number; y: number };
type Bounds = { x: number; y: number; w: number; h: number };

/* ── Dev-only diagnostic logging (tree-shaken in production) ── */
const DEBUG =
  typeof import.meta !== "undefined" &&
  import.meta.env?.DEV;

function debugLog(action: string, data?: Record<string, unknown>) {
  if (!DEBUG) return;
  console.debug(`[useDrawing] ${action}`, data ?? "");
}

export function screenToPdf(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  zoom: number,
): Point {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom,
  };
}

export function boundingBox(points: Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

const MIN_DRAG = 5; // minimum PDF-coord drag distance for rect tools

export function useDrawing(
  activeTool: AnnotationTool,
  zoom: number,
  currentPage: number,
  onAnnotationCreated: (
    opType: AnnotationOperation["opType"],
    page: number,
    bounds: Bounds,
    payload?: Record<string, unknown>,
  ) => void,
  annotations: AnnotationOperation[] = [],
  onAnnotationErased?: (opId: string) => void,
  onClickFeedback?: (message: string) => void,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<Point | null>(null);
  const [inkPoints, setInkPoints] = useState<Point[]>([]);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [hoveredOpId, setHoveredOpId] = useState<string | null>(null);
  const [editingOpId, setEditingOpId] = useState<string | null>(null);

  // Click ripple state — visual proof that every click registers
  const [clickRipple, setClickRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const rippleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewRect: Bounds | null =
    drawStart && drawCurrent
      ? {
          x: Math.min(drawStart.x, drawCurrent.x),
          y: Math.min(drawStart.y, drawCurrent.y),
          w: Math.abs(drawCurrent.x - drawStart.x),
          h: Math.abs(drawCurrent.y - drawStart.y),
        }
      : null;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (activeTool === "pan") return;
      const svg = svgRef.current;
      if (!svg) return;

      const pt = screenToPdf(e.clientX, e.clientY, svg, zoom);
      debugLog("pointerDown", { activeTool, pt, page: currentPage });

      // Click ripple — fires for every tool except pan
      if (rippleTimerRef.current) clearTimeout(rippleTimerRef.current);
      setClickRipple({ x: pt.x, y: pt.y, id: Date.now() });
      rippleTimerRef.current = setTimeout(() => setClickRipple(null), 500);

      // Select: allow click-to-edit existing text annotations
      if (activeTool === "select") {
        const hitId = hitTestAnnotation(pt, annotations, currentPage);
        const hitOp = hitId ? annotations.find((o) => o.opId === hitId && o.opType === "text") : null;
        debugLog("select hitTest", { hitId, hitOpType: hitOp?.opType ?? null });
        if (hitOp) {
          setEditingOpId(hitOp.opId);
          setTextInputPos({ x: hitOp.bounds.x, y: hitOp.bounds.y });
        } else if (!hitId) {
          // Clicked on empty space — guide the user
          onClickFeedback?.("Select a drawing tool to annotate, or use Text to add text.");
        }
        return;
      }

      // Eraser: hit-test and remove
      if (activeTool === "eraser") {
        const hitId = hitTestAnnotation(pt, annotations, currentPage);
        debugLog("eraser hitTest", { hitId });
        if (hitId && onAnnotationErased) {
          onAnnotationErased(hitId);
        }
        return;
      }

      // Text: click-to-place or click-to-edit existing
      if (activeTool === "text") {
        const hitId = hitTestAnnotation(pt, annotations, currentPage);
        const hitOp = hitId ? annotations.find((o) => o.opId === hitId && o.opType === "text") : null;
        debugLog("text hitTest", { hitId, isNew: !hitOp });
        if (hitOp) {
          setEditingOpId(hitOp.opId);
          setTextInputPos({ x: hitOp.bounds.x, y: hitOp.bounds.y });
        } else {
          setEditingOpId(null);
          setTextInputPos(pt);
        }
        return;
      }

      setIsDrawing(true);
      setDrawStart(pt);
      setDrawCurrent(pt);
      if (activeTool === "ink") {
        setInkPoints([pt]);
      }
      svg.setPointerCapture(e.pointerId);
    },
    [activeTool, zoom, annotations, currentPage, onAnnotationErased, onClickFeedback],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Eraser hover tracking (before the isDrawing guard)
      if (activeTool === "eraser") {
        const svg = svgRef.current;
        if (!svg) return;
        const pt = screenToPdf(e.clientX, e.clientY, svg, zoom);
        const hitId = hitTestAnnotation(pt, annotations, currentPage);
        setHoveredOpId(hitId);
        return;
      }

      if (!isDrawing) return;
      const svg = svgRef.current;
      if (!svg) return;

      const pt = screenToPdf(e.clientX, e.clientY, svg, zoom);
      setDrawCurrent(pt);
      if (activeTool === "ink") {
        setInkPoints((prev) => [...prev, pt]);
      }
    },
    [isDrawing, activeTool, zoom, annotations, currentPage],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing || !drawStart) {
        setIsDrawing(false);
        return;
      }

      const svg = svgRef.current;
      if (!svg) {
        setIsDrawing(false);
        return;
      }

      const pt = screenToPdf(e.clientX, e.clientY, svg, zoom);

      if (activeTool === "ink") {
        const finalPoints = [...inkPoints, pt];
        const bb = boundingBox(finalPoints);
        onAnnotationCreated("ink", currentPage, bb, { points: finalPoints });
      } else {
        const opType = activeTool as AnnotationOperation["opType"];
        const bounds: Bounds = {
          x: Math.min(drawStart.x, pt.x),
          y: Math.min(drawStart.y, pt.y),
          w: Math.abs(pt.x - drawStart.x),
          h: Math.abs(pt.y - drawStart.y),
        };
        debugLog("pointerUp", { activeTool, bounds, meetsMinDrag: bounds.w >= MIN_DRAG || bounds.h >= MIN_DRAG });
        if (bounds.w >= MIN_DRAG || bounds.h >= MIN_DRAG) {
          onAnnotationCreated(opType, currentPage, bounds);
        } else {
          // Click without drag — guide the user
          onClickFeedback?.("Click and drag to draw. Hold and pull to create a region.");
        }
      }

      setIsDrawing(false);
      setDrawStart(null);
      setDrawCurrent(null);
      setInkPoints([]);
    },
    [isDrawing, drawStart, inkPoints, activeTool, zoom, currentPage, onAnnotationCreated, onClickFeedback],
  );

  const submitText = useCallback(
    (text: string) => {
      if (!textInputPos || !text.trim()) {
        setTextInputPos(null);
        return;
      }
      onAnnotationCreated(
        "text",
        currentPage,
        { x: textInputPos.x, y: textInputPos.y, w: 150, h: 20 },
        { text },
      );
      setTextInputPos(null);
    },
    [textInputPos, currentPage, onAnnotationCreated],
  );

  const cancelText = useCallback(() => {
    setTextInputPos(null);
  }, []);

  const cursorClass = (() => {
    switch (activeTool) {
      case "select": return "cursor-default";
      case "pan": return "cursor-grab";
      case "text": return "cursor-text";
      case "eraser": return "cursor-pointer";
      default: return "cursor-crosshair";
    }
  })();

  return {
    svgRef,
    isDrawing,
    previewRect,
    inkPoints,
    textInputPos,
    hoveredOpId,
    editingOpId,
    setEditingOpId,
    clickRipple,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
    submitText,
    cancelText,
    cursorClass,
  };
}
