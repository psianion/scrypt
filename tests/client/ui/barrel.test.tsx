import { describe, test, expect } from "bun:test";
import * as ui from "@/client/ui";

/**
 * Smoke test: the `src/client/ui` barrel re-exports every primitive + the
 * Chip family siblings (Pill, Kbd, TierChip). If a primitive is ever renamed
 * or the barrel drifts, this test fails fast in CI before any consumer
 * import breaks.
 */
describe("src/client/ui barrel", () => {
  test("exports every Wave 0 primitive", () => {
    const expected = [
      "Button",
      "Input",
      "Chip",
      "Pill",
      "Kbd",
      "TierChip",
      "Toggle",
      "Checkbox",
      "Segment",
      "Warning",
    ];
    // forwardRef-wrapped components are objects, not functions; assert
    // presence rather than typeof so we stay agnostic to wrapping style.
    for (const name of expected) {
      expect((ui as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
