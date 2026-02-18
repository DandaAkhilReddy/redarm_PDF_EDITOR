import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnnotations } from './useAnnotations';

vi.mock('../lib/api', () => ({ apiJson: vi.fn() }));
import { apiJson } from '../lib/api';

const TOKEN = 'test-token';
const DOC_ID = 'doc-123';
const AUTHOR = 'test-author';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAnnotations', () => {
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    expect(result.current.ops).toEqual([]);
    expect(result.current.activeTool).toBe('select');
    expect(result.current.isSaving).toBe(false);
  });

  it('addAnnotation adds an operation to the ops array', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    act(() => {
      result.current.addAnnotation('highlight', 1);
    });

    expect(result.current.ops).toHaveLength(1);
    expect(result.current.ops[0].opType).toBe('highlight');
    expect(result.current.ops[0].page).toBe(1);
  });

  it('addAnnotation generates a unique opId for each operation', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    let op1: ReturnType<typeof result.current.addAnnotation>;
    let op2: ReturnType<typeof result.current.addAnnotation>;

    act(() => {
      op1 = result.current.addAnnotation('text', 1);
      op2 = result.current.addAnnotation('text', 2);
    });

    expect(op1!.opId).toBeTruthy();
    expect(op2!.opId).toBeTruthy();
    expect(op1!.opId).not.toBe(op2!.opId);
  });

  it('addAnnotation uses default bounds when no bounds are provided', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    act(() => {
      result.current.addAnnotation('ink', 1);
    });

    expect(result.current.ops[0].bounds).toEqual({ x: 50, y: 50, w: 120, h: 40 });
  });

  it('addAnnotation uses provided bounds when supplied', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));
    const customBounds = { x: 10, y: 20, w: 200, h: 80 };

    act(() => {
      result.current.addAnnotation('shape', 3, customBounds);
    });

    expect(result.current.ops[0].bounds).toEqual(customBounds);
  });

  it('addAnnotation sets the author from the hook param', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    act(() => {
      result.current.addAnnotation('redaction', 2);
    });

    expect(result.current.ops[0].author).toBe(AUTHOR);
  });

  it('removeAnnotation removes the operation with the matching opId', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    let op1: ReturnType<typeof result.current.addAnnotation>;
    act(() => {
      op1 = result.current.addAnnotation('highlight', 1);
      result.current.addAnnotation('text', 2);
    });

    expect(result.current.ops).toHaveLength(2);

    act(() => {
      result.current.removeAnnotation(op1!.opId);
    });

    expect(result.current.ops).toHaveLength(1);
    expect(result.current.ops[0].opType).toBe('text');
  });

  it('clearAnnotations empties the ops array', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    act(() => {
      result.current.addAnnotation('highlight', 1);
      result.current.addAnnotation('ink', 2);
      result.current.addAnnotation('text', 3);
    });

    expect(result.current.ops).toHaveLength(3);

    act(() => {
      result.current.clearAnnotations();
    });

    expect(result.current.ops).toHaveLength(0);
  });

  it('setActiveTool changes the active tool', () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    expect(result.current.activeTool).toBe('select');

    act(() => {
      result.current.setActiveTool('highlight');
    });

    expect(result.current.activeTool).toBe('highlight');

    act(() => {
      result.current.setActiveTool('pan');
    });

    expect(result.current.activeTool).toBe('pan');
  });

  it('saveAnnotations calls apiJson with correct arguments', async () => {
    const versionId = 'v-abc-123';
    vi.mocked(apiJson).mockResolvedValue({ ok: true, versionId });

    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    act(() => {
      result.current.addAnnotation('highlight', 1);
    });

    const currentOps = result.current.ops;
    let returnedVersionId: string | undefined;

    await act(async () => {
      returnedVersionId = await result.current.saveAnnotations();
    });

    expect(apiJson).toHaveBeenCalledOnce();
    expect(apiJson).toHaveBeenCalledWith(
      `/docs/${DOC_ID}/save-annotation`,
      'POST',
      TOKEN,
      { schemaVersion: '1.0', operations: currentOps }
    );
    expect(returnedVersionId).toBe(versionId);
  });

  it('saveAnnotations does nothing when token is empty', async () => {
    const { result } = renderHook(() => useAnnotations('', DOC_ID, AUTHOR));

    await act(async () => {
      await result.current.saveAnnotations();
    });

    expect(apiJson).not.toHaveBeenCalled();
  });

  it('saveAnnotations does nothing when docId is empty', async () => {
    const { result } = renderHook(() => useAnnotations(TOKEN, '', AUTHOR));

    await act(async () => {
      await result.current.saveAnnotations();
    });

    expect(apiJson).not.toHaveBeenCalled();
  });

  it('saveAnnotations sets isSaving to true during the request and false after', async () => {
    let resolveSave!: (value: unknown) => void;
    const savePromise = new Promise((resolve) => { resolveSave = resolve; });
    vi.mocked(apiJson).mockReturnValue(savePromise as ReturnType<typeof apiJson>);

    const { result } = renderHook(() => useAnnotations(TOKEN, DOC_ID, AUTHOR));

    expect(result.current.isSaving).toBe(false);

    let saveCall: Promise<string | undefined>;
    act(() => {
      saveCall = result.current.saveAnnotations();
    });

    // isSaving should be true while the promise is pending
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      resolveSave({ ok: true, versionId: 'v-1' });
      await saveCall!;
    });

    expect(result.current.isSaving).toBe(false);
  });
});
