import { Badge } from "../ui/Badge";
import { Briefcase, ExternalLink, Loader2 } from "lucide-react";
import type { JobResponse } from "../../types";

interface JobsPanelProps {
  jobs: JobResponse[];
}

function statusVariant(status: string) {
  switch (status) {
    case "completed": return "success" as const;
    case "failed": return "error" as const;
    case "running": return "warning" as const;
    case "queued": return "info" as const;
    default: return "default" as const;
  }
}

export function JobsPanel({ jobs }: JobsPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Jobs</h3>
        </div>
        <Badge variant="default">{jobs.length}</Badge>
      </div>

      <div className="flex-1 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <p className="text-sm text-slate-400">No jobs yet</p>
            <p className="mt-1 text-xs text-slate-400">Export or run OCR to create jobs</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {jobs.map((job) => (
              <div
                key={job.jobId}
                className="rounded-lg border border-slate-100 p-3 dark:border-slate-800"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 uppercase">
                    {job.type}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {(job.status === "queued" || job.status === "running") && (
                      <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                    )}
                    <Badge variant={statusVariant(job.status)}>
                      {job.status}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 truncate text-xs text-slate-400 font-mono">
                  {job.jobId}
                </p>
                {job.resultUri && (
                  <a
                    href={job.resultUri}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Download result
                  </a>
                )}
                {job.error && (
                  <p className="mt-2 text-xs text-red-500">{job.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
