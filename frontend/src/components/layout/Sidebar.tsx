import { useState, useEffect } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Upload, PanelLeftClose, PanelLeft } from "lucide-react";

interface SidebarProps {
  totalPages: number;
  currentPage: number;
  onGoToPage: (page: number) => void;
  onUpload: (file: File) => void;
  getThumbnail: (page: number) => Promise<string>;
  isDocLoaded: boolean;
}

export function Sidebar({ totalPages, currentPage, onGoToPage, onUpload, getThumbnail, isDocLoaded }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  useEffect(() => {
    if (totalPages === 0) {
      setThumbnails({});
      return;
    }

    let cancelled = false;
    const load = async () => {
      const thumbs: Record<number, string> = {};
      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) break;
        try {
          thumbs[i] = await getThumbnail(i);
        } catch { /* skip */ }
      }
      if (!cancelled) setThumbnails(thumbs);
    };
    load();
    return () => { cancelled = true; };
  }, [totalPages, getThumbnail]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = "";
  };

  if (collapsed) {
    return (
      <div className="flex w-12 flex-col items-center border-r border-slate-200 bg-slate-50 py-3 dark:border-slate-700 dark:bg-slate-900">
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <aside className="flex w-56 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 lg:w-64">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Pages
        </span>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3">
        <label className="cursor-pointer">
          <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
          <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 transition-colors dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-400">
            <Upload className="h-4 w-4" />
            Upload PDF
          </div>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {!isDocLoaded && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-xs text-slate-400">No document loaded</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
            <button
              key={pageNum}
              onClick={() => onGoToPage(pageNum)}
              className={cn(
                "group flex flex-col items-center gap-1 rounded-lg p-2 transition-colors",
                pageNum === currentPage
                  ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/30"
                  : "hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
            >
              {thumbnails[pageNum] ? (
                <img
                  src={thumbnails[pageNum]}
                  alt={`Page ${pageNum}`}
                  className="w-full rounded border border-slate-200 shadow-sm dark:border-slate-700"
                />
              ) : (
                <div className="aspect-[8.5/11] w-full rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
              )}
              <span className={cn(
                "text-xs",
                pageNum === currentPage
                  ? "font-medium text-brand-700 dark:text-brand-400"
                  : "text-slate-500 dark:text-slate-400"
              )}>
                {pageNum}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
