/**
 * Vortex Entity Schema
 * ====================
 * A vortex zone centred on the caster that pulls entities toward its centre.
 *
 * Lifecycle:
 *   1. L1-4: Pull only.
 *   2. L5-10: Pull, then an explosion damages everything near the centre.
 *
 * Phases: "pull" -> "explode" (VFX hold) -> remove
 */
import { Schema, type } from "@colyseus/schema";

export type VortexFaction = "player" | "enemy";
export type VortexPhase = "pull" | "explode";

export class Vortex extends Schema {
  // ---- Synced (visible to client for rendering) ----
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Skill id (always "vortex"). */
  @type("string") skillId: string = "vortex";
  /** Skill level at cast time. */
  @type("number") level: number = 1;
  /** Faction of the caster. */
  @type("string") faction: VortexFaction = "player";
  /** Current phase: pull / explode. */
  @type("string") phase: VortexPhase = "pull";
  /** Vortex pull radius in pixels. */
  @type("number") radius: number = 80;
  /** Explosion radius (0 if no explosion). */
  @type("number") explosionRadius: number = 0;
  /** Colour tier: grey (1-2), brown (3-5), purple (6-10). */
  @type("string") colorTier: string = "grey";

  // ---- Server-only (not synced) ----
  /** Pull duration remaining (seconds). */
  pullTimer: number = 0;
  /** Pull force (px/sec). */
  pullForce: number = 120;
  /** Explosion damage (0 if no explosion). */
  explosionDamage: number = 0;
  /** Whether this vortex has an explosion phase. */
  hasExplosion: boolean = false;
  /** How long the "explode" phase lingers (client VFX time), seconds. */
  explodeTimer: number = 0;
  /** Session/id of the caster. */
  ownerId: string = "";
  /** Crit rate of the caster (fraction 0..1). */
  critRate: number = 0;
  /** Crit damage multiplier of the caster. */
  critDamage: number = 1.5;
  /** Track entities that were pulled (for explosion damage). */
  pulledEntities: Set<string> = new Set();
}
