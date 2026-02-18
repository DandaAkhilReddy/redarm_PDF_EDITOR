import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AnnotationOperation, JobResponse, LoginResponse, UploadResponse } from "./types";

GlobalWorkerOptions.workerSrc = workerSrc;

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

function apiUrl(path: string): string {
  if (!API_BASE) {
    return `/api${path}`;
  }
  return `${API_BASE}/api${path}`;
}

async function apiJson<T>(path: string, method: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as any)?.error?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [docId, setDocId] = useState("");
  const [readUrl, setReadUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [ops, setOps] = useState<AnnotationOperation[]>([]);
  const [opType, setOpType] = useState<AnnotationOperation["opType"]>("highlight");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const canUseEditor = useMemo(() => token.length > 0 && docId.length > 0, [token, docId]);

  useEffect(() => {
    if (!readUrl || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const render = async () => {
      try {
        const loadingTask = getDocument(readUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.1 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to render PDF: ${(err as Error).message}`);
        }
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [readUrl]);

  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    if (!token) {
      return;
    }

    const timer = setInterval(async () => {
      const currentJobs = jobsRef.current;
      const active = currentJobs.filter((j) => j.status === "queued" || j.status === "running");
      if (active.length === 0) {
        return;
      }

      const refreshed: JobResponse[] = [];
      for (const job of currentJobs) {
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

  const onLogin = async () => {
    setError("");
    setMessage("");

    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    try {
      const result = await apiJson<LoginResponse>("/auth/login", "POST", "", { email, password });
      setToken(result.accessToken);
      setUserEmail(result.user.email);
      setMessage(`Logged in as ${result.user.email}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onUpload = async (file: File | null) => {
    if (!file || !token) {
      return;
    }

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_SIZE / 1024 / 1024} MB.`);
      return;
    }

    if (file.type && file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const upload = await apiJson<UploadResponse>("/docs/upload-url", "POST", token, {
        fileName: file.name,
        contentType: file.type || "application/pdf"
      });

      const put = await fetch(upload.sasUrl, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": "application/pdf"
        },
        body: file
      });

      if (!put.ok) {
        throw new Error(`Blob upload failed (${put.status})`);
      }

      setDocId(upload.docId);
      setReadUrl(upload.readUrl);
      setOps([]);
      setMessage(`Uploaded ${file.name}. Document ID: ${upload.docId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addOperation = () => {
    if (!userEmail) {
      return;
    }

    const op: AnnotationOperation = {
      opId: crypto.randomUUID(),
      opType,
      page: 1,
      bounds: { x: 50, y: 50, w: 120, h: 40 },
      author: userEmail,
      payload: { note: `${opType} annotation` },
      ts: new Date().toISOString()
    };

    setOps((prev) => [...prev, op]);
  };

  const saveAnnotations = async () => {
    if (!canUseEditor) {
      return;
    }

    try {
      const payload = {
        schemaVersion: "1.0",
        operations: ops
      };
      const result = await apiJson<{ ok: boolean; versionId: string }>(`/docs/${docId}/save-annotation`, "POST", token, payload);
      setMessage(`Annotations saved as ${result.versionId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startJob = async (jobType: "ocr" | "export") => {
    if (!canUseEditor) {
      return;
    }

    try {
      const endpoint = jobType === "ocr" ? `/docs/${docId}/ocr` : `/docs/${docId}/export`;
      const body = jobType === "ocr" ? { pages: "1" } : { format: "pdf" };
      const result = await apiJson<{ jobId: string }>(endpoint, "POST", token, body);
      setJobs((prev) => [{ jobId: result.jobId, status: "queued", type: jobType, resultUri: null, error: null, updatedAt: null }, ...prev]);
      setMessage(`${jobType.toUpperCase()} job queued: ${result.jobId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="container">
      <h1>RedArm PDF Editor (Cheap MVP)</h1>

      <div className="card">
        <h2>1) Login</h2>
        <div className="row">
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={onLogin}>Login</button>
        </div>
        <p className="small">Use BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD for first login.</p>
      </div>

      <div className="card">
        <h2>2) Upload PDF</h2>
        <input
          type="file"
          accept="application/pdf"
          disabled={!token}
          onChange={(e) => onUpload(e.target.files?.[0] || null)}
        />
      </div>

      <div className="card">
        <h2>3) View and annotate</h2>
        <canvas ref={canvasRef} />
        <div className="row" style={{ marginTop: 12 }}>
          <select value={opType} onChange={(e) => setOpType(e.target.value as AnnotationOperation["opType"])}>
            <option value="highlight">highlight</option>
            <option value="ink">ink</option>
            <option value="text">text</option>
            <option value="shape">shape</option>
            <option value="redaction">redaction</option>
          </select>
          <button className="secondary" disabled={!canUseEditor} onClick={addOperation}>
            Add Sample Annotation
          </button>
          <button disabled={!canUseEditor} onClick={saveAnnotations}>
            Save Annotation Ops
          </button>
        </div>
        <pre>{JSON.stringify({ schemaVersion: "1.0", operations: ops }, null, 2)}</pre>
      </div>

      <div className="card">
        <h2>4) Manual Jobs</h2>
        <div className="row">
          <button disabled={!canUseEditor} onClick={() => startJob("export")}>
            Export PDF
          </button>
          <button disabled={!canUseEditor} onClick={() => startJob("ocr")}
            title="Requires Azure Document Intelligence to be configured on the backend">
            Run OCR (Manual)
          </button>
        </div>
        <div className="jobs" style={{ marginTop: 12 }}>
          {jobs.map((job) => (
            <div className="job-item" key={job.jobId}>
              <strong>{job.type.toUpperCase()}</strong> - {job.status}
              <div className="small">Job: {job.jobId}</div>
              {job.resultUri ? (
                <div>
                  Result: <a href={job.resultUri} target="_blank" rel="noreferrer">open</a>
                </div>
              ) : null}
              {job.error ? <div className="error">{job.error}</div> : null}
            </div>
          ))}
        </div>
      </div>

      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}