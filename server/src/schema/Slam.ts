/**
 * Slam Entity Schema
 * ==================
 * A moving rectangular hitbox for the slam skill. Travels in a fixed
 * direction for a set range, damaging anything in its path. Does NOT
 * despawn on hit — it persists until it finishes travelling.
 */
import { Schema, type } from "@colyseus/schema";

export type SlamFaction = "player" | "enemy";

export class Slam extends Schema {
  // ---- Synced (visible to client for rendering) ----
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Skill id (always "slam"). */
  @type("string") skillId: string = "slam";
  /** Skill level at cast time (drives frame row + range). */
  @type("number") level: number = 1;
  /** Faction of the caster. */
  @type("string") faction: SlamFaction = "player";
  /** Travel direction in radians. */
  @type("number") angle: number = 0;
  /** Remaining travel distance (px). */
  @type("number") remainingRange: number = 0;

  // ---- Server-only (not synced) ----
  /** Velocity x (px/sec). */
  vx: number = 0;
  /** Velocity y (px/sec). */
  vy: number = 0;
  /** Damage per hit tick. */
  damage: number = 200;
  /** Hitbox half-width (perpendicular to travel direction). */
  halfWidth: number = 40;
  /** Hitbox half-height (along travel direction). */
  halfHeight: number = 20;
  /** Ids already hit recently (cooldown per target to prevent multi-hit per second). */
  hitCooldowns: Map<string, number> = new Map();
  /** Session/id of the caster. */
  ownerId: string = "";
}
