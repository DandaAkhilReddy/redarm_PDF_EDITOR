import { useState, useCallback, useEffect } from "react";
import type { AnnotationOperation } from "../types";

type HistoryAction =
  | { type: "add"; op: AnnotationOperation }
  | { type: "remove"; op: AnnotationOperation }
  | { type: "clear"; ops: AnnotationOperation[] }
  | { type: "update"; oldOp: AnnotationOperation; newOp: AnnotationOperation };

export function useUndoRedo(
  addAnnotationRaw: (
    opType: AnnotationOperation["opType"],
    page: number,
    bounds?: { x: number; y: number; w: number; h: number },
    payload?: Record<string, unknown>,
  ) => AnnotationOperation,
  removeAnnotationRaw: (opId: string) => void,
  clearAnnotationsRaw: () => void,
  ops: AnnotationOperation[],
  setOpsDirectly: React.Dispatch<React.SetStateAction<AnnotationOperation[]>>,
) {
  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  const addAnnotation = useCallback(
    (
      opType: AnnotationOperation["opType"],
      page: number,
      bounds?: { x: number; y: number; w: number; h: number },
      payload?: Record<string, unknown>,
    ) => {
      const op = addAnnotationRaw(opType, page, bounds, payload);
      setUndoStack((prev) => [...prev, { type: "add", op }]);
      setRedoStack([]);
      return op;
    },
    [addAnnotationRaw],
  );

  const removeAnnotation = useCallback(
    (opId: string) => {
      const op = ops.find((o) => o.opId === opId);
      if (!op) return;
      removeAnnotationRaw(opId);
      setUndoStack((prev) => [...prev, { type: "remove", op }]);
      setRedoStack([]);
    },
    [ops, removeAnnotationRaw],
  );

  const clearAnnotations = useCallback(() => {
    if (ops.length === 0) return;
    const snapshot = [...ops];
    clearAnnotationsRaw();
    setUndoStack((prev) => [...prev, { type: "clear", ops: snapshot }]);
    setRedoStack([]);
  }, [ops, clearAnnotationsRaw]);

  const updateAnnotation = useCallback(
    (opId: string, updates: { payload?: Record<string, unknown>; bounds?: { x: number; y: number; w: number; h: number } }) => {
      const oldOp = ops.find((o) => o.opId === opId);
      if (!oldOp) return;
      const newOp: AnnotationOperation = {
        ...oldOp,
        bounds: updates.bounds ?? oldOp.bounds,
        payload: updates.payload !== undefined ? { ...oldOp.payload, ...updates.payload } : oldOp.payload,
        ts: new Date().toISOString(),
      };
      setOpsDirectly((prev) => prev.map((o) => (o.opId === opId ? newOp : o)));
      setUndoStack((prev) => [...prev, { type: "update", oldOp, newOp }]);
      setRedoStack([]);
    },
    [ops, setOpsDirectly],
  );

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      const rest = prev.slice(0, -1);

      switch (action.type) {
        case "add":
          setOpsDirectly((current) => current.filter((o) => o.opId !== action.op.opId));
          break;
        case "remove":
          setOpsDirectly((current) => [...current, action.op]);
          break;
        case "clear":
          setOpsDirectly(action.ops);
          break;
        case "update":
          setOpsDirectly((current) => current.map((o) => (o.opId === action.oldOp.opId ? action.oldOp : o)));
          break;
      }

      setRedoStack((r) => [...r, action]);
      return rest;
    });
  }, [setOpsDirectly]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      const rest = prev.slice(0, -1);

      switch (action.type) {
        case "add":
          setOpsDirectly((current) => [...current, action.op]);
          break;
        case "remove":
          setOpsDirectly((current) => current.filter((o) => o.opId !== action.op.opId));
          break;
        case "clear":
          setOpsDirectly([]);
          break;
        case "update":
          setOpsDirectly((current) => current.map((o) => (o.opId === action.newOp.opId ? action.newOp : o)));
          break;
      }

      setUndoStack((u) => [...u, action]);
      return rest;
    });
  }, [setOpsDirectly]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || (e.key === "y" && !e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return {
    addAnnotation,
    removeAnnotation,
    clearAnnotations,
    updateAnnotation,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
