import { useState, useCallback, useRef, useEffect } from "react";
import { apiJson } from "../lib/api";
import type { JobResponse } from "../types";

export function useJobs(token: string, docId: string) {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    if (!token) return;

    const timer = setInterval(async () => {
      const current = jobsRef.current;
      const active = current.filter((j) => j.status === "queued" || j.status === "running");
      if (active.length === 0) return;

      const refreshed: JobResponse[] = [];
      for (const job of current) {
        if (job.status !== "queued" && job.status !== "running") {
          refreshed.push(job);
          continue;
        }
        try {
          const updated = await apiJson<JobResponse>(`/jobs/${job.jobId}`, "GET", token);
          refreshed.push(updated);
        } catch {
          refreshed.push(job);
        }
      }
      setJobs(refreshed);
    }, 3000);

    return () => clearInterval(timer);
  }, [token]);

  const startJob = useCallback(
    async (jobType: "ocr" | "export") => {
      if (!token || !docId) return;
      const endpoint = jobType === "ocr" ? `/docs/${docId}/ocr` : `/docs/${docId}/export`;
      const body = jobType === "ocr" ? { pages: "1" } : { format: "pdf" };
      const result = await apiJson<{ jobId: string }>(endpoint, "POST", token, body);
      const newJob: JobResponse = {
        jobId: result.jobId,
        status: "queued",
        type: jobType,
        resultUri: null,
        error: null,
        updatedAt: null,
      };
      setJobs((prev) => [newJob, ...prev]);
      return result.jobId;
    },
    [token, docId]
  );

  const clearJobs = useCallback(() => setJobs([]), []);

  return { jobs, startJob, clearJobs };
}
