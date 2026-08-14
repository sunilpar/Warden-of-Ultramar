/**
 * Shock Cast (VFX) Schema
 * =======================
 * Chain-lightning skill visual. Segments are encoded as a flat string
 * to avoid nested schema serialization overhead.
 *
 * Format: "x1,y1,x2,y2,delay;x1,y1,x2,y2,delay;..."
 */
import { Schema, type } from "@colyseus/schema";

export class ShockCast extends Schema {
  /** Caster position (for the activation hand VFX). */
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Skill level (drives which art row to use). */
  @type("number") level: number = 1;
  /** Faction of the caster (player vs enemy). */
  @type("string") faction: string = "player";
  /** Aim angle in radians (for hitbox cone direction). */
  @type("number") aimAngle: number = 0;
  /** Segments as flat string: "x1,y1,x2,y2,delay;..." */
  @type("string") segments: string = "";
}
