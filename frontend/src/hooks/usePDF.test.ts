import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePDF } from './usePDF';

// pdfjs-dist is mocked globally in src/test/setup.ts.
// The mock resolves getDocument() with a document whose numPages = 5,
// and each getPage() returns a page with a getViewport/render stub.
// canvasRef.current stays null throughout (no real DOM canvas is mounted),
// so renderPage() exits early — we are testing only state management here.

describe('usePDF', () => {
  // ─── initial state ────────────────────────────────────────────────────────

  it('starts with totalPages = 0', () => {
    const { result } = renderHook(() => usePDF());
    expect(result.current.totalPages).toBe(0);
  });

  it('starts with currentPage = 1', () => {
    const { result } = renderHook(() => usePDF());
    expect(result.current.currentPage).toBe(1);
  });

  it('starts with scale = 1.0', () => {
    const { result } = renderHook(() => usePDF());
    expect(result.current.scale).toBe(1.0);
  });

  it('starts with isLoading = false', () => {
    const { result } = renderHook(() => usePDF());
    expect(result.current.isLoading).toBe(false);
  });

  it('canvasRef.current starts as null (no DOM canvas attached)', () => {
    const { result } = renderHook(() => usePDF());
    expect(result.current.canvasRef.current).toBeNull();
  });

  // ─── loadPDF ──────────────────────────────────────────────────────────────

  it('loadPDF sets totalPages from the mocked PDF document (numPages = 5)', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    expect(result.current.totalPages).toBe(5);
  });

  it('loadPDF resets currentPage to 1', async () => {
    const { result } = renderHook(() => usePDF());

    // Move away from page 1 first (won't go above totalPages=0 yet, but
    // after loading we want to confirm it snaps back to 1).
    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    // Advance to page 3, then reload — should return to 1.
    await act(async () => {
      result.current.goToPage(3);
    });
    expect(result.current.currentPage).toBe(3);

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });
    expect(result.current.currentPage).toBe(1);
  });

  it('loadPDF clears isLoading to false once the document resolves', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    // After the promise completes isLoading must be false (the finally block
    // in the hook guarantees this even if an error is thrown).
    expect(result.current.isLoading).toBe(false);
  });

  // ─── navigation ───────────────────────────────────────────────────────────

  it('nextPage increments currentPage by 1', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    act(() => { result.current.nextPage(); });
    expect(result.current.currentPage).toBe(2);
  });

  it('nextPage does not exceed totalPages', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    // Jump to last page then attempt to go further.
    act(() => { result.current.goToPage(5); });
    act(() => { result.current.nextPage(); });
    expect(result.current.currentPage).toBe(5);
  });

  it('prevPage decrements currentPage by 1', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    act(() => { result.current.goToPage(3); });
    act(() => { result.current.prevPage(); });
    expect(result.current.currentPage).toBe(2);
  });

  it('prevPage does not go below 1', () => {
    const { result } = renderHook(() => usePDF());
    // currentPage is already 1; calling prevPage must keep it at 1.
    act(() => { result.current.prevPage(); });
    expect(result.current.currentPage).toBe(1);
  });

  it('goToPage clamps to 1 when given a value below 1', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    act(() => { result.current.goToPage(-10); });
    expect(result.current.currentPage).toBe(1);
  });

  it('goToPage clamps to totalPages when given a value above totalPages', async () => {
    const { result } = renderHook(() => usePDF());

    await act(async () => {
      await result.current.loadPDF('mock://file.pdf');
    });

    act(() => { result.current.goToPage(999); });
    expect(result.current.currentPage).toBe(5);
  });

  // ─── zoom ─────────────────────────────────────────────────────────────────

  it('zoomIn increases scale by 0.25', () => {
    const { result } = renderHook(() => usePDF());
    act(() => { result.current.zoomIn(); });
    expect(result.current.scale).toBeCloseTo(1.25);
  });

  it('zoomOut decreases scale by 0.25', () => {
    const { result } = renderHook(() => usePDF());
    act(() => { result.current.zoomOut(); });
    expect(result.current.scale).toBeCloseTo(0.75);
  });

  it('zoomOut does not go below 0.25', () => {
    const { result } = renderHook(() => usePDF());
    // Drive scale down past the floor.
    act(() => {
      for (let i = 0; i < 20; i++) result.current.zoomOut();
    });
    expect(result.current.scale).toBeCloseTo(0.25);
  });

  it('zoomIn does not exceed 5', () => {
    const { result } = renderHook(() => usePDF());
    // Drive scale up past the ceiling.
    act(() => {
      for (let i = 0; i < 30; i++) result.current.zoomIn();
    });
    expect(result.current.scale).toBeCloseTo(5);
  });

  it('setScale clamps values below 0.25 to 0.25', () => {
    const { result } = renderHook(() => usePDF());
    act(() => { result.current.setScale(0.01); });
    expect(result.current.scale).toBeCloseTo(0.25);
  });

  it('setScale clamps values above 5 to 5', () => {
    const { result } = renderHook(() => usePDF());
    act(() => { result.current.setScale(100); });
    expect(result.current.scale).toBeCloseTo(5);
  });

  it('setScale accepts a value within the valid range unchanged', () => {
    const { result } = renderHook(() => usePDF());
    act(() => { result.current.setScale(2.5); });
    expect(result.current.scale).toBeCloseTo(2.5);
  });
});
