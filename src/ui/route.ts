// Hash routes (docs/design/lab_ui.md section 2): the path picks the screen and the query carries the shareable state. A few lines, no router. Lineage, Challenge and Break-out join the
// list when their steps land (Lineage and Challenge landed in S3e).

export const SCREENS = ["home", "setup", "results", "lineage", "challenge", "notes"] as const;
export type Screen = (typeof SCREENS)[number];

export interface Route {
  screen: Screen;
  query: string;
}

/** The route of a hash such as `#/setup?scenario=default`; a hash that names no screen is Home. */
export const parseHash = (hash: string): Route => {
  const at = hash.indexOf("?");
  const path = (at === -1 ? hash : hash.slice(0, at)).replace(/^#\//, "");
  const screen = SCREENS.find((s) => s === path);
  return { screen: screen ?? "home", query: at === -1 ? "" : hash.slice(at + 1) };
};

export const hashOf = (screen: Screen, query = ""): string => `#/${screen}${query === "" ? "" : `?${query}`}`;
