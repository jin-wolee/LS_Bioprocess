import { describe, expect, it } from "vitest";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import type { StepId } from "./tour.ts";

// P8b (docs/design/plant_ui.md section 3.5, "The steps"): what each step's text says. A text says where to look and what the record keeps and states no simulation result (invariant 3 and 9): it holds no
// digit (a figure reaches it through a placeholder filled with a label), it never calls a feed "scripted" (the feed in the gap of this sample is the rule's daily one), and it ranks nothing. Each step has a
// title and a text in both languages, and each text has the placeholders its step fills.

const STEPS: Record<StepId, string[]> = {
  draw: ["sample", "unit", "clock"],
  feed: ["sample", "unit", "clock"],
  run: ["analyzer", "clock"],
  records: ["sample", "clock"],
  truth: ["sample"],
};
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
const dictionaries = { en, ko } as Record<string, Record<string, string>>;

describe("the texts of the guided scene", () => {
  for (const lang of ["en", "ko"]) {
    for (const [id, names] of Object.entries(STEPS)) {
      it(`Given ${lang} Then the step ${id} has a title without a placeholder and a text with exactly its placeholders`, () => {
        const d = dictionaries[lang] as Record<string, string>;
        expect(d[`plant.tour.${id}.title`]?.length).toBeGreaterThan(0);
        expect(placeholders(d[`plant.tour.${id}.title`] ?? "")).toEqual([]);
        expect(placeholders(d[`plant.tour.${id}.text`] ?? "")).toEqual([...names].sort());
      });
    }
  }

  it("Given the English texts Then none says a feed is scripted, ranks an architecture or states an outcome as a result", () => {
    const tour = Object.entries(en).filter(([k]) => k.startsWith("plant.tour.")).map(([, v]) => v as string);
    expect(tour.length).toBeGreaterThan(20);
    for (const text of tour) {
      expect(text).not.toMatch(/\b(scripted|better|worse|best|wins?|winner|outperform\w*|accuracy|rate)\b/i);
      expect(text).not.toMatch(/\d/);
    }
  });

  it("Given the offer and the buttons Then the English words are the ones the design names", () => {
    expect(en["plant.tour.button"]).toBe("Take the tour");
    expect(en["plant.tour.offer.take"]).toBe("Take the tour");
    expect(en["plant.tour.offer.later"]).toBe("Not now");
    expect(en["plant.tour.back"]).toBe("Back");
    expect(en["plant.tour.next"]).toBe("Next");
    expect(en["plant.tour.finish"]).toBe("Finish");
    expect(en["plant.tour.skip"]).toBe("Skip the tour");
  });
});
