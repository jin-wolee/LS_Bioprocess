import type { PlantProblem } from "./plant_state.ts";
import { ErrorBlock } from "../ui/ErrorBlock.tsx";
import { Label, T } from "../ui/T.tsx";

// The text at the head of the plant route (docs/design/plant_ui.md section 9): the heading, the lead, the status line and, without WebGL, the notice. It is part of the first load.

/** What the scene is doing: not asked for, being fetched, drawn, or failed with the message of the error. */
export type SceneStatus = { kind: "none" | "loading" | "ready" } | { kind: "failed"; message: string };

export function Intro({ webgl, planned, problem, scene, state, renderer }: {
  webgl: boolean;
  /** Whether the Worker's first plan has arrived. */
  planned: boolean;
  problem: PlantProblem | null;
  scene: SceneStatus;
  /** The value of `data-plant-status`: `text` without WebGL, otherwise the scene's state. */
  state: string;
  renderer: string | null;
}) {
  return (
    <section class="plant-intro" aria-labelledby="plant-heading">
      <T as="h1" k="plant.heading" id="plant-heading" />
      <T as="p" k="plant.lead" />
      {problem && <ErrorBlock problem={{ id: null, code: problem.code, message: problem.message }} />}
      <p id="plant-status" role="status" data-plant-status={state} class="plant-status">
        <T k={planned ? "plant.status.plan.ready" : "plant.status.plan.waiting"} />{" "}
        {webgl && scene.kind === "loading" && planned && <T k="plant.status.scene.loading" />}
        {webgl && scene.kind === "ready" && <T k="plant.status.scene.ready" />}
        {scene.kind === "failed" && (
          <>
            <T k="plant.status.scene.failed" />{" "}
            <code>
              <Label engine>{scene.message}</Label>
            </code>
          </>
        )}{" "}
        {renderer && <T k="plant.status.renderer" parts={{ renderer: <Label engine>{renderer}</Label> }} />}
      </p>
      {!webgl && (
        <div class="notice" role="note" data-plant-fallback>
          <T as="h2" k="plant.nowebgl.heading" />
          <T as="p" k="plant.nowebgl.notice" />
        </div>
      )}
    </section>
  );
}
