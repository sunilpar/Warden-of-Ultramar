/**
 * Enemy Stats Configuration
 * =========================
 * Central definition of every enemy type. Mirrors the player's stat model
 * (base / multiplier / effective) so level-based growth and percentage
 * buffs/debuffs apply cleanly.
 *
 * SKILL POOL
 *   Skills are shared between enemies and the player (same SkillId space as
 *   client/src/config/skills.ts). An enemy's skill pool is the set of skills
 *   it MAY cast; the EnemySystem picks one at random each attempt, gated by
 *   that skill's cooldown. Skill logic itself is NOT implemented yet.
 *
 * BASE SPEED NOTE
 *   The simulation moves entities by `speed * dt` where dt is in SECONDS.
 *   A base speed of 60 px/sec == exactly 1 pixel per tick (60 ticks/sec).
 *   A percentage bonus (e.g. +20%) is applied as a multiplier (1.2), giving
 *   72 px/sec. The same formula that moves players then moves the enemy.
 */

/**
 * Skill identifiers shared with the player (mirrors
 * client/src/config/skills.ts). Kept as a loose type here so the enemy
 * skill pool can reference the same ids without importing client code.
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

/** Enemy type identifier. */
export type EnemyTypeId = "tyranid" | "orck";

export interface EnemyBaseConfig {
  /** Display title. */
  title: string;
  /** Short description. */
  description: string;
  /** Base stats at level 1. */
  maxHealth: number;
  /** Base move speed in px/sec (60 == 1px/tick at 60Hz). */
  moveSpeed: number;
  /** Base attack power. */
  attack: number;
  /** Defence, fraction 0..1 (0.1 = take 10% less damage). Default 0. */
  defence?: number;
  /** Crit chance, fraction 0..1 (0.2 = 20%). Default 0. */
  critRate?: number;
  /** Crit damage multiplier (1.5 = 150% of base damage). Default 1.5. */
  critDamage?: number;
  /** Shield (absorbs damage before health). 0 for now. */
  shield: number;
  /** Collision radius (legacy fallback for circle-based collision). */
  collisionRadius: number;
  /** Hitbox half-width (rectangle hitbox). */
  hitboxW: number;
  /** Hitbox half-height (rectangle hitbox). */
  hitboxH: number;
  /** Skills this enemy may use. */
  skillPool: SkillId[];
  /** Per-skill cooldown in SECONDS (keyed by SkillId). 0 = no cooldown. */
  skillCooldown: Partial<Record<SkillId, number>>;
  /** Per-level stat growth. */
  growth: {
    maxHealth: number;
    moveSpeed: number;
    attack: number;
  };
  /** XP awarded to the killer when this enemy dies. */
  xpReward: number;
}

export interface EnemyTypeConfig extends EnemyBaseConfig {
  id: EnemyTypeId;
}

export const ENEMY_STATS: Record<EnemyTypeId, EnemyTypeConfig> = {
  tyranid: {
    id: "tyranid",
    title: "Tyranid",
    description:
      "A relentless xenos beast that closes the distance and tears its prey apart with melee claws.",
    maxHealth: 200,
    moveSpeed: 60, // 1px per tick
    attack: 20,
    defence: 0.01, // 10% damage reduction
    critRate: 0.2, // 20% crit chance
    shield: 0,
    collisionRadius: 9,
    hitboxW: 16,
    hitboxH: 8,
    skillPool: ["claw"],
    skillCooldown: { claw: 1.5 },
    growth: {
      maxHealth: 120,
      moveSpeed: 0, // speed doesn't grow with level
      attack: 8,
    },
    xpReward: 100,
  },
  orck: {
    id: "orck",
    title: "Orck",
    description:
      "A hulking greenskin brute. Slower but tougher than a tyranid, with a larger frame.",
    maxHealth: 500,
    moveSpeed: 45, // slower than tyranid
    attack: 50,
    defence: 0.01,
    critRate: 0.2,
    shield: 0,
    collisionRadius: 16, // larger hitbox than tyranid
    hitboxW: 15,
    hitboxH: 30,
    skillPool: ["slam"],
    skillCooldown: { slam: 2.0 },
    growth: {
      maxHealth: 100,
      moveSpeed: 0,
      attack: 8,
    },
    xpReward: 300,
  },
};

/** All enemy types as a list (useful for spawn tables). */
export const ENEMY_TYPE_LIST: EnemyTypeConfig[] = Object.values(ENEMY_STATS);
