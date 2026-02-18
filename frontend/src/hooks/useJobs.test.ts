import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJobs } from './useJobs';

vi.mock('../lib/api', () => ({ apiJson: vi.fn() }));

import { apiJson } from '../lib/api';

const mockApiJson = apiJson as ReturnType<typeof vi.fn>;

const TOKEN = 'test-token-abc';
const DOC_ID = 'doc-123';

beforeEach(() => {
  vi.useFakeTimers();
  mockApiJson.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useJobs', () => {
  it('returns an empty jobs array as initial state', () => {
    const { result } = renderHook(() => useJobs(TOKEN, DOC_ID));

    expect(result.current.jobs).toEqual([]);
  });

  it('startJob calls apiJson for export with the correct endpoint and body', async () => {
    mockApiJson.mockResolvedValueOnce({ jobId: 'job-export-1' });

    const { result } = renderHook(() => useJobs(TOKEN, DOC_ID));

    await act(async () => {
      await result.current.startJob('export');
    });

    expect(mockApiJson).toHaveBeenCalledOnce();
    expect(mockApiJson).toHaveBeenCalledWith(
      `/docs/${DOC_ID}/export`,
      'POST',
      TOKEN,
      { format: 'pdf' }
    );
  });

  it('startJob calls apiJson for ocr with the correct endpoint and body', async () => {
    mockApiJson.mockResolvedValueOnce({ jobId: 'job-ocr-1' });

    const { result } = renderHook(() => useJobs(TOKEN, DOC_ID));

    await act(async () => {
      await result.current.startJob('ocr');
    });

    expect(mockApiJson).toHaveBeenCalledOnce();
    expect(mockApiJson).toHaveBeenCalledWith(
      `/docs/${DOC_ID}/ocr`,
      'POST',
      TOKEN,
      { pages: '1' }
    );
  });

  it('startJob prepends the new job to the beginning of the jobs array', async () => {
    mockApiJson
      .mockResolvedValueOnce({ jobId: 'job-first' })
      .mockResolvedValueOnce({ jobId: 'job-second' });

    const { result } = renderHook(() => useJobs(TOKEN, DOC_ID));

    await act(async () => {
      await result.current.startJob('export');
    });

    await act(async () => {
      await result.current.startJob('ocr');
    });

    expect(result.current.jobs).toHaveLength(2);
    expect(result.current.jobs[0].jobId).toBe('job-second');
    expect(result.current.jobs[1].jobId).toBe('job-first');

    const latestJob = result.current.jobs[0];
    expect(latestJob).toMatchObject({
      jobId: 'job-second',
      status: 'queued',
      type: 'ocr',
      resultUri: null,
      error: null,
      updatedAt: null,
    });
  });

  it('startJob returns the jobId from the api response', async () => {
    mockApiJson.mockResolvedValueOnce({ jobId: 'returned-job-id' });

    const { result } = renderHook(() => useJobs(TOKEN, DOC_ID));

    let returnedId: string | undefined;
    await act(async () => {
      returnedId = await result.current.startJob('export');
    });

    expect(returnedId).toBe('returned-job-id');
  });

  it('startJob does nothing and does not call apiJson when token is empty', async () => {
    const { result } = renderHook(() => useJobs('', DOC_ID));

    await act(async () => {
      await result.current.startJob('export');
    });

    expect(mockApiJson).not.toHaveBeenCalled();
    expect(result.current.jobs).toEqual([]);
  });

  it('clearJobs empties the jobs array', async () => {
    mockApiJson.mockResolvedValueOnce({ jobId: 'job-to-clear' });

    const { result } = renderHook(() => useJobs(TOKEN, DOC_ID));

    await act(async () => {
      await result.current.startJob('export');
    });

    expect(result.current.jobs).toHaveLength(1);

    act(() => {
      result.current.clearJobs();
    });

    expect(result.current.jobs).toEqual([]);
  });

  it('does not start the polling interval when token is empty', async () => {
    mockApiJson.mockResolvedValue({ jobId: 'poll-job', status: 'completed' });

    const { result } = renderHook(() => useJobs('', DOC_ID));

    // Advance timers well past the 3-second poll interval
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });

    // apiJson should never have been called because no token means no polling
    expect(mockApiJson).not.toHaveBeenCalled();
    expect(result.current.jobs).toEqual([]);
  });
});
