import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./hooks/useAuth";
import { usePDF } from "./hooks/usePDF";
import { useAnnotations } from "./hooks/useAnnotations";
import { useJobs } from "./hooks/useJobs";
import { LoginPage } from "./components/auth/LoginPage";
import { Header } from "./components/layout/Header";
import { EditorLayout } from "./components/layout/EditorLayout";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/editor/Toolbar";
import { PDFViewer } from "./components/editor/PDFViewer";
import { AnnotationPanel } from "./components/editor/AnnotationPanel";
import { JobsPanel } from "./components/editor/JobsPanel";
import { ToastContainer } from "./components/ui/Toast";
import { apiJson, uploadBlob } from "./lib/api";
import type { Theme, Toast, UploadResponse } from "./types";

export default function App() {
  // Auth
  const { auth, login, logout, isLoggingIn } = useAuth();

  // PDF viewer
  const pdf = usePDF();

  // Document state (must be declared before hooks that reference currentDocId)
  const [currentDocId, setCurrentDocId] = useState("");
  const [fileName, setFileName] = useState("");

  // Annotations & jobs (only active when authenticated + doc loaded)
  const annotations = useAnnotations(auth.token, currentDocId, auth.email);
  const jobs = useJobs(auth.token, currentDocId);

  // Theme (persisted to localStorage)
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("redarm_theme") as Theme) || "light";
  });

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("redarm_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: Toast["type"], message: string) => {
    setToasts((prev) => [...prev, { id: crypto.randomUUID(), type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Upload handler
  const handleUpload = useCallback(
    async (file: File) => {
      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        addToast("error", `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 10 MB.`);
        return;
      }
      if (file.type && file.type !== "application/pdf") {
        addToast("error", "Only PDF files are supported.");
        return;
      }

      try {
        const upload = await apiJson<UploadResponse>(
          "/docs/upload-url", "POST", auth.token,
          { fileName: file.name, contentType: file.type || "application/pdf" }
        );
        await uploadBlob(upload.sasUrl, file);
        setCurrentDocId(upload.docId);
        setFileName(file.name);
        annotations.clearAnnotations();
        await pdf.loadPDF(upload.readUrl);
        addToast("success", `Uploaded ${file.name}`);
      } catch (err) {
        addToast("error", (err as Error).message);
      }
    },
    [auth.token, pdf, annotations, addToast]
  );

  // Save handler
  const handleSave = useCallback(async () => {
    try {
      const versionId = await annotations.saveAnnotations();
      if (versionId) addToast("success", `Saved as ${versionId}`);
    } catch (err) {
      addToast("error", (err as Error).message);
    }
  }, [annotations, addToast]);

  // Job handlers
  const handleExport = useCallback(async () => {
    try {
      const jobId = await jobs.startJob("export");
      if (jobId) addToast("info", `Export job queued: ${jobId}`);
    } catch (err) {
      addToast("error", (err as Error).message);
    }
  }, [jobs, addToast]);

  const handleOCR = useCallback(async () => {
    try {
      const jobId = await jobs.startJob("ocr");
      if (jobId) addToast("info", `OCR job queued: ${jobId}`);
    } catch (err) {
      addToast("error", (err as Error).message);
    }
  }, [jobs, addToast]);

  // Add annotation from toolbar
  const handleToolAnnotation = useCallback(() => {
    const tool = annotations.activeTool;
    if (tool === "select" || tool === "pan") return;
    annotations.addAnnotation(tool, pdf.currentPage);
  }, [annotations, pdf.currentPage]);

  const canEdit = auth.isAuthenticated && currentDocId.length > 0;

  // --- Render ---

  if (!auth.isAuthenticated) {
    return (
      <>
        <LoginPage onLogin={login} isLoading={isLoggingIn} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        fileName={fileName}
        email={auth.email}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
      />
      <EditorLayout
        sidebar={
          <Sidebar
            totalPages={pdf.totalPages}
            currentPage={pdf.currentPage}
            onGoToPage={pdf.goToPage}
            onUpload={handleUpload}
            getThumbnail={pdf.getThumbnail}
            isDocLoaded={currentDocId.length > 0}
          />
        }
        toolbar={
          <Toolbar
            activeTool={annotations.activeTool}
            onToolChange={(tool) => {
              annotations.setActiveTool(tool);
              if (tool !== "select" && tool !== "pan" && canEdit) {
                annotations.addAnnotation(tool, pdf.currentPage);
              }
            }}
            currentPage={pdf.currentPage}
            totalPages={pdf.totalPages}
            scale={pdf.scale}
            onPrevPage={pdf.prevPage}
            onNextPage={pdf.nextPage}
            onZoomIn={pdf.zoomIn}
            onZoomOut={pdf.zoomOut}
            onSave={handleSave}
            onExport={handleExport}
            onOCR={handleOCR}
            onClearAnnotations={annotations.clearAnnotations}
            isSaving={annotations.isSaving}
            canEdit={canEdit}
          />
        }
        canvas={
          <PDFViewer
            canvasRef={pdf.canvasRef}
            isLoading={pdf.isLoading}
            hasDocument={currentDocId.length > 0}
          />
        }
        rightPanel={
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto border-b border-slate-200 dark:border-slate-700">
              <AnnotationPanel
                annotations={annotations.ops}
                onRemove={annotations.removeAnnotation}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              <JobsPanel jobs={jobs.jobs} />
            </div>
          </div>
        }
      />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
