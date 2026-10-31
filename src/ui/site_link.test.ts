import { describe, expect, it } from "vitest";
import { en } from "../i18n/en.ts";
import { ko } from "../i18n/ko.ts";
import { EXPLAINER_HREF, SiteLink } from "./SiteLink.tsx";

// The way back from the lab to the explainer page (lab_ui.md section 13). The Pages site holds the infographic at its root and the lab one folder below it (`lab/`), so the way back is the
// relative address `../`; a relative address works under any Pages path (a project site lives under /<repository>/). scripts/qa_site.py follows the link on the assembled folder.

interface VNode {
  type: unknown;
  props: { id?: string; href?: string; children?: VNode };
}
const link = SiteLink() as unknown as VNode;

describe("the link back to the explainer page", () => {
  it("Given the link Then it is an anchor to the folder above, as a relative address", () => {
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("../");
    expect(EXPLAINER_HREF).toBe("../");
  });

  it("Given the link Then it has an id the end-to-end checks can reach", () => {
    expect(link.props.id).toBe("site-link");
  });

  it("Given the link Then its text is a dictionary key with an English and a Korean text", () => {
    const key = (link.props.children?.props as { k?: string } | undefined)?.k;
    expect(key).toBe("controls.site");
    expect(en["controls.site"]).toBe("Explainer page");
    expect(ko["controls.site"]).toBe("해설 페이지");
  });
});
