/**
 * Claw Slash Schema
 * ==================
 * Defines what claw slash data gets synchronized to all clients.
 *
 * A claw slash is a melee cone attack:
 *   - Originates from the attacker's position
 *   - Directed toward a target (directionX, directionY)
 *   - Has a cone radius and arc angle
 *   - Instant damage (no travel time like bullets)
 *   - Brief visual on client (red slash effect)
 *
 * LIFECYCLE:
 *   1. Created when an enemy/player attacks with claw
 *   2. CombatSystem checks cone collision immediately
 *   3. Marked as processed
 *   4. Removed next tick
 */

import { Schema, type } from "@colyseus/schema";

export class ClawSlash extends Schema {
  /** Origin X position (attacker's position) */
  @type("number") x: number = 0;

  /** Origin Y position (attacker's position) */
  @type("number") y: number = 0;

  /** Normalized direction X component (toward target) */
  @type("number") directionX: number = 0;

  /** Normalized direction Y component (toward target) */
  @type("number") directionY: number = 0;

  /** Damage dealt on hit */
  @type("number") damage: number = 15;

  /** Whether this claw was created by a player */
  @type("boolean") isPlayerClaw: boolean = false;

  /** Who created this claw (enemy ID or player session ID).
   * Synced so client can trigger attack animation on the owner. */
  @type("string") ownerId: string = "";

  /** Whether this claw has been processed (damage applied).
   * NOT synced — server-only. */
  processed: boolean = false;

  /** Tick when this claw was created (for delayed cleanup).
   * NOT synced — server-only. */
  createdAt: number = 0;
}