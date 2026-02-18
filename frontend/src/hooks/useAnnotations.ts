import { useState, useCallback } from "react";
import { apiJson } from "../lib/api";
import type { AnnotationOperation, AnnotationTool } from "../types";

export function useAnnotations(token: string, docId: string, author: string) {
  const [ops, setOps] = useState<AnnotationOperation[]>([]);
  const [activeTool, setActiveTool] = useState<AnnotationTool>("select");
  const [isSaving, setIsSaving] = useState(false);

  const addAnnotation = useCallback(
    (opType: AnnotationOperation["opType"], page: number, bounds?: { x: number; y: number; w: number; h: number }, payload?: Record<string, unknown>) => {
      const op: AnnotationOperation = {
        opId: crypto.randomUUID(),
        opType,
        page,
        bounds: bounds || { x: 50, y: 50, w: 120, h: 40 },
        author,
        payload: payload || { note: `${opType} annotation` },
        ts: new Date().toISOString(),
      };
      setOps((prev) => [...prev, op]);
      return op;
    },
    [author]
  );

  const removeAnnotation = useCallback((opId: string) => {
    setOps((prev) => prev.filter((op) => op.opId !== opId));
  }, []);

  const clearAnnotations = useCallback(() => {
    setOps([]);
  }, []);

  const saveAnnotations = useCallback(async () => {
    if (!token || !docId) return;
    setIsSaving(true);
    try {
      const result = await apiJson<{ ok: boolean; versionId: string }>(
        `/docs/${docId}/save-annotation`,
        "POST",
        token,
        { schemaVersion: "1.0", operations: ops }
      );
      return result.versionId;
    } finally {
      setIsSaving(false);
    }
  }, [token, docId, ops]);

  return {
    ops,
    setOps,
    activeTool,
    setActiveTool,
    addAnnotation,
    removeAnnotation,
    clearAnnotations,
    saveAnnotations,
    isSaving,
  };
}
