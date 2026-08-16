/**
 * Card Loot Configuration
 * =======================
 * Card modifiers, rarity tiers and drop rules.
 *
 * MOD MODEL
 * ---------
 * A card can hold up to 4 modifier slots:
 *   - 2 PREFIX slots (offensive stats)
 *   - 2 SUFFIX slots (defensive/utility stats)
 *   - UNIQUE effects occupy one prefix + one suffix slot conceptually but
 *     are stored as a single unique id (a unique card has NO other mods).
 *
 * Every mod declares which skills it can appear on (`appliesTo`) and a
 * tier value (tiers exist for future tuning; all values equal for now).
 *
 * Each mod id maps to an effect function in LootSystem - the single
 * place where the numeric effect is defined.
 */

import { type SkillId } from "./skillDefs";

export type ModSlot = "prefix" | "suffix" | "unique";
export type Rarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "unique";

export interface CardModDef {
  id: string;
  /** Display name (client tooltip). */
  name: string;
  slot: ModSlot;
  /** Skills this mod may roll on. Empty = any skill. */
  appliesTo: SkillId[];
  /** Tier (future tuning; unused for now). */
  tier: number;
}

/** Prefix pool (offensive): crit rate / crit damage. */
export const PREFIX_POOL: CardModDef[] = [
  {
    id: "inc_crit_rate",
    name: "Increased Crit Rate",
    slot: "prefix",
    appliesTo: [],
    tier: 1,
  },
  {
    id: "inc_crit_damage",
    name: "Increased Crit Damage",
    slot: "prefix",
    appliesTo: [],
    tier: 1,
  },
];

/** Suffix pool (defensive/utility): attack damage / shield amount. */
export const SUFFIX_POOL: CardModDef[] = [
  {
    id: "inc_atk_damage",
    name: "Increased Damage",
    slot: "suffix",
    appliesTo: [],
    tier: 1,
  },
  {
    id: "inc_shield_amount",
    name: "Increased Shield",
    slot: "suffix",
    appliesTo: ["shield"],
    tier: 1,
  },
];

/** Unique effects - only pulse/vortex may roll these. */
export const UNIQUE_POOL: CardModDef[] = [
  {
    id: "wide_sweep",
    name: "Wide Sweep",
    slot: "unique",
    appliesTo: ["pulse", "vortex"],
    tier: 1,
  },
];

/** Rarity colors (0xRRGGBB) used by the client drop visuals. */
export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0x9e9e9e,
  uncommon: 0x00c853,
  rare: 0x2979ff,
  epic: 0xaa00ff,
  legendary: 0xffd700,
  unique: 0x00e5ff,
};

/** Rarity display names (client). */
export const RARITY_NAMES: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  unique: "Unique",
};

/** Mod-count -> rarity (0/1/2/3/4 mods; unique is exclusive). */
export function rarityForModCount(prefixes: number, suffixes: number, unique: boolean): Rarity {
  if (unique) return "unique";
  const n = prefixes + suffixes;
  if (n <= 1) return n === 0 ? "common" : "uncommon";
  if (n === 2) return "rare";
  if (n === 3) return "epic";
  return "legendary";
}

/** Mod values (flat per mod tier; per-mod functions live in LootSystem). */
export const MOD_VALUES = {
  inc_crit_rate: 0.1, // +10% crit rate
  inc_crit_damage: 0.2, // +20% crit damage
  inc_atk_damage: 0.1, // +10% skill damage
  inc_shield_amount: 100, // +100 shield
  unique_wide_sweep: { radiusMult: 2.0, damageMult: 0.5 },
} as const;

/**
 * Drop rules for card loot.
 * Values are per-enemy-spawn chances (not per-kill).
 */
export const CARD_DROP = {
  /** Chance an enemy spawns WITH a card in its skill pool. */
  SPAWN_WITH_CARD: 0.5,
  /** Rarity weights (spawn-time roll, only when a card is rolled). */
  RARITY_WEIGHTS: {
    common: 53, // remainder (100 - 20 - 10 - 5 - 2 - 10)
    uncommon: 20,
    rare: 10,
    epic: 5,
    legendary: 2,
    unique: 10,
  },
  /** Drop on death: only uncommon+ cards drop (common cards stay hidden). */
  DROP_ONLY_UNCOMMON_PLUS: true,
} as const;
