/**
 * Enemy Schema
 * ============
 * Defines what enemy data gets synchronized to all clients.
 *
 * REFACTOR: Enemies no longer have their own attack/cooldown/range.
 * Instead they have a `skills` array referencing skill ids (e.g. "claw").
 * The SkillSystem owns all damage/cooldown/range logic. The enemy only
 * decides WHEN to trigger a skill (handled by EnemyAISystem).
 *
 * Enemies also carry their own `spritesheet` config so the client knows
 * exactly how to render & animate them (the tyranid uses a 2x4 sheet).
 *
 * IMPORTANT: Runtime AI state (cooldowns, facing, etc.) is NOT synced —
 * it's kept in separate AI state objects. Only visual/gameplay data is
 * synced to keep bandwidth low and hide AI internals from clients.
 */

import { Schema, type, ArraySchema } from "@colyseus/schema";

/**
 * Spritesheet descriptor for an enemy.
 * Tells the client which texture to load and how its animation is laid out.
 */
export class EnemySpriteSheet extends Schema {
  /** Phaser texture key (must be preloaded on the client) */
  @type("string") key: string = "";

  /** Display width in pixels */
  @type("number") displayWidth: number = 48;

  /** Display height in pixels */
  @type("number") displayHeight: number = 48;

  /** Frame width of one frame in the sheet */
  @type("number") frameWidth: number = 64;

  /** Frame height of one frame in the sheet */
  @type("number") frameHeight: number = 64;

  /** First frame index of the walk animation */
  @type("number") walkStart: number = 0;

  /** Last frame index of the walk animation */
  @type("number") walkEnd: number = 3;

  /** First frame index of the attack animation */
  @type("number") attackStart: number = 4;

  /** Last frame index of the attack animation */
  @type("number") attackEnd: number = 7;

  /** Walk animation framerate */
  @type("number") walkFrameRate: number = 8;

  /** Attack animation framerate */
  @type("number") attackFrameRate: number = 10;
}

export class Enemy extends Schema {
  /** Current X position */
  @type("number") x: number = 0;

  /** Current Y position */
  @type("number") y: number = 0;

  /** Current health points */
  @type("number") hp: number = 100;

  /** Maximum health points */
  @type("number") maxHp: number = 100;

  /**
   * Enemy type identifier (e.g. "tyranid").
   * Used by the client to pick rendering specifics and by AI systems.
   */
  @type("string") enemyType: string = "tyranid";

  /**
   * Skill ids this enemy can use, e.g. ["claw"].
   * The SkillSystem looks up each id to get damage/cooldown/range.
   * The enemy triggers them via EnemyAISystem -> SkillSystem.activate().
   */
  @type(["string"]) skills = new ArraySchema<string>();

  /** Spritesheet config for rendering & animation on the client (synced) */
  @type(EnemySpriteSheet) spritesheet = new EnemySpriteSheet();

  /** Movement speed in pixels per second */
  @type("number") speed: number = 60;

  /** Collision radius in pixels */
  @type("number") collisionRadius: number = 20;

  /** Whether this enemy has died and should be cleaned up */
  @type("boolean") isDead: boolean = false;
}