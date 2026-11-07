import type { ProfileInfo } from "../protocol.ts";
import { Ref } from "./Ref.tsx";
import { Label, T } from "./T.tsx";

// The two profile lists of Setup (spec section 4.5.6): one bioreactor profile per bay and one analyzer profile per analyzer, by position. Each pick shows the bundle of the profile with its
// grade; an analyzer profile also shows the analytes it measures. The catalogue comes from `ready`, so nothing here names a profile.

function ProfileSelect({ id, labelKey, n, picked, profiles, onPick, invalid }: { id: string; labelKey: "setup.bay" | "setup.analyzer"; n: number; picked: string; profiles: ProfileInfo[]; onPick: (profile: string) => void; invalid?: boolean }) {
  const profile = profiles.find((p) => p.id === picked);
  return (
    <div class="pick" data-position={n}>
      <T as="label" k={labelKey} for={id} parts={{ n: <Label>{n}</Label> }} />
      <select id={id} {...(invalid && { "aria-invalid": true, "aria-describedby": "fleet-problems" })} data-label value={picked} onChange={(event) => onPick(event.currentTarget.value)}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id}
          </option>
        ))}
      </select>
      {profile && (
        <span class="pick-detail">
          <T k="setup.profile.bundle" /> <Ref ids={[profile.bundle]}>{profile.id}</Ref>
          {profile.stages && (
            <>
              {" "}
              <T k="setup.profile.measures" /> <Label>{profile.stages.flatMap((s) => s.analytes).join(", ")}</Label>
            </>
          )}
        </span>
      )}
    </div>
  );
}

/** One list. `kind` picks the catalogue and the ids of the selects (`bay-1`, `analyzer-1`, ...); `onPick` gets the position (from zero) and the profile id. */
export function ProfileList({ kind, picks, profiles, onPick, invalidPositions = [] }: { kind: "bioreactor" | "analyzer"; picks: string[]; profiles: ProfileInfo[]; onPick: (position: number, profile: string) => void; invalidPositions?: readonly number[] }) {
  const offered = profiles.filter((p) => p.kind === kind);
  if (offered.length === 0) return <T as="p" k="setup.profile.none" />;
  return (
    <div class="picks" data-list={kind}>
      {picks.map((picked, i) => (
        <ProfileSelect invalid={invalidPositions.includes(i + 1)} key={i} id={`${kind === "bioreactor" ? "bay" : "analyzer"}-${i + 1}`} labelKey={kind === "bioreactor" ? "setup.bay" : "setup.analyzer"} n={i + 1} picked={picked} profiles={offered} onPick={(profile) => onPick(i, profile)} />
      ))}
    </div>
  );
}
