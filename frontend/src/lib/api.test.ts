import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiJson, uploadBlob } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response-like object that satisfies the subset of the
 * Fetch Response API used by api.ts.
 */
function makeResponse(options: {
  ok: boolean;
  status: number;
  jsonResult?: unknown;
  jsonThrows?: boolean;
}): Response {
  const { ok, status, jsonResult, jsonThrows = false } = options;

  const jsonFn = jsonThrows
    ? vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON'))
    : vi.fn().mockResolvedValue(jsonResult ?? {});

  return {
    ok,
    status,
    json: jsonFn,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup — replace global fetch with a vi.fn() before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

// ---------------------------------------------------------------------------
// apiJson
// ---------------------------------------------------------------------------

describe('apiJson', () => {
  it('sends the correct URL with /api prefix when no VITE_API_BASE_URL is set', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: { id: 1 } }));

    await apiJson('/docs', 'GET', 'tok');

    const [url] = fetchMock.mock.calls[0];
    // When VITE_API_BASE_URL is undefined the module falls back to "" so the
    // path becomes /api<path>.
    expect(url).toBe('/api/docs');
  });

  it('includes the Authorization header when a token is provided', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: {} }));

    await apiJson('/docs', 'GET', 'my-token');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer my-token',
    });
  });

  it('omits the Authorization header when token is an empty string', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: {} }));

    await apiJson('/docs', 'GET', '');

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('always sends Content-Type: application/json', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: {} }));

    await apiJson('/docs', 'GET', '');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('JSON-stringifies the body when one is provided', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: {} }));

    const body = { name: 'Test Doc', size: 42 };
    await apiJson('/docs', 'POST', 'tok', body);

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toBe(JSON.stringify(body));
  });

  it('sends undefined body when no body argument is passed', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: {} }));

    await apiJson('/docs', 'GET', 'tok');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toBeUndefined();
  });

  it('returns the parsed JSON payload on a successful response', async () => {
    const fetchMock = vi.mocked(fetch);
    const data = { docId: 'abc-123', name: 'report.pdf' };
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonResult: data }));

    const result = await apiJson<typeof data>('/docs/abc-123', 'GET', 'tok');

    expect(result).toEqual(data);
  });

  it('throws an Error using the server error.message on a failed response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 403,
        jsonResult: { error: { message: 'Forbidden – insufficient permissions' } },
      })
    );

    await expect(apiJson('/docs', 'GET', 'tok')).rejects.toThrow(
      'Forbidden – insufficient permissions'
    );
  });

  it('throws a generic error message when the response body has no error.message', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      makeResponse({ ok: false, status: 500, jsonResult: { something: 'else' } })
    );

    await expect(apiJson('/docs', 'GET', 'tok')).rejects.toThrow('Request failed (500)');
  });

  it('handles a response.json() parse failure gracefully and falls back to the generic message', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      makeResponse({ ok: false, status: 502, jsonThrows: true })
    );

    // When JSON parsing fails, payload defaults to {} so no error.message is
    // present and the generic message is used.
    await expect(apiJson('/docs', 'GET', 'tok')).rejects.toThrow('Request failed (502)');
  });
});

// ---------------------------------------------------------------------------
// uploadBlob
// ---------------------------------------------------------------------------

describe('uploadBlob', () => {
  const SAS_URL = 'https://storage.example.com/container/doc.pdf?sv=sig';

  function makeFile(name = 'test.pdf', type = 'application/pdf'): File {
    return new File(['%PDF-1.4 content'], name, { type });
  }

  it('sends a PUT request to the provided SAS URL', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 201 }));

    await uploadBlob(SAS_URL, makeFile());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SAS_URL);
    expect((init as RequestInit).method).toBe('PUT');
  });

  it('sends the x-ms-blob-type: BlockBlob header', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 201 }));

    await uploadBlob(SAS_URL, makeFile());

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      'x-ms-blob-type': 'BlockBlob',
    });
  });

  it('sends the Content-Type: application/pdf header', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 201 }));

    await uploadBlob(SAS_URL, makeFile());

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/pdf',
    });
  });

  it('passes the File object as the request body', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200 }));

    const file = makeFile();
    await uploadBlob(SAS_URL, file);

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toBe(file);
  });

  it('resolves without throwing when the response is 200', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200 }));

    await expect(uploadBlob(SAS_URL, makeFile())).resolves.toBeUndefined();
  });

  it('resolves without throwing when the response is 201', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 201 }));

    await expect(uploadBlob(SAS_URL, makeFile())).resolves.toBeUndefined();
  });

  it('throws an Error with status code when the response is not ok', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(makeResponse({ ok: false, status: 403 }));

    await expect(uploadBlob(SAS_URL, makeFile())).rejects.toThrow('Blob upload failed (403)');
  });
});
