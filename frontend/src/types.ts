export type LoginResponse = {
  accessToken: string;
  expiresIn: string;
  user: {
    email: string;
    role: string;
  };
};

export type UploadResponse = {
  docId: string;
  sasUrl: string;
  blobPath: string;
  readUrl: string;
  expiresAt: string;
  maxUploadBytes: number;
};

export type JobResponse = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  type: string;
  resultUri: string | null;
  error: string | null;
  updatedAt: string | null;
};

export type AnnotationOperation = {
  opId: string;
  opType: "highlight" | "ink" | "text" | "shape" | "redaction";
  page: number;
  bounds: { x: number; y: number; w: number; h: number };
  author: string;
  payload?: Record<string, unknown>;
  ts: string;
};