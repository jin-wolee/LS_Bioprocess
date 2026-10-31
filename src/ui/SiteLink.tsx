import { T } from "./T.tsx";

/** The explainer page is one folder up: the Pages site holds it at its root and the lab under `lab/` (lab_ui.md section 13). Relative, so it works under any Pages path. */
export const EXPLAINER_HREF = "../";

/** The link back to the explainer page, in the header. */
export function SiteLink() {
  return (
    <a id="site-link" href={EXPLAINER_HREF}>
      <T k="controls.site" />
    </a>
  );
}
