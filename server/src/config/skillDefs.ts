/**
 * Skill Definitions (Server-Authoritative Behavior)
 * =================================================
 * Central definition of how each skill BEHAVES. This is the server-side
 * source of truth for damage, cooldown, projectile speed, chain, color
 * tiers, etc. Skills are SHARED between players and enemies — the same
 * skill id behaves identically regardless of caster (only the caster's
 * stats + the skill's level change the numbers).
 *
 * The client has its own copy of the card-ART data (client skillDefs.ts);
 * behavior lives here so it's authoritative and identical for everyone.
 *
 * DAMAGE MODEL
 *   finalDamage = casterAttack
 *               * SKILL.attackFactor           (per-skill base factor)
 *               * levelFactor(skillLevel)      (growth with skill level)
 *               * casterDamageMultiplier       (buffs/debuffs, e.g. +200%)
 *
 * BOLTER (implemented now)
 *   - Fires a bullet toward the caster's aim direction.
 *   - Player bullets hit ENEMIES ONLY (never other players, never self).
 *   - Enemy bullets hit PLAYERS + OTHER ENEMIES (never the caster itself).
 *   - Chain (skill level > 3): on hit, damage is halved and the bullet
 *     continues in the same direction. Chain count = skillLevel - 3.
 *   - Color tiers (cosmetic, synced to client): 1-3 white, 3-5 yellow, 5+ blue.
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

/** Max skill level (caps upgrading for testing). */
export const MAX_SKILL_LEVEL = 10;

/** Visual color tier for a bolter bullet, derived from its skill level. */
export type BolterColorTier = "yellow" | "blue" | "purple";

export interface SkillDef {
  id: SkillId;
  /** Base cooldown in seconds (at skill level 1). */
  cooldown: number;
  /** Base attack factor: finalDamage = casterAttack * attackFactor * levelFactor * dmgMult. */
  attackFactor: number;
  /** Hit feedback duration in ms (white flash + hit-stun freeze). */
  hitFeedbackMs?: number;
}

export interface BolterDef extends SkillDef {
  id: "bolter";
  /** Projectile speed in px/sec. */
  projectileSpeed: number;
  /** Projectile radius in px (for hit detection). */
  projectileRadius: number;
  /** Max travel distance in px before the bullet despawns. */
  maxRange: number;
  /** Skill level above which chaining is enabled. */
  chainUnlockLevel: number;
  /** Number of chain bounces = max(0, skillLevel - chainUnlockLevel). */
  chainCount: (skillLevel: number) => number;
}


export interface ClawDef extends SkillDef {
  id: "claw";
  /** Cone half-angle (radians) per tier. Full cone = 2 * halfAngle. */
  coneHalfAngle: (skillLevel: number) => number;
  /** Cone reach (px) per tier. */
  range: (skillLevel: number) => number;
  /** Skill level at which bleed is unlocked. */
  bleedUnlockLevel: number;
  /** Bleed damage per second (applied while active). */
  bleedDps: (skillLevel: number) => number;
  /** Bleed duration in seconds. */
  bleedDuration: (skillLevel: number) => number;
}

export interface SlamDef extends SkillDef {
  id: "slam";
  range: (skillLevel: number) => number;
  speed: number;
  halfWidth: number;
  halfHeight: number;
  hitInterval: number;
}

export const SKILL_DEFS = {
  bolter: {
    id: "bolter",
    cooldown: 0.5,
    attackFactor: 2.0,
    projectileSpeed: 520,
    projectileRadius: 6,
    maxRange: 900,
    chainUnlockLevel: 3,
    chainCount: (lvl: number) => Math.max(0, lvl - 3),
    hitFeedbackMs: 100,
  },
  claw: {
    id: "claw",
    cooldown: 0.5,
    attackFactor: 1.0,
    coneHalfAngle: (lvl: number) => (clawTier(lvl) === "big" ? 0.9 : clawTier(lvl) === "mid" ? 0.7 : 0.5),
    range: (lvl: number) => (clawTier(lvl) === "big" ? 110 : clawTier(lvl) === "mid" ? 85 : 60),
    bleedUnlockLevel: 8,
    bleedDps: (_lvl: number) => 20,
    bleedDuration: (_lvl: number) => 4,
    hitFeedbackMs: 120,
  },
  slam: {
    id: "slam",
    cooldown: 2.0,
    attackFactor: 1.0,
    range: (lvl: number) => (lvl >= 6 ? 200 : 120),
    speed: 300,
    halfWidth: 40,
    halfHeight: 20,
    hitInterval: 0.5,
    hitFeedbackMs: 250,
  },
} as const;

/**
 * Per-skill damage growth with level. Linear multiplier: level 1 = 1.0x,
 * each level adds +10% (level 10 = 1.9x). Override per skill if needed.
 */
export function levelFactor(_skillId: SkillId, skillLevel: number): number {
  return 1.0 + 0.1 * Math.max(0, skillLevel - 1);
}

/**
 * Compute the final damage a skill deals given the caster's attack stat,
 * the skill level, and the caster's outgoing damage multiplier.
 */
export function computeSkillDamage(
  skillId: SkillId,
  casterAttack: number,
  skillLevel: number,
  casterDamageMultiplier: number,
): number {
  const def = (SKILL_DEFS as Record<string, SkillDef>)[skillId];
  const af = def ? def.attackFactor : 1.0;
  return (
    casterAttack *
    af *
    levelFactor(skillId, skillLevel) *
    casterDamageMultiplier
  );
}

/** Bolter bullet color tier based on skill level (synced for rendering). */
export function bolterColorTier(skillLevel: number): BolterColorTier {
  if (skillLevel >= 8) return "purple";
  if (skillLevel >= 4) return "blue";
  return "yellow";
}

/** Chain damage multiplier for the Nth hit (0 = first target). Halve each. */
export function chainDamageMultiplier(chainIndex: number): number {
  return Math.pow(0.5, chainIndex);
}

// ============================================================
// CLAW TIER + BLEED
// ============================================================

/** Claw visual/damage tier. small (1-3), mid (4-7), big (8-10). */
export type ClawTier = "small" | "mid" | "big";

export function clawTier(skillLevel: number): ClawTier {
  if (skillLevel >= 8) return "big";
  if (skillLevel >= 4) return "mid";
  return "small";
}

/** True if this skill level inflicts bleed (tier "big"). */
export function clawInflictsBleed(skillLevel: number): boolean {
  return skillLevel >= (SKILL_DEFS.claw as ClawDef).bleedUnlockLevel;
}

/** The typed claw definition helper. */
export const CLAW_DEF: ClawDef = SKILL_DEFS.claw as ClawDef;

/** The bolter definition (typed helper). */
export const BOLTER_DEF: BolterDef = SKILL_DEFS.bolter;

/** The slam definition (typed helper). */
export const SLAM_DEF: SlamDef = SKILL_DEFS.slam as SlamDef;

/** Returns the hit-feedback duration (ms) for a given skill. */
export function getSkillHitFeedback(skill: SkillId): number {
  const def = (SKILL_DEFS as Record<string, { hitFeedbackMs?: number }>)[skill];
  return def?.hitFeedbackMs ?? 80; // default 80ms
}
