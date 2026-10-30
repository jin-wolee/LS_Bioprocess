import { hasKey } from "../i18n/index.ts";
import type { Key } from "../i18n/index.ts";
import type { PresetInfo } from "../protocol.ts";
import type { ReadyInfo } from "./state.ts";
import { Label, T } from "./T.tsx";

// Every place that lists the flags (lab_ui.md section 11) reads `ready.flags`: the page never types how many flags exist. Each list carries `data-flag-list`, each flag in it
// `data-flag`, and the end-to-end check `flags` fails when a list lacks a flag of `ready.flags` or names one that is not in it. A flag the dictionary has no entries for yet shows its
// name (the engine adds a flag; the dictionary follows).

const entry = (flag: string, part: "label" | "on" | "off" | "effect"): Key | null => {
  const key = `flag.${flag}.${part}`;
  return hasKey(key) ? key : null;
};

/** The name of a flag: its translated label and the engine's name for it. */
export function FlagName({ flag }: { flag: string }) {
  const label = entry(flag, "label");
  return (
    <>
      {label && <T k={label} />} <code class="flag-name"><Label>{flag}</Label></code>
    </>
  );
}

/** A flag state in words and shape: a check mark for on, a dash for off. Colour is not the only carrier. */
export function FlagState({ on }: { on: boolean }) {
  return (
    <span class={`flag-state flag-${on ? "on" : "off"}`} data-flag-state={on ? "on" : "off"}>
      <span aria-hidden="true">{on ? "✓" : "–"}</span> <T k={on ? "flag.state.on" : "flag.state.off"} />
    </span>
  );
}

/** The flags against the presets A, B and C (Setup): one row per flag, one column per preset, then the labelling method and the capture path default of each preset. */
export function FlagMatrix({ ready }: { ready: ReadyInfo }) {
  const presets: PresetInfo[] = ready.presets.filter((p) => p.role === "preset");
  return (
    <table class="flag-matrix" data-flag-list="setup-matrix">
      <thead>
        <tr>
          <T as="th" k="setup.flags.flag" />
          {presets.map((p) => (
            <th key={p.id} scope="col">
              <Label>{p.id}</Label>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ready.flags.map((flag) => (
          <tr key={flag} data-flag={flag}>
            <th scope="row">
              <FlagName flag={flag} />
            </th>
            {presets.map((p) => (
              <td key={p.id}>
                <FlagState on={p.flags[flag] === true} />
              </td>
            ))}
          </tr>
        ))}
        <tr>
          <T as="th" k="setup.flags.labelling" />
          {presets.map((p) => (
            <td key={p.id}>
              <Label>{p.labelling}</Label>
            </td>
          ))}
        </tr>
        <tr>
          <T as="th" k="setup.flags.capture" />
          {presets.map((p) => (
            <td key={p.id}>
              <Label>{p.capture_path ?? ""}</Label>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** The flags of one architecture (the legend of a Results block, the head of a Lineage column): every flag of `ready.flags`, on or off as the preset says. `list` names the list for the check `flags`. */
export function FlagLegend({ ready, architecture, list = "results-legend" }: { ready: ReadyInfo; architecture: string; list?: string }) {
  const preset = ready.presets.find((p) => p.id === architecture);
  return (
    <ul class="flag-legend" data-flag-list={list} data-architecture={architecture}>
      {ready.flags.map((flag) => (
        <li key={flag} data-flag={flag}>
          <FlagName flag={flag} /> <FlagState on={preset?.flags[flag] === true} />
        </li>
      ))}
    </ul>
  );
}

/** The flag table of ADR-0005 as dictionary text (Notes): what each flag does when on and off, and the error it targets. */
export function FlagTable({ ready }: { ready: ReadyInfo }) {
  return (
    <dl class="flag-table" data-flag-list="notes-table">
      {ready.flags.map((flag) => {
        const [on, off, effect] = (["on", "off", "effect"] as const).map((part) => entry(flag, part));
        return (
          <div key={flag} class="flag-row" data-flag={flag}>
            <dt>
              <FlagName flag={flag} />
            </dt>
            <dd>
              {on && off && effect ? (
                <>
                  <T as="strong" k="notes.flags.on" /> <T k={on} />. <T as="strong" k="notes.flags.off" /> <T k={off} />. <T as="strong" k="notes.flags.effect" /> <T k={effect} />.
                </>
              ) : (
                <T k="flag.unknown" />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
