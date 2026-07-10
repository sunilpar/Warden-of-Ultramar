/**
 * Skill Configuration
 * ===================
 * Central registry of all skill definitions.
 *
 * A SKILL is an ability that can be used by BOTH players and enemies.
 * Enemies reference a skill by id; the skill owns its damage, cooldown,
 * range, animation, and tags. The enemy only decides WHEN to trigger it.
 *
 * WHY: Previously attackDamage/cooldown/range lived on the enemy config.
 * Now they live on the skill, so the same "claw" skill behaves identically
 * whether a tyranid or a future melee enemy uses it. Tuning happens here.
 *
 * FIELDS:
 *   - name         : display name
 *   - cooldown     : ms between uses
 *   - baseDamage   : damage per hit (heal uses healAmount instead)
 *   - tags         : categories e.g. ["melee","physical"]
 *   - startFrom    : where in the caster hitbox the effect originates
 *                      "center" -> caster center
 *                      "edge"   -> offset to caster edge toward target
 *   - type         : behavior family ("melee"|"projectile"|"aoe"|"self")
 *   - spritesheet  : animation asset info for the skill effect (client)
 *   - cardSprite   : card art path when used by the PLAYER (client)
 *
 * The type-specific fields (range/halfAngle/radius/bulletSpeed/lifetime/...)
 * are only read by the matching skill implementation.
 */

export type SkillType = "melee" | "projectile" | "aoe" | "self";

export type SkillStartFrom = "center" | "edge";

export interface SkillSpriteSheet {
  /** Phaser texture key (must be preloaded on the client) */
  key: string;
  /** Asset path (for documentation / client preload) */
  path: string;
  frameWidth: number;
  frameHeight: number;
  /** Animation frames for the effect visual (row-major indices) */
  effectFrames: { start: number; end: number };
  frameRate: number;
}

export interface SkillConfig {
  id: string;
  name: string;
  cooldown: number;
  baseDamage: number;
  tags: string[];
  startFrom: SkillStartFrom;
  type: SkillType;

  /** Effect animation spritesheet (may be unused if client draws procedurally) */
  spritesheet: SkillSpriteSheet;

  /** Card art path when this skill is equipped by the player */
  cardSprite: string;

  // ---- type-specific tuning ----
  /** melee */
  range?: number;
  halfAngle?: number;
  /** projectile */
  bulletSpeed?: number;
  lifetime?: number;
  /** aoe */
  radius?: number;
  /** self (heal) */
  healAmount?: number;
  killsRequired?: number;
}

export const SKILLS: Record<string, SkillConfig> = {
  /**
   * Claw — melee cone attack.
   * Used by: tyranid (enemy).
   * Tags: melee, physical.
   */
  claw: {
    id: "claw",
    name: "Claw",
    cooldown: 3000,
    baseDamage: 15,
    tags: ["melee", "physical"],
    startFrom: "center",
    type: "melee",
    range: 50,
    halfAngle: Math.PI / 4,
    spritesheet: {
      key: "claw_effect",
      path: "assets/cards/skillCards/sword.png",
      frameWidth: 64,
      frameHeight: 64,
      effectFrames: { start: 0, end: 3 },
      frameRate: 12,
    },
    cardSprite: "assets/cards/skillCards/sword.png",
  },

  /**
   * Bolter Shot — ranged projectile.
   * Used by: player. (Future: ork-type enemies.)
   * Tags: ranged, physical.
   */
  boltershot: {
    id: "boltershot",
    name: "Bolter Shot",
    cooldown: 500,
    baseDamage: 80,
    tags: ["ranged", "physical"],
    startFrom: "edge",
    type: "projectile",
    bulletSpeed: 1000,
    lifetime: 3000,
    spritesheet: {
      key: "bolter_effect",
      path: "assets/cards/skillCards/boltGun.png",
      frameWidth: 16,
      frameHeight: 8,
      effectFrames: { start: 0, end: 0 },
      frameRate: 1,
    },
    cardSprite: "assets/cards/skillCards/boltGun.png",
  },

  /**
   * Pulse — instant AoE shockwave around the caster.
   * Used by: player. (Future: elder-type enemies.)
   * Tags: aoe, energy.
   */
  pulse: {
    id: "pulse",
    name: "Pulse",
    cooldown: 3000,
    baseDamage: 150,
    tags: ["aoe", "energy"],
    startFrom: "center",
    type: "aoe",
    radius: 100,
    spritesheet: {
      key: "pulse_effect",
      path: "assets/cards/skillCards/pulse.png",
      frameWidth: 64,
      frameHeight: 64,
      effectFrames: { start: 0, end: 3 },
      frameRate: 12,
    },
    cardSprite: "assets/cards/skillCards/pulse.png",
  },

  /**
   * Heal — restores the caster's HP.
   * Used by: player only (for now).
   * Kill-based cooldown (killsRequired).
   */
  heal: {
    id: "heal",
    name: "Heal",
    cooldown: 0,
    baseDamage: 0,
    tags: ["self", "support"],
    startFrom: "center",
    type: "self",
    healAmount: 300,
    killsRequired: 6,
    spritesheet: {
      key: "heal_effect",
      path: "assets/cards/skillCards/hpIncrease.png",
      frameWidth: 64,
      frameHeight: 64,
      effectFrames: { start: 0, end: 3 },
      frameRate: 10,
    },
    cardSprite: "assets/cards/skillCards/hpIncrease.png",
  },
};

/** Get a skill config by id (throws if missing — catches typos early). */
export function getSkillConfig(id: string): SkillConfig {
  const cfg = SKILLS[id];
  if (!cfg) throw new Error(`Unknown skill id: "${id}"`);
  return cfg;
}