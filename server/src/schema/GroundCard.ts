/**
 * Ground Card
 * ===========
 * A card dropped onto the map (world space). For now it is just a
 * skill card (skill id + level). Later, loot rarity etc. will extend
 * this schema - clients already render a simple box from these fields.
 */

import { Schema, type } from "@colyseus/schema";
import { CardInstance } from "./CardInstance";

export class GroundCard extends Schema {
  @type("string") skill: string = "";
  /** Skill level carried by the card (card tier / art frame). */
  @type("number") level: number = 1;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Server timestamp (ms) until which pickup is blocked (drop grace). */
  @type("number") pickupLockUntil: number = 0;
  /** The full rolled card (mods + rarity). Synced nested schema. */
  @type(CardInstance) card: CardInstance = new CardInstance();
}
