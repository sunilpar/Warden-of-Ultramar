/**
 * Enemy Configuration
 * ===================
 * Base tuning values for each enemy type.
 *
 * REFACTOR: attackDamage / attackCooldown / shootingRange no longer live
 * here — those belong to SKILLS now (see config/skills.ts). The enemy only
 * defines health, speed, collision, the skills it can trigger, its
 * spritesheet, and spawn settings.
 *
 * To add a new enemy: add a config here + create/extend an AI behavior.
 * To change how hard the tyranid hits: edit the "claw" skill, not here.
 */

import { EnemySpriteSheet } from "../schema/Enemy";

export interface EnemyConfig {
  /** Display name */
  name: string;

  /** Health points */
  hp: number;

  /** Movement speed in pixels per second */
  speed: number;

  /** Collision radius */
  collisionRadius: number;

  /** Skill ids this enemy can trigger (looked up in config/skills.ts) */
  skills: string[];

  /** Spritesheet config for the client */
  spritesheet: EnemySpriteSheet;

  /** Spawning settings */
  spawn: {
    maxAlive: number;
    intervalMs: number;
  };
}

/**
 * Helper to build an EnemySpriteSheet with sensible defaults.
 */
function makeSpritesheet(partial: Partial<EnemySpriteSheet>): EnemySpriteSheet {
  const s = new EnemySpriteSheet();
  Object.assign(s, partial);
  return s;
}

/**
 * Tyranid — melee enemy using the Claw skill.
 * Uses a 2x4 spritesheet: row 0 = walk (frames 0-3), row 1 = attack (4-7).
 */
export const TYRANID_CONFIG: EnemyConfig = {
  name: "Tyranid",
  hp: 100,
  speed: 80,
  collisionRadius: 20,
  skills: ["claw"],
  spritesheet: makeSpritesheet({
    key: "tyranid_sheet",
    displayWidth: 48,
    displayHeight: 48,
    frameWidth: 64,
    frameHeight: 64,
    walkStart: 0,
    walkEnd: 3,
    attackStart: 4,
    attackEnd: 7,
    walkFrameRate: 8,
    attackFrameRate: 10,
  }),
  spawn: {
    maxAlive: 5,
    intervalMs: 5000,
  },
};

/**
 * All enemy configs by type id.
 * Add new enemies here.
 */
export const ENEMIES: Record<string, EnemyConfig> = {
  tyranid: TYRANID_CONFIG,
};

/** Get an enemy config by type id (throws if missing). */
export function getEnemyConfig(type: string): EnemyConfig {
  const cfg = ENEMIES[type];
  if (!cfg) throw new Error(`Unknown enemy type: "${type}"`);
  return cfg;
}