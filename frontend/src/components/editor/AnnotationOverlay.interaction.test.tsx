import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { AnnotationOverlay } from './AnnotationOverlay';
import type { AnnotationOperation, AnnotationTool } from '../../types';

// Mock hitTest but NOT useDrawing -- we want real pointer-event flows end-to-end
vi.mock('../../lib/hitTest', () => ({
  hitTestAnnotation: vi.fn(() => null),
}));
import { hitTestAnnotation } from '../../lib/hitTest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(
  overrides: Partial<AnnotationOperation> & {
    opId: string;
    opType: AnnotationOperation['opType'];
  },
): AnnotationOperation {
  return {
    page: 1,
    bounds: { x: 10, y: 20, w: 100, h: 50 },
    author: 'test',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

const defaultProps = {
  annotations: [] as AnnotationOperation[],
  currentPage: 1,
  zoom: 1,
  activeTool: 'select' as AnnotationTool,
  onAnnotationCreated: vi.fn(),
  onAnnotationErased: vi.fn(),
  onAnnotationUpdated: vi.fn(),
};

function getSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('SVG not found');
  return svg;
}

function pointerDown(svg: SVGSVGElement, x: number, y: number) {
  fireEvent.pointerDown(svg, { clientX: x, clientY: y, pointerId: 1 });
}

function pointerMove(svg: SVGSVGElement, x: number, y: number) {
  fireEvent.pointerMove(svg, { clientX: x, clientY: y, pointerId: 1 });
}

function pointerUp(svg: SVGSVGElement, x: number, y: number) {
  fireEvent.pointerUp(svg, { clientX: x, clientY: y, pointerId: 1 });
}

/** Simulate a full drag sequence: down -> move(s) -> up */
function drag(
  svg: SVGSVGElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  intermediatePoints: Array<{ x: number; y: number }> = [],
) {
  pointerDown(svg, from.x, from.y);
  for (const pt of intermediatePoints) {
    pointerMove(svg, pt.x, pt.y);
  }
  pointerMove(svg, to.x, to.y);
  pointerUp(svg, to.x, to.y);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// =========================================================================
// Select and Pan tools (no-ops)
// =========================================================================

describe('Select and Pan tools (no-ops)', () => {
  it('1. Select tool: pointer events do not call onAnnotationCreated', () => {
    const props = { ...defaultProps, activeTool: 'select' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 100, y: 100 }, { x: 200, y: 200 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });

  it('2. Pan tool: pointer events do not call onAnnotationCreated', () => {
    const props = { ...defaultProps, activeTool: 'pan' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 50, y: 50 }, { x: 300, y: 300 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Highlight tool
// =========================================================================

describe('Highlight tool', () => {
  it('3. Click and drag > 5px creates highlight annotation', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 10, y: 20 }, { x: 100, y: 80 });

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
  });

  it('4. Click and drag < 5px does NOT create annotation (MIN_DRAG threshold)', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Drag only 2px in each direction (below MIN_DRAG of 5)
    drag(svg, { x: 100, y: 100 }, { x: 102, y: 103 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });

  it('5. Annotation bounds are min/max of start and end points', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Drag from bottom-right to top-left (reverse direction)
    drag(svg, { x: 200, y: 150 }, { x: 50, y: 30 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'highlight',
      1,
      expect.objectContaining({
        x: 50,
        y: 30,
        w: 150,
        h: 120,
      }),
    );
  });

  it('6. onAnnotationCreated called with opType="highlight"', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 0, y: 0 }, { x: 50, y: 50 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'highlight',
      expect.any(Number),
      expect.any(Object),
    );
  });
});

// =========================================================================
// Shape tool
// =========================================================================

describe('Shape tool', () => {
  it('7. Click and drag creates shape annotation', () => {
    const props = { ...defaultProps, activeTool: 'shape' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 10, y: 10 }, { x: 80, y: 90 });

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
  });

  it('8. onAnnotationCreated called with opType="shape"', () => {
    const props = { ...defaultProps, activeTool: 'shape' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 0, y: 0 }, { x: 60, y: 60 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'shape',
      1,
      expect.objectContaining({ x: 0, y: 0, w: 60, h: 60 }),
    );
  });
});

// =========================================================================
// Redaction tool
// =========================================================================

describe('Redaction tool', () => {
  it('9. Click and drag creates redaction annotation', () => {
    const props = { ...defaultProps, activeTool: 'redaction' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 20, y: 20 }, { x: 120, y: 70 });

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
  });

  it('10. onAnnotationCreated called with opType="redaction"', () => {
    const props = { ...defaultProps, activeTool: 'redaction' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 5, y: 5 }, { x: 100, y: 50 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'redaction',
      1,
      expect.objectContaining({ x: 5, y: 5, w: 95, h: 45 }),
    );
  });
});

// =========================================================================
// Ink tool
// =========================================================================

describe('Ink tool', () => {
  it('11. Click and drag creates ink annotation with points payload', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 10, y: 10 }, { x: 50, y: 50 }, [
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ]);

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
    const call = props.onAnnotationCreated.mock.calls[0];
    expect(call[0]).toBe('ink');
    expect(call[3]).toHaveProperty('points');
    expect(Array.isArray(call[3].points)).toBe(true);
  });

  it('12. Ink annotation includes all intermediate points', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 10, 10);
    pointerMove(svg, 20, 25);
    pointerMove(svg, 30, 35);
    pointerMove(svg, 40, 45);
    pointerUp(svg, 50, 55);

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
    const payload = props.onAnnotationCreated.mock.calls[0][3];
    const points = payload.points as Array<{ x: number; y: number }>;
    // Points: initial (10,10), moves (20,25), (30,35), (40,45), final (50,55)
    expect(points.length).toBe(5);
    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points[1]).toEqual({ x: 20, y: 25 });
    expect(points[2]).toEqual({ x: 30, y: 35 });
    expect(points[3]).toEqual({ x: 40, y: 45 });
    expect(points[4]).toEqual({ x: 50, y: 55 });
  });

  it('13. Ink annotation has bounding box around all points', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 200);
    pointerMove(svg, 50, 300);
    pointerMove(svg, 150, 100);
    pointerUp(svg, 120, 250);

    const bounds = props.onAnnotationCreated.mock.calls[0][2];
    // Points: (100,200), (50,300), (150,100), (120,250)
    // minX=50, minY=100, maxX=150, maxY=300 => w=100, h=200
    expect(bounds.x).toBe(50);
    expect(bounds.y).toBe(100);
    expect(bounds.w).toBe(100);
    expect(bounds.h).toBe(200);
  });

  it('14. onAnnotationCreated called with opType="ink"', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 0, y: 0 }, { x: 30, y: 30 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'ink',
      1,
      expect.any(Object),
      expect.objectContaining({ points: expect.any(Array) }),
    );
  });
});

// =========================================================================
// Text tool (new text)
// =========================================================================

describe('Text tool (new text)', () => {
  it('15. Click on empty area opens text input (textarea appears)', () => {
    const props = { ...defaultProps, activeTool: 'text' as const };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 100);

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
  });

  it('16. Typing and pressing Enter creates text annotation', () => {
    const props = { ...defaultProps, activeTool: 'text' as const };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 200);

    const textarea = container.querySelector('textarea')!;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea, { target: { value: 'Hello World' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'text',
      1,
      expect.objectContaining({ x: 100, y: 200, w: 150, h: 20 }),
      { text: 'Hello World' },
    );
  });

  it('17. Pressing Escape cancels text input', () => {
    const props = { ...defaultProps, activeTool: 'text' as const };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 100);

    const textarea = container.querySelector('textarea')!;
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea, { target: { value: 'discard me' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
    // Textarea should be removed after cancel
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('18. Text annotation has correct page number', () => {
    const props = { ...defaultProps, activeTool: 'text' as const, currentPage: 3 };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 50, 50);

    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'page 3 text' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'text',
      3,
      expect.any(Object),
      { text: 'page 3 text' },
    );
  });
});

// =========================================================================
// Text tool (edit existing)
// =========================================================================

describe('Text tool (edit existing)', () => {
  it('19. Click on existing text annotation opens editor with existing text', () => {
    const existingOp = makeOp({
      opId: 'text-op-1',
      opType: 'text',
      bounds: { x: 50, y: 60, w: 150, h: 20 },
      payload: { text: 'Existing text' },
    });
    const props = {
      ...defaultProps,
      activeTool: 'text' as const,
      annotations: [existingOp],
    };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce('text-op-1');

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 55, 65);

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    // TextEditor receives initialText from the existing annotation
    expect(textarea!.value).toBe('Existing text');
  });

  it('20. Editing existing text calls onAnnotationUpdated', () => {
    const existingOp = makeOp({
      opId: 'text-op-2',
      opType: 'text',
      bounds: { x: 50, y: 60, w: 150, h: 20 },
      payload: { text: 'Old text' },
    });
    const props = {
      ...defaultProps,
      activeTool: 'text' as const,
      annotations: [existingOp],
    };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce('text-op-2');

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 55, 65);

    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Updated text' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(props.onAnnotationUpdated).toHaveBeenCalledWith('text-op-2', {
      payload: { text: 'Updated text' },
    });
    // Should NOT call onAnnotationCreated for edits
    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Eraser tool
// =========================================================================

describe('Eraser tool', () => {
  it('21. Click on annotation calls onAnnotationErased with opId', () => {
    const op = makeOp({ opId: 'erase-me', opType: 'highlight' });
    const props = {
      ...defaultProps,
      activeTool: 'eraser' as const,
      annotations: [op],
    };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce('erase-me');

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 50, 30);

    expect(props.onAnnotationErased).toHaveBeenCalledWith('erase-me');
  });

  it('22. Click on empty area does nothing (hitTestAnnotation returns null)', () => {
    const props = { ...defaultProps, activeTool: 'eraser' as const };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 400, 400);

    expect(props.onAnnotationErased).not.toHaveBeenCalled();
  });

  it('23. Moving over annotation while eraser active calls hitTestAnnotation for hover tracking', () => {
    const op = makeOp({ opId: 'hover-target', opType: 'shape' });
    const props = {
      ...defaultProps,
      activeTool: 'eraser' as const,
      annotations: [op],
    };
    vi.mocked(hitTestAnnotation).mockReturnValue('hover-target');

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerMove(svg, 50, 30);
    pointerMove(svg, 60, 40);

    // hitTestAnnotation should be called on each pointer move for eraser
    expect(hitTestAnnotation).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// Zoom interactions
// =========================================================================

describe('Zoom interactions', () => {
  it('24. With zoom=2, coordinates are divided by zoom', () => {
    const props = {
      ...defaultProps,
      activeTool: 'highlight' as const,
      zoom: 2,
    };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Screen coordinates 200,100 -> 300,200
    // PDF coordinates at zoom=2: (200/2, 100/2) -> (300/2, 200/2) = (100,50) -> (150,100)
    drag(svg, { x: 200, y: 100 }, { x: 300, y: 200 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'highlight',
      1,
      expect.objectContaining({
        x: 100,
        y: 50,
        w: 50,
        h: 50,
      }),
    );
  });

  it('25. Created annotation bounds are in PDF coordinates (not screen coordinates)', () => {
    const props = {
      ...defaultProps,
      activeTool: 'shape' as const,
      zoom: 1.5,
    };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Screen coords (150, 150) -> (300, 300)
    // PDF: (150/1.5, 150/1.5) -> (300/1.5, 300/1.5) = (100, 100) -> (200, 200)
    drag(svg, { x: 150, y: 150 }, { x: 300, y: 300 });

    const bounds = props.onAnnotationCreated.mock.calls[0][2];
    expect(bounds.x).toBe(100);
    expect(bounds.y).toBe(100);
    expect(bounds.w).toBe(100);
    expect(bounds.h).toBe(100);
  });
});

// =========================================================================
// Drawing state (preview rect)
// =========================================================================

describe('Drawing state', () => {
  it('26. Preview rect appears during drag (extra rect in SVG)', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    const rectsBeforeDrag = svg.querySelectorAll('rect').length;

    pointerDown(svg, 10, 10);
    pointerMove(svg, 100, 100);

    const rectsDuringDrag = svg.querySelectorAll('rect').length;
    expect(rectsDuringDrag).toBeGreaterThan(rectsBeforeDrag);
  });

  it('27. Preview rect disappears after pointer up', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 10, 10);
    pointerMove(svg, 100, 100);

    // During drag, preview rect exists
    const rectsDuringDrag = svg.querySelectorAll('rect').length;
    expect(rectsDuringDrag).toBeGreaterThan(0);

    pointerUp(svg, 100, 100);

    // After pointer up, no annotations rendered (empty annotations array), no preview
    const rectsAfterUp = svg.querySelectorAll('rect').length;
    expect(rectsAfterUp).toBe(0);
  });
});

// =========================================================================
// Multiple annotations
// =========================================================================

describe('Multiple annotations', () => {
  it('28. Can create multiple annotations sequentially', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 10, y: 10 }, { x: 60, y: 60 });
    drag(svg, { x: 100, y: 100 }, { x: 200, y: 200 });
    drag(svg, { x: 300, y: 300 }, { x: 400, y: 400 });

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(3);
  });
});

// =========================================================================
// Page context
// =========================================================================

describe('Page context', () => {
  it('29. Annotation created with correct currentPage value', () => {
    const props = {
      ...defaultProps,
      activeTool: 'highlight' as const,
      currentPage: 5,
    };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 0, y: 0 }, { x: 50, y: 50 });

    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'highlight',
      5,
      expect.any(Object),
    );
  });
});

// =========================================================================
// Pointer capture
// =========================================================================

describe('Pointer capture', () => {
  it('30. setPointerCapture is called on pointer down for drawing tools', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 50, 50);

    // SVGElement.prototype.setPointerCapture is mocked in setup.ts
    expect(svg.setPointerCapture).toHaveBeenCalledWith(1);
  });
});

// =========================================================================
// Edge cases
// =========================================================================

describe('Edge cases', () => {
  it('31. Very small drag (1px) does not create annotation', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 100, y: 100 }, { x: 101, y: 101 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });

  it('32. Pointer up without pointer down does not create annotation', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Only fire pointer up without any prior pointer down
    pointerUp(svg, 200, 200);

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });

  it('33. Rapid click does not create duplicate annotations', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Two rapid drags in sequence
    pointerDown(svg, 10, 10);
    pointerMove(svg, 50, 50);
    pointerUp(svg, 50, 50);

    pointerDown(svg, 10, 10);
    pointerMove(svg, 50, 50);
    pointerUp(svg, 50, 50);

    // Each full drag cycle should produce exactly one annotation
    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// Cursor classes
// =========================================================================

describe('Cursor classes', () => {
  it('34. SVG has cursor-crosshair for highlight tool', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-crosshair')).toBe(true);
  });

  it('35. SVG has cursor-pointer for eraser tool', () => {
    const props = { ...defaultProps, activeTool: 'eraser' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-pointer')).toBe(true);
  });
});

// =========================================================================
// Additional cursor tests
// =========================================================================

describe('Additional cursor classes', () => {
  it('36. SVG has cursor-default for select tool', () => {
    const props = { ...defaultProps, activeTool: 'select' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-default')).toBe(true);
  });

  it('37. SVG has cursor-grab for pan tool', () => {
    const props = { ...defaultProps, activeTool: 'pan' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-grab')).toBe(true);
  });

  it('38. SVG has cursor-text for text tool', () => {
    const props = { ...defaultProps, activeTool: 'text' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-text')).toBe(true);
  });

  it('39. SVG has cursor-crosshair for shape tool', () => {
    const props = { ...defaultProps, activeTool: 'shape' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-crosshair')).toBe(true);
  });

  it('40. SVG has cursor-crosshair for ink tool', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    expect(svg.classList.contains('cursor-crosshair')).toBe(true);
  });
});

// =========================================================================
// Ink preview polyline
// =========================================================================

describe('Ink preview', () => {
  it('41. Ink preview polyline appears during drawing', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    const polylinesBefore = svg.querySelectorAll('polyline').length;

    pointerDown(svg, 10, 10);
    pointerMove(svg, 20, 20);
    pointerMove(svg, 30, 30);

    const polylinesAfter = svg.querySelectorAll('polyline').length;
    expect(polylinesAfter).toBeGreaterThan(polylinesBefore);
  });

  it('42. Ink preview polyline disappears after pointer up', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 10, 10);
    pointerMove(svg, 20, 20);
    pointerUp(svg, 30, 30);

    // No annotations prop passed, no preview after up
    const polylines = svg.querySelectorAll('polyline').length;
    expect(polylines).toBe(0);
  });
});

// =========================================================================
// Existing annotations rendering
// =========================================================================

describe('Annotation rendering', () => {
  it('43. Existing annotations on current page are rendered', () => {
    const ops = [
      makeOp({ opId: 'h1', opType: 'highlight', page: 1 }),
      makeOp({ opId: 'h2', opType: 'shape', page: 1 }),
    ];
    const props = { ...defaultProps, annotations: ops };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Each annotation renders its own <g> with shapes
    const groups = svg.querySelectorAll('g');
    expect(groups.length).toBe(2);
  });

  it('44. Annotations on different pages are NOT rendered', () => {
    const ops = [
      makeOp({ opId: 'p2-op', opType: 'highlight', page: 2 }),
    ];
    const props = { ...defaultProps, annotations: ops, currentPage: 1 };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // No <g> groups for annotations on page 2
    const groups = svg.querySelectorAll('g');
    expect(groups.length).toBe(0);
  });
});

// =========================================================================
// Eraser hover visual
// =========================================================================

describe('Eraser hover visual', () => {
  it('45. Eraser hover over annotation renders hover rect', () => {
    const op = makeOp({ opId: 'hover-op', opType: 'highlight', page: 1 });
    const props = {
      ...defaultProps,
      activeTool: 'eraser' as const,
      annotations: [op],
    };

    // First render: no hover
    const { container, rerender } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    const rectsBefore = svg.querySelectorAll('rect').length;

    // Simulate hover - hitTestAnnotation returns the opId on move
    vi.mocked(hitTestAnnotation).mockReturnValue('hover-op');
    pointerMove(svg, 50, 30);

    const rectsAfter = svg.querySelectorAll('rect').length;
    // When hovered, an extra highlight border rect is added (the hover indicator)
    expect(rectsAfter).toBeGreaterThan(rectsBefore);
  });
});

// =========================================================================
// Redaction tool with MIN_DRAG
// =========================================================================

describe('Redaction MIN_DRAG threshold', () => {
  it('46. Redaction drag < 5px does NOT create annotation', () => {
    const props = { ...defaultProps, activeTool: 'redaction' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 100, y: 100 }, { x: 103, y: 102 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Shape tool with MIN_DRAG
// =========================================================================

describe('Shape MIN_DRAG threshold', () => {
  it('47. Shape drag < 5px does NOT create annotation', () => {
    const props = { ...defaultProps, activeTool: 'shape' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    drag(svg, { x: 200, y: 200 }, { x: 203, y: 204 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Ink with zoom
// =========================================================================

describe('Ink with zoom', () => {
  it('48. Ink points are in PDF coordinates when zoom > 1', () => {
    const props = {
      ...defaultProps,
      activeTool: 'ink' as const,
      zoom: 2,
    };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 100);
    pointerMove(svg, 200, 200);
    pointerUp(svg, 300, 300);

    const payload = props.onAnnotationCreated.mock.calls[0][3];
    const points = payload.points as Array<{ x: number; y: number }>;
    // screen (100,100) / zoom 2 = PDF (50,50)
    expect(points[0]).toEqual({ x: 50, y: 50 });
    // screen (200,200) / zoom 2 = PDF (100,100)
    expect(points[1]).toEqual({ x: 100, y: 100 });
    // screen (300,300) / zoom 2 = PDF (150,150)
    expect(points[2]).toEqual({ x: 150, y: 150 });
  });
});

// =========================================================================
// Select/Pan do not call eraser
// =========================================================================

describe('Select and Pan do not erase', () => {
  it('49. Select tool pointer down does not call onAnnotationErased', () => {
    const op = makeOp({ opId: 'no-erase', opType: 'highlight' });
    const props = {
      ...defaultProps,
      activeTool: 'select' as const,
      annotations: [op],
    };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 50, 30);

    expect(props.onAnnotationErased).not.toHaveBeenCalled();
  });

  it('50. Pan tool pointer down does not call onAnnotationErased', () => {
    const op = makeOp({ opId: 'no-erase-pan', opType: 'highlight' });
    const props = {
      ...defaultProps,
      activeTool: 'pan' as const,
      annotations: [op],
    };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 50, 30);

    expect(props.onAnnotationErased).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Drag exactly at MIN_DRAG boundary
// =========================================================================

describe('MIN_DRAG boundary', () => {
  it('51. Drag exactly 5px in width creates annotation (boundary value)', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Drag exactly 5px wide, 0px tall
    drag(svg, { x: 100, y: 100 }, { x: 105, y: 100 });

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
  });

  it('52. Drag exactly 5px in height creates annotation (boundary value)', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Drag 0px wide, exactly 5px tall
    drag(svg, { x: 100, y: 100 }, { x: 100, y: 105 });

    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
  });

  it('53. Drag 4.9px does NOT create annotation (just under threshold)', () => {
    const props = { ...defaultProps, activeTool: 'highlight' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Drag 4px wide, 4px tall - both under 5
    drag(svg, { x: 100, y: 100 }, { x: 104, y: 104 });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Text tool empty submit
// =========================================================================

describe('Text tool edge cases', () => {
  it('54. Submitting empty text does not create annotation', () => {
    const props = { ...defaultProps, activeTool: 'text' as const };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 100);

    const textarea = container.querySelector('textarea')!;
    // Leave textarea empty and submit
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Empty/whitespace-only text is discarded by handleSubmit -> onCancel
    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });

  it('55. Submitting whitespace-only text does not create annotation', () => {
    const props = { ...defaultProps, activeTool: 'text' as const };
    vi.mocked(hitTestAnnotation).mockReturnValueOnce(null);

    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    pointerDown(svg, 100, 100);

    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(props.onAnnotationCreated).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Ink tool bypass MIN_DRAG
// =========================================================================

describe('Ink tool bypasses MIN_DRAG', () => {
  it('56. Ink tool creates annotation even with very small drag (no MIN_DRAG for ink)', () => {
    const props = { ...defaultProps, activeTool: 'ink' as const };
    const { container } = render(<AnnotationOverlay {...props} />);
    const svg = getSvg(container);

    // Very small drag - only 1px
    drag(svg, { x: 100, y: 100 }, { x: 101, y: 101 });

    // Ink tool does NOT check MIN_DRAG, it always creates
    expect(props.onAnnotationCreated).toHaveBeenCalledTimes(1);
    expect(props.onAnnotationCreated).toHaveBeenCalledWith(
      'ink',
      expect.any(Number),
      expect.any(Object),
      expect.objectContaining({ points: expect.any(Array) }),
    );
  });
});
