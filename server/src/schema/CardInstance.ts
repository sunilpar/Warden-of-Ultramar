/**
 * Card Instance
 * =============
 * One concretely rolled card: skill + level + rarity + modifiers.
 * A card IS a skill trigger: when the HUD slot holding it fires, the
 * card's skill casts with only this card's mods applied.
 * Used by:
 *   - Enemy.card       (the card an enemy spawns with; drops on death)
 *   - GroundCard.card  (the rolled card lying on the map)
 *   - Player.equippedSlots[i] (the card equipped in HUD slot i)
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
  /**
   * Rolled modifier VALUES (parallel to modIds). Populated at roll time
   * from the tier ranges in config/lootTiers.ts — a tier-5 crit rate mod
   * carries ~0.30-0.40 while a tier-1 one carries ~0.01-0.05. Kept in
   * sync so the client tooltip can show the real rolled value.
   */
  @type(["number"]) modValues = new ArraySchema<number>();
}
