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

/**
 * Card type categories. A skill declares which categories it belongs to;
 * a mod declares which categories it is eligible to roll on. A mod rolls on
 * a card when its categories overlap with the card's skill categories
 * (or when the mod is "universal").
 *
 * - "damage"   : skill deals damage (bolter, pulse, claw, shock)
 * - "support"  : skill provides utility (dash, vortex, heal, shield)
 * - "aoe"      : skill has a scalable radius (slam, heal @ L6+)
 * - "universal": mod may roll on any skill (currently cooldown reduction)
 *
 * Heal is special-cased: its "aoe" tag is only honored at L6+ because the
 * skill has zero radius before then. The eligibility helper drops the
 * "aoe" category from heal cards below L6.
 */
export type SkillCategory = "damage" | "support" | "aoe" | "universal";

/** Categories each skill belongs to. Used to filter the mod pool per drop.
 *  `shield` is a passive slot (not a card-cast skill) and never rolls mods
 *  from the generic pools; inc_shield_amount targets it explicitly via the
 *  appliesTo skill-list, not via categories. */
export const SKILL_CATEGORIES: Record<SkillId, SkillCategory[]> = {
  bolter: ["damage"],
  pulse:  ["damage"],
  claw:   ["damage"],
  shock:  ["damage"],
  slam:   ["damage", "aoe"],
  dash:   ["support"],
  vortex: ["support"],
  heal:   ["support", "aoe"],
  shield: ["support"],
};

/**
 * Returns the categories a card of (skill, level) is eligible for.
 * Heal at L1-5 has zero radius, so it is treated as support-only.
 */
export function eligibleCategories(skill: SkillId, level: number): SkillCategory[] {
  if (skill === "heal" && level < 6) {
    return ["support"];
  }
  return SKILL_CATEGORIES[skill];
}

/** True iff `mod` is allowed to roll on a card of (skill, level). */
export function modEligibleForSkill(
  mod: { appliesTo: SkillId[]; categories: SkillCategory[] },
  skill: SkillId,
  level: number,
): boolean {
  // Explicit skill list (uniques, shield-only) takes precedence.
  if (mod.appliesTo.length > 0) {
    return mod.appliesTo.includes(skill);
  }
  const cardCats = eligibleCategories(skill, level);
  return mod.categories.some((c) => cardCats.includes(c));
}

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
  /** Skills this mod may roll on (skill-list filter, used for uniques / shield-only). Empty = use `categories`. */
  appliesTo: SkillId[];
  /** Skill-type categories this mod is eligible for. Empty + non-empty appliesTo = skill-list-only. */
  categories: SkillCategory[];
  /** Tier (future tuning; unused for now). */
  tier: number;
}

/** Prefix pool (offensive): crit rate / crit damage. Damage-only. */
export const PREFIX_POOL: CardModDef[] = [
  {
    id: "inc_crit_rate",
    name: "Increased Crit Rate",
    slot: "prefix",
    appliesTo: [],
    categories: ["damage"],
    tier: 1,
  },
  {
    id: "inc_crit_damage",
    name: "Increased Crit Damage",
    slot: "prefix",
    appliesTo: [],
    categories: ["damage"],
    tier: 1,
  },
];

/**
 * Suffix pool (defensive/utility): damage / cooldown / shield / aoe / defence.
 * Categories drive eligibility:
 *   - inc_atk_damage   : damage
 *   - inc_cooldown     : universal (any card)
 *   - inc_shield_amount: shield only (skill-list filter, appliesTo)
 *   - inc_aoe          : aoe (slam, heal L6+)
 *   - inc_defence      : support (dash, vortex, heal)
 */
export const SUFFIX_POOL: CardModDef[] = [
  {
    id: "inc_atk_damage",
    name: "Increased Damage",
    slot: "suffix",
    appliesTo: [],
    categories: ["damage"],
    tier: 1,
  },
  {
    id: "inc_cooldown",
    name: "Increased Cooldown Reduction",
    slot: "suffix",
    appliesTo: [],
    categories: ["universal"],
    tier: 1,
  },
  {
    id: "inc_shield_amount",
    name: "Increased Shield",
    slot: "suffix",
    appliesTo: ["shield"],
    categories: [],
    tier: 1,
  },
  {
    id: "inc_aoe",
    name: "Increased Area of Effect",
    slot: "suffix",
    appliesTo: [],
    categories: ["aoe"],
    tier: 1,
  },
  {
    id: "inc_defence",
    name: "Increased Defence",
    slot: "suffix",
    appliesTo: [],
    categories: ["support"],
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
    categories: [],
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
 *
 * RARITY ROLL PIPELINE (LootSystem.rollRarity)
 *   finalWeight(r) = max(0, baseWeight(r) + levelBonus + rarityBias(r) + dropRateBias(r))
 *   - baseWeight(r):   normalized base weights below (sum to 100)
 *   - levelBonus:      +2 per enemy level, applied to EVERY rarity equally
 *   - rarityBias(r):   per-rarity additive bonus from the enemy's profile
 *                      (e.g. +20 to epic for "all enemies get +20% epic")
 *   - dropRateBias(r): per-rarity additive bonus from the room's drop rate
 *                      (e.g. a +10% epic drop-rate mod adds +10 to epic)
 *   Result is then re-normalized and rolled.
 *
 * DROP RATE STAT (room-level)
 *   The room carries a `dropRate` value sourced from the highest player's
 *   "increased drop rate" stat. It multiplies the SPAWN_WITH_CARD gate
 *   (so a player with +50% drop rate sees 50% more cards spawn).
 *
 * ADVANTAGE / DISADVANTAGE (TODO — wiring reserved)
 *   CardInstance.rollsWith stores whether the card was rolled with
 *   advantage ("roll twice, take highest") or disadvantage ("roll twice,
 *   take lowest"). For now it is assigned randomly at roll time; later
 *   it will be driven by card mods / map affixes. The damage numeric
 *   on each mod will be the (highest|lowest) of two modValue rolls.
 */
export const CARD_DROP = {
  /** Chance an enemy spawns WITH a card in its skill pool. */
  SPAWN_WITH_CARD: 0.5,
  /**
   * Normalized base rarity weights (sum to 100). Tuned so cards are
   * actually rare: rare+epic+legendary+unique = 70, common+uncommon = 55
   * before the +2/level bonus shifts the curve upward.
   */
  RARITY_WEIGHTS: {
    common: 30,
    uncommon: 25,
    rare: 20,
    epic: 15,
    legendary: 10,
    unique: 25,
  },
  /** Drop on death: only uncommon+ cards drop (common cards stay hidden). */
  DROP_ONLY_UNCOMMON_PLUS: true,
  /**
   * Absolute additive bonus to EVERY rarity weight per enemy level.
   * Level 10 -> each rarity gets +20 absolute weight on top of the base.
   */
  RARITY_LEVEL_BONUS: 2,
  /**
   * Per-rarity additive bias applied to ALL enemies. Currently every
   * enemy gets +20 to epic (so epic feels reachable without trivializing
   * it). Adjust per-design needs.
   */
  GLOBAL_RARITY_BIAS: {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 20,
    legendary: 0,
    unique: 0,
  },
} as const;

/**
 * DROP_RATE constant (room stat)
 * ===============================
 * Players carry a `dropRate` stat (added by items/skills later). The
 * room tracks the HIGHEST player's drop rate and uses it as a scalar
 * on the SPAWN_WITH_CARD gate:
 *
 *   effectiveSpawnChance = clamp(SPAWN_WITH_CARD * (1 + roomDropRate), 0, 1)
 *
 * Also exposed as a per-rarity additive bias (`dropRateBias`) so future
 * "increased X rarity drop rate" mods can add weight to one bucket
 * specifically (e.g. +10% epic chance -> +10 to epic weight).
 */
export const DROP_RATE = {
  /** Default room drop rate when no player has the stat. */
  DEFAULT: 0,
  /** Hard ceiling on the room drop rate scalar. */
  MAX: 2.0, // 200% -> SPAWN_WITH_CARD can max out at 1.0
} as const;
