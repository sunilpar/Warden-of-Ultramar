/**
 * Room State Schema
 * =================
 * The top-level state object that gets synced to all clients.
 * Colyseus automatically detects changes to @type fields and
 * sends only the changed values to clients (bandwidth optimization).
 */

import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Enemy } from "./Enemy";
import { Projectile } from "./Projectile";
import { SkillCast } from "./SkillCast";
import { Slam } from "./Slam";
import { Vortex } from "./Vortex";
import { ShockCast } from "./ShockCast";

export class RoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: SkillCast }) skillCasts = new MapSchema<SkillCast>();
  @type({ map: Slam }) slams = new MapSchema<Slam>();
  @type({ map: ShockCast }) shockCasts = new MapSchema<ShockCast>();
  @type({ map: Vortex }) vortexes = new MapSchema<Vortex>();
}
