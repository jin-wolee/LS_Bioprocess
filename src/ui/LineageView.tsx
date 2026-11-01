import type { LineageView as View } from "../protocol.ts";
import { FlagLegend } from "./Flags.tsx";
import { RecordSvg } from "./RecordSvg.tsx";
import { ErrorTypeName } from "./Figure.tsx";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// The lineage view of one sample (lab_ui.md section 8): the truth column and one column per record. Used by the Lineage screen and by the reveal of the challenge. It sits inside a result
// block of its screen, so every identifier and count in it is marked (invariant 3).

export function LineageTruth({ view }: { view: Pick<View, "truth" | "sample"> }) {
  const { truth, sample } = view;
  return (
    <section class="lg-truth" data-lineage-truth aria-labelledby="lg-truth-heading">
      <T as="h3" k="lineage.truth.heading" id="lg-truth-heading" />
      <T as="p" k="lineage.truth.lead" />
      <dl class="facts">
        <T as="dt" k="lineage.truth.sample" />
        <dd>
          <Label>{sample.sample_id}</Label> <T k={`lineage.picked.${sample.picked_by}`} class="chip" />
        </dd>
        <T as="dt" k="lineage.truth.unit" />
        <dd data-truth="unit">
          <Label>{truth.unit_id}</Label>
        </dd>
        <T as="dt" k="lineage.truth.sampled_at" />
        <dd data-truth="sampled_at">
          <Label>{truth.sampled_at}</Label>
        </dd>
        <T as="dt" k="lineage.truth.context" />
        <dd data-truth="process_context">
          <T k="lineage.truth.context.value" parts={{ epoch: <Label>{truth.context.feed_epoch}</Label>, phase: <Label>{truth.context.batch_phase}</Label> }} />
        </dd>
      </dl>
    </section>
  );
}

/** The errors the injector materialised on the sample in one record: the heading, then the list (or "none"). The lineage columns and the truth block of the plant's record panel draw it. */
export function RealisedErrors({ column }: { column: Pick<View["columns"][number], "architecture" | "realised_errors"> }) {
  return (
    <>
      <T as="h4" k="lineage.errors.heading" />
      {column.realised_errors.length === 0 ? (
        <T as="p" k="lineage.errors.none" data-realised={column.architecture} />
      ) : (
        <ul class="lg-errors" data-realised={column.architecture}>
          {column.realised_errors.map((e, i) => (
            <li key={i} data-error-type={e.type}>
              <ErrorTypeName type={e.type} />{" "}
              {Object.entries(e.detail).map(([name, value]) => (
                <span key={name} class="lg-detail">
                  <code>{name}</code> <Label>{value}</Label>{" "}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function LineageColumns({ view, ready }: { view: View; ready: ReadyInfo }) {
  return (
    <>
      <T as="p" k="lineage.legend.edges" class="lg-legend" />
      <T as="p" k="lineage.legend.answers" class="lg-legend" />
      <div class="lg-columns">
        {view.columns.map((column) => (
          <section key={column.architecture} class="lg-column" data-architecture={column.architecture} aria-labelledby={`lg-h-${column.architecture}`}>
            <h3 id={`lg-h-${column.architecture}`}>
              <Label>{column.architecture}</Label>
            </h3>
            <dl class="facts">
              <T as="dt" k="lineage.column.labelling" />
              <dd>
                <Label>{column.labelling}</Label>
              </dd>
            </dl>
            <T as="h4" k="lineage.column.flags" />
            <FlagLegend ready={ready} architecture={column.architecture} list="lineage-column" />
            <RecordSvg column={column} sample={view.sample.sample_id} truth={view.truth} />
            <RealisedErrors column={column} />
          </section>
        ))}
      </div>
    </>
  );
}
