import { describe, expect, it } from "vitest";
import { ringHeight } from "./avatar.ts";

// The ring on the floor about the object whose panel is open (docs/design/plant_ui.md sections 3.4 and 3.5). A reactor stands on its bay's plinth, which is 0.2 m high (`PLINTH` of dims.ts), so a ring
// drawn 0.05 m above the floor is under the plinth and the reader sees no mark on the reactor the tour (or a click) picked: the ring of a reactor lies 0.05 m above the plinth, that is at 0.25 m.
// Found in P8b, when the first two steps of the tour picked a reactor and showed no outline. Every other object stands on the floor.

describe("the height of the ring about a picked object", () => {
  it("Given a reactor Then the ring lies on its plinth, 0.05 m above the top of it", () => {
    expect(ringHeight("reactor")).toBeCloseTo(0.25, 9);
  });

  it("Given anything that stands on the floor Then the ring lies 0.05 m above it", () => {
    for (const kind of ["analyzer", "staff", "sample", "lot", "equipment", "confirm"] as const) expect(ringHeight(kind), kind).toBeCloseTo(0.05, 9);
  });
});
