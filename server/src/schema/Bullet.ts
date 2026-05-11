/**
 * Bullet Schema
 * =============
 * Defines what bullet data gets synchronized to all clients.
 *
 * Bullets are server-authoritative: the server creates them,
 * moves them, checks collisions, and removes them.
 *
 * The client only renders them at the synced positions.
 *
 * directionX/directionY are normalized direction components.
 * The client can use these to rotate the bullet sprite to face
 * its travel direction (for long rifle bullet visuals).
 */

import { Schema, type } from "@colyseus/schema";

export class Bullet extends Schema {
  /** Current X position */
  @type("number") x: number = 0;

  /** Current Y position */
  @type("number") y: number = 0;

  /** Normalized direction X component (-1 to 1) */
  @type("number") directionX: number = 0;

  /** Normalized direction Y component (-1 to 1) */
  @type("number") directionY: number = 0;

  /** Damage dealt on hit */
  @type("number") damage: number = 10;

  /** Who created this bullet (enemy ID or player session ID).
   * NOT synced — server-only, used to prevent friendly fire. */
  ownerId: string = "";
}