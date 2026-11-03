import { describe, expect, it } from "vitest";
import { wordsOf } from "../plant/action_list.ts";
import { en } from "./en.ts";
import { ko } from "./ko.ts";

// The Korean particle of "to": 로 after a vowel or ㄹ and 으로 after any other final consonant (P8a). A sentence that takes a word from the dictionary does not write "(으)로" for the reader to choose;
// the word comes with its particle, as a key ending in `.to`, and this test keeps every such key to the rule (the expected endings are typed here by hand, not read from the code under test).

const BASE = 0xac00; // the first Hangul syllable
/** The particle a word takes: the final consonant of its last syllable decides (none or ㄹ, code 8, take 로; the others take 으로). */
const particle = (word: string): "로" | "으로" => {
  const last = word.codePointAt(word.length - 1) as number;
  const final = (last - BASE) % 28;
  return final === 0 || final === 8 ? "로" : "으로";
};

const WITH_TO = Object.keys(ko).filter((k) => /^plant\.(act\.(path|method|state)|flags\.state|confirm)\..+\.to$/.test(k)) as (keyof typeof ko)[];

describe("the Korean particle of a word that is the object of 'to'", () => {
  it("Given the two capture paths Then one ends in a vowel and takes 로 and the other in a consonant and takes 으로", () => {
    expect(ko["plant.act.path.manual_transcription.to"]).toBe("수기 전사로");
    expect(ko["plant.act.path.adapter_ingest.to"]).toBe("어댑터 수집으로");
  });

  it("Given the three labelling methods and the two states Then each takes the particle its last syllable asks for", () => {
    expect(ko["plant.act.method.handwritten.to"]).toBe("손글씨로");
    expect(ko["plant.act.method.preprinted_barcode.to"]).toBe("사전 인쇄 바코드로");
    expect(ko["plant.act.method.issued_at_draw.to"]).toBe("채취 시점 발급으로");
    expect(ko["plant.act.state.on.to"]).toBe("켬으로");
    expect(ko["plant.act.state.off.to"]).toBe("끔으로");
  });

  it("Given every key that ends in .to Then it is the word of its base key and the particle of the rule, and the English one is the word itself", () => {
    expect(WITH_TO.length).toBeGreaterThanOrEqual(11);
    for (const key of WITH_TO) {
      const base = key.slice(0, -3) as keyof typeof ko;
      expect(ko[key], key).toBe(ko[base] + particle(ko[base]));
      expect(en[key], key).toBe(en[base]);
    }
  });

  it("Given the sentences of the list Then none leaves the choice of the particle to the reader, and the action reads its word with the particle", () => {
    for (const key of ["plant.act.words.set_capture_path", "plant.act.words.set_labelling", "plant.act.words.set_flag", "plant.flags.cell", "plant.log.confirmed"] as const) expect(ko[key], key).not.toMatch(/\(으\)|\(를\)|\(을\)/);
    expect(wordsOf({ kind: "set_capture_path", at: 1, path: "adapter_ingest" }).slots.path).toEqual({ word: "plant.act.path.adapter_ingest.to" });
    expect(wordsOf({ kind: "set_labelling", at: 1, method: "handwritten" }).slots.method).toEqual({ word: "plant.act.method.handwritten.to" });
    expect(wordsOf({ kind: "set_flag", at: 1, architecture: "c_context", flag: "audit_trail", on: false }).slots.state).toEqual({ word: "plant.act.state.off.to" });
  });
});
