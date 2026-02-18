import type { ReactNode } from "react";

interface EditorLayoutProps {
  sidebar: ReactNode;
  toolbar: ReactNode;
  canvas: ReactNode;
  rightPanel: ReactNode;
}

export function EditorLayout({ sidebar, toolbar, canvas, rightPanel }: EditorLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {sidebar}

      <div className="flex flex-1 flex-col overflow-hidden">
        {toolbar}

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950">
            {canvas}
          </main>

          <aside className="hidden w-80 flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:flex">
            {rightPanel}
          </aside>
        </div>
      </div>
    </div>
  );
}
