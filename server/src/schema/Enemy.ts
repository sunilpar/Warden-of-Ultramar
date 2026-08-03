/**
 * Enemy Schema
 * ============
 * Defines what enemy data gets synchronized to all clients.
 */

import { Schema, type, ArraySchema } from "@colyseus/schema";
import { StatusEffect } from "./StatusEffect";

export class EnemySpriteSheet extends Schema {
  @type("string") key: string = "";
  @type("number") displayWidth: number = 48;
  @type("number") displayHeight: number = 48;
  @type("number") frameWidth: number = 64;
  @type("number") frameHeight: number = 64;
  @type("number") walkStart: number = 0;
  @type("number") walkEnd: number = 3;
  @type("number") attackStart: number = 4;
  @type("number") attackEnd: number = 7;
  @type("number") walkFrameRate: number = 8;
  @type("number") attackFrameRate: number = 10;
}

export class Enemy extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("string") enemyType: string = "tyranid";

  /** Session ID of the player whose map this enemy belongs to (per-player). */
  @type("string") ownerId: string = "";

  @type(["string"]) skills = new ArraySchema<string>();
  @type(EnemySpriteSheet) spritesheet = new EnemySpriteSheet();
  @type("number") speed: number = 60;
  @type("number") collisionRadius: number = 20;
  @type("boolean") isDead: boolean = false;
  @type("boolean") isInvincible: boolean = false;

  statusEffects: Map<string, StatusEffect> = new Map();
  invincibleUntil: number = 0;

  /** Attack damage multiplier from mods (server-only, NOT synced). */
  atkMult: number = 1;
}
