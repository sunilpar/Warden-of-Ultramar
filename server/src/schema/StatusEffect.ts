/**
 * Status Effect Schema
 * =====================
 * A status effect on a player or enemy.
 *
 * Effects are keyed by a unique id and synced to clients for visual feedback.
 * Each effect has:
 *   - type: what kind of effect (slow, poison, fire, cold, stun, etc.)
 *   - duration: how long it lasts (ms)
 *   - startTime: when it was applied (game time ms)
 *   - magnitude: strength of the effect (e.g. 0.5 = 50% slow)
 *   - sourceId: who applied it (for kill crediting on DoT)
 *
 * The StatusSystem processes these each tick and applies their logic.
 */

import { Schema, type } from "@colyseus/schema";

/** All possible status effect types */
export type StatusEffectType =
  | "slow"      // reduces movement speed by magnitude (0-1)
  | "poison"    // damage over time
  | "fire"      // damage over time
  | "cold"      // reduces speed + small damage
  | "stun"      // prevents all actions
  | "reduceAtk" // reduces attack damage
  | "reduceDef"; // reduces defense

export class StatusEffect extends Schema {
  /** Type of effect */
  @type("string") type: StatusEffectType = "slow";

  /** Game time (ms) when this effect was applied */
  @type("number") startTime: number = 0;

  /** Duration in ms */
  @type("number") duration: number = 0;

  /**
   * Magnitude of the effect (interpretation depends on type):
   *   slow: 0.5 = 50% speed reduction
   *   poison/fire: damage per second
   *   reduceAtk/reduceDef: flat reduction amount
   */
  @type("number") magnitude: number = 0;

  /** ID of the entity that applied this effect (for kill crediting) */
  @type("string") sourceId: string = "";

  /** Last tick time (for DoT effects) - NOT synced */
  lastTickTime: number = 0;
}
