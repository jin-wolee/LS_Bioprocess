import { useEffect, useRef, useState } from "preact/hooks";
import { drillFromQuery } from "../plant/drill.ts";
import type { AskLink, Known } from "../plant/link.ts";
import type { Route } from "./route.ts";

// A screen opened from the plant (docs/design/plant_ui.md section 7, "As built in P5c"): the plant it came from, kept until the reader enters the plant or Home, and the part of the screen the link names,
// scrolled to once it is there. A Lineage link is acted on once for each link: `onSample` asks for the sample; so is a Break-out link (P7c): `onBreakout` asks for the case.

export interface Origin {
  link: AskLink;
  /** The id of the part of the page to scroll to (`flag-table`, `utilisation`), until it has been scrolled to. */
  focus: string | null;
}

/** `known` is null while the build is not ready; `results` changes when a result arrives, which is when the utilisation block exists. */
export function useOrigin(known: Known | null, route: Route, results: unknown, onSample: (link: AskLink, sample: string) => void, onBreakout: (link: AskLink) => void): Origin | null {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!known) return;
    if (route.screen === "plant" || route.screen === "home") return setOrigin(null);
    const drill = route.query === "" ? null : drillFromQuery(route.query, known);
    if (!drill) return;
    setOrigin({ link: drill.link, focus: drill.focus });
    if (route.screen === "lineage" && drill.sample !== null && handled.current !== route.query) {
      handled.current = route.query;
      onSample(drill.link, drill.sample);
    }
    // the Break-out screen opened from a case of the plant asks for that case once for each link (P7c)
    if (route.screen === "breakout" && handled.current !== route.query) {
      handled.current = route.query;
      onBreakout(drill.link);
    }
  }, [known !== null, route.screen, route.query]);

  useEffect(() => {
    const target = origin?.focus ? document.getElementById(origin.focus) : null;
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    setOrigin((now) => (now ? { ...now, focus: null } : now));
  }, [route.screen, results, origin]);

  return origin;
}
