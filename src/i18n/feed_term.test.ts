import { describe, expect, it } from "vitest";
import { en } from "./en.ts";
import { ko } from "./ko.ts";
import type { Key } from "./en.ts";

// The Korean term for the fed-batch feed (docs/design/plant_ui.md section 12, item 15; the author, 2026-11-02): one term, 피드, in every Korean dictionary of the lab, so that the word on the bar of the
// plant is the word of its log, of the lineage view and of the notes. The English is not touched. The expected texts are typed by hand.

const keys = Object.keys(en) as Key[];

describe("The Korean term for a feed is 피드 everywhere (section 12, item 15)", () => {
  it("Given the bar's add_feed Then the Korean is 피드 추가 and the English is unchanged", () => {
    expect(ko["plant.bar.add_feed"]).toBe("피드 추가");
    expect(en["plant.bar.add_feed"]).toBe("Add a feed");
  });

  it("Given the plant's log line, the lineage view's context and the notes Then each says 피드", () => {
    expect(ko["plant.log.feed"]).toBe("{clock}: 바이오리액터 {unit} 피드.");
    expect(ko["lineage.truth.context.value"]).toBe("피드 {epoch}회차, 단계 {phase}");
    expect(ko["flag.material_lot_links.on"]).toContain("피드 추가");
    expect(ko["lineage.pick.rule.note"]).toContain("피드");
  });

  it("Given an English text that mentions a feed Then its Korean text says 피드", () => {
    const withFeed = keys.filter((k) => /\bfeeds?\b/i.test(en[k]));
    expect(withFeed.length).toBeGreaterThanOrEqual(7);
    for (const k of withFeed) expect(ko[k], k).toContain("피드");
  });

  it("Given every Korean text Then none says 공급 (the term the plant used before 2026-11-02)", () => {
    for (const k of keys) expect(ko[k], k).not.toContain("공급");
  });
});
