import type { PlantKept } from "../../engine/src/experiments/assembly/lab/plant.ts";
import type { createChallenges } from "../../engine/src/experiments/assembly/lab/challenges.ts";
import type { answerPlantRecord as answerPlantRecordType } from "../../engine/src/experiments/assembly/lab/plant_record.ts";
import type { answerPlantStart as answerPlantStartType } from "../../engine/src/experiments/assembly/lab/plant_stage.ts";
import type { answerPlantTruth as answerPlantTruthType, checkTruthPick as checkTruthPickType } from "../../engine/src/experiments/assembly/lab/plant_truth.ts";
import type { truthKeyOf as truthKeyOfType } from "../../engine/src/experiments/assembly/lab/truth_key.ts";
import type { ErrorCode, Response } from "../protocol.ts";
import type { WorkerEnv } from "./worker.ts";

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const createPlantWorker = (
  post: (message: Response) => void,
  env: WorkerEnv,
  challenges: ReturnType<typeof createChallenges>,
  fail: (id: number | null, code: ErrorCode, message: string) => void,
  { answerPlantRecord, answerPlantStart, answerPlantTruth, checkTruthPick, truthKeyOf }: {
    answerPlantRecord: typeof answerPlantRecordType;
    answerPlantStart: typeof answerPlantStartType;
    answerPlantTruth: typeof answerPlantTruthType;
    checkTruthPick: typeof checkTruthPickType;
    truthKeyOf: typeof truthKeyOfType;
  },
) => {
  /** The plant: the newest epoch asked for, what the last answer posted kept and the epoch it belongs to, and the queue (plant runs are answered one at a time, in the order they arrive). */
  let plantLatest = -1;
  let plantKept: PlantKept | undefined;
  let keptEpoch = -1;
  let plantQueue: Promise<void> = Promise.resolve();

  const plantAnswer = async (id: number, epoch: number, raw: unknown): Promise<void> => {
    const stale = (): boolean => epoch !== plantLatest;
    const cancelled = (): void => post({ type: "error", id, epoch, code: "cancelled", message: "the plant run was replaced by a newer one before its answer was drawn" });
    try {
      // one turn of the event loop first: a newer request that is already waiting is handled before this one builds anything
      await yieldToLoop();
      if (stale()) return cancelled();
      const out = await answerPlantStart(env.data, challenges, { spec: raw }, plantKept);
      if (stale()) return cancelled();
      if (!out.ok) return post({ type: "error", id, epoch, code: out.code, message: out.message, ...(out.code === "refused" && { reason: out.reason, index: out.index }) });
      plantKept = out.kept;
      keptEpoch = epoch;
      // Keep the base key and, for a run with actions, the key of its actual truth. Break-out cases cannot be challenged.
      post({ type: "plant_ready", id, epoch, ...out.answer, key: out.kept.run === null ? truthKeyOf(out.kept.events) : challenges.keyOf(out.kept.run, out.kept.seed), ...(out.kept.run !== null && out.kept.actions.length > 0 && { action_truth_key: truthKeyOf(out.kept.events) }) });
      // the other halls, one at a time, a turn of the event loop between them; a newer epoch stops the ones still pending and nothing is posted for them (section 5.5)
      for (const build of out.halls) {
        await yieldToLoop();
        if (stale()) return;
        const hall = await build();
        if (stale()) return;
        post({ type: "plant_halls", id, epoch, ...hall });
      }
    } catch (e) {
      post({ type: "error", id, epoch, code: "engine_error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  /** `plant_record`: the rows one architecture holds for one card, read from the halls the Worker kept for that epoch. Answered at once; the epoch is echoed on every message about it. */
  const plantRecord = (id: number, message: Record<string, unknown>): void => {
    const { epoch, architecture, sample_id } = message;
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return fail(id, "invalid_spec", "a plant_record request needs a whole epoch, 0 or more");
    if (typeof architecture !== "string" || typeof sample_id !== "string") return post({ type: "error", id, epoch, code: "invalid_spec", message: "a plant_record request needs an architecture and a sample_id, both strings" });
    // the record is read from the run of the epoch asked for: when the Worker holds another run (a newer one was posted, or none was) the request is stale and the page drops the answer anyway
    if (plantKept === undefined || epoch !== keptEpoch) return post({ type: "error", id, epoch, code: "cancelled", message: `the Worker holds no plant run of epoch ${epoch}` });
    const out = answerPlantRecord(plantKept, architecture, sample_id);
    if (!out.ok) return post({ type: "error", id, epoch, code: "refused", reason: "unknown_target", message: out.message });
    post({ type: "plant_record_view", id, epoch, sample: out.sample });
  };

  /**
   * `plant_truth`: what the simulation knows and no record can hold, for the run the Worker kept (plant_truth.ts). The order of the checks: a malformed request, then the epoch (another one is
   * `cancelled`), then the lock of a challenge on the same run, asked at this moment, then the sample. Answered at once; the epoch is echoed on every message about it.
   */
  const plantTruth = (id: number, message: Record<string, unknown>): void => {
    const { epoch, pick } = message;
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return fail(id, "invalid_spec", "a plant_truth request needs a whole epoch, 0 or more");
    const checked = checkTruthPick(pick);
    if (!checked.ok) return post({ type: "error", id, epoch, code: "invalid_spec", message: checked.message });
    if (plantKept === undefined || epoch !== keptEpoch) return post({ type: "error", id, epoch, code: "cancelled", message: `the Worker holds no plant run of epoch ${epoch}` });
    const out = answerPlantTruth(plantKept, challenges, checked.pick);
    if (!out.ok) return post(out.code === "locked" ? { type: "error", id, epoch, code: "locked", message: out.message } : { type: "error", id, epoch, code: "refused", reason: out.reason, message: out.message });
    post({ type: "plant_truth_view", id, epoch, view: out.view });
  };

  const plantRun = (id: number, message: Record<string, unknown>): Promise<void> | void => {
    const epoch = message.epoch;
    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) return fail(id, "invalid_spec", "a plant_run request needs a whole epoch, 0 or more");
    if (epoch <= plantLatest) return post({ type: "error", id, epoch, code: "invalid_spec", message: `the epoch ${epoch} is not larger than the last epoch seen (${plantLatest})` });
    plantLatest = epoch;
    plantQueue = plantQueue.then(() => plantAnswer(id, epoch, message.spec));
    return plantQueue;
  };

  return { plantRun, plantRecord, plantTruth };
};
