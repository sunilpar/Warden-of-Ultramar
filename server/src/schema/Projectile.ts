/**
 * Projectile Schema
 * =================
 * A synced entity representing a skill projectile (e.g. a bolter bullet).
 *
 * Synced fields let the client render position, color tier, and faction.
 * Server-only fields hold the simulation state (velocity, damage, chain,
 * already-hit ids, owner) so the server stays authoritative.
 *
 * FACTION RULES (friendly-fire)
 *   - "player" projectiles damage ENEMIES only (never players, never owner).
 *   - "enemy"  projectiles damage PLAYERS + OTHER ENEMIES (never the caster).
 */
import { Schema, type } from "@colyseus/schema";
import type { BolterColorTier } from "../config/skillDefs";

export type ProjectileFaction = "player" | "enemy";

export class Projectile extends Schema {
  // ---- Position (synced) ----
  @type("number") x: number = 0;
  @type("number") y: number = 0;

  /** Skill id this projectile belongs to (e.g. "bolter"). */
  @type("string") skillId: string = "bolter";
  /** Skill level at cast time (drives color tier + chain). */
  @type("number") level: number = 1;
  /** Color tier (white/yellow/blue) derived from level — synced for render. */
  @type("string") colorTier: BolterColorTier = "yellow";
  /** Who fired it — determines what it can hit. */
  @type("string") faction: ProjectileFaction = "player";

  // ---- Simulation state (NOT synced; server-only) ----
  /** Velocity in px/sec. */
  vx: number = 0;
  vy: number = 0;
  /** Damage dealt on hit (already includes caster stats + level + multipliers). */
  damage: number = 0;
  /** Collision radius for hit detection. */
  radius: number = 7;
  /** Remaining travel distance before despawn (px). */
  remainingRange: number = 0;
  /** Remaining chain bounces (0 = no more chain). */
  chainRemaining: number = 0;
  /** Ids already hit (prevents hitting the same target twice). */
  hitSet: Set<string | number> = new Set();
  /** Session/id of the caster (never damage the caster itself). */
  ownerId: string = "";
  /** Crit rate of the caster (fraction 0..1). */
  critRate: number = 0;
  /** Crit damage multiplier of the caster (e.g. 1.5 = 150%). */
  critDamage: number = 1.5;
}

export interface CastAim {
  /** Aim angle in radians. */
  angle: number;
}
