import type { ExperimentReport } from "../../engine/src/generated/experiment_report.schema";
import type { RefValue, UtilisationRow, UtilisationView } from "../protocol.ts";
import { Figure } from "./Figure.tsx";
import { Ref } from "./Ref.tsx";
import type { ReportRow } from "./results_view.ts";
import { groupRows } from "./results_view.ts";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// Utilisation, once (spec section 4.5.6): it is read from the truth run that every architecture shares, so it is not repeated per architecture. The pooled figure comes from the report; the
// figure per analyzer profile comes from the Worker's view (the report leaves arrays out), with the grade of the profile's bundle beside it.

const PATH = /^utilisation\.per_(staffed_window|24h)\.(with|without)_setup$/;

/** The staffed window and the full day, with and without setup time: the name of a figure, the window length (A098) shown beside the staffed window. */
function WindowName({ window, setup, staffed }: { window: "staffed" | "24h"; setup: "with" | "without"; staffed: RefValue | undefined }) {
  return (
    <>
      <T k={window === "staffed" ? "util.window.staffed" : "util.window.day"} />
      {window === "staffed" && staffed && (
        <>
          {" "}
          (<Ref ids={[staffed.ref]}>
            {staffed.value} {staffed.unit}
          </Ref>)
        </>
      )}
      {", "}
      <T k={setup === "with" ? "util.setup.with" : "util.setup.without"} />
    </>
  );
}

/** A row of the Worker's view as a row of the report, so that one component draws both. */
const asRow = (profile: string, row: UtilisationRow, seeds: number): ReportRow => ({
  metric: `utilisation.by_profile.${profile}.${row.window}.${row.setup}`,
  status: row.n_defined > 0 ? "reported" : "none_occurred",
  n_seeds: seeds,
  n_defined: row.n_defined,
  median: row.median,
  lo: row.lo,
  hi: row.hi,
  denominator: row.denominator,
  den: null,
  reason: null,
});

export function Utilisation({ report, view, ready }: { report: ExperimentReport; view: UtilisationView | undefined; ready: ReadyInfo }) {
  const staffed = ready.evaluation.find((e) => e.name === "staffed_window_h");
  const pooled = groupRows(report.architectures[0]?.rows ?? []).utilisation;
  const profiles = view?.by_profile ?? [];
  return (
    <section id="utilisation" class="utilisation" data-utilisation aria-labelledby="util-heading">
      <T as="h2" k="util.heading" id="util-heading" />
      <T as="p" k="util.lead" />
      <T as="h3" k="util.pooled" />
      <div class="figures">
        {pooled.map((row) => {
          const m = PATH.exec(row.metric);
          const window = m?.[1] === "24h" ? "24h" : "staffed";
          const setup = m?.[2] === "without" ? "without" : "with";
          return <Figure key={row.metric} name={<WindowName window={window} setup={setup} staffed={staffed} />} row={row} max={1} label={row.metric} />;
        })}
      </div>
      {profiles.map((p) => {
        const bundle = ready.profiles.find((x) => x.kind === "analyzer" && x.id === p.profile)?.bundle;
        return (
        <div key={p.profile} class="util-profile" data-profile={p.profile}>
          <h3>
            <T k="util.profile" /> {bundle ? <Ref ids={[bundle]}><Label>{p.profile}</Label></Ref> : <Label>{p.profile}</Label>} <Label>{p.instruments}</Label> <T k="util.instruments" />
          </h3>
          <div class="figures">
            {p.rows.map((row) => (
              <Figure key={`${row.window}${row.setup}`} name={<WindowName window={row.window} setup={row.setup} staffed={staffed} />} row={asRow(p.profile, row, report.n_seeds)} max={1} label={p.profile} />
            ))}
          </div>
        </div>
        );
      })}
      {profiles.length > 1 && <T as="p" k="util.routing" class="notice" />}
    </section>
  );
}
