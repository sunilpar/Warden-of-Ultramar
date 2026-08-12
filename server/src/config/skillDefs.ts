/**
 * Skill Definitions (Server-Authoritative Behavior)
 * =================================================
 */

export type SkillId =
  | "bolter"
  | "shield"
  | "dash"
  | "pulse"
  | "vortex"
  | "claw"
  | "slam"
  | "shock"
  | "heal";

/** Max skill level. */
export const MAX_SKILL_LEVEL = 10;

export type BolterColorTier = "yellow" | "blue" | "purple";

// Helper to get a numeric value that might be a function
function num(
  v: number | ((skillLevel: number) => number),
  skillLevel: number,
): number {
  if (typeof v === "function") return v(skillLevel);
  return v;
}

// Helper to get a boolean value that might be a function
function bool(
  v: boolean | ((skillLevel: number) => boolean),
  skillLevel: number,
): boolean {
  if (typeof v === "function") return v(skillLevel);
  return v;
}

export interface SkillDef {
  id: SkillId;
  cooldown: number;
  /** Additive damage bonus over base attack (0.2 = +20%). Damage = attack * (1 + attackFactor). */
  attackFactor: number;
  damageMultiplierPerLevel?: number;
  /** Base crit chance at skill level 1 (0.1 = 10%). */
  baseCritRate?: number;
  /** Crit chance added per skill level above 1 (0.01 = +1% per level). */
  critRatePerLevel?: number;
  hitFeedbackMs?: number | ((skillLevel: number) => number);
}

export interface BolterDef extends SkillDef {
  id: "bolter";
  projectileSpeed: number | ((skillLevel: number) => number);
  projectileRadius: number;
  maxRange: number;
  chainUnlockLevel: number;
  chainCount: (skillLevel: number) => number;
}

export interface ClawDef extends SkillDef {
  id: "claw";
  coneHalfAngle: (skillLevel: number) => number;
  range: (skillLevel: number) => number;
  bleedUnlockLevel: number;
  bleedDps: (skillLevel: number) => number;
  bleedDuration: (skillLevel: number) => number;
}

export interface SlamDef extends SkillDef {
  id: "slam";
  range: (skillLevel: number) => number;
  speed: number;
  halfWidth: number | ((skillLevel: number) => number);
  halfHeight: number | ((skillLevel: number) => number);
  bypassWalls?: (skillLevel: number) => boolean;
  hitInterval: number;
}

export interface HealDef extends SkillDef {
  id: "heal";
  /** Heal amount at level 1 (L1-4 only; L5+ stays fixed). */
  baseHeal: number;
  /** Heal increase per level (L1-4 only). */
  healPerLevel: number;
  /** Level at which heal becomes AoE. */
  aoeUnlockLevel: number;
  /** AoE radius in pixels. Grows with level from aoeUnlockLevel. */
  aoeRadius: (skillLevel: number) => number;
  /** Kills required to recharge (L1 to aoeUnlockLevel-1). */
  killsToRecharge: number;
  /** Cooldown in seconds (aoeUnlockLevel and above). */
  cooldown: number;
}

/**
 * Bolter:
 * - +20% base damage over attack (attackFactor)
 * - +10% damage per level (default levelFactor)
 * - Projectile speed: +2% per level
 * - Chain counts: L3-6=2 chains, L7-9=3 chains, L10=4 chains
 */
const BOLTER: BolterDef = {
  id: "bolter",
  cooldown: 0.5,
  attackFactor: 0.2, // +20% damage over base attack
  baseCritRate: 0.1, // 10% crit at level 1
  critRatePerLevel: 0.01, // +1% crit per level
  projectileSpeed: (lvl: number) => Math.round(520 * Math.pow(1.02, lvl - 1)),
  projectileRadius: 6,
  maxRange: 900,
  chainUnlockLevel: 3,
  chainCount: (lvl: number) => {
    if (lvl >= 10) return 4;
    if (lvl >= 7) return 3;
    if (lvl >= 3) return 2;
    return 0;
  },
  hitFeedbackMs: 100,
};

/**
 * Claw:
 * - +20% damage per level (damageMultiplierPerLevel)
 * - Cone angle + range: +10% per level from L5-10
 * - Hit feedback: +20% per level from L5-10
 * - Bleed: L5 unlocks, 500 dps at L5, +100 dps per level, 10 sec at L5, +1 sec per level
 */
const CLAW: ClawDef = {
  id: "claw",
  cooldown: 0.5,
  attackFactor: 0.0,
  damageMultiplierPerLevel: 0.2,
  baseCritRate: 0.15, // 15% crit at level 1
  critRatePerLevel: 0.01, // +1% crit per level
  coneHalfAngle: (lvl: number) => {
    const base = lvl >= 8 ? 0.9 : lvl >= 4 ? 0.7 : 0.5;
    if (lvl >= 5 && lvl <= 10) {
      const levelsAbove4 = lvl - 4;
      return base * Math.pow(1.1, levelsAbove4);
    }
    return base;
  },
  range: (lvl: number) => {
    const base = lvl >= 8 ? 110 : lvl >= 4 ? 85 : 60;
    if (lvl >= 5 && lvl <= 10) {
      const levelsAbove4 = lvl - 4;
      return Math.round(base * Math.pow(1.1, levelsAbove4));
    }
    return base;
  },
  bleedUnlockLevel: 5,
  bleedDps: (lvl: number) => {
    if (lvl < 5) return 0;
    return 10; // flat 10 damage per tick
  },
  bleedDuration: (lvl: number) => {
    if (lvl < 5) return 0;
    return 10; // flat 10 seconds
  },
  hitFeedbackMs: (lvl: number) => {
    const base = 120;
    if (lvl >= 5 && lvl <= 10) {
      const levelsAbove4 = lvl - 4;
      return Math.round(base * Math.pow(1.2, levelsAbove4));
    }
    return base;
  },
};

/**
 * Slam:
 * - +20% damage per level (damageMultiplierPerLevel)
 * - Hitbox: +10% per level from L3+
 * - Hit feedback: +20% per level from L3-10
 * - Bypass walls at L5+
 */
const SLAM: SlamDef = {
  id: "slam",
  cooldown: 2.0,
  attackFactor: 0.0,
  damageMultiplierPerLevel: 0.2,
  baseCritRate: 0.1, // 10% crit at level 1
  critRatePerLevel: 0.01, // +1% crit per level
  range: (lvl: number) => (lvl >= 6 ? 200 : 120),
  speed: 300,
  halfWidth: (lvl: number) => {
    const base = 40;
    if (lvl >= 3) {
      const levelsAbove2 = lvl - 2;
      return Math.round(base * Math.pow(1.1, levelsAbove2));
    }
    return base;
  },
  halfHeight: (lvl: number) => {
    const base = 20;
    if (lvl >= 3) {
      const levelsAbove2 = lvl - 2;
      return Math.round(base * Math.pow(1.1, levelsAbove2));
    }
    return base;
  },
  bypassWalls: (lvl: number) => lvl >= 5,
  hitInterval: 0.5,
  hitFeedbackMs: (lvl: number) => {
    const base = 250;
    if (lvl >= 3 && lvl <= 10) {
      const levelsAbove2 = lvl - 2;
      return Math.round(base * Math.pow(1.2, levelsAbove2));
    }
    return base;
  },
};

/**
 * Heal:
 * - L1-4: Self-only. Charged by kills (5 kills per use). Heals 100 + 100/level.
 * - L5-10: AoE circle, heals all players + enemies in radius. Cooldown-based.
 *           Heal amount frozen at L4 value; only radius grows (+20px/level).
 */
const HEAL: HealDef = {
  id: "heal",
  cooldown: 10.0,
  attackFactor: 0.0,
  baseHeal: 100,
  healPerLevel: 100,
  aoeUnlockLevel: 5,
  aoeRadius: (lvl: number) => {
    if (lvl < 5) return 0;
    return 80 + (lvl - 5) * 20;
  },
  killsToRecharge: 5,
};

// Export as object with helper accessors that handle function values
export const SKILL_DEFS: Record<string, SkillDef> & {
  bolter: BolterDef;
  claw: ClawDef;
  slam: SlamDef;
  heal: HealDef;
} = {
  bolter: BOLTER,
  claw: CLAW,
  slam: SLAM,
  heal: HEAL,
};

/** Heal amount for a given level. L1-4 scales, L5+ frozen at L4 value. */
export function healAmount(skillLevel: number): number {
  const lvl = Math.max(1, skillLevel);
  const effectiveLvl = lvl >= HEAL.aoeUnlockLevel ? HEAL.aoeUnlockLevel - 1 : lvl;
  return HEAL.baseHeal + HEAL.healPerLevel * (effectiveLvl - 1);
}

/** AoE radius for heal at a given level (0 if below unlock level). */
export function healRadius(skillLevel: number): number {
  return HEAL.aoeRadius(skillLevel);
}

/**
 * Per-skill damage growth with level.
 * Default: +10% per level.
 * Override per skill via damageMultiplierPerLevel.
 */
export function levelFactor(skillId: SkillId, skillLevel: number): number {
  const def = SKILL_DEFS[skillId];
  const mult = def?.damageMultiplierPerLevel ?? 0.1;
  return 1.0 + mult * Math.max(0, skillLevel - 1);
}

export function computeSkillDamage(
  skillId: SkillId,
  casterAttack: number,
  skillLevel: number,
  casterDamageMultiplier: number,
): number {
  const def = SKILL_DEFS[skillId];
  // attackFactor is now an additive percentage bonus (0.2 = +20% damage)
  const af = def ? def.attackFactor : 0.0;
  return (
    casterAttack *
    (1.0 + af) *
    levelFactor(skillId, skillLevel) *
    casterDamageMultiplier
  );
}

/**
 * Roll a critical hit and return the damage multiplier + crit flag.
 * Returns { damage, isCrit }.
 */
export function applyCrit(
  damage: number,
  critRate: number,
  critDamage: number,
): { damage: number; isCrit: boolean } {
  if (critRate > 0 && Math.random() < critRate) {
    return { damage: damage * critDamage, isCrit: true };
  }
  return { damage, isCrit: false };
}

export function bolterColorTier(skillLevel: number): BolterColorTier {
  if (skillLevel >= 8) return "purple";
  if (skillLevel >= 4) return "blue";
  return "yellow";
}

/**
 * Compute the crit rate for a given skill at a given level.
 * Combines the player's base crit rate with the skill's own crit rate
 * (baseCritRate + critRatePerLevel * (level - 1)).
 */
export function skillCritRate(
  skillId: SkillId,
  skillLevel: number,
  playerCritRate: number,
): number {
  const def = SKILL_DEFS[skillId];
  const base = def?.baseCritRate ?? 0;
  const perLvl = def?.critRatePerLevel ?? 0;
  return playerCritRate + base + perLvl * Math.max(0, skillLevel - 1);
}

export function chainDamageMultiplier(chainIndex: number): number {
  return Math.pow(0.5, chainIndex);
}

export type ClawTier = "small" | "mid" | "big";

export function clawTier(skillLevel: number): ClawTier {
  if (skillLevel >= 8) return "big";
  if (skillLevel >= 4) return "mid";
  return "small";
}

export function clawInflictsBleed(skillLevel: number): boolean {
  return skillLevel >= CLAW.bleedUnlockLevel;
}

/** Get bolter projectile speed (handles function or number). */
export function getBolterSpeed(skillLevel: number): number {
  return num(BOLTER.projectileSpeed, skillLevel);
}

/** Get slam halfWidth (handles function or number). */
export function getSlamHalfWidth(skillLevel: number): number {
  return num(SLAM.halfWidth, skillLevel);
}

/** Get slam halfHeight (handles function or number). */
export function getSlamHalfHeight(skillLevel: number): number {
  return num(SLAM.halfHeight, skillLevel);
}

/** Does this slam level bypass walls? */
export function slamBypassesWalls(skillLevel: number): boolean {
  return SLAM.bypassWalls ? bool(SLAM.bypassWalls, skillLevel) : false;
}

/** Get hit feedback ms for a skill at given level. */
export function getSkillHitFeedback(
  skill: SkillId,
  skillLevel: number = 1,
): number {
  const def = SKILL_DEFS[skill];
  if (!def?.hitFeedbackMs) return 80;
  return num(def.hitFeedbackMs, skillLevel);
}

/** Get claw cone half-angle for level. */
export function getClawHalfAngle(skillLevel: number): number {
  return CLAW.coneHalfAngle(skillLevel);
}

/** Get claw range for level. */
export function getClawRange(skillLevel: number): number {
  return CLAW.range(skillLevel);
}

/** Get claw bleed dps for level. */
export function getClawBleedDps(skillLevel: number): number {
  return CLAW.bleedDps(skillLevel);
}

/** Get claw bleed duration for level. */
export function getClawBleedDuration(skillLevel: number): number {
  return CLAW.bleedDuration(skillLevel);
}

// Typed helpers
export const CLAW_DEF: ClawDef = CLAW;
export const BOLTER_DEF: BolterDef = BOLTER;
export const SLAM_DEF: SlamDef = SLAM;
