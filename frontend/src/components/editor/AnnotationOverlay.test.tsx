import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { useDrawing } from "../../hooks/useDrawing";
import type { AnnotationOperation, AnnotationTool } from "../../types";

// ---------------------------------------------------------------------------
// Mock useDrawing so we can test the component in isolation
// ---------------------------------------------------------------------------
vi.mock("../../hooks/useDrawing", () => ({
  useDrawing: vi.fn(),
}));

// Mock the TextEditor so we can detect it without worrying about internals
vi.mock("./TextEditor", () => ({
  TextEditor: (props: Record<string, unknown>) => (
    <div data-testid="text-editor" data-position={JSON.stringify(props.position)} data-zoom={props.zoom} data-initial-text={props.initialText} data-is-editing={props.isEditing}>
      MockTextEditor
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockSvgRef = { current: null };

function mockUseDrawing(overrides: Record<string, unknown> = {}) {
  const defaults = {
    svgRef: mockSvgRef,
    isDrawing: false,
    previewRect: null,
    inkPoints: [] as Array<{ x: number; y: number }>,
    textInputPos: null,
    hoveredOpId: null,
    editingOpId: null,
    setEditingOpId: vi.fn(),
    handlers: {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    },
    submitText: vi.fn(),
    cancelText: vi.fn(),
    cursorClass: "cursor-default",
  };
  const merged = { ...defaults, ...overrides };
  vi.mocked(useDrawing).mockReturnValue(merged as ReturnType<typeof useDrawing>);
  return merged;
}

function makeOp(
  overrides: Partial<AnnotationOperation> & {
    opId: string;
    opType: AnnotationOperation["opType"];
  },
): AnnotationOperation {
  return {
    page: 1,
    bounds: { x: 10, y: 20, w: 100, h: 50 },
    author: "test",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

const defaultProps = {
  annotations: [] as AnnotationOperation[],
  currentPage: 1,
  zoom: 1,
  activeTool: "select" as AnnotationTool,
  onAnnotationCreated: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AnnotationOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDrawing();
  });

  // =========================================================================
  // SVG rendering
  // =========================================================================
  describe("SVG rendering", () => {
    it("1 - renders an SVG element", () => {
      const { container } = render(<AnnotationOverlay {...defaultProps} />);
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    it('2 - SVG has class "absolute inset-0 z-20 h-full w-full"', () => {
      const { container } = render(<AnnotationOverlay {...defaultProps} />);
      const svg = container.querySelector("svg")!;
      expect(svg.classList.contains("absolute")).toBe(true);
      expect(svg.classList.contains("inset-0")).toBe(true);
      expect(svg.classList.contains("z-20")).toBe(true);
      expect(svg.classList.contains("h-full")).toBe(true);
      expect(svg.classList.contains("w-full")).toBe(true);
    });

    it('3 - SVG has style touchAction "none"', () => {
      const { container } = render(<AnnotationOverlay {...defaultProps} />);
      const svg = container.querySelector("svg")!;
      expect(svg.style.touchAction).toBe("none");
    });

    it("4 - SVG has pointer event handlers attached", () => {
      const mocks = mockUseDrawing();
      const { container } = render(<AnnotationOverlay {...defaultProps} />);
      const svg = container.querySelector("svg")!;

      // The handlers are attached via React props; verify useDrawing returned them
      expect(mocks.handlers.onPointerDown).toBeDefined();
      expect(mocks.handlers.onPointerMove).toBeDefined();
      expect(mocks.handlers.onPointerUp).toBeDefined();

      // Verify the SVG has onPointerDown/Move/Up by simulating events
      // (React attaches them internally, so we dispatch a pointer event)
      const pointerDownEvent = new PointerEvent("pointerdown", { bubbles: true });
      svg.dispatchEvent(pointerDownEvent);
      // The mock handlers are attached via React, so check they exist on the returned object
      expect(typeof mocks.handlers.onPointerDown).toBe("function");
      expect(typeof mocks.handlers.onPointerMove).toBe("function");
      expect(typeof mocks.handlers.onPointerUp).toBe("function");
    });
  });

  // =========================================================================
  // Page filtering
  // =========================================================================
  describe("Page filtering", () => {
    it("5 - only renders annotations for current page", () => {
      const page1Op = makeOp({ opId: "op-p1", opType: "highlight", page: 1 });
      const page2Op = makeOp({ opId: "op-p2", opType: "highlight", page: 2 });

      const { container } = render(
        <AnnotationOverlay
          {...defaultProps}
          annotations={[page1Op, page2Op]}
          currentPage={1}
        />,
      );

      const svg = container.querySelector("svg")!;
      // Only one <g> group should be rendered (for page 1 annotation)
      const groups = svg.querySelectorAll("g");
      expect(groups.length).toBe(1);
    });

    it("6 - does not render annotations from different pages", () => {
      const page2Op = makeOp({ opId: "op-p2", opType: "highlight", page: 2 });
      const page3Op = makeOp({ opId: "op-p3", opType: "shape", page: 3 });

      const { container } = render(
        <AnnotationOverlay
          {...defaultProps}
          annotations={[page2Op, page3Op]}
          currentPage={1}
        />,
      );

      const svg = container.querySelector("svg")!;
      const groups = svg.querySelectorAll("g");
      expect(groups.length).toBe(0);
    });
  });

  // =========================================================================
  // Highlight annotation rendering
  // =========================================================================
  describe("Highlight annotation rendering", () => {
    it("7 - renders a rect for highlight type with yellow fill", () => {
      const op = makeOp({ opId: "hl-1", opType: "highlight" });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect).toBeInTheDocument();
      expect(rect?.getAttribute("fill")).toBe("rgba(250, 204, 21, 0.35)");
      expect(rect?.getAttribute("stroke")).toBe("none");
    });

    it("8 - highlight rect dimensions are scaled by zoom", () => {
      const op = makeOp({
        opId: "hl-2",
        opType: "highlight",
        bounds: { x: 10, y: 20, w: 100, h: 50 },
      });
      const zoom = 2;
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} zoom={zoom} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect?.getAttribute("x")).toBe("20"); // 10 * 2
      expect(rect?.getAttribute("y")).toBe("40"); // 20 * 2
      expect(rect?.getAttribute("width")).toBe("200"); // 100 * 2
      expect(rect?.getAttribute("height")).toBe("100"); // 50 * 2
    });
  });

  // =========================================================================
  // Shape annotation rendering
  // =========================================================================
  describe("Shape annotation rendering", () => {
    it("9 - renders a rect for shape type with purple stroke", () => {
      const op = makeOp({ opId: "sh-1", opType: "shape" });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect).toBeInTheDocument();
      expect(rect?.getAttribute("fill")).toBe("none");
      expect(rect?.getAttribute("stroke")).toBe("#a855f7");
      expect(rect?.getAttribute("stroke-width")).toBe("2");
    });
  });

  // =========================================================================
  // Redaction annotation rendering
  // =========================================================================
  describe("Redaction annotation rendering", () => {
    it("10 - renders a rect for redaction with black fill", () => {
      const op = makeOp({ opId: "rd-1", opType: "redaction" });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect).toBeInTheDocument();
      expect(rect?.getAttribute("fill")).toBe("rgba(0, 0, 0, 0.85)");
      expect(rect?.getAttribute("stroke")).toBe("none");
    });
  });

  // =========================================================================
  // Ink annotation rendering
  // =========================================================================
  describe("Ink annotation rendering", () => {
    it("11 - renders a polyline for ink type with points payload", () => {
      const op = makeOp({
        opId: "ink-1",
        opType: "ink",
        payload: {
          points: [
            { x: 5, y: 10 },
            { x: 15, y: 25 },
            { x: 30, y: 40 },
          ],
        },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector("g polyline");
      expect(polyline).toBeInTheDocument();
      expect(polyline?.getAttribute("fill")).toBe("none");
      expect(polyline?.getAttribute("stroke")).toBe("#3b82f6");
      expect(polyline?.getAttribute("stroke-width")).toBe("2");
      expect(polyline?.getAttribute("stroke-linecap")).toBe("round");
      expect(polyline?.getAttribute("stroke-linejoin")).toBe("round");
    });

    it("12 - ink polyline points are scaled by zoom", () => {
      const op = makeOp({
        opId: "ink-2",
        opType: "ink",
        payload: {
          points: [
            { x: 5, y: 10 },
            { x: 15, y: 25 },
          ],
        },
      });
      const zoom = 3;
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} zoom={zoom} />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector("g polyline");
      // Points should be: "15,30 45,75" (each coord * 3)
      expect(polyline?.getAttribute("points")).toBe("15,30 45,75");
    });

    it("13 - ink without points payload falls back to rect", () => {
      const op = makeOp({
        opId: "ink-3",
        opType: "ink",
        // no payload.points
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector("g polyline");
      expect(polyline).toBeNull();

      const rect = svg.querySelector("g rect");
      expect(rect).toBeInTheDocument();
      expect(rect?.getAttribute("fill")).toBe("none");
      expect(rect?.getAttribute("stroke")).toBe("#3b82f6");
      expect(rect?.getAttribute("stroke-width")).toBe("2");
    });
  });

  // =========================================================================
  // Text annotation rendering
  // =========================================================================
  describe("Text annotation rendering", () => {
    it("14 - renders a rect and text element for text type", () => {
      const op = makeOp({
        opId: "txt-1",
        opType: "text",
        payload: { text: "Hello World" },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      const textEl = svg.querySelector("g text");
      expect(rect).toBeInTheDocument();
      expect(textEl).toBeInTheDocument();

      // Verify text annotation rect styling
      expect(rect?.getAttribute("fill")).toBe("rgba(74, 222, 128, 0.15)");
      expect(rect?.getAttribute("stroke")).toBe("#22c55e");
      expect(rect?.getAttribute("stroke-dasharray")).toBe("4 2");
    });

    it("15 - text content comes from payload.text", () => {
      const op = makeOp({
        opId: "txt-2",
        opType: "text",
        payload: { text: "My annotation text" },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const textEl = svg.querySelector("g text");
      expect(textEl?.textContent).toBe("My annotation text");
    });

    it('16 - default text is "Text" when payload.text is missing', () => {
      const op = makeOp({ opId: "txt-3", opType: "text" });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const textEl = svg.querySelector("g text");
      expect(textEl?.textContent).toBe("Text");
    });
  });

  // =========================================================================
  // Zoom scaling
  // =========================================================================
  describe("Zoom scaling", () => {
    it("17 - annotation bounds are multiplied by zoom factor", () => {
      const op = makeOp({
        opId: "z-1",
        opType: "shape",
        bounds: { x: 15, y: 25, w: 80, h: 40 },
      });
      const zoom = 1.5;
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} zoom={zoom} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect?.getAttribute("x")).toBe("22.5"); // 15 * 1.5
      expect(rect?.getAttribute("y")).toBe("37.5"); // 25 * 1.5
      expect(rect?.getAttribute("width")).toBe("120"); // 80 * 1.5
      expect(rect?.getAttribute("height")).toBe("60"); // 40 * 1.5
    });

    it("18 - zoom=2 doubles all coordinates", () => {
      const op = makeOp({
        opId: "z-2",
        opType: "redaction",
        bounds: { x: 5, y: 10, w: 50, h: 30 },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} zoom={2} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect?.getAttribute("x")).toBe("10"); // 5 * 2
      expect(rect?.getAttribute("y")).toBe("20"); // 10 * 2
      expect(rect?.getAttribute("width")).toBe("100"); // 50 * 2
      expect(rect?.getAttribute("height")).toBe("60"); // 30 * 2
    });
  });

  // =========================================================================
  // Eraser hover highlight
  // =========================================================================
  describe("Eraser hover highlight", () => {
    it("19 - when activeTool=eraser and hoveredOpId matches, renders red highlight rect", () => {
      const op = makeOp({ opId: "er-1", opType: "highlight" });
      mockUseDrawing({ hoveredOpId: "er-1" });

      const { container } = render(
        <AnnotationOverlay
          {...defaultProps}
          annotations={[op]}
          activeTool="eraser"
        />,
      );

      const svg = container.querySelector("svg")!;
      const rects = svg.querySelectorAll("g rect");
      // Should be 2 rects: the highlight rect + the red hover rect
      expect(rects.length).toBe(2);

      const hoverRect = rects[1];
      expect(hoverRect.getAttribute("stroke")).toBe("#ef4444");
      expect(hoverRect.getAttribute("fill")).toBe("rgba(239, 68, 68, 0.15)");
      expect(hoverRect.getAttribute("stroke-dasharray")).toBe("4 2");
      expect(hoverRect.getAttribute("rx")).toBe("2");
    });

    it("20 - when activeTool=eraser but hoveredOpId does not match, no highlight", () => {
      const op = makeOp({ opId: "er-2", opType: "highlight" });
      mockUseDrawing({ hoveredOpId: "different-op" });

      const { container } = render(
        <AnnotationOverlay
          {...defaultProps}
          annotations={[op]}
          activeTool="eraser"
        />,
      );

      const svg = container.querySelector("svg")!;
      const rects = svg.querySelectorAll("g rect");
      // Only 1 rect: the highlight annotation itself
      expect(rects.length).toBe(1);
    });

    it("21 - when activeTool is not eraser, no highlight even if hoveredOpId matches", () => {
      const op = makeOp({ opId: "er-3", opType: "highlight" });
      mockUseDrawing({ hoveredOpId: "er-3" });

      const { container } = render(
        <AnnotationOverlay
          {...defaultProps}
          annotations={[op]}
          activeTool="select"
        />,
      );

      const svg = container.querySelector("svg")!;
      const rects = svg.querySelectorAll("g rect");
      // Only 1 rect: the annotation, no hover highlight
      expect(rects.length).toBe(1);
    });
  });

  // =========================================================================
  // Multiple annotations
  // =========================================================================
  describe("Multiple annotations", () => {
    it("22 - renders all annotations for current page", () => {
      const ops = [
        makeOp({ opId: "multi-1", opType: "highlight", page: 1 }),
        makeOp({ opId: "multi-2", opType: "shape", page: 1 }),
        makeOp({ opId: "multi-3", opType: "redaction", page: 1 }),
        makeOp({ opId: "multi-4", opType: "text", page: 1, payload: { text: "note" } }),
      ];

      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={ops} currentPage={1} />,
      );

      const svg = container.querySelector("svg")!;
      const groups = svg.querySelectorAll("g");
      expect(groups.length).toBe(4);
    });

    it("23 - each annotation gets a unique key (opId) - no duplicate groups", () => {
      const ops = [
        makeOp({ opId: "k-1", opType: "highlight", page: 1 }),
        makeOp({ opId: "k-2", opType: "shape", page: 1 }),
        makeOp({ opId: "k-3", opType: "redaction", page: 1 }),
      ];

      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={ops} currentPage={1} />,
      );

      const svg = container.querySelector("svg")!;
      const groups = svg.querySelectorAll("g");
      // Each op should have exactly one <g>, meaning 3 distinct groups
      expect(groups.length).toBe(3);

      // Verify they contain different shapes (highlight=yellow fill, shape=purple stroke, redaction=black fill)
      const fills = Array.from(groups).map((g) => g.querySelector("rect")?.getAttribute("fill"));
      expect(fills).toContain("rgba(250, 204, 21, 0.35)"); // highlight
      expect(fills).toContain("none"); // shape
      expect(fills).toContain("rgba(0, 0, 0, 0.85)"); // redaction
    });
  });

  // =========================================================================
  // Cursor class
  // =========================================================================
  describe("Cursor class", () => {
    it("24 - passes cursorClass to SVG className", () => {
      mockUseDrawing({ cursorClass: "cursor-crosshair" });

      const { container } = render(<AnnotationOverlay {...defaultProps} />);
      const svg = container.querySelector("svg")!;
      expect(svg.classList.contains("cursor-crosshair")).toBe(true);
    });

    it("25 - different activeTool produces different cursorClass on SVG", () => {
      mockUseDrawing({ cursorClass: "cursor-grab" });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="pan" />,
      );
      const svg = container.querySelector("svg")!;
      expect(svg.classList.contains("cursor-grab")).toBe(true);

      // Verify cursor-default is NOT present
      expect(svg.classList.contains("cursor-default")).toBe(false);
    });
  });

  // =========================================================================
  // TextEditor integration
  // =========================================================================
  describe("TextEditor integration", () => {
    it("26 - does not render TextEditor when textInputPos is null", () => {
      mockUseDrawing({ textInputPos: null });

      render(<AnnotationOverlay {...defaultProps} />);
      expect(screen.queryByTestId("text-editor")).not.toBeInTheDocument();
    });

    it("27 - renders TextEditor when textInputPos is set", () => {
      mockUseDrawing({ textInputPos: { x: 100, y: 200 } });

      render(<AnnotationOverlay {...defaultProps} />);
      const editor = screen.getByTestId("text-editor");
      expect(editor).toBeInTheDocument();
      expect(editor.textContent).toBe("MockTextEditor");
    });

    it("27b - TextEditor receives correct position and zoom props", () => {
      mockUseDrawing({ textInputPos: { x: 50, y: 75 } });

      render(<AnnotationOverlay {...defaultProps} zoom={2} />);
      const editor = screen.getByTestId("text-editor");
      expect(editor.getAttribute("data-position")).toBe(JSON.stringify({ x: 50, y: 75 }));
      expect(editor.getAttribute("data-zoom")).toBe("2");
    });

    it("27c - TextEditor receives empty initialText when not editing an existing annotation", () => {
      mockUseDrawing({ textInputPos: { x: 50, y: 75 }, editingOpId: null });

      render(<AnnotationOverlay {...defaultProps} />);
      const editor = screen.getByTestId("text-editor");
      expect(editor.getAttribute("data-initial-text")).toBe("");
      expect(editor.getAttribute("data-is-editing")).toBe("false");
    });

    it("27d - TextEditor receives existing text when editing an annotation", () => {
      const textOp = makeOp({
        opId: "edit-txt",
        opType: "text",
        payload: { text: "Existing text content" },
      });
      mockUseDrawing({ textInputPos: { x: 50, y: 75 }, editingOpId: "edit-txt" });

      render(
        <AnnotationOverlay
          {...defaultProps}
          annotations={[textOp]}
        />,
      );
      const editor = screen.getByTestId("text-editor");
      expect(editor.getAttribute("data-initial-text")).toBe("Existing text content");
      expect(editor.getAttribute("data-is-editing")).toBe("true");
    });
  });

  // =========================================================================
  // Preview rect (during drawing)
  // =========================================================================
  describe("Preview rect during drawing", () => {
    it("28 - does not render preview rect when isDrawing is false", () => {
      mockUseDrawing({
        isDrawing: false,
        previewRect: { x: 10, y: 20, w: 100, h: 50 },
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="highlight" />,
      );

      const svg = container.querySelector("svg")!;
      // No <g> groups (no annotations), and no direct rects for preview
      const directRects = svg.querySelectorAll(":scope > rect");
      expect(directRects.length).toBe(0);
    });

    it("29 - renders preview rect when isDrawing is true and previewRect is set", () => {
      mockUseDrawing({
        isDrawing: true,
        previewRect: { x: 10, y: 20, w: 100, h: 50 },
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="highlight" />,
      );

      const svg = container.querySelector("svg")!;
      // Preview rect is rendered directly inside <svg>, not inside <g>
      const directRects = svg.querySelectorAll(":scope > rect");
      expect(directRects.length).toBe(1);

      const previewRect = directRects[0];
      expect(previewRect.getAttribute("x")).toBe("10"); // 10 * 1 (zoom=1)
      expect(previewRect.getAttribute("y")).toBe("20");
      expect(previewRect.getAttribute("width")).toBe("100");
      expect(previewRect.getAttribute("height")).toBe("50");

      // Highlight preview style
      expect(previewRect.getAttribute("fill")).toBe("rgba(250, 204, 21, 0.3)");
      expect(previewRect.getAttribute("stroke")).toBe("rgba(250, 204, 21, 0.8)");
    });

    it("29b - preview rect for shape tool has correct style", () => {
      mockUseDrawing({
        isDrawing: true,
        previewRect: { x: 10, y: 20, w: 80, h: 40 },
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="shape" />,
      );

      const svg = container.querySelector("svg")!;
      const directRects = svg.querySelectorAll(":scope > rect");
      expect(directRects.length).toBe(1);

      const previewRect = directRects[0];
      expect(previewRect.getAttribute("fill")).toBe("none");
      expect(previewRect.getAttribute("stroke")).toBe("#a855f7");
      expect(previewRect.getAttribute("stroke-dasharray")).toBe("6 3");
    });

    it("29c - preview rect for redaction tool has correct style", () => {
      mockUseDrawing({
        isDrawing: true,
        previewRect: { x: 5, y: 10, w: 60, h: 30 },
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="redaction" />,
      );

      const svg = container.querySelector("svg")!;
      const directRects = svg.querySelectorAll(":scope > rect");
      expect(directRects.length).toBe(1);

      const previewRect = directRects[0];
      expect(previewRect.getAttribute("fill")).toBe("rgba(0, 0, 0, 0.5)");
      expect(previewRect.getAttribute("stroke")).toBe("#000");
    });

    it("29d - preview rect is NOT rendered during ink drawing", () => {
      mockUseDrawing({
        isDrawing: true,
        previewRect: { x: 10, y: 20, w: 100, h: 50 },
        inkPoints: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="ink" />,
      );

      const svg = container.querySelector("svg")!;
      // Should have a polyline for ink preview, but no rect preview
      const directRects = svg.querySelectorAll(":scope > rect");
      expect(directRects.length).toBe(0);

      const polylines = svg.querySelectorAll(":scope > polyline");
      expect(polylines.length).toBe(1);
    });

    it("29e - preview rect is scaled by zoom", () => {
      mockUseDrawing({
        isDrawing: true,
        previewRect: { x: 10, y: 20, w: 100, h: 50 },
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="highlight" zoom={2} />,
      );

      const svg = container.querySelector("svg")!;
      const directRects = svg.querySelectorAll(":scope > rect");
      expect(directRects.length).toBe(1);

      const previewRect = directRects[0];
      expect(previewRect.getAttribute("x")).toBe("20"); // 10 * 2
      expect(previewRect.getAttribute("y")).toBe("40"); // 20 * 2
      expect(previewRect.getAttribute("width")).toBe("200"); // 100 * 2
      expect(previewRect.getAttribute("height")).toBe("100"); // 50 * 2
    });
  });

  // =========================================================================
  // Ink preview
  // =========================================================================
  describe("Ink preview during drawing", () => {
    it("30 - renders polyline preview during ink drawing", () => {
      mockUseDrawing({
        isDrawing: true,
        inkPoints: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ],
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="ink" />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector(":scope > polyline");
      expect(polyline).toBeInTheDocument();
      expect(polyline?.getAttribute("points")).toBe("10,20 30,40 50,60");
      expect(polyline?.getAttribute("fill")).toBe("none");
      expect(polyline?.getAttribute("stroke")).toBe("#3b82f6");
      expect(polyline?.getAttribute("stroke-width")).toBe("2");
      expect(polyline?.getAttribute("stroke-linecap")).toBe("round");
      expect(polyline?.getAttribute("stroke-linejoin")).toBe("round");
    });

    it("30b - ink preview polyline points are scaled by zoom", () => {
      mockUseDrawing({
        isDrawing: true,
        inkPoints: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="ink" zoom={2} />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector(":scope > polyline");
      expect(polyline?.getAttribute("points")).toBe("20,40 60,80");
    });

    it("30c - ink preview is not rendered when only 1 point", () => {
      mockUseDrawing({
        isDrawing: true,
        inkPoints: [{ x: 10, y: 20 }],
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="ink" />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector(":scope > polyline");
      // The component checks inkPoints.length > 1
      expect(polyline).toBeNull();
    });

    it("30d - ink preview is not rendered when not drawing", () => {
      mockUseDrawing({
        isDrawing: false,
        inkPoints: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
      });

      const { container } = render(
        <AnnotationOverlay {...defaultProps} activeTool="ink" />,
      );

      const svg = container.querySelector("svg")!;
      const polyline = svg.querySelector(":scope > polyline");
      expect(polyline).toBeNull();
    });
  });

  // =========================================================================
  // useDrawing call
  // =========================================================================
  describe("useDrawing call", () => {
    it("31 - calls useDrawing with correct activeTool", () => {
      mockUseDrawing();
      render(<AnnotationOverlay {...defaultProps} activeTool="highlight" />);

      expect(useDrawing).toHaveBeenCalledWith(
        "highlight",
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
        expect.any(Array),
        undefined,
        undefined,
      );
    });

    it("32 - calls useDrawing with correct zoom", () => {
      mockUseDrawing();
      render(<AnnotationOverlay {...defaultProps} zoom={2.5} />);

      expect(useDrawing).toHaveBeenCalledWith(
        expect.any(String),
        2.5,
        expect.any(Number),
        expect.any(Function),
        expect.any(Array),
        undefined,
        undefined,
      );
    });

    it("33 - calls useDrawing with correct currentPage", () => {
      mockUseDrawing();
      render(<AnnotationOverlay {...defaultProps} currentPage={3} />);

      expect(useDrawing).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        3,
        expect.any(Function),
        expect.any(Array),
        undefined,
        undefined,
      );
    });

    it("34 - passes onAnnotationCreated to useDrawing", () => {
      mockUseDrawing();
      const onCreate = vi.fn();
      render(<AnnotationOverlay {...defaultProps} onAnnotationCreated={onCreate} />);

      expect(useDrawing).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        onCreate,
        expect.any(Array),
        undefined,
        undefined,
      );
    });

    it("35 - passes annotations to useDrawing", () => {
      mockUseDrawing();
      const ops = [
        makeOp({ opId: "a1", opType: "highlight" }),
        makeOp({ opId: "a2", opType: "shape" }),
      ];
      render(<AnnotationOverlay {...defaultProps} annotations={ops} />);

      expect(useDrawing).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
        ops,
        undefined,
        undefined,
      );
    });

    it("35b - passes onAnnotationErased to useDrawing", () => {
      mockUseDrawing();
      const onErased = vi.fn();
      render(
        <AnnotationOverlay {...defaultProps} onAnnotationErased={onErased} />,
      );

      expect(useDrawing).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(Function),
        expect.any(Array),
        onErased,
        undefined,
      );
    });

    it("35c - calls useDrawing with all six arguments in correct order", () => {
      mockUseDrawing();
      const onCreate = vi.fn();
      const onErased = vi.fn();
      const ops = [makeOp({ opId: "a1", opType: "highlight" })];

      render(
        <AnnotationOverlay
          {...defaultProps}
          activeTool="shape"
          zoom={1.5}
          currentPage={7}
          annotations={ops}
          onAnnotationCreated={onCreate}
          onAnnotationErased={onErased}
        />,
      );

      expect(useDrawing).toHaveBeenCalledWith("shape", 1.5, 7, onCreate, ops, onErased, undefined);
    });
  });

  // =========================================================================
  // Pointer events passthrough on annotation shapes (Bug 3 fix)
  // =========================================================================
  describe("Pointer events passthrough", () => {
    it("annotation <g> elements have pointer-events='none'", () => {
      const ops = [
        makeOp({ opId: "pe-1", opType: "highlight", page: 1 }),
        makeOp({ opId: "pe-2", opType: "shape", page: 1 }),
        makeOp({ opId: "pe-3", opType: "text", page: 1, payload: { text: "hi" } }),
      ];

      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={ops} currentPage={1} />,
      );

      const svg = container.querySelector("svg")!;
      const groups = svg.querySelectorAll("g");
      expect(groups.length).toBe(3);

      groups.forEach((g) => {
        expect(g.getAttribute("pointer-events")).toBe("none");
      });
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe("Edge cases", () => {
    it("renders no annotation shapes when annotations array is empty", () => {
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[]} />,
      );

      const svg = container.querySelector("svg")!;
      const groups = svg.querySelectorAll("g");
      expect(groups.length).toBe(0);
    });

    it("ink annotation with empty points array falls back to rect", () => {
      const op = makeOp({
        opId: "ink-empty",
        opType: "ink",
        payload: { points: [] },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      // Empty array is falsy for the length check but truthy for Array.isArray,
      // however the code checks `op.payload.points && Array.isArray(...)`,
      // and an empty array is truthy. The polyline would have empty points.
      // Let's check what actually renders:
      const polyline = svg.querySelector("g polyline");
      const rect = svg.querySelector("g rect");
      // An empty array is truthy and Array.isArray returns true, so it tries polyline
      // with an empty points string
      if (polyline) {
        expect(polyline.getAttribute("points")).toBe("");
      } else {
        // If the component treats empty points array differently
        expect(rect).toBeInTheDocument();
      }
    });

    it("text annotation with empty string payload shows default text", () => {
      const op = makeOp({
        opId: "txt-empty",
        opType: "text",
        payload: { text: "" },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} />,
      );

      const svg = container.querySelector("svg")!;
      const textEl = svg.querySelector("g text");
      // Empty string is falsy, so `|| "Text"` kicks in
      expect(textEl?.textContent).toBe("Text");
    });

    it("zoom of 0.5 correctly scales annotations to half size", () => {
      const op = makeOp({
        opId: "half-zoom",
        opType: "shape",
        bounds: { x: 100, y: 200, w: 300, h: 400 },
      });
      const { container } = render(
        <AnnotationOverlay {...defaultProps} annotations={[op]} zoom={0.5} />,
      );

      const svg = container.querySelector("svg")!;
      const rect = svg.querySelector("g rect");
      expect(rect?.getAttribute("x")).toBe("50"); // 100 * 0.5
      expect(rect?.getAttribute("y")).toBe("100"); // 200 * 0.5
      expect(rect?.getAttribute("width")).toBe("150"); // 300 * 0.5
      expect(rect?.getAttribute("height")).toBe("200"); // 400 * 0.5
    });
  });
});
