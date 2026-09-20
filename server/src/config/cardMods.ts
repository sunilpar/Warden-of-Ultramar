/**
 * Card Modifier Display (Backend source of truth)
 * ===============================================
 *
 * Every card mod id has EXACTLY ONE display definition here. The server
 * exposes this list to clients through room metadata on join, so a card's
 * tooltip/label is always driven by the server (no client-side hardcoded
 * strings per mod).
 */
export type CardModId =
  | "inc_crit_rate"
  | "inc_crit_damage"
  | "inc_atk_damage"
  | "inc_cooldown"
  | "inc_shield_amount"
  | "wide_sweep";

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
};

export interface CardModMetadata {
  id: CardModId;
  label: string;
  color: string;
  kind: CardModKind;
  fallbackValue: number;
}

export function cardModMetadata(): CardModMetadata[] {
  return Object.values(CARD_MOD_DISPLAY).map((m) => ({
    id: m.id, label: m.label, color: m.color, kind: m.kind, fallbackValue: m.fallbackValue,
  }));
}
