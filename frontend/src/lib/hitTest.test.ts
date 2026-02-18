import { describe, it, expect } from "vitest";
import { hitTestAnnotation, distanceToSegment } from "./hitTest";

type AnnotationOperation = {
  opId: string;
  opType: "highlight" | "ink" | "text" | "shape" | "redaction";
  page: number;
  bounds: { x: number; y: number; w: number; h: number };
  author: string;
  payload?: Record<string, unknown>;
  ts: string;
};

function makeOp(
  overrides: Partial<AnnotationOperation> & {
    opId: string;
    opType: AnnotationOperation["opType"];
  },
): AnnotationOperation {
  return {
    page: 1,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    author: "test",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// distanceToSegment
// ---------------------------------------------------------------------------
describe("distanceToSegment", () => {
  it("1. zero-length segment (both points same) returns distance to that point", () => {
    const d = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(d).toBeCloseTo(5, 5); // 3-4-5 triangle
  });

  it("2. point lying exactly on the segment returns 0", () => {
    // Midpoint of (0,0)-(10,0) is (5,0)
    const d = distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(0, 5);
  });

  it("3. point closest to the start of the segment (t clamped to 0)", () => {
    // Point is behind the start
    const d = distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    // Closest is start (0,0), distance = hypot(3,4) = 5
    expect(d).toBeCloseTo(5, 5);
  });

  it("4. point closest to the end of the segment (t clamped to 1)", () => {
    // Point is beyond the end
    const d = distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    // Closest is end (10,0), distance = hypot(3,4) = 5
    expect(d).toBeCloseTo(5, 5);
  });

  it("5. point closest to the middle of the segment (perpendicular projection)", () => {
    // Segment from (0,0) to (10,0), point at (5,3) -> perpendicular distance = 3
    const d = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(3, 5);
  });

  it("6. horizontal segment", () => {
    const d = distanceToSegment({ x: 50, y: 7 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(d).toBeCloseTo(7, 5);
  });

  it("7. vertical segment", () => {
    const d = distanceToSegment({ x: 7, y: 50 }, { x: 0, y: 0 }, { x: 0, y: 100 });
    expect(d).toBeCloseTo(7, 5);
  });

  it("8. diagonal segment", () => {
    // Segment from (0,0) to (10,10). Point at (10,0).
    // The perpendicular distance from (10,0) to the line y=x is 10/sqrt(2) ~ 7.071
    // But the projection t = ((10-0)*10 + (0-0)*10) / (100+100) = 100/200 = 0.5
    // proj = (5,5), dist = hypot(5,5) = sqrt(50) ~ 7.071
    const d = distanceToSegment({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(d).toBeCloseTo(Math.SQRT2 * 5, 5);
  });
});

// ---------------------------------------------------------------------------
// hitTestAnnotation — rect-based types (highlight, text, shape, redaction)
// ---------------------------------------------------------------------------
describe("hitTestAnnotation - rect-based types", () => {
  const rectOp = makeOp({
    opId: "rect-1",
    opType: "highlight",
    bounds: { x: 50, y: 50, w: 100, h: 60 },
  });

  it("9. point inside bounds returns opId", () => {
    const result = hitTestAnnotation({ x: 80, y: 70 }, [rectOp], 1);
    expect(result).toBe("rect-1");
  });

  it("10. point outside bounds returns null", () => {
    const result = hitTestAnnotation({ x: 200, y: 200 }, [rectOp], 1);
    expect(result).toBeNull();
  });

  it("11. point on exact boundary edge returns opId (>= and <=)", () => {
    // Right edge: x = 50 + 100 = 150, y within bounds
    const result = hitTestAnnotation({ x: 150, y: 80 }, [rectOp], 1);
    expect(result).toBe("rect-1");
  });

  it("12. point at top-left corner returns opId", () => {
    const result = hitTestAnnotation({ x: 50, y: 50 }, [rectOp], 1);
    expect(result).toBe("rect-1");
  });

  it("13. point at bottom-right corner returns opId", () => {
    // Bottom-right: (50+100, 50+60) = (150, 110)
    const result = hitTestAnnotation({ x: 150, y: 110 }, [rectOp], 1);
    expect(result).toBe("rect-1");
  });

  it("14. point 1px outside bounds returns null", () => {
    const result = hitTestAnnotation({ x: 151, y: 80 }, [rectOp], 1);
    expect(result).toBeNull();
  });

  it("text opType uses rect-based hit test", () => {
    const textOp = makeOp({
      opId: "text-1",
      opType: "text",
      bounds: { x: 10, y: 10, w: 50, h: 20 },
    });
    expect(hitTestAnnotation({ x: 30, y: 20 }, [textOp], 1)).toBe("text-1");
  });

  it("shape opType uses rect-based hit test", () => {
    const shapeOp = makeOp({
      opId: "shape-1",
      opType: "shape",
      bounds: { x: 10, y: 10, w: 50, h: 20 },
    });
    expect(hitTestAnnotation({ x: 30, y: 20 }, [shapeOp], 1)).toBe("shape-1");
  });

  it("redaction opType uses rect-based hit test", () => {
    const redactOp = makeOp({
      opId: "redact-1",
      opType: "redaction",
      bounds: { x: 10, y: 10, w: 50, h: 20 },
    });
    expect(hitTestAnnotation({ x: 30, y: 20 }, [redactOp], 1)).toBe("redact-1");
  });
});

// ---------------------------------------------------------------------------
// hitTestAnnotation — ink type
// ---------------------------------------------------------------------------
describe("hitTestAnnotation - ink type", () => {
  it("15. point near ink polyline segment returns opId", () => {
    const inkOp = makeOp({
      opId: "ink-1",
      opType: "ink",
      payload: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
    });
    // Point 5px above the segment (within HIT_RADIUS=8)
    const result = hitTestAnnotation({ x: 50, y: 5 }, [inkOp], 1);
    expect(result).toBe("ink-1");
  });

  it("16. point far from ink polyline returns null", () => {
    const inkOp = makeOp({
      opId: "ink-2",
      opType: "ink",
      payload: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
    });
    // Point 20px above the segment (outside HIT_RADIUS=8)
    const result = hitTestAnnotation({ x: 50, y: 20 }, [inkOp], 1);
    expect(result).toBeNull();
  });

  it("17. single-point ink, point near returns opId (within HIT_RADIUS=8)", () => {
    const inkOp = makeOp({
      opId: "ink-3",
      opType: "ink",
      payload: { points: [{ x: 50, y: 50 }] },
    });
    // Distance = hypot(3,4) = 5 < 8
    const result = hitTestAnnotation({ x: 53, y: 54 }, [inkOp], 1);
    expect(result).toBe("ink-3");
  });

  it("18. single-point ink, point far returns null", () => {
    const inkOp = makeOp({
      opId: "ink-4",
      opType: "ink",
      payload: { points: [{ x: 50, y: 50 }] },
    });
    // Distance = hypot(6,8) = 10 > 8
    const result = hitTestAnnotation({ x: 56, y: 58 }, [inkOp], 1);
    expect(result).toBeNull();
  });

  it("19. empty points array returns null (skipped)", () => {
    const inkOp = makeOp({
      opId: "ink-5",
      opType: "ink",
      payload: { points: [] },
    });
    const result = hitTestAnnotation({ x: 50, y: 50 }, [inkOp], 1);
    expect(result).toBeNull();
  });

  it("20. multi-segment ink path, point near middle segment", () => {
    const inkOp = makeOp({
      opId: "ink-6",
      opType: "ink",
      payload: {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    });
    // Near the vertical segment (50,0)-(50,50), point at (53, 25) => dist=3 < 8
    const result = hitTestAnnotation({ x: 53, y: 25 }, [inkOp], 1);
    expect(result).toBe("ink-6");
  });
});

// ---------------------------------------------------------------------------
// hitTestAnnotation — page filtering
// ---------------------------------------------------------------------------
describe("hitTestAnnotation - page filtering", () => {
  it("21. annotations on a different page returns null", () => {
    const op = makeOp({
      opId: "page-1",
      opType: "highlight",
      page: 2,
      bounds: { x: 0, y: 0, w: 200, h: 200 },
    });
    // Point is inside bounds but on the wrong page
    const result = hitTestAnnotation({ x: 50, y: 50 }, [op], 1);
    expect(result).toBeNull();
  });

  it("22. mixed pages, only tests correct page", () => {
    const opPage1 = makeOp({
      opId: "p1-op",
      opType: "highlight",
      page: 1,
      bounds: { x: 0, y: 0, w: 50, h: 50 },
    });
    const opPage2 = makeOp({
      opId: "p2-op",
      opType: "highlight",
      page: 2,
      bounds: { x: 0, y: 0, w: 200, h: 200 },
    });
    // Point at (25,25) is inside both bounds but only page 1 should match
    const result = hitTestAnnotation({ x: 25, y: 25 }, [opPage1, opPage2], 1);
    expect(result).toBe("p1-op");
  });
});

// ---------------------------------------------------------------------------
// hitTestAnnotation — priority (reverse order)
// ---------------------------------------------------------------------------
describe("hitTestAnnotation - priority (reverse order)", () => {
  it("23. overlapping annotations returns topmost (last in array)", () => {
    const bottom = makeOp({
      opId: "bottom",
      opType: "highlight",
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    const top = makeOp({
      opId: "top",
      opType: "highlight",
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    const result = hitTestAnnotation({ x: 50, y: 50 }, [bottom, top], 1);
    expect(result).toBe("top");
  });

  it("24. first annotation overlaps but second (topmost) wins", () => {
    const first = makeOp({
      opId: "first",
      opType: "text",
      bounds: { x: 0, y: 0, w: 200, h: 200 },
    });
    const second = makeOp({
      opId: "second",
      opType: "shape",
      bounds: { x: 40, y: 40, w: 30, h: 30 },
    });
    // Point (50,50) is inside both, second is last => wins
    const result = hitTestAnnotation({ x: 50, y: 50 }, [first, second], 1);
    expect(result).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// hitTestAnnotation — edge cases
// ---------------------------------------------------------------------------
describe("hitTestAnnotation - edge cases", () => {
  it("25. empty annotations array returns null", () => {
    const result = hitTestAnnotation({ x: 50, y: 50 }, [], 1);
    expect(result).toBeNull();
  });

  it("26. ink without points payload falls through to bounds check", () => {
    const inkNoPts = makeOp({
      opId: "ink-no-pts",
      opType: "ink",
      bounds: { x: 10, y: 10, w: 80, h: 80 },
      // no payload.points at all
    });
    // Point inside bounds should still hit via the else branch
    // (The condition `op.opType === "ink" && op.payload?.points && Array.isArray(op.payload.points)`
    //  will be false because payload is undefined, so it falls to else)
    const result = hitTestAnnotation({ x: 50, y: 50 }, [inkNoPts], 1);
    expect(result).toBe("ink-no-pts");
  });

  it("27. multiple annotation types on same page, returns correct one", () => {
    const highlight = makeOp({
      opId: "h-1",
      opType: "highlight",
      bounds: { x: 0, y: 0, w: 30, h: 30 },
    });
    const inkOp = makeOp({
      opId: "ink-7",
      opType: "ink",
      payload: {
        points: [
          { x: 200, y: 200 },
          { x: 300, y: 200 },
        ],
      },
    });
    const textOp = makeOp({
      opId: "text-2",
      opType: "text",
      bounds: { x: 400, y: 400, w: 50, h: 20 },
    });

    // Hit the highlight
    expect(hitTestAnnotation({ x: 15, y: 15 }, [highlight, inkOp, textOp], 1)).toBe("h-1");

    // Hit the ink
    expect(hitTestAnnotation({ x: 250, y: 203 }, [highlight, inkOp, textOp], 1)).toBe("ink-7");

    // Hit the text
    expect(hitTestAnnotation({ x: 420, y: 410 }, [highlight, inkOp, textOp], 1)).toBe("text-2");

    // Miss all
    expect(hitTestAnnotation({ x: 999, y: 999 }, [highlight, inkOp, textOp], 1)).toBeNull();
  });

  it("ink with payload but points is not an array falls through to bounds check", () => {
    const inkBadPts = makeOp({
      opId: "ink-bad",
      opType: "ink",
      bounds: { x: 10, y: 10, w: 80, h: 80 },
      payload: { points: "not-an-array" },
    });
    const result = hitTestAnnotation({ x: 50, y: 50 }, [inkBadPts], 1);
    expect(result).toBe("ink-bad");
  });

  it("ink with payload.points but null falls through to bounds check", () => {
    const inkNullPts = makeOp({
      opId: "ink-null",
      opType: "ink",
      bounds: { x: 10, y: 10, w: 80, h: 80 },
      payload: { points: null },
    });
    const result = hitTestAnnotation({ x: 50, y: 50 }, [inkNullPts], 1);
    expect(result).toBe("ink-null");
  });
});
