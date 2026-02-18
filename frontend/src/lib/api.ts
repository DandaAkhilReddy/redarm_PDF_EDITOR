const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

function apiUrl(path: string): string {
  if (!API_BASE) return `/api${path}`;
  return `${API_BASE}/api${path}`;
}

export async function apiJson<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload as Record<string, any>)?.error?.message ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export async function uploadBlob(sasUrl: string, file: File): Promise<void> {
  const put = await fetch(sasUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "application/pdf",
    },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Blob upload failed (${put.status})`);
  }
}
