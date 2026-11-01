import { describe, expect, expectTypeOf, it } from "vitest";
import { ACTION_KINDS } from "../../src/experiments/assembly/lab/actions.ts";
import type { Action, RefusalReason } from "../../src/experiments/assembly/lab/actions.ts";
import type { SampleRecord as EngineRecord } from "../../src/experiments/assembly/lab/lineage.ts";
import type { PlantAnswer } from "../../src/experiments/assembly/lab/plant.ts";
import type { PlantHall } from "../../src/experiments/assembly/lab/plant_stage.ts";
import type { ScenePlan as EnginePlan } from "../../src/experiments/assembly/lab/plant_plan.ts";
import type { PlantAction, RefusalReason as PageReason, Request, Response, SampleRecord, ScenePlan } from "../../../src/protocol.ts";

// P3 (docs/design/plant_ui.md section 6): the page imports no engine module, so src/protocol.ts declares the shapes of the plant's plain data. Nothing here runs at run time but the list of kinds;
// the checks are types, which `npm run typecheck` verifies: a field added to the engine's scene plan or action without the same field in the protocol fails to compile.

describe("the plant shapes of src/protocol.ts are the engine's", () => {
  it("Given the scene plan, the actions and the refusal reasons Then each shape of the protocol equals the engine's", () => {
    expectTypeOf<ScenePlan>().toEqualTypeOf<EnginePlan>();
    expectTypeOf<PlantAction>().toEqualTypeOf<Action>();
    expectTypeOf<PageReason>().toEqualTypeOf<RefusalReason>();
  });

  it("Given what the engine answers Then it is what the protocol's plant_ready carries", () => {
    type Ready = Extract<Response, { type: "plant_ready" }>;
    expectTypeOf<Pick<Ready, "plan" | "resume_at" | "hashes" | "checks">>().toEqualTypeOf<PlantAnswer>();
  });

  it("Given the halls and the record the Worker sends after plant_ready (P5a) Then plant_halls carries the engine's hall and plant_record_view the engine's record, and plant_record is asked for by architecture and sample id", () => {
    expectTypeOf<Pick<Extract<Response, { type: "plant_halls" }>, "records" | "cells">>().toEqualTypeOf<PlantHall>();
    expectTypeOf<Extract<Response, { type: "plant_record_view" }>["sample"]>().toEqualTypeOf<EngineRecord>();
    expectTypeOf<SampleRecord>().toEqualTypeOf<EngineRecord>();
    expectTypeOf<Extract<Request, { type: "plant_record" }>>().toEqualTypeOf<{ type: "plant_record"; id: number; epoch: number; architecture: string; sample_id: string }>();
  });

  it("Given the kinds of the engine Then there are eight, as in section 5.2", () => {
    expect([...ACTION_KINDS].sort()).toEqual(["add_feed", "analyzer_down", "change_lot", "move_draw", "raise_alarm", "set_capture_path", "set_flag", "set_labelling"]);
  });
});
