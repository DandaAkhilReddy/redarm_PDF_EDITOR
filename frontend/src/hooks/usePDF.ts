import { useState, useCallback, useRef, useEffect } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

export type UsePDFReturn = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  totalPages: number;
  currentPage: number;
  scale: number;
  isLoading: boolean;
  loadPDF: (url: string) => Promise<void>;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setScale: (s: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getThumbnail: (pageNum: number) => Promise<string>;
};

export function usePDF(): UsePDFReturn {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);

  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScaleState] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);

  const renderPage = useCallback(async (pageNum: number, zoom: number) => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    } catch { /* ignore */ }

    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoom });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes("cancelled")) return;
      throw err;
    }
  }, []);

  const loadPDF = useCallback(async (url: string) => {
    setIsLoading(true);
    try {
      const doc = await getDocument(url).promise;
      pdfRef.current = doc;
      setTotalPages(doc.numPages);
      setCurrentPage(1);
      await renderPage(1, scale);
    } finally {
      setIsLoading(false);
    }
  }, [renderPage, scale]);

  useEffect(() => {
    if (pdfRef.current && currentPage > 0) {
      renderPage(currentPage, scale);
    }
  }, [currentPage, scale, renderPage]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage((prev) => {
      const total = pdfRef.current?.numPages || 1;
      const clamped = Math.max(1, Math.min(page, total));
      return clamped;
    });
  }, []);

  const nextPage = useCallback(() => {
    setCurrentPage((prev) => Math.min(prev + 1, pdfRef.current?.numPages || 1));
  }, []);

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  }, []);

  const setScale = useCallback((s: number) => {
    setScaleState(Math.max(0.25, Math.min(5, s)));
  }, []);

  const zoomIn = useCallback(() => {
    setScaleState((prev) => Math.min(prev + 0.25, 5));
  }, []);

  const zoomOut = useCallback(() => {
    setScaleState((prev) => Math.max(prev - 0.25, 0.25));
  }, []);

  const getThumbnail = useCallback(async (pageNum: number): Promise<string> => {
    const pdf = pdfRef.current;
    if (!pdf) return "";
    const page = await pdf.getPage(pageNum);
    const vp = page.getViewport({ scale: 0.2 });
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.floor(vp.width);
    offscreen.height = Math.floor(vp.height);
    const ctx = offscreen.getContext("2d");
    if (!ctx) return "";
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return offscreen.toDataURL("image/png");
  }, []);

  return {
    canvasRef, totalPages, currentPage, scale, isLoading,
    loadPDF, goToPage, nextPage, prevPage, setScale, zoomIn, zoomOut, getThumbnail,
  };
}
