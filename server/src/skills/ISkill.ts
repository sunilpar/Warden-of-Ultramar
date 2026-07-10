/**
 * Skill Interface
 * ===============
 * Every skill (claw, boltershot, pulse, heal) implements this.
 *
 * RESPONSIBILITIES OF A SKILL:
 *   - activate(): called when a player or enemy triggers the skill.
 *       Creates one or more SkillEffect instances via ctx.spawn().
 *   - update():   called every tick for every active effect of this skill.
 *       Moves projectiles, applies AoE/cone damage once, handles lifetime.
 *       Returns true when the effect should be despawned (memory freed).
 *
 * WHY: Each skill owns its own behavior. There is no separate
 * BulletSystem/CombatSystem special-casing "is this a claw or a bullet?".
 * Adding a new skill = add a class + register it. Nothing else changes.
 *
 * CONTEXT: SkillSystem builds a SkillContext each call giving the skill
 * safe access to state (players/enemies) for damage application, plus
 * spawn/despawn helpers and map collision checks.
 */

import type { SkillConfig } from "../config/skills";
import type { SkillEffect } from "../schema/SkillEffect";

export interface SkillActivationResult {
  /** true if the skill actually fired (used by SkillSystem to start cooldown) */
  triggered: boolean;
}

/**
 * Who is casting the skill.
 * `position` is the caster's center.
 * `targetDir` is a normalized direction toward the aim target (may be 0,0).
 */
export interface CasterInfo {
  /** "player:<sessionId>" or "enemy:<enemyId>" */
  ownerId: string;
  isPlayer: boolean;
  x: number;
  y: number;
  /** Normalized direction toward the aim/target (0,0 if none) */
  targetDirX: number;
  targetDirY: number;
}

/**
 * Read/write helpers handed to a skill during update().
 * Lets skills apply damage & spawn/despawn effects without touching
 * RoomState directly (keeps them decoupled & testable).
 */
export interface SkillContext {
  /** Spawn a new effect. Returns its id. */
  spawn: (effect: SkillEffect) => string;
  /** Despawn an effect by id (frees memory + removes from client). */
  despawn: (effectId: string) => void;

  /** Iterate players. callback returns true to "stop". */
  forEachPlayer: (cb: (p: any, id: string) => void | boolean) => void;
  /** Iterate enemies. callback returns true to "stop". */
  forEachEnemy: (cb: (e: any, id: string) => void | boolean) => void;

  /** Get a player by id (for self-heal, kill tracking, etc.) */
  getPlayer: (id: string) => any | undefined;
  /** Get an enemy by id */
  getEnemy: (id: string) => any | undefined;

  /** Map width (bounds) */
  mapWidth: number;
  /** Map height (bounds) */
  mapHeight: number;
  /** Returns true if a point is inside a blocking obstacle (walls) */
  pointBlocked: (x: number, y: number) => boolean;
}

export interface ISkill {
  /** The skill config (id, cooldown, damage, tags, ...) */
  readonly config: SkillConfig;

  /**
   * Trigger the skill from a caster.
   * Creates effects via ctx.spawn().
   * Returns whether it actually fired.
   *
   * NOTE: Cooldown enforcement is handled by SkillSystem, NOT here.
   * activate() is only called when the skill is off cooldown.
   *
   * For "self" skills like heal, this applies the effect immediately
   * and may spawn a short-lived visual effect.
   */
  activate(caster: CasterInfo, ctx: SkillContext): SkillActivationResult;

  /**
   * Per-tick update for ONE active effect of this skill.
   *
   * @param effectId  - id of the effect (from spawn)
   * @param effect    - the synced SkillEffect object
   * @param dt        - delta time in SECONDS
   * @param currentTime - game time in ms
   * @param ctx       - helpers (spawn/despawn/damage)
   * @returns true if the effect should be despawned now
   */
  update(
    effectId: string,
    effect: SkillEffect,
    dt: number,
    currentTime: number,
    ctx: SkillContext,
  ): boolean;
}