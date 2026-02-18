import type { AnnotationOperation } from "../types";

type Point = { x: number; y: number };

const HIT_RADIUS = 8; // PDF-coordinate proximity threshold for ink strokes

/**
 * Returns the opId of the topmost annotation at the given PDF-coordinate point,
 * or null if no annotation is hit. Annotations are tested in reverse order
 * (last drawn = topmost).
 */
export function hitTestAnnotation(
  point: Point,
  annotations: AnnotationOperation[],
  page: number,
): string | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const op = annotations[i];
    if (op.page !== page) continue;

    if (op.opType === "ink" && op.payload?.points && Array.isArray(op.payload.points)) {
      const pts = op.payload.points as Point[];
      if (pts.length === 0) continue;
      if (pts.length === 1) {
        if (Math.hypot(point.x - pts[0].x, point.y - pts[0].y) < HIT_RADIUS) {
          return op.opId;
        }
        continue;
      }
      for (let j = 0; j < pts.length - 1; j++) {
        if (distanceToSegment(point, pts[j], pts[j + 1]) < HIT_RADIUS) {
          return op.opId;
        }
      }
    } else {
      const { x, y, w, h } = op.bounds;
      if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
        return op.opId;
      }
    }
  }
  return null;
}

/** Distance from point P to line segment AB. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}
