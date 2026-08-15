/**
 * Enemy Stats Configuration
 * =========================
 * Central definition of every enemy type. Mirrors the player's stat model
 * (base / multiplier / effective) so level-based growth and percentage
 * buffs/debuffs apply cleanly.
 *
 * SKILL POOL
 *   Skills are shared between enemies and the player (same SkillId space as
 *   client/src/config/skills.ts). An enemy does NOT have a fixed skill pool;
 *   instead it declares an ORDERED list of `potentialSkills`. At spawn the
 *   enemy unlocks the first `1 + floor(level / 5)` of them (so 1 skill at
 *   levels 1-4, 2 skills at levels 5-9, 3 at levels 10-14, ...). The enemy's
 *   level is then randomly distributed as skill levels across the unlocked
 *   skills (each capped at MAX_SKILL_LEVEL). The EnemySystem picks a skill
 *   from the unlocked pool at random each attempt, gated by cooldown.
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
export type EnemyTypeId = "tyranid" | "orck" | "tau" | "mechanicus";

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
  /**
   * Ordered list of skills this enemy can potentially learn. At spawn, the
   * first `1 + floor(level / 5)` entries are unlocked and form the active
   * skill pool. e.g. orck has ["slam", "claw"]: level 1-4 => [slam],
   * level 5-9 => [slam, claw]. Index 0 is the primary skill.
   */
  potentialSkills: SkillId[];
  /**
   * Aggro radius in px: the enemy only hunts a player when one is within
   * this distance. Outside it, the enemy wanders randomly. Default 500.
   */
  aggroRadius?: number;
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
    shield: 50, // base shield at level 1
    collisionRadius: 9,
    hitboxW: 16,
    hitboxH: 8,
    potentialSkills: ["claw"],
    aggroRadius: 500, // default aggro distance
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
    shield: 100, // base shield at level 1
    collisionRadius: 16, // larger hitbox than tyranid
    hitboxW: 15,
    hitboxH: 30,
    // Primary (and only): slam.
    potentialSkills: ["slam"],
    aggroRadius: 300, // short aggro range — ambush predator
    skillCooldown: { slam: 2.0 },
    growth: {
      maxHealth: 100,
      moveSpeed: 0,
      attack: 8,
    },
    xpReward: 300,
  },
  tau: {
    id: "tau",
    title: "Tau",
    description:
      "A ranged Tau warrior. Keeps its distance and fires heavy bolter rounds; high damage, low health.",
    // 100 less base health than tyranid (200 - 100).
    maxHealth: 100,
    moveSpeed: 50,
    attack: 200,
    defence: 0.01,
    critRate: 0.3, // 30% base crit
    critDamage: 2.0, // 200% crit damage
    shield: 30,
    collisionRadius: 10,
    hitboxW: 14,
    hitboxH: 14,
    // Primary: bolter. Secondary: dash.
    // (Shield level is derived separately as the remainder slot.)
    potentialSkills: ["bolter", "dash"],
    aggroRadius: 700, // long aggro range — long-range shooter
    skillCooldown: { bolter: 3.0, dash: 6.0 },
    growth: {
      maxHealth: 60,
      moveSpeed: 0,
      attack: 10,
    },
    xpReward: 200,
  },
  mechanicus: {
    id: "mechanicus",
    title: "Mechanicus",
    description:
      "A cyborg adept of the Machine God. Buffs itself, shocks its foes, and repairs its allies; moderate health and damage.",
    maxHealth: 300,
    moveSpeed: 30,
    attack: 150,
    defence: 0.01,
    critRate: 0.2, // 20% base crit
    shield: 20, // base shield at level 1
    collisionRadius: 10,
    hitboxW: 14,
    hitboxH: 14,
    // Primary: shock. Buff: shield (self-buff, restores shield to max).
    // Then: pulse (2nd damage skill), vortex (3rd).
    // (A shield level is ALSO derived separately as the remainder slot.)
    potentialSkills: ["shock", "shield", "pulse", "vortex"],
    aggroRadius: 700, // long aggro range — ranged caster
    skillCooldown: { shock: 5.0, shield: 10.0, pulse: 8.0, vortex: 12.0 },
    growth: {
      maxHealth: 80,
      moveSpeed: 0,
      attack: 10,
    },
    xpReward: 250,
  },
};

/** All enemy types as a list (useful for spawn tables). */
export const ENEMY_TYPE_LIST: EnemyTypeConfig[] = Object.values(ENEMY_STATS);
