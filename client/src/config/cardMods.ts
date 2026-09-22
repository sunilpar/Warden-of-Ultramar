/**
 * Card Modifier Display (Client mirror)
 * =====================================
 *
 * Mirror of `server/src/config/cardMods.ts`. The CLIENT receives the same
 * data via room metadata on join and overlays the server's label/color/kind
 * on top. This local mirror exists so that:
 *
 *   1. Card tooltips render immediately (no flicker) before the server
 *      metadata arrives.
 *   2. The router knows which mod ids are valid (typing).
 *
 * EDITING DISPLAY INFO
 *   The server file is the source of truth - edit THAT first, then mirror
 *   the change here. A drift here only affects the brief window before the
 *   room metadata arrives.
 */

export type CardModId =
  | "inc_crit_rate"
  | "inc_crit_damage"
  | "inc_atk_damage"
  | "inc_cooldown"
  | "inc_shield_amount"
  | "wide_sweep"
  | "inc_aoe"
  | "inc_defence";

export type CardModKind = "percent" | "flat" | "composite";

export interface CardModDisplay {
  id: CardModId;
  label: string;
  color: string;
  kind: CardModKind;
  fallbackValue: number;
}

export const CARD_MOD_DISPLAY: Record<CardModId, CardModDisplay> = {
  inc_crit_rate: { id: "inc_crit_rate", label: "Crit Rate", color: "#66ff66", kind: "percent", fallbackValue: 0.03 },
  inc_crit_damage: { id: "inc_crit_damage", label: "Crit Damage", color: "#ffd700", kind: "percent", fallbackValue: 0.3 },
  inc_atk_damage: { id: "inc_atk_damage", label: "Damage", color: "#ff9955", kind: "percent", fallbackValue: 0.03 },
  inc_cooldown: { id: "inc_cooldown", label: "Cooldown Reduction", color: "#4da6ff", kind: "percent", fallbackValue: 0.03 },
  inc_shield_amount: { id: "inc_shield_amount", label: "Shield", color: "#33b5ff", kind: "flat", fallbackValue: 60 },
  wide_sweep: { id: "wide_sweep", label: "2x Radius, 1/2 Damage", color: "#b266ff", kind: "composite", fallbackValue: 0 },
  inc_aoe: { id: "inc_aoe", label: "Area of Effect", color: "#88ddff", kind: "percent", fallbackValue: 0.03 },
  inc_defence: { id: "inc_defence", label: "Defence", color: "#88aaff", kind: "percent", fallbackValue: 0.02 },
};

/** Format a single mod line using a mod's display entry + its rolled value. */
export function formatModLine(
  display: CardModDisplay,
  value: number | undefined,
): string {
  if (display.kind === "composite") {
    return display.label;
  }
  const v =
    typeof value === "number" && value > 0 ? value : display.fallbackValue;
  if (display.kind === "flat") {
    return "+" + Math.round(v) + " " + display.label;
  }
  return "+" + Math.round(v * 100) + "% " + display.label;
}

/** Look up display info for a mod id. Falls back to a generic entry built
 *  from the id itself so an unknown id still renders (instead of crashing). */
export function getCardModDisplay(id: string): CardModDisplay {
  const known = (CARD_MOD_DISPLAY as Record<string, CardModDisplay>)[id];
  if (known) return known;
  return {
    id: id as CardModId,
    label: id,
    color: "#ffffff",
    kind: "percent",
    fallbackValue: 0.03,
  };
}
