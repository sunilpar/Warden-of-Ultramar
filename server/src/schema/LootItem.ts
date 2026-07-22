/**
 * Loot Item Schema
 * =================
 * Defines loot data that gets synchronized to all clients.
 *
 * A LootItem is a card (or future item) dropped on the ground when an
 * enemy dies. The client renders a small label on the ground and shows
 * the full details (category, title, description, card image) on hover.
 */

import { Schema, type } from "@colyseus/schema";

export class LootItem extends Schema {
  /** Current X position (where the enemy died) */
  @type("number") x: number = 0;

  /** Current Y position (where the enemy died) */
  @type("number") y: number = 0;

  /**
   * Loot type identifier (e.g. "card").
   * Used by the client to decide how to render/pick up the loot.
   */
  @type("string") itemType: string = "card";

  /**
   * The specific loot id (e.g. a card id like "vortex").
   * The client uses this to pick the correct card image to display on hover.
   */
  @type("string") lootId: string = "";

  /** Loot category (e.g. "card", "consumable") shown in the hover tooltip */
  @type("string") category: string = "";

  /** Display name shown as the on-ground label and hover title */
  @type("string") label: string = "";

  /** Short description of what this loot does, shown in the hover tooltip */
  @type("string") description: string = "";

  /** The texture key the client preloaded for this loot's card image */
  @type("string") textureKey: string = "";
}
