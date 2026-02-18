import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { PDFViewer } from './PDFViewer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRef() {
  return createRef<HTMLCanvasElement | null>();
}

const defaultOverlayProps = {
  annotations: [],
  currentPage: 1,
  zoom: 1,
  activeTool: "select" as const,
  onAnnotationCreated: vi.fn(),
  onAnnotationErased: vi.fn(),
  onAnnotationUpdated: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PDFViewer', () => {
  describe('empty state (hasDocument=false)', () => {
    it('shows "No document loaded" heading when there is no document', () => {
      render(
        <PDFViewer canvasRef={makeRef()} isLoading={false} hasDocument={false} {...defaultOverlayProps} />
      );

      expect(
        screen.getByText('No document loaded')
      ).toBeInTheDocument();
    });

    it('shows the sidebar upload hint when there is no document', () => {
      render(
        <PDFViewer canvasRef={makeRef()} isLoading={false} hasDocument={false} {...defaultOverlayProps} />
      );

      expect(
        screen.getByText('Upload a PDF from the sidebar to get started')
      ).toBeInTheDocument();
    });

    it('does not render a canvas element when there is no document', () => {
      render(
        <PDFViewer canvasRef={makeRef()} isLoading={false} hasDocument={false} {...defaultOverlayProps} />
      );

      expect(document.querySelector('canvas')).toBeNull();
    });
  });

  describe('document loaded state (hasDocument=true)', () => {
    it('renders the canvas element when a document is loaded', () => {
      render(
        <PDFViewer canvasRef={makeRef()} isLoading={false} hasDocument={true} {...defaultOverlayProps} />
      );

      expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('shows the loading spinner when isLoading=true', () => {
      const { container } = render(
        <PDFViewer canvasRef={makeRef()} isLoading={true} hasDocument={true} {...defaultOverlayProps} />
      );

      // Loader2 from lucide-react renders an <svg>; the spinner wrapper has the
      // animate-spin class that vitest can detect via the DOM class list.
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('does not show the loading spinner when isLoading=false', () => {
      const { container } = render(
        <PDFViewer canvasRef={makeRef()} isLoading={false} hasDocument={true} {...defaultOverlayProps} />
      );

      expect(container.querySelector('.animate-spin')).toBeNull();
    });

    it('attaches the forwarded ref to the canvas element', () => {
      const ref = makeRef();

      render(
        <PDFViewer canvasRef={ref} isLoading={false} hasDocument={true} {...defaultOverlayProps} />
      );

      const canvas = document.querySelector('canvas');
      expect(canvas).toBeInTheDocument();
      expect(ref.current).toBe(canvas);
    });
  });
});
