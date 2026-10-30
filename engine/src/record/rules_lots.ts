import type { Rule } from "./rule_types.ts";

// VR-021 (data_model 15.5; spec section 5, rule table): a lot or an equipment item is recorded as used and no edge says so. It reads three things, each only with the flag that stores its edge
// (subset schemas, data_model 15.6): a `medium_addition` that names a lot, and no `consumed_in` edge from that lot to the batch (a lot used again by the batch has its one edge, to the first use);
// a `batch.seed_lot_id` with no `seeded_from` edge from that lot to the batch (both with `material_lot_links`); and an `equipment_use` that names an item, with no `used_in` edge from it to that
// use (with `equipment_links`). It writes a finding on a `process_event:` or `batch:` target and changes no row, so the review step does not see it (as for VR-024 to VR-026). The dataset of a
// scenario with a break-out block only: the validation adds this rule for a dataset that has the extension's tables and lists it nowhere else.

export const LOT_RULES: Rule[] = [
  {
    id: "VR-021", severity: "warning", action: "hold",
    unmet: (ds) =>
      ds.architecture.flags.material_lot_links || ds.architecture.flags.equipment_links
        ? null
        : "neither material_lot_links nor equipment_links is on: a lot or an equipment item is free text at most and nothing is stored to compare with an edge",
    check: (ds) => {
      const flags = ds.architecture.flags;
      const edges = ds.lineage_edge ?? [];
      const found: string[] = [];
      if (flags.material_lot_links) {
        const batchOfEvent = new Map(ds.process_event.map((p) => [p.event_id, p.batch_id]));
        const consumed = new Set(edges.filter((e) => e.relation === "consumed_in").map((e) => `${e.from_id}|${batchOfEvent.get(e.to_id)}`));
        for (const p of ds.process_event) if (p.kind === "medium_addition" && p.lot_id != null && !consumed.has(`${p.lot_id}|${p.batch_id}`)) found.push(`process_event:${p.event_id}`);
        const seeded = new Set(edges.filter((e) => e.relation === "seeded_from").map((e) => `${e.from_id}|${e.to_id}`));
        for (const b of ds.batch) if (b.seed_lot_id != null && !seeded.has(`${b.seed_lot_id}|${b.batch_id}`)) found.push(`batch:${b.batch_id}`);
      }
      if (flags.equipment_links) {
        const used = new Set(edges.filter((e) => e.relation === "used_in").map((e) => `${e.from_id}|${e.to_id}`));
        for (const p of ds.process_event) if (p.kind === "equipment_use" && p.equipment_id != null && !used.has(`${p.equipment_id}|${p.event_id}`)) found.push(`process_event:${p.event_id}`);
      }
      return found;
    },
  },
];
