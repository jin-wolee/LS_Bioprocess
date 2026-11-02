import { Fragment } from "preact";
import { useContext, useEffect, useMemo, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { text } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { ScenePlan } from "../protocol.ts";
import { ErrorBlock } from "../ui/ErrorBlock.tsx";
import { Label, LangContext, T } from "../ui/T.tsx";
import type { Drill } from "./drill.ts";
import { DrillLink, DrillLinks } from "./DrillLinks.tsx";
import { panelOf } from "./panels.ts";
import type { AnalyzerPanel, Listed, Panel, ReactorPanel, SamplePanel, StaffPanel } from "./panels.ts";
import type { PlantRecordState } from "./plant_state.ts";
import type { Playback } from "./playback.ts";
import { useSlowClock } from "./usePlayback.ts";
import { clockOf, keyOf, pickedOfKey } from "./view.ts";
import type { Picked } from "./view.ts";

// The panels of the picked object (docs/design/plant_ui.md section 3.2, "As built in P5b"): a reactor, a sample, an analyzer or a member of staff, at the clock instant. The content is `panelOf`, a pure
// function of the plan, so the figures here are the ones the plan gives; every figure is a label and every time a clock reading. A panel is a region with its heading focused when it opens; Escape or
// its button closes it and the focus goes back to whatever opened it (the record panel's rule). P5c: the links to the other screens at the foot of a panel (section 7).

interface Handlers {
  onClose: () => void;
  onPick: (p: Picked) => void;
}

const Time = ({ t }: { t: number | null }) => {
  if (t === null) return <T k="plant.panel.not_yet" />;
  const c = clockOf(t);
  return <T k="plant.clock.reading" parts={{ day: <Label>{c.day}</Label>, time: <Label>{c.time}</Label> }} />;
};

/** A row of a panel: the name of a figure and the figure, which `field` names for the end-to-end check. */
const Row = ({ name, field, children }: { name: Key; field?: string; children: ComponentChildren }) => (
  <>
    <T as="dt" k={name} />
    <dd {...(field && { "data-panel-field": field })}>{children}</dd>
  </>
);

/** The newest rows of a panel, each a button that picks the sample. */
function Newest({ rows, onPick }: { rows: Listed[]; onPick: (p: Picked) => void }) {
  const lang = useContext(LangContext);
  if (rows.length === 0) return <T as="p" k="plant.panel.none" />;
  return (
    <ul class="plant-object-list" data-panel-list="newest">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" data-pick-sample={r.id} onClick={() => onPick({ kind: "sample", index: r.sample })} title={text(lang, "plant.panel.pick", { sample: r.id })}>
            <T k="plant.panel.at" parts={{ sample: <Label>{r.id}</Label>, clock: <Time t={r.at_s} /> }} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Reactor({ p, drill, onPick }: { p: ReactorPanel; drill: Drill; onPick: (x: Picked) => void }) {
  const newest = p.newest[0];
  return (
    <>
    <dl class="plant-facts">
      <Row name="plant.panel.bay"><Label>{p.bay}</Label></Row>
      <Row name="plant.panel.profile"><Label>{p.profile}</Label></Row>
      <Row name="plant.panel.batch" field="batch">{p.batch === null ? <T k="plant.batch.none" /> : <Label>{p.batch}</Label>}</Row>
      <Row name="plant.panel.status" field="status"><T k={`plant.status.${p.status}`} /></Row>
      <Row name="plant.panel.started" field="started"><Time t={p.started_s} /></Row>
      <Row name="plant.panel.ended" field="ended"><Time t={p.ended_s} /></Row>
      <Row name="plant.panel.drawn" field="drawn"><Label>{p.drawn}</Label></Row>
      <T as="dt" k="plant.panel.newest" />
      <dd><Newest rows={p.newest} onPick={onPick} /></dd>
    </dl>
    {newest ? (
      <DrillLinks>
        <DrillLink name="lineage" href={drill.lineage(newest.id)} k="plant.drill.lineage" parts={{ sample: <Label>{newest.id}</Label> }} />
      </DrillLinks>
    ) : (
      <T as="p" k="plant.drill.lineage.none" data-note="drill" />
    )}
    </>
  );
}

function Staff({ p, drill, onPick }: { p: StaffPanel; drill: Drill; onPick: (x: Picked) => void }) {
  return (
    <>
    <dl class="plant-facts">
      <Row name="plant.panel.duty" field="duty"><T k={p.on_duty ? "plant.duty.on" : "plant.duty.off"} /></Row>
      <Row name="plant.panel.mode" field="mode"><T k={`plant.mode.${p.mode}`} /></Row>
      <Row name="plant.panel.draws" field="drawn"><Label>{p.drawn}</Label></Row>
      <T as="dt" k="plant.panel.newest" />
      <dd><Newest rows={p.newest} onPick={onPick} /></dd>
      <Row name="plant.panel.qualification" field="qualification">
        {p.qualification === null ? <T k="plant.qualification.unknown" /> : <T k={p.qualification ? "plant.qualification.stored" : "lineage.null"} />}
      </Row>
    </dl>
    <DrillLinks>
      <DrillLink name="notes" href={drill.notes()} k="plant.drill.notes" />
    </DrillLinks>
    </>
  );
}

function Analyzer({ plan, p, drill, onPick }: { plan: ScenePlan; p: AnalyzerPanel; drill: Drill; onPick: (x: Picked) => void }) {
  const open = (id: string) => () => {
    const found = pickedOfKey(plan, `sample:${id}`);
    if (found) onPick(found);
  };
  const lane = p.lane.map((id) => (
    <li key={id}>
      <button type="button" data-pick-sample={id} onClick={open(id)}>
        <Label>{id}</Label>
      </button>
    </li>
  ));
  return (
    <>
    <dl class="plant-facts">
      <Row name="plant.panel.profile"><Label>{p.profile}</Label></Row>
      <Row name="plant.panel.group"><Label>{p.group}</Label></Row>
      <Row name="plant.panel.lamp" field="lamp"><T k={`plant.lamp.${p.lamp}`} /></Row>
      <Row name="plant.panel.inside" field="inside">{p.inside === null ? <T k="plant.panel.none" /> : <Label>{p.inside}</Label>}</Row>
      <T as="dt" k="plant.panel.lane" />
      <dd data-panel-field="lane" data-lane-length={p.lane.length}>{p.lane.length === 0 ? <T k="plant.panel.lane.empty" /> : <ul class="plant-object-list">{lane}</ul>}</dd>
      <Row name="plant.panel.finished" field="finished"><Label>{p.finished}</Label></Row>
      <T as="dt" k="plant.panel.newest" />
      <dd><Newest rows={p.newest} onPick={onPick} /></dd>
      <T as="dt" k="plant.panel.windows" />
      <dd data-panel-field="windows">
        {p.windows.length === 0 ? (
          <T k="plant.panel.windows.none" />
        ) : (
          <ul class="plant-window-list">
            {p.windows.map((w) => (
              <li key={`${w.kind}-${w.from_s}`} data-window-open={w.open}>
                <T k={w.open ? "plant.panel.window.open" : "plant.panel.window.next"} parts={{ kind: <T k={`plant.lamp.${w.kind as "qc" | "maintenance" | "closed"}`} />, from: <Time t={w.from_s} />, to: <Time t={w.to_s} /> }} />
              </li>
            ))}
          </ul>
        )}
      </dd>
    </dl>
    <DrillLinks>
      <DrillLink name="results" href={drill.results(plan.layout.architectures, "utilisation")} k="plant.drill.utilisation" />
    </DrillLinks>
    </>
  );
}

function Sample({ p, drill, fields, lens, following, onFollow, onOpenRecord }: { p: SamplePanel; drill: Drill; fields: PlantRecordState | null; lens: string; following: boolean; onFollow: () => void; onOpenRecord: () => void }) {
  const mine = fields !== null && fields.sample_id === p.id ? fields : null;
  const row = mine?.view?.nodes.find((n) => n.table === "sample");
  return (
    <>
      <dl class="plant-facts">
        <Row name="plant.panel.unit"><Label>{p.unit}</Label></Row>
        <Row name="plant.panel.operator" field="operator">{p.operator === null ? <T k="plant.panel.none" /> : <Label>{p.operator}</Label>}</Row>
        <Row name="plant.panel.label" field="label">{p.label === null ? <T k="plant.panel.none" /> : <Label>{p.label}</Label>}</Row>
        <Row name="plant.panel.phase" field="phase"><T k={`plant.phase.${p.phase}`} /></Row>
        <Row name="plant.panel.planned" field="planned"><Time t={p.planned_s} /></Row>
        <Row name="plant.panel.drawn_at" field="drawn"><Time t={p.drawn_s} /></Row>
        <Row name="plant.panel.arrived" field="arrived"><Time t={p.arrived_s} /></Row>
      </dl>
      <T as="h3" k="plant.panel.visits" />
      {p.visits.length === 0 ? (
        <T as="p" k="plant.panel.visits.none" />
      ) : (
        <ol class="plant-visits" data-panel-field="visits" data-visits={p.visits.length}>
          {p.visits.map((v) => (
            <li key={v.attempt + v.analyzer + v.queued_s} data-visit-analyzer={v.analyzer}>
              <T k="plant.panel.visit" parts={{ analyzer: <Label>{v.analyzer}</Label>, attempt: <Label>{v.attempt}</Label> }} />
              <dl class="plant-facts">
                <Row name="plant.panel.queued"><Time t={v.queued_s} /></Row>
                <Row name="plant.panel.entered"><Time t={v.started_s} /></Row>
                <Row name="plant.panel.run_began"><Time t={v.run_started_s} /></Row>
                <Row name="plant.panel.finished_at"><Time t={v.ended_s} /></Row>
                <Row name="plant.panel.qc">{v.qc === null ? <T k="plant.panel.not_yet" /> : <T k={`plant.log.outcome.${v.qc}` as Key} />}</Row>
              </dl>
            </li>
          ))}
        </ol>
      )}
      <T as="h3" k="plant.panel.fields" />
      <p class="plant-panel-lens"><Label>{lens}</Label></p>
      {!p.card ? (
        <T as="p" k="plant.panel.fields.none" data-note="fields" />
      ) : mine?.problem ? (
        <ErrorBlock problem={{ id: mine.id, code: mine.problem.code, message: mine.problem.message }} />
      ) : !row ? (
        <T as="p" k="plant.panel.fields.loading" />
      ) : (
        <dl class="plant-facts" data-panel-field="fields">
          {row.fields.map((f) => (
            <Fragment key={f.name}>
              <dt><code>{f.name}</code></dt>
              <dd>{f.value === null ? <T k={f.no_value ? "lineage.no_value" : "lineage.null"} /> : <Label>{f.value}</Label>}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <div class="plant-panel-actions">
        {p.phase !== "planned" && p.phase !== "skipped" && p.phase !== "gone" && (
          <button type="button" data-panel-action="follow" aria-pressed={following} onClick={onFollow}>
            <T k={following ? "plant.panel.unfollow" : "plant.panel.follow"} />
          </button>
        )}
        <button type="button" data-panel-action="record" disabled={!p.card} onClick={onOpenRecord}>
          <T k="plant.panel.open_record" />
        </button>
      </div>
      {p.phase !== "planned" && p.phase !== "skipped" && (
        <DrillLinks>
          <DrillLink name="lineage" href={drill.lineage(p.id)} k="plant.drill.lineage" parts={{ sample: <Label>{p.id}</Label> }} />
        </DrillLinks>
      )}
    </>
  );
}

const HEADING = { reactor: "plant.panel.reactor", sample: "plant.panel.sample", analyzer: "plant.panel.analyzer", staff: "plant.panel.staff" } as const satisfies Record<Panel["kind"], Key>;

export function Panels({ plan, playback, pick, lens, fields, following, drill, onClose, onPick, onFollow, onOpenRecord, onFields, onFieldsClose }: Handlers & {
  plan: ScenePlan;
  drill: Drill;
  playback: Playback;
  pick: Picked;
  lens: string;
  fields: PlantRecordState | null;
  following: boolean;
  onFollow: () => void;
  onOpenRecord: (architecture: string, sample_id: string) => void;
  /** The sample panel reads the rows of its sample from the lens hall, once the hall stands a card of it; leaving the panel (or a sample without a card) closes the request. */
  onFields: (architecture: string, sample_id: string) => void;
  onFieldsClose: () => void;
}) {
  const lang = useContext(LangContext);
  const root = useRef<HTMLElement>(null);
  const at = Math.floor(useSlowClock(playback, 1).t);
  const panel = useMemo(() => panelOf(plan, pick, at, lens), [plan, pick.kind, pick.index, at, lens]);
  const key = keyOf(plan, pick);

  // it opens with the focus on its heading's region; closing gives the focus back to whatever opened it
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [key]);

  const wanted = panel.kind === "sample" && panel.card ? panel.id : null;
  useEffect(() => {
    if (wanted === null) onFieldsClose();
    else onFields(lens, wanted);
  }, [wanted, lens]);
  useEffect(() => onFieldsClose, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section ref={root} class="plant-panel" tabIndex={-1} role="region" aria-labelledby="plant-panel-heading" data-plant-panel={panel.kind} data-panel-key={key}>
      <div class="plant-record-head">
        <T as="h2" k={HEADING[panel.kind]} id="plant-panel-heading" parts={{ id: <Label>{panel.id}</Label> }} />
        <button type="button" class="plant-record-close" data-panel="close" aria-label={text(lang, "plant.panel.close")} title={text(lang, "plant.panel.close")} onClick={onClose}>
          ×
        </button>
      </div>
      {panel.kind === "reactor" && <Reactor p={panel} drill={drill} onPick={onPick} />}
      {panel.kind === "staff" && <Staff p={panel} drill={drill} onPick={onPick} />}
      {panel.kind === "analyzer" && <Analyzer plan={plan} p={panel} drill={drill} onPick={onPick} />}
      {panel.kind === "sample" && <Sample p={panel} drill={drill} fields={fields} lens={lens} following={following} onFollow={onFollow} onOpenRecord={() => onOpenRecord(lens, panel.id)} />}
    </section>
  );
}
