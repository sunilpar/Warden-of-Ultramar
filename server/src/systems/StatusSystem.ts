/**
 * Status System
 * ==============
 * Processes all active status effects on players and enemies each tick.
 *
 * SUPPORTED EFFECTS:
 *   - slow: reduces movement speed (handled by PlayerSystem reading the effect)
 *   - poison/fire/cold: damage over time (DoT)
 *   - stun: prevents input processing (handled by PlayerSystem)
 *   - reduceAtk/reduceDef: stat reductions (applied at read-time by skills)
 *
 * THIS SYSTEM handles:
 *   - DoT damage ticks (every 500ms)
 *   - Effect expiry (removes expired effects)
 *
 * PlayerSystem reads slow/stun effects each tick to modify movement.
 */

import { RoomState } from "../schema/RoomState";
import { Player } from "../schema/Player";
import { Enemy } from "../schema/Enemy";
import { StatusEffect } from "../schema/StatusEffect";
import { applyDamage } from "../skills/damage";
import type { SkillContext } from "../skills/ISkill";

const DOT_TICK_MS = 500; // damage-over-time ticks every 500ms

export class StatusSystem {
  private state: RoomState;
  private ctx: SkillContext;

  constructor(state: RoomState, ctx: SkillContext) {
    this.state = state;
    this.ctx = ctx;
  }

  /**
   * Process all status effects for this tick.
   * @param currentTime - game time in ms
   */
  update(currentTime: number): void {
    // Process player status effects
    this.state.players.forEach((player, playerId) => {
      if (player.isDead) return;
      this.processEntityStatus(player, playerId, currentTime, true);
    });

    // Process enemy status effects
    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.isDead) return;
      this.processEntityStatus(enemy, enemyId, currentTime, false);
    });
  }

  /**
   * Process status effects on a single entity (player or enemy).
   */
  private processEntityStatus(
    entity: Player | Enemy,
    entityId: string,
    currentTime: number,
    isPlayer: boolean,
  ): void {
    const effects = entity.statusEffects;
    const toRemove: string[] = [];

    for (const [key, effect] of effects) {
      // Check expiry
      if (currentTime - effect.startTime >= effect.duration) {
        toRemove.push(key);
        continue;
      }

      // Process DoT effects (poison, fire, cold)
      if (effect.type === "poison" || effect.type === "fire" || effect.type === "cold") {
        if (currentTime - effect.lastTickTime >= DOT_TICK_MS) {
          effect.lastTickTime = currentTime;
          // Damage = magnitude per second, so per tick = magnitude * (DOT_TICK_MS / 1000)
          const dmg = effect.magnitude * (DOT_TICK_MS / 1000);
          // DoT uses the source's alignment for friendly-fire checks
          // sourceIsPlayer = !isPlayer means enemy-cast DoT hits players and vice versa
          applyDamage(entity, dmg, !isPlayer, effect.sourceId, this.ctx);
        }
      }
    }

    // Remove expired effects
    for (const key of toRemove) {
      effects.delete(key);
    }
  }

  /**
   * Apply a status effect to a player or enemy.
   * If the same type already exists, refresh it (extend duration).
   */
  static applyStatus(
    entity: Player | Enemy,
    type: StatusEffect["type"],
    duration: number,
    magnitude: number,
    sourceId: string,
    currentTime: number,
  ): void {
    const key = type; // one effect per type per entity
    const effect = new StatusEffect();
    effect.type = type;
    effect.startTime = currentTime;
    effect.duration = duration;
    effect.magnitude = magnitude;
    effect.sourceId = sourceId;
    effect.lastTickTime = currentTime;
    entity.statusEffects.set(key, effect);
  }

  /**
   * Check if an entity has a specific status effect (still active).
   */
  static hasStatus(entity: Player | Enemy, type: StatusEffect["type"]): boolean {
    return entity.statusEffects.has(type);
  }

  /**
   * Get the total slow multiplier for an entity (1.0 = no slow).
   * Returns a value between 0 and 1.
   */
  static getSlowMultiplier(entity: Player | Enemy): number {
    let multiplier = 1.0;
    const slow = entity.statusEffects.get("slow");
    if (slow) {
      multiplier *= (1 - slow.magnitude);
    }
    const cold = entity.statusEffects.get("cold");
    if (cold) {
      multiplier *= (1 - cold.magnitude * 0.5); // cold slows less than dedicated slow
    }
    return Math.max(0.1, multiplier); // never fully stopped by slow alone
  }

  /**
   * Check if an entity is stunned (can't act).
   */
  static isStunned(entity: Player | Enemy): boolean {
    return entity.statusEffects.has("stun");
  }
}
