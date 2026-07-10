/**
 * Room State Schema
 * =================
 * The top-level state object that gets synced to all clients.
 *
 * This is the SINGLE SOURCE OF TRUTH for the game world.
 * Everything the client needs to render is in here.
 *
 * HOW IT WORKS:
 *   - Colyseus automatically detects changes to @type fields
 *   - Only changed values are sent to clients (bandwidth optimization)
 *   - Clients listen for changes and update their visuals
 *
 * SERVER AUTHORITY: Only server code modifies this state.
 * Clients NEVER write to this — they only read it for rendering.
 *
 * SKILL EFFECTS: All skill visuals (claw slashes, bullets, pulse rings,
 * heal auras) are now unified into a single `skillEffects` map.
 * The old separate `bullets` and `clawSlashes` maps are gone.
 */

import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Enemy } from "./Enemy";
import { SkillEffect } from "./SkillEffect";

export class RoomState extends Schema {
  /** Map/world dimensions (sent so client knows boundaries) */
  @type("number") mapWidth: number = 800;
  @type("number") mapHeight: number = 600;

  /** All connected players, keyed by session ID */
  @type({ map: Player }) players = new MapSchema<Player>();

  /** All alive enemies, keyed by enemy ID */
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();

  /**
   * All active skill effects (bullets, claw slashes, pulse rings, heal auras),
   * keyed by effect ID. Managed by SkillSystem.
   */
  @type({ map: SkillEffect }) skillEffects = new MapSchema<SkillEffect>();
}