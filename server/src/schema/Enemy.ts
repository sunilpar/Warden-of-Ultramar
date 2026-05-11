/**
 * Enemy Schema
 * ============
 * Defines what enemy data gets synchronized to all clients.
 *
 * IMPORTANT: Runtime AI state (like Ork phase, cooldowns, etc.)
 * is NOT synced — it's kept in separate AI state objects.
 * Only the visual/ gameplay-relevant data is synced.
 *
 * This keeps bandwidth low and prevents clients from reading AI state.
 */

import { Schema, type } from "@colyseus/schema";

export class Enemy extends Schema {
  /** Current X position */
  @type("number") x: number = 0;

  /** Current Y position */
  @type("number") y: number = 0;

  /** Current health points */
  @type("number") hp: number = 100;

  /** Maximum health points */
  @type("number") maxHp: number = 100;

  /** Attack damage (for melee enemies) */
  @type("number") attack: number = 10;

  /** Enemy type: "elder" (melee) or "ork" (ranged) */
  @type("string") enemyType: string = "elder";

  /** Whether this enemy has died and should be cleaned up */
  @type("boolean") isDead: boolean = false;
}