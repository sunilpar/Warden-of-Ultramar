/**
 * Skill Effect Schema
 * ===================
 * A single generic synced object representing one active skill effect
 * in the world (a claw slash, a bolter projectile, a pulse ring, ...).
 *
 * This REPLACES the old per-type schemas (Bullet, ClawSlash).
 * Now every skill spawns SkillEffect instances and updates them itself.
 *
 * The client reads `skillId` to know which visual/animation to play.
 * Position + direction let the client render & rotate the effect.
 * `radius`/`range` let the client size AoE/cone visuals.
 *
 * LIFECYCLE:
 *   1. A skill's activate() creates a SkillEffect via SkillSystem.spawn()
 *   2. That skill's update() moves/processes it each tick
 *   3. When done, the skill calls SkillSystem.despawn(id) to free memory
 */

import { Schema, type } from "@colyseus/schema";

export class SkillEffect extends Schema {
  /** Which skill this effect belongs to (e.g. "claw","boltershot") */
  @type("string") skillId: string = "";

  /** Current X position */
  @type("number") x: number = 0;

  /** Current Y position */
  @type("number") y: number = 0;

  /** Normalized direction X (facing/travel) */
  @type("number") directionX: number = 0;

  /** Normalized direction Y */
  @type("number") directionY: number = 0;

  /** Visual radius for AoE/ring effects (0 = ignored) */
  @type("number") radius: number = 0;

  /** Who cast this effect ("player:<sessionId>" or "enemy:<enemyId>") */
  @type("string") ownerId: string = "";

  /** True if cast by a player (client coloring / friendly-fire logic) */
  @type("boolean") isPlayer: boolean = false;

  /**
   * Per-skill runtime payload (JSON string).
   * Holds lifetime, speed, processed flag, etc. Server-only really,
   * but kept tiny & synced so a reconnecting client can render state.
   * Most skills also keep a parallel non-synced Map in SkillSystem.
   */
  @type("string") data: string = "{}";
}