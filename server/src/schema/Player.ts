/**
 * Player Schema
 * =============
 */

import { Schema, type, ArraySchema } from "@colyseus/schema";
import { StatusEffect } from "./StatusEffect";
import { ModifierData } from "./ModifierData";

export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  tick?: number;
}

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") tick: number = 0;
  @type("number") hp: number = 1000;
  @type("number") maxHp: number = 1000;
  @type("number") speed: number = 120;
  @type("boolean") isDead: boolean = false;

  inputQueue: InputData[] = [];
  lastShootTime: number = 0;
  lastPulseTime: number = 0;

  @type("number") killsSinceLastHeal: number = 0;
  @type("boolean") isInvincible: boolean = false;

  /** The map this player is currently on (per-player map instances). */
  @type("string") currentMapId: string = "map_1_first_hall";

  /** Whether this player is currently choosing a modifier (pauses their game). */
  @type("boolean") isChoosingMod: boolean = false;

  /** 2 modifier choices presented to the player at map exit. */
  @type({ array: ModifierData }) pendingModChoices = new ArraySchema<ModifierData>();

  /** Active modifiers applied to this player's current map. */
  @type({ array: ModifierData }) activeMods = new ArraySchema<ModifierData>();

  statusEffects: Map<string, StatusEffect> = new Map();
  invincibleUntil: number = 0;
}
