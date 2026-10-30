import type { DecisionRecordView, RecordView } from "../protocol.ts";
import { formatValue } from "./lineage_layout.ts";
import { RowTable } from "./RowTable.tsx";
import { Label, T } from "./T.tsx";

// The tables of the shown record (lab_ui.md section 9, "What the reader can open"). The sample variant: the samples, the results, the findings of the record's own rules and, where audit_trail is
// on, the audit events. The decision variant: the decisions in time order and the samples with a pH result. Recorded rows only; the reader opens a sample to see its rows joined by their keys.

type Actions = { disabled: boolean; onOpen: (sample_id: string) => void; onGuess: (target: { sample_id: string } | { decision_id: string }) => void };
const show = (v: string | number | null): string => (v === null ? "–" : String(formatValue(v)));

function SampleActions({ id, actions }: { id: string; actions: Actions }) {
  return (
    <>
      <button type="button" class="row-open" disabled={actions.disabled} onClick={() => actions.onOpen(id)}>
        <T k="challenge.open" />
      </button>{" "}
      <button type="button" class="row-guess" disabled={actions.disabled} onClick={() => actions.onGuess({ sample_id: id })}>
        <T k="challenge.guess" />
      </button>
    </>
  );
}

export function SampleTables({ record, actions }: { record: RecordView; actions: Actions }) {
  return (
    <>
      <RowTable
        name="samples" title="challenge.record.samples" rows={record.samples} idOf={(r) => r.sample_id}
        columns={[
          { head: "sample_id", cell: (r) => r.sample_id }, { head: "unit_id", cell: (r) => r.unit_id }, { head: "batch_id", cell: (r) => show(r.batch_id) },
          { head: "sampled_at", cell: (r) => show(r.sampled_at) }, { head: "planned_at", cell: (r) => show(r.planned_at) }, { head: "state", cell: (r) => show(r.state) },
        ]}
        actions={(r) => <SampleActions id={r.sample_id} actions={actions} />}
      />
      <RowTable
        name="results" title="challenge.record.results" rows={record.results} idOf={(r) => r.request_id}
        columns={[
          { head: "request_id", cell: (r) => r.request_id }, { head: "analyte", cell: (r) => r.analyte }, { head: "version", cell: (r) => r.version }, { head: "value", cell: (r) => show(r.value) },
          { head: "measured_at", cell: (r) => r.measured_at }, { head: "available_at", cell: (r) => show(r.available_at) }, { head: "state", cell: (r) => show(r.state) },
        ]}
      />
      <RowTable
        name="findings" title="challenge.record.findings" rows={record.findings} idOf={(r) => r.target}
        columns={[{ head: "rule", cell: (r) => r.rule }, { head: "target", cell: (r) => r.target }, { head: "severity", cell: (r) => r.severity }, { head: "status", cell: (r) => r.status }]}
      />
      <RowTable
        name="audit" title="challenge.record.audit" rows={record.audit_events} idOf={(r) => r.request_id}
        columns={[
          { head: "audit_id", cell: (r) => r.audit_id }, { head: "request_id", cell: (r) => r.request_id }, { head: "analyte", cell: (r) => r.analyte }, { head: "at", cell: (r) => r.at },
          { head: "old_value", cell: (r) => show(r.old_value) }, { head: "new_value", cell: (r) => show(r.new_value) },
        ]}
      />
    </>
  );
}

/** What a decision did and what it read, in words and labels. */
function Decision({ d }: { d: DecisionRecordView["decisions"][number] }) {
  return (
    <>
      <T k={`challenge.decision.action.${d.action}`} />{" "}
      {d.action === "readjust" && <Label>{show(d.onto)}</Label>}
      {d.read ? (
        <T
          k="challenge.decision.read"
          class="dec-read"
          parts={{ filed: <Label>{d.read.filed_under}</Label>, measured: <Label>{d.read.measured_at}</Label>, value: <Label>{show(d.read.value)}</Label>, container: <Label>{show(d.read.container)}</Label>, hold: <Label>{show(d.read.hold_s)}</Label> }}
        />
      ) : (
        <T k="challenge.decision.noread" class="dec-read" />
      )}
    </>
  );
}

export function DecisionTables({ record, actions }: { record: DecisionRecordView; actions: Actions }) {
  return (
    <>
      <T as="p" k="challenge.decisions.lead" />
      <RowTable
        name="decisions" title="challenge.record.decisions" rows={record.decisions} idOf={(r) => r.decision_id}
        columns={[{ head: "decision_id", cell: (r) => r.decision_id }, { head: "unit_id", cell: (r) => r.unit_id }, { head: "t", cell: (r) => r.t }, { head: "decision", cell: (r) => <Decision d={r} /> }]}
        actions={(r) => (
          <>
            {r.read && (
              <>
                <button type="button" class="row-open" disabled={actions.disabled} onClick={() => actions.onOpen((r.read as { filed_under: string }).filed_under)}>
                  <T k="challenge.open" />
                </button>{" "}
              </>
            )}
            <button type="button" class="row-guess" disabled={actions.disabled} onClick={() => actions.onGuess({ decision_id: r.decision_id })}>
              <T k="challenge.guess" />
            </button>
          </>
        )}
      />
      <RowTable
        name="samples" title="challenge.decision.samples" rows={record.samples} idOf={(r) => r.sample_id}
        columns={[
          { head: "sample_id", cell: (r) => r.sample_id }, { head: "unit_id", cell: (r) => r.unit_id }, { head: "sampled_at", cell: (r) => show(r.sampled_at) },
          { head: "container", cell: (r) => show(r.container) }, { head: "hold_s", cell: (r) => show(r.hold_s) },
        ]}
        actions={(r) => (
          <button type="button" class="row-open" disabled={actions.disabled} onClick={() => actions.onOpen(r.sample_id)}>
            <T k="challenge.open" />
          </button>
        )}
      />
      <RowTable
        name="findings" title="challenge.record.findings" rows={record.findings} idOf={(r) => r.target}
        columns={[{ head: "rule", cell: (r) => r.rule }, { head: "target", cell: (r) => r.target }, { head: "severity", cell: (r) => r.severity }, { head: "status", cell: (r) => r.status }]}
      />
    </>
  );
}
