import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Trash2, MessageSquare } from "lucide-react";
import type { AnnotationOperation } from "../../types";

interface AnnotationPanelProps {
  annotations: AnnotationOperation[];
  onRemove: (opId: string) => void;
}

const opColors: Record<string, string> = {
  highlight: "bg-yellow-400/20 border-yellow-400",
  ink: "bg-blue-400/20 border-blue-400",
  text: "bg-green-400/20 border-green-400",
  shape: "bg-purple-400/20 border-purple-400",
  redaction: "bg-red-400/20 border-red-400",
};

export function AnnotationPanel({ annotations, onRemove }: AnnotationPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Annotations</h3>
        </div>
        <Badge variant="default">{annotations.length}</Badge>
      </div>

      <div className="flex-1 overflow-y-auto">
        {annotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <p className="text-sm text-slate-400">No annotations yet</p>
            <p className="mt-1 text-xs text-slate-400">Use the toolbar to add annotations</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {annotations.map((op) => (
              <div
                key={op.opId}
                className="group flex items-start gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50 transition-colors dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                <div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${opColors[op.opType] || "border-slate-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize text-slate-700 dark:text-slate-300">
                      {op.opType}
                    </span>
                    <span className="text-xs text-slate-400">
                      p.{op.page}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {op.author} &middot; {new Date(op.ts).toLocaleTimeString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(op.opId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity !h-7 !w-7 !p-0"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
