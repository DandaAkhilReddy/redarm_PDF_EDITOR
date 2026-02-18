import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { screenToPdf, boundingBox, useDrawing } from './useDrawing';
import type { AnnotationOperation, AnnotationTool } from '../types';

// ---------------------------------------------------------------------------
// Mock hitTestAnnotation — must be declared before importing the module that
// uses it because vi.mock is hoisted.
// ---------------------------------------------------------------------------
vi.mock('../lib/hitTest', () => ({
  hitTestAnnotation: vi.fn(() => null),
}));
import { hitTestAnnotation } from '../lib/hitTest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock SVGSVGElement with a configurable bounding rect. */
function makeSvg(left = 0, top = 0, width = 800, height = 600): SVGSVGElement {
  return {
    getBoundingClientRect: () => ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    }),
  } as unknown as SVGSVGElement;
}

/** Shorthand for creating a mock onAnnotationCreated callback. */
function makeOnCreated() {
  return vi.fn<
    [AnnotationOperation['opType'], number, { x: number; y: number; w: number; h: number }, (Record<string, unknown> | undefined)?]
  >();
}

/** Build a minimal AnnotationOperation for testing purposes. */
function makeAnnotation(
  overrides: Partial<AnnotationOperation> = {},
): AnnotationOperation {
  return {
    opId: 'ann-1',
    opType: 'highlight',
    page: 1,
    bounds: { x: 10, y: 10, w: 100, h: 50 },
    author: 'test',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// SECTION 1 — Pure function tests: screenToPdf & boundingBox
// ===========================================================================

describe('screenToPdf', () => {
  it('converts screen coordinates to PDF coordinates with zoom=1', () => {
    const svg = makeSvg(0, 0);
    const result = screenToPdf(100, 200, svg, 1);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('converts with zoom=2 (coordinates halved)', () => {
    const svg = makeSvg(0, 0);
    const result = screenToPdf(200, 400, svg, 2);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('converts with zoom=0.5 (coordinates doubled)', () => {
    const svg = makeSvg(0, 0);
    const result = screenToPdf(100, 200, svg, 0.5);
    expect(result).toEqual({ x: 200, y: 400 });
  });

  it('accounts for SVG left offset', () => {
    const svg = makeSvg(50, 0);
    const result = screenToPdf(150, 100, svg, 1);
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('accounts for SVG top offset', () => {
    const svg = makeSvg(0, 30);
    const result = screenToPdf(100, 130, svg, 1);
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('handles both offsets and zoom combined', () => {
    const svg = makeSvg(20, 40);
    // clientX - left = 120 - 20 = 100 => / 2 => 50
    // clientY - top  = 140 - 40 = 100 => / 2 => 50
    const result = screenToPdf(120, 140, svg, 2);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('returns 0,0 when clientX/Y equals the SVG origin with zoom=1', () => {
    const svg = makeSvg(10, 20);
    const result = screenToPdf(10, 20, svg, 1);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('handles fractional zoom levels correctly', () => {
    const svg = makeSvg(0, 0);
    const result = screenToPdf(150, 300, svg, 1.5);
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(200, 5);
  });
});

describe('boundingBox', () => {
  it('returns w=1 and h=1 for a single point (minimum dimensions)', () => {
    const result = boundingBox([{ x: 5, y: 10 }]);
    expect(result).toEqual({ x: 5, y: 10, w: 1, h: 1 });
  });

  it('computes a correct bounding box for two points', () => {
    const result = boundingBox([
      { x: 10, y: 20 },
      { x: 50, y: 80 },
    ]);
    expect(result).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it('computes a correct bounding box for multiple points', () => {
    const result = boundingBox([
      { x: 5, y: 3 },
      { x: 100, y: 200 },
      { x: 50, y: 50 },
      { x: 0, y: 150 },
    ]);
    expect(result).toEqual({ x: 0, y: 3, w: 100, h: 197 });
  });

  it('handles points in negative coordinates', () => {
    const result = boundingBox([
      { x: -10, y: -20 },
      { x: 10, y: 20 },
    ]);
    expect(result).toEqual({ x: -10, y: -20, w: 20, h: 40 });
  });

  it('returns w=1 when all points share the same X', () => {
    const result = boundingBox([
      { x: 42, y: 10 },
      { x: 42, y: 50 },
      { x: 42, y: 100 },
    ]);
    expect(result).toEqual({ x: 42, y: 10, w: 1, h: 90 });
  });

  it('returns h=1 when all points share the same Y', () => {
    const result = boundingBox([
      { x: 10, y: 7 },
      { x: 80, y: 7 },
    ]);
    expect(result).toEqual({ x: 10, y: 7, w: 70, h: 1 });
  });

  it('handles a large spread of points', () => {
    const result = boundingBox([
      { x: -1000, y: -2000 },
      { x: 3000, y: 4000 },
    ]);
    expect(result).toEqual({ x: -1000, y: -2000, w: 4000, h: 6000 });
  });
});

// ===========================================================================
// SECTION 2 — useDrawing hook tests
// ===========================================================================

describe('useDrawing', () => {
  const defaultProps = {
    activeTool: 'select' as AnnotationTool,
    zoom: 1,
    currentPage: 1,
    onAnnotationCreated: makeOnCreated(),
    annotations: [] as AnnotationOperation[],
    onAnnotationErased: vi.fn(),
  };

  function renderDrawingHook(overrides: Partial<typeof defaultProps & { onClickFeedback: ReturnType<typeof vi.fn> }> = {}) {
    const props = { ...defaultProps, onAnnotationCreated: makeOnCreated(), onAnnotationErased: vi.fn(), onClickFeedback: vi.fn(), ...overrides };
    return {
      ...renderHook(() =>
        useDrawing(
          props.activeTool,
          props.zoom,
          props.currentPage,
          props.onAnnotationCreated,
          props.annotations,
          props.onAnnotationErased,
          props.onClickFeedback,
        ),
      ),
      props,
    };
  }

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('isDrawing is false initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.isDrawing).toBe(false);
    });

    it('previewRect is null initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.previewRect).toBeNull();
    });

    it('inkPoints is empty initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.inkPoints).toEqual([]);
    });

    it('textInputPos is null initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.textInputPos).toBeNull();
    });

    it('hoveredOpId is null initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.hoveredOpId).toBeNull();
    });

    it('editingOpId is null initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.editingOpId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cursor class
  // -------------------------------------------------------------------------
  describe('cursorClass', () => {
    it('is "cursor-default" for "select"', () => {
      const { result } = renderDrawingHook({ activeTool: 'select' });
      expect(result.current.cursorClass).toBe('cursor-default');
    });

    it('is "cursor-grab" for "pan"', () => {
      const { result } = renderDrawingHook({ activeTool: 'pan' });
      expect(result.current.cursorClass).toBe('cursor-grab');
    });

    it('is "cursor-text" for "text"', () => {
      const { result } = renderDrawingHook({ activeTool: 'text' });
      expect(result.current.cursorClass).toBe('cursor-text');
    });

    it('is "cursor-pointer" for "eraser"', () => {
      const { result } = renderDrawingHook({ activeTool: 'eraser' });
      expect(result.current.cursorClass).toBe('cursor-pointer');
    });

    it('is "cursor-crosshair" for "highlight"', () => {
      const { result } = renderDrawingHook({ activeTool: 'highlight' });
      expect(result.current.cursorClass).toBe('cursor-crosshair');
    });

    it('is "cursor-crosshair" for "ink"', () => {
      const { result } = renderDrawingHook({ activeTool: 'ink' });
      expect(result.current.cursorClass).toBe('cursor-crosshair');
    });

    it('is "cursor-crosshair" for "shape"', () => {
      const { result } = renderDrawingHook({ activeTool: 'shape' });
      expect(result.current.cursorClass).toBe('cursor-crosshair');
    });

    it('is "cursor-crosshair" for "redaction"', () => {
      const { result } = renderDrawingHook({ activeTool: 'redaction' });
      expect(result.current.cursorClass).toBe('cursor-crosshair');
    });
  });

  // -------------------------------------------------------------------------
  // Handler existence & shape
  // -------------------------------------------------------------------------
  describe('handlers and return shape', () => {
    it('handlers object has onPointerDown, onPointerMove, and onPointerUp functions', () => {
      const { result } = renderDrawingHook();
      expect(typeof result.current.handlers.onPointerDown).toBe('function');
      expect(typeof result.current.handlers.onPointerMove).toBe('function');
      expect(typeof result.current.handlers.onPointerUp).toBe('function');
    });

    it('svgRef is a ref object with current property', () => {
      const { result } = renderDrawingHook();
      expect(result.current.svgRef).toHaveProperty('current');
    });

    it('svgRef.current is null before mount (no DOM)', () => {
      const { result } = renderDrawingHook();
      expect(result.current.svgRef.current).toBeNull();
    });

    it('returns all expected properties', () => {
      const { result } = renderDrawingHook();
      const keys = Object.keys(result.current);
      expect(keys).toContain('svgRef');
      expect(keys).toContain('isDrawing');
      expect(keys).toContain('previewRect');
      expect(keys).toContain('inkPoints');
      expect(keys).toContain('textInputPos');
      expect(keys).toContain('hoveredOpId');
      expect(keys).toContain('editingOpId');
      expect(keys).toContain('setEditingOpId');
      expect(keys).toContain('handlers');
      expect(keys).toContain('submitText');
      expect(keys).toContain('cancelText');
      expect(keys).toContain('cursorClass');
    });

    it('setEditingOpId is a function', () => {
      const { result } = renderDrawingHook();
      expect(typeof result.current.setEditingOpId).toBe('function');
    });

    it('submitText is a function', () => {
      const { result } = renderDrawingHook();
      expect(typeof result.current.submitText).toBe('function');
    });

    it('cancelText is a function', () => {
      const { result } = renderDrawingHook();
      expect(typeof result.current.cancelText).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // submitText / cancelText
  // -------------------------------------------------------------------------
  describe('submitText', () => {
    it('does NOT call onAnnotationCreated when textInputPos is null', () => {
      const { result, props } = renderDrawingHook();
      // textInputPos starts as null
      act(() => {
        result.current.submitText('Hello');
      });
      expect(props.onAnnotationCreated).not.toHaveBeenCalled();
    });

    it('does NOT call onAnnotationCreated with empty string even if textInputPos were set', () => {
      const { result, props } = renderDrawingHook();
      act(() => {
        result.current.submitText('');
      });
      expect(props.onAnnotationCreated).not.toHaveBeenCalled();
    });

    it('does NOT call onAnnotationCreated with whitespace-only string', () => {
      const { result, props } = renderDrawingHook();
      act(() => {
        result.current.submitText('   ');
      });
      expect(props.onAnnotationCreated).not.toHaveBeenCalled();
    });
  });

  describe('cancelText', () => {
    it('keeps textInputPos as null when already null', () => {
      const { result } = renderDrawingHook();
      act(() => {
        result.current.cancelText();
      });
      expect(result.current.textInputPos).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Tool changes via rerender
  // -------------------------------------------------------------------------
  describe('tool change re-renders', () => {
    it('changing activeTool from "select" to "highlight" updates cursorClass', () => {
      let tool: AnnotationTool = 'select';
      const onCreated = makeOnCreated();
      const { result, rerender } = renderHook(() =>
        useDrawing(tool, 1, 1, onCreated),
      );
      expect(result.current.cursorClass).toBe('cursor-default');

      tool = 'highlight';
      rerender();
      expect(result.current.cursorClass).toBe('cursor-crosshair');
    });

    it('changing activeTool to "eraser" updates cursorClass to "cursor-pointer"', () => {
      let tool: AnnotationTool = 'select';
      const onCreated = makeOnCreated();
      const { result, rerender } = renderHook(() =>
        useDrawing(tool, 1, 1, onCreated),
      );

      tool = 'eraser';
      rerender();
      expect(result.current.cursorClass).toBe('cursor-pointer');
    });

    it('changing activeTool to "pan" updates cursorClass to "cursor-grab"', () => {
      let tool: AnnotationTool = 'highlight';
      const onCreated = makeOnCreated();
      const { result, rerender } = renderHook(() =>
        useDrawing(tool, 1, 1, onCreated),
      );
      expect(result.current.cursorClass).toBe('cursor-crosshair');

      tool = 'pan';
      rerender();
      expect(result.current.cursorClass).toBe('cursor-grab');
    });
  });

  // -------------------------------------------------------------------------
  // Default parameters
  // -------------------------------------------------------------------------
  describe('default parameters', () => {
    it('works with the default empty annotations array', () => {
      const onCreated = makeOnCreated();
      const { result } = renderHook(() =>
        useDrawing('select', 1, 1, onCreated),
      );
      // Should not throw; annotations defaults to []
      expect(result.current.isDrawing).toBe(false);
    });

    it('works without onAnnotationErased callback', () => {
      const onCreated = makeOnCreated();
      const { result } = renderHook(() =>
        useDrawing('select', 1, 1, onCreated, []),
      );
      expect(result.current.isDrawing).toBe(false);
    });

    it('onAnnotationCreated mock is not called on initial render', () => {
      const onCreated = makeOnCreated();
      renderHook(() =>
        useDrawing('highlight', 1, 1, onCreated),
      );
      expect(onCreated).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setEditingOpId direct usage
  // -------------------------------------------------------------------------
  describe('setEditingOpId', () => {
    it('can set editingOpId to a string value', () => {
      const { result } = renderDrawingHook();
      expect(result.current.editingOpId).toBeNull();

      act(() => {
        result.current.setEditingOpId('op-42');
      });

      expect(result.current.editingOpId).toBe('op-42');
    });

    it('can reset editingOpId back to null', () => {
      const { result } = renderDrawingHook();

      act(() => {
        result.current.setEditingOpId('op-42');
      });
      expect(result.current.editingOpId).toBe('op-42');

      act(() => {
        result.current.setEditingOpId(null);
      });
      expect(result.current.editingOpId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Stability — identity & referential checks
  // -------------------------------------------------------------------------
  describe('stability across re-renders', () => {
    it('handlers object functions are stable across re-renders with same props', () => {
      const onCreated = makeOnCreated();
      const annotations: AnnotationOperation[] = [];
      const onErased = vi.fn();
      const { result, rerender } = renderHook(() =>
        useDrawing('select', 1, 1, onCreated, annotations, onErased),
      );

      const firstDown = result.current.handlers.onPointerDown;
      const firstMove = result.current.handlers.onPointerMove;
      const firstUp = result.current.handlers.onPointerUp;

      rerender();

      // useCallback should preserve identity when dependencies do not change
      expect(result.current.handlers.onPointerDown).toBe(firstDown);
      expect(result.current.handlers.onPointerMove).toBe(firstMove);
      expect(result.current.handlers.onPointerUp).toBe(firstUp);
    });

    it('cursorClass string value does not change if activeTool stays the same', () => {
      const onCreated = makeOnCreated();
      const { result, rerender } = renderHook(() =>
        useDrawing('ink', 1, 1, onCreated),
      );
      expect(result.current.cursorClass).toBe('cursor-crosshair');

      rerender();
      expect(result.current.cursorClass).toBe('cursor-crosshair');
    });
  });

  // -------------------------------------------------------------------------
  // Click ripple state
  // -------------------------------------------------------------------------
  describe('clickRipple', () => {
    it('clickRipple is null initially', () => {
      const { result } = renderDrawingHook();
      expect(result.current.clickRipple).toBeNull();
    });

    it('clickRipple is returned from hook', () => {
      const { result } = renderDrawingHook();
      expect(result.current).toHaveProperty('clickRipple');
    });
  });

  // -------------------------------------------------------------------------
  // Return shape includes new properties
  // -------------------------------------------------------------------------
  describe('return shape includes new properties', () => {
    it('returns clickRipple in the expected properties', () => {
      const { result } = renderDrawingHook();
      const keys = Object.keys(result.current);
      expect(keys).toContain('clickRipple');
    });
  });
});
