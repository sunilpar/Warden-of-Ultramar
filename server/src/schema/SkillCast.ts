/**
 * Skill Cast (VFX) Schema
 * =======================
 * A transient synced entity representing an instant, non-projectile skill's
 * visual effect (e.g. the claw cone slash). It has NO gameplay collision —
 * damage is applied immediately at cast time by the system. The client renders
 * the appropriate animation + auto-removes when the effect ends.
 *
 * Lifecycle: the server creates it, the client plays the anim, and the server
 * removes it after EFFECT_TTL_MS (well past the client animation length).
 */
import { Schema, type } from "@colyseus/schema";
import type { ClawTier } from "../config/skillDefs";

export class SkillCast extends Schema {
  /** Position where the cast originated (the caster's center). */
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Skill id (e.g. "claw"). */
  @type("string") skillId: string = "claw";
  /** Aim angle in radians (cone direction). */
  @type("number") angle: number = 0;
  /** Skill level (drives tier art). */
  @type("number") level: number = 1;
  /** Claw tier string (small/mid/big) for client art selection. */
  @type("string") tier: ClawTier = "small";
  /** Faction of the caster (for client tint: player vs enemy). */
  @type("string") faction: string = "player";
}
