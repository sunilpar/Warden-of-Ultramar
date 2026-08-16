/**
 * Card Instance
 * =============
 * One concretely rolled card: skill + level + modifiers.
 * Used by:
 *   - Enemy.card      (the card an enemy spawns with; drops on death)
 *   - GroundCard.card (the rolled card lying on the map)
 *   - Player.equippedCards (the player's equipped card per skill)
 */

import { Schema, type, ArraySchema } from "@colyseus/schema";

export class CardInstance extends Schema {
  /** Skill this card represents. */
  @type("string") skill: string = "";
  /** Skill level carried by the card. */
  @type("number") level: number = 1;
  /** Rolled rarity (derived from mods, but synced for cheap reads). */
  @type("string") rarity: string = "common";
  /** Rolled modifier ids (prefix/suffix/unique ids from loot config). */
  @type(["string"]) modIds = new ArraySchema<string>();
}
