import { describe, expect, it } from "vitest";
import { createWorker } from "../../../src/worker/worker.ts";
import type { Response } from "../../../src/protocol.ts";
import { labData } from "../support/lab_data.ts";

describe("seed preflight uses the canonical experiment rules", () => {
  it.each([
    [[1009, 1103], null],
    [[1009, 1009], "a seed is repeated"],
    [[20240101], "seed 20240101 is date-shaped (seeds are neutral values)"],
    [[], "seeds must name at least one seed"],
  ])("checks %j without running the experiment", async (seeds, reason) => {
    const messages: Response[] = [];
    const worker = createWorker((m) => messages.push(m), { data: labData(), now: () => 0, fetchReference: async () => null });
    await worker.onMessage({ type: "seed_check", id: 44, seeds });
    expect(messages).toEqual([{ type: "seed_checked", id: 44, reason }]);
  });
});
