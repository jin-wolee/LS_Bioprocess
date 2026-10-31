import { BREAKOUT_PUBLIC } from "./generated/breakout_public.ts";

// Whether this build offers the Break-out screen (docs/design/lab_ui.md sections 6 and 20; ADR-0013; the S3a ruling, Open item 2). Extension figures are stricter than the provisional chip: the
// screen shows ids that follow to sources below `main-reread`, so the public build refuses it until those sources are re-read. scripts/lab_ledger.py writes the rule (no id of the screen follows
// to a source below main-reread) into src/generated/breakout_public.ts and into the ledger view (`breakout.public`); a local build (`VITE_LAB_LOCAL=1`) offers the screen anyway and marks
// it "not for publication".

export type Offer = "offered" | "local_only" | "refused";

export const offerOf = (publicOk: boolean, local: boolean): Offer => (publicOk ? "offered" : local ? "local_only" : "refused");

/** The Break-out screen of this build. In a build that refuses it, src/worker/data.ts bundles none of its files (see there), so the public bundle holds no extension figure. */
export const OFFER: Offer = offerOf(BREAKOUT_PUBLIC, import.meta.env.VITE_LAB_LOCAL === "1");
