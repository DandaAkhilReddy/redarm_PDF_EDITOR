import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { useUndoRedo } from "./useUndoRedo";
import type { AnnotationOperation } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeOp(
  opType: AnnotationOperation["opType"] = "highlight",
  page = 1,
  overrides: Partial<AnnotationOperation> = {},
): AnnotationOperation {
  return {
    opId: `op-${++idCounter}`,
    opType,
    page,
    bounds: { x: 10, y: 10, w: 100, h: 50 },
    author: "test",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

function setup(initialOps: AnnotationOperation[] = []) {
  const addRaw = vi.fn(
    (
      opType: AnnotationOperation["opType"],
      page: number,
      bounds?: { x: number; y: number; w: number; h: number },
      payload?: Record<string, unknown>,
    ) => {
      const op = makeOp(opType, page);
      if (bounds) op.bounds = bounds;
      if (payload) op.payload = payload;
      return op;
    },
  );
  const removeRaw = vi.fn();
  const clearRaw = vi.fn();

  const { result } = renderHook(() => {
    const [ops, setOps] = useState<AnnotationOperation[]>(initialOps);
    const undoRedo = useUndoRedo(addRaw, removeRaw, clearRaw, ops, setOps);
    return { ops, setOps, undoRedo };
  });

  return { result, addRaw, removeRaw, clearRaw };
}

beforeEach(() => {
  idCounter = 0;
});

// ===========================================================================
// Tests
// ===========================================================================

describe("useUndoRedo", () => {
  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------
  describe("initial state", () => {
    it("1 - canUndo is false initially", () => {
      const { result } = setup();
      expect(result.current.undoRedo.canUndo).toBe(false);
    });

    it("2 - canRedo is false initially", () => {
      const { result } = setup();
      expect(result.current.undoRedo.canRedo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // addAnnotation
  // -----------------------------------------------------------------------
  describe("addAnnotation", () => {
    it("3 - calls addAnnotationRaw and records to undo stack", () => {
      const { result, addRaw } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });

      expect(addRaw).toHaveBeenCalledTimes(1);
      expect(addRaw).toHaveBeenCalledWith("highlight", 1, undefined, undefined);
      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("4 - canUndo becomes true after add", () => {
      const { result } = setup();
      expect(result.current.undoRedo.canUndo).toBe(false);

      act(() => {
        result.current.undoRedo.addAnnotation("text", 2);
      });

      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("5 - clears redo stack on new add action", () => {
      const { result } = setup();

      // Add then undo to populate redo stack
      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      // New add should clear redo
      act(() => {
        result.current.undoRedo.addAnnotation("ink", 1);
      });
      expect(result.current.undoRedo.canRedo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // removeAnnotation
  // -----------------------------------------------------------------------
  describe("removeAnnotation", () => {
    it("6 - calls removeAnnotationRaw when op exists", () => {
      const existingOp = makeOp("highlight", 1);
      const { result, removeRaw } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.removeAnnotation(existingOp.opId);
      });

      expect(removeRaw).toHaveBeenCalledTimes(1);
      expect(removeRaw).toHaveBeenCalledWith(existingOp.opId);
    });

    it("7 - records removal to undo stack", () => {
      const existingOp = makeOp("highlight", 1);
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.removeAnnotation(existingOp.opId);
      });

      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("8 - does nothing when opId does not exist", () => {
      const existingOp = makeOp("highlight", 1);
      const { result, removeRaw } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.removeAnnotation("nonexistent-id");
      });

      expect(removeRaw).not.toHaveBeenCalled();
      expect(result.current.undoRedo.canUndo).toBe(false);
    });

    it("9 - canUndo becomes true after remove", () => {
      const existingOp = makeOp("text", 3);
      const { result } = setup([existingOp]);
      expect(result.current.undoRedo.canUndo).toBe(false);

      act(() => {
        result.current.undoRedo.removeAnnotation(existingOp.opId);
      });

      expect(result.current.undoRedo.canUndo).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // clearAnnotations
  // -----------------------------------------------------------------------
  describe("clearAnnotations", () => {
    it("10 - calls clearAnnotationsRaw", () => {
      const ops = [makeOp("highlight"), makeOp("text")];
      const { result, clearRaw } = setup(ops);

      act(() => {
        result.current.undoRedo.clearAnnotations();
      });

      expect(clearRaw).toHaveBeenCalledTimes(1);
    });

    it("11 - records all ops snapshot to undo stack", () => {
      const ops = [makeOp("highlight"), makeOp("ink"), makeOp("text")];
      const { result } = setup(ops);

      act(() => {
        result.current.undoRedo.clearAnnotations();
      });

      expect(result.current.undoRedo.canUndo).toBe(true);

      // Undo should restore all 3 ops
      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.ops).toHaveLength(3);
    });

    it("12 - does nothing when ops is empty", () => {
      const { result, clearRaw } = setup([]);

      act(() => {
        result.current.undoRedo.clearAnnotations();
      });

      expect(clearRaw).not.toHaveBeenCalled();
      expect(result.current.undoRedo.canUndo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // updateAnnotation
  // -----------------------------------------------------------------------
  describe("updateAnnotation", () => {
    it("13 - updates op payload in-place via setOps", () => {
      const existingOp = makeOp("text", 1, { payload: { content: "hello" } });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          payload: { content: "world" },
        });
      });

      const updated = result.current.ops.find((o) => o.opId === existingOp.opId);
      expect(updated).toBeDefined();
      expect(updated!.payload).toEqual({ content: "world" });
    });

    it("14 - records old and new op to undo stack", () => {
      const existingOp = makeOp("shape", 2);
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          bounds: { x: 20, y: 20, w: 200, h: 100 },
        });
      });

      expect(result.current.undoRedo.canUndo).toBe(true);

      // Undo should revert to original bounds
      act(() => {
        result.current.undoRedo.undo();
      });

      const reverted = result.current.ops.find((o) => o.opId === existingOp.opId);
      expect(reverted!.bounds).toEqual(existingOp.bounds);
    });

    it("15 - does nothing when opId does not exist", () => {
      const existingOp = makeOp("highlight", 1);
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation("nonexistent-id", {
          payload: { color: "red" },
        });
      });

      expect(result.current.undoRedo.canUndo).toBe(false);
      // ops remain unchanged
      expect(result.current.ops).toHaveLength(1);
      expect(result.current.ops[0]).toEqual(existingOp);
    });

    it("16 - merges payload with existing payload", () => {
      const existingOp = makeOp("text", 1, {
        payload: { color: "blue", fontSize: 12 },
      });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          payload: { fontSize: 16 },
        });
      });

      const updated = result.current.ops.find((o) => o.opId === existingOp.opId);
      expect(updated!.payload).toEqual({ color: "blue", fontSize: 16 });
    });
  });

  // -----------------------------------------------------------------------
  // Undo - add
  // -----------------------------------------------------------------------
  describe("undo - add", () => {
    it("17 - undoing an add removes the annotation from ops", () => {
      const { result } = setup();

      let addedOp: AnnotationOperation;
      act(() => {
        addedOp = result.current.undoRedo.addAnnotation("highlight", 1);
      });

      // The op was added via addAnnotationRaw (which doesn't push into our
      // local state), so we simulate it being in ops by using setOps.
      // The undo path uses setOpsDirectly to remove it. Let's add it first.
      act(() => {
        result.current.setOps((prev) => [...prev, addedOp!]);
      });
      expect(result.current.ops).toHaveLength(1);

      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.ops).toHaveLength(0);
    });

    it("18 - canUndo becomes false after undoing last action", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      expect(result.current.undoRedo.canUndo).toBe(true);

      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canUndo).toBe(false);
    });

    it("19 - canRedo becomes true after undo", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      expect(result.current.undoRedo.canRedo).toBe(false);

      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Undo - remove
  // -----------------------------------------------------------------------
  describe("undo - remove", () => {
    it("20 - undoing a remove restores the annotation to ops", () => {
      const existingOp = makeOp("highlight", 1);
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.removeAnnotation(existingOp.opId);
      });

      // removeAnnotationRaw is mocked and doesn't actually remove from ops,
      // so we simulate that removal
      act(() => {
        result.current.setOps([]);
      });
      expect(result.current.ops).toHaveLength(0);

      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.ops).toHaveLength(1);
      expect(result.current.ops[0].opId).toBe(existingOp.opId);
    });
  });

  // -----------------------------------------------------------------------
  // Undo - clear
  // -----------------------------------------------------------------------
  describe("undo - clear", () => {
    it("21 - undoing a clear restores all annotations", () => {
      const ops = [makeOp("highlight"), makeOp("text"), makeOp("ink")];
      const { result } = setup(ops);

      act(() => {
        result.current.undoRedo.clearAnnotations();
      });

      // clearAnnotationsRaw is mocked, simulate clearing ops
      act(() => {
        result.current.setOps([]);
      });
      expect(result.current.ops).toHaveLength(0);

      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.ops).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // Undo - update
  // -----------------------------------------------------------------------
  describe("undo - update", () => {
    it("22 - undoing an update reverts to oldOp", () => {
      const existingOp = makeOp("shape", 1, {
        bounds: { x: 0, y: 0, w: 50, h: 50 },
      });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          bounds: { x: 100, y: 100, w: 200, h: 200 },
        });
      });

      const updatedOp = result.current.ops.find((o) => o.opId === existingOp.opId);
      expect(updatedOp!.bounds).toEqual({ x: 100, y: 100, w: 200, h: 200 });

      act(() => {
        result.current.undoRedo.undo();
      });

      const revertedOp = result.current.ops.find((o) => o.opId === existingOp.opId);
      expect(revertedOp!.bounds).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    });
  });

  // -----------------------------------------------------------------------
  // Redo - add
  // -----------------------------------------------------------------------
  describe("redo - add", () => {
    it("23 - redoing an add re-adds the annotation", () => {
      const { result } = setup();

      let addedOp: AnnotationOperation;
      act(() => {
        addedOp = result.current.undoRedo.addAnnotation("highlight", 1);
      });

      // Put it in ops so undo can filter it out
      act(() => {
        result.current.setOps([addedOp!]);
      });

      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.ops).toHaveLength(0);

      act(() => {
        result.current.undoRedo.redo();
      });
      expect(result.current.ops).toHaveLength(1);
      expect(result.current.ops[0].opId).toBe(addedOp!.opId);
    });

    it("24 - canRedo becomes false after redoing last action", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      act(() => {
        result.current.undoRedo.redo();
      });
      expect(result.current.undoRedo.canRedo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Redo - remove
  // -----------------------------------------------------------------------
  describe("redo - remove", () => {
    it("25 - redoing a remove re-removes the annotation", () => {
      const existingOp = makeOp("highlight", 1);
      const { result } = setup([existingOp]);

      // Remove
      act(() => {
        result.current.undoRedo.removeAnnotation(existingOp.opId);
      });

      // Simulate raw remove
      act(() => {
        result.current.setOps([]);
      });

      // Undo restores it
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.ops).toHaveLength(1);

      // Redo removes it again
      act(() => {
        result.current.undoRedo.redo();
      });
      expect(result.current.ops).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Redo - clear
  // -----------------------------------------------------------------------
  describe("redo - clear", () => {
    it("26 - redoing a clear empties ops again", () => {
      const ops = [makeOp("highlight"), makeOp("text")];
      const { result } = setup(ops);

      // Clear
      act(() => {
        result.current.undoRedo.clearAnnotations();
      });
      act(() => {
        result.current.setOps([]);
      });

      // Undo restores
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.ops).toHaveLength(2);

      // Redo clears again
      act(() => {
        result.current.undoRedo.redo();
      });
      expect(result.current.ops).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Redo - update
  // -----------------------------------------------------------------------
  describe("redo - update", () => {
    it("27 - redoing an update re-applies newOp", () => {
      const existingOp = makeOp("shape", 1, {
        bounds: { x: 0, y: 0, w: 50, h: 50 },
      });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          bounds: { x: 100, y: 100, w: 200, h: 200 },
        });
      });

      const newBounds = result.current.ops.find((o) => o.opId === existingOp.opId)!.bounds;
      expect(newBounds).toEqual({ x: 100, y: 100, w: 200, h: 200 });

      // Undo reverts
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(
        result.current.ops.find((o) => o.opId === existingOp.opId)!.bounds,
      ).toEqual({ x: 0, y: 0, w: 50, h: 50 });

      // Redo re-applies
      act(() => {
        result.current.undoRedo.redo();
      });
      expect(
        result.current.ops.find((o) => o.opId === existingOp.opId)!.bounds,
      ).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    });
  });

  // -----------------------------------------------------------------------
  // Multi-step sequences
  // -----------------------------------------------------------------------
  describe("multi-step sequences", () => {
    it("28 - add 3, undo 2, redo 1 yields correct state", () => {
      const { result } = setup();

      const added: AnnotationOperation[] = [];

      // Add 3 annotations
      act(() => {
        added.push(result.current.undoRedo.addAnnotation("highlight", 1));
      });
      act(() => {
        result.current.setOps((prev) => [...prev, added[0]]);
      });

      act(() => {
        added.push(result.current.undoRedo.addAnnotation("text", 2));
      });
      act(() => {
        result.current.setOps((prev) => [...prev, added[1]]);
      });

      act(() => {
        added.push(result.current.undoRedo.addAnnotation("ink", 3));
      });
      act(() => {
        result.current.setOps((prev) => [...prev, added[2]]);
      });

      expect(result.current.ops).toHaveLength(3);
      expect(result.current.undoRedo.canUndo).toBe(true);
      expect(result.current.undoRedo.canRedo).toBe(false);

      // Undo 2 times
      act(() => {
        result.current.undoRedo.undo();
      });
      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.ops).toHaveLength(1);
      expect(result.current.ops[0].opId).toBe(added[0].opId);
      expect(result.current.undoRedo.canUndo).toBe(true);
      expect(result.current.undoRedo.canRedo).toBe(true);

      // Redo 1 time
      act(() => {
        result.current.undoRedo.redo();
      });

      expect(result.current.ops).toHaveLength(2);
      expect(result.current.ops[0].opId).toBe(added[0].opId);
      expect(result.current.ops[1].opId).toBe(added[1].opId);
      expect(result.current.undoRedo.canUndo).toBe(true);
      expect(result.current.undoRedo.canRedo).toBe(true);
    });

    it("29 - add, remove, undo, undo goes back to after first add", () => {
      const existingOp = makeOp("highlight", 1);
      const { result } = setup([existingOp]);

      // Add a new annotation
      let addedOp: AnnotationOperation;
      act(() => {
        addedOp = result.current.undoRedo.addAnnotation("text", 2);
      });
      act(() => {
        result.current.setOps((prev) => [...prev, addedOp!]);
      });
      expect(result.current.ops).toHaveLength(2);

      // Remove the existing op
      act(() => {
        result.current.undoRedo.removeAnnotation(existingOp.opId);
      });
      act(() => {
        result.current.setOps((prev) => prev.filter((o) => o.opId !== existingOp.opId));
      });
      expect(result.current.ops).toHaveLength(1);

      // Undo remove - restores existingOp
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.ops).toHaveLength(2);

      // Undo add - removes addedOp
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.ops).toHaveLength(1);
      expect(result.current.ops[0].opId).toBe(existingOp.opId);
    });

    it("30 - new action after undo clears redo stack", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.addAnnotation("text", 2);
      });

      // Undo one
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      // New action should clear redo
      act(() => {
        result.current.undoRedo.addAnnotation("ink", 3);
      });
      expect(result.current.undoRedo.canRedo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Undo / redo on empty stacks
  // -----------------------------------------------------------------------
  describe("undo/redo on empty stacks", () => {
    it("31 - undo with empty stack does nothing", () => {
      const { result } = setup();

      expect(result.current.undoRedo.canUndo).toBe(false);

      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.undoRedo.canUndo).toBe(false);
      expect(result.current.undoRedo.canRedo).toBe(false);
      expect(result.current.ops).toHaveLength(0);
    });

    it("32 - redo with empty stack does nothing", () => {
      const { result } = setup();

      expect(result.current.undoRedo.canRedo).toBe(false);

      act(() => {
        result.current.undoRedo.redo();
      });

      expect(result.current.undoRedo.canUndo).toBe(false);
      expect(result.current.undoRedo.canRedo).toBe(false);
      expect(result.current.ops).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------
  describe("keyboard shortcuts", () => {
    it("33 - Ctrl+Z triggers undo", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      expect(result.current.undoRedo.canUndo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      });

      expect(result.current.undoRedo.canUndo).toBe(false);
      expect(result.current.undoRedo.canRedo).toBe(true);
    });

    it("34 - Ctrl+Shift+Z triggers redo", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
      });

      expect(result.current.undoRedo.canRedo).toBe(false);
      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("35 - Ctrl+Y triggers redo", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "y", ctrlKey: true });
      });

      expect(result.current.undoRedo.canRedo).toBe(false);
      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("36 - Z without Ctrl does nothing", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      expect(result.current.undoRedo.canUndo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "z", ctrlKey: false });
      });

      // Still undoable - the shortcut did not fire
      expect(result.current.undoRedo.canUndo).toBe(true);
      expect(result.current.undoRedo.canRedo).toBe(false);
    });

    it("37 - Ctrl+X does nothing (only Z and Y handled)", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      expect(result.current.undoRedo.canUndo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "x", ctrlKey: true });
      });

      // Nothing should have changed
      expect(result.current.undoRedo.canUndo).toBe(true);
      expect(result.current.undoRedo.canRedo).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge-case and integration tests
  // -----------------------------------------------------------------------
  describe("additional edge cases", () => {
    it("38 - addAnnotation forwards bounds and payload to addAnnotationRaw", () => {
      const { result, addRaw } = setup();
      const bounds = { x: 5, y: 10, w: 80, h: 40 };
      const payload = { color: "red", opacity: 0.5 };

      act(() => {
        result.current.undoRedo.addAnnotation("shape", 4, bounds, payload);
      });

      expect(addRaw).toHaveBeenCalledWith("shape", 4, bounds, payload);
    });

    it("39 - addAnnotation returns the created AnnotationOperation", () => {
      const { result } = setup();

      let returnedOp: AnnotationOperation | undefined;
      act(() => {
        returnedOp = result.current.undoRedo.addAnnotation("redaction", 5);
      });

      expect(returnedOp).toBeDefined();
      expect(returnedOp!.opType).toBe("redaction");
      expect(returnedOp!.page).toBe(5);
    });

    it("40 - multiple undos in sequence drain the undo stack correctly", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.addAnnotation("text", 2);
      });
      act(() => {
        result.current.undoRedo.addAnnotation("ink", 3);
      });

      expect(result.current.undoRedo.canUndo).toBe(true);

      act(() => {
        result.current.undoRedo.undo();
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      act(() => {
        result.current.undoRedo.undo();
      });

      expect(result.current.undoRedo.canUndo).toBe(false);
      expect(result.current.undoRedo.canRedo).toBe(true);
    });

    it("41 - multiple redos in sequence drain the redo stack correctly", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.addAnnotation("text", 2);
      });

      act(() => {
        result.current.undoRedo.undo();
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      act(() => {
        result.current.undoRedo.redo();
      });
      act(() => {
        result.current.undoRedo.redo();
      });

      expect(result.current.undoRedo.canRedo).toBe(false);
      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("42 - updateAnnotation updates bounds only when payload is undefined", () => {
      const existingOp = makeOp("shape", 1, {
        bounds: { x: 0, y: 0, w: 50, h: 50 },
        payload: { strokeWidth: 2 },
      });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          bounds: { x: 10, y: 10, w: 60, h: 60 },
        });
      });

      const updated = result.current.ops.find((o) => o.opId === existingOp.opId)!;
      expect(updated.bounds).toEqual({ x: 10, y: 10, w: 60, h: 60 });
      // payload should remain unchanged since we didn't pass one
      expect(updated.payload).toEqual({ strokeWidth: 2 });
    });

    it("43 - updateAnnotation updates the timestamp", () => {
      const existingOp = makeOp("text", 1, { ts: "2020-01-01T00:00:00.000Z" });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          payload: { content: "updated" },
        });
      });

      const updated = result.current.ops.find((o) => o.opId === existingOp.opId)!;
      expect(updated.ts).not.toBe("2020-01-01T00:00:00.000Z");
    });

    it("44 - removeAnnotation clears redo stack", () => {
      const op1 = makeOp("highlight");
      const op2 = makeOp("text");
      const { result } = setup([op1, op2]);

      // Create some redo history
      act(() => {
        result.current.undoRedo.removeAnnotation(op1.opId);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      // New remove should clear redo
      act(() => {
        result.current.undoRedo.removeAnnotation(op2.opId);
      });
      expect(result.current.undoRedo.canRedo).toBe(false);
    });

    it("45 - clearAnnotations clears redo stack", () => {
      const op1 = makeOp("highlight");
      const { result } = setup([op1]);

      // Create some redo history
      act(() => {
        result.current.undoRedo.removeAnnotation(op1.opId);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      // Clear should wipe redo
      act(() => {
        result.current.undoRedo.clearAnnotations();
      });
      expect(result.current.undoRedo.canRedo).toBe(false);
    });

    it("46 - updateAnnotation clears redo stack", () => {
      const op1 = makeOp("shape", 1);
      const { result } = setup([op1]);

      act(() => {
        result.current.undoRedo.updateAnnotation(op1.opId, {
          bounds: { x: 1, y: 1, w: 1, h: 1 },
        });
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      act(() => {
        result.current.undoRedo.updateAnnotation(op1.opId, {
          bounds: { x: 2, y: 2, w: 2, h: 2 },
        });
      });
      expect(result.current.undoRedo.canRedo).toBe(false);
    });

    it("47 - Meta key (Cmd on Mac) + Z triggers undo", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      expect(result.current.undoRedo.canUndo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "z", metaKey: true });
      });

      expect(result.current.undoRedo.canUndo).toBe(false);
      expect(result.current.undoRedo.canRedo).toBe(true);
    });

    it("48 - Meta+Shift+Z triggers redo (Mac style)", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.undoRedo.canRedo).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
      });

      expect(result.current.undoRedo.canRedo).toBe(false);
      expect(result.current.undoRedo.canUndo).toBe(true);
    });

    it("49 - undo then redo for update preserves op identity", () => {
      const existingOp = makeOp("text", 1, {
        payload: { content: "original" },
      });
      const { result } = setup([existingOp]);

      act(() => {
        result.current.undoRedo.updateAnnotation(existingOp.opId, {
          payload: { content: "modified" },
        });
      });

      // Verify update
      expect(
        result.current.ops.find((o) => o.opId === existingOp.opId)!.payload,
      ).toEqual({ content: "modified" });

      // Undo
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(
        result.current.ops.find((o) => o.opId === existingOp.opId)!.payload,
      ).toEqual({ content: "original" });

      // Redo
      act(() => {
        result.current.undoRedo.redo();
      });
      expect(
        result.current.ops.find((o) => o.opId === existingOp.opId)!.payload,
      ).toEqual({ content: "modified" });

      // opId should be the same throughout
      expect(result.current.ops).toHaveLength(1);
      expect(result.current.ops[0].opId).toBe(existingOp.opId);
    });

    it("50 - interleaved add and update operations undo correctly", () => {
      const { result } = setup();

      // Add an annotation
      let addedOp: AnnotationOperation;
      act(() => {
        addedOp = result.current.undoRedo.addAnnotation("text", 1);
      });
      act(() => {
        result.current.setOps([addedOp!]);
      });

      // Update it
      act(() => {
        result.current.undoRedo.updateAnnotation(addedOp!.opId, {
          payload: { content: "updated text" },
        });
      });

      expect(result.current.ops[0].payload).toEqual({ content: "updated text" });

      // Undo update
      act(() => {
        result.current.undoRedo.undo();
      });
      // Op should be back to no payload (or original)
      expect(result.current.ops[0].opId).toBe(addedOp!.opId);

      // Undo add
      act(() => {
        result.current.undoRedo.undo();
      });
      expect(result.current.ops).toHaveLength(0);
    });

    it("51 - keyboard event preventDefault is called on Ctrl+Z", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });

      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      act(() => {
        window.dispatchEvent(event);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("52 - keyboard event preventDefault is called on Ctrl+Shift+Z", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });

      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      act(() => {
        window.dispatchEvent(event);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it("53 - keyboard event preventDefault is called on Ctrl+Y", () => {
      const { result } = setup();

      act(() => {
        result.current.undoRedo.addAnnotation("highlight", 1);
      });
      act(() => {
        result.current.undoRedo.undo();
      });

      const event = new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      act(() => {
        window.dispatchEvent(event);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });
});
