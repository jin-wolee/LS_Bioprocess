import type { ScenarioInfo } from "../protocol.ts";
import { Ref } from "./Ref.tsx";
import { Label } from "./T.tsx";

/** The inputs of a scenario, each as the file gives it with its ledger id, its grade and, when a source is below main-reread, the provisional chip (lab_ui.md section 6). */
export function ScenarioInputs({ scenario }: { scenario: ScenarioInfo | undefined }) {
  if (!scenario) return null;
  return (
    <ul class="inputs">
      {scenario.settings.map((s) => (
        <li key={s.name}>
          <code class="input-name">
            <Label>{s.name}</Label>
          </code>
          <Ref ids={[s.ref]}>
            {s.value} {s.unit}
          </Ref>
        </li>
      ))}
    </ul>
  );
}
