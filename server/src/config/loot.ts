/**
 * Loot Configuration
 * ==================
 * Defines the loot pool — the set of possible items an enemy can drop
 * when it dies, along with the drop chance for each entry.
 *
 * Each enemy config references one or more LootEntry ids. When an enemy
 * dies, each entry is rolled independently: if `Math.random() < chance`
 * the loot drops at the enemy's death position.
 *
 * LOOT TYPES:
 *   - "card": a skill card. `lootId` maps to a card image the client
 *     has preloaded. `textureKey` is the Phaser texture key.
 */

/**
 * A single possible loot drop from an enemy.
 */
export interface LootEntry {
  /** Loot type (e.g. "card"). The client uses this to render/pick up. */
  type: string;

  /** Specific loot id (e.g. "vortex"). */
  lootId: string;

  /** Loot category shown in the hover tooltip (e.g. "card") */
  category: string;

  /** Display name shown as the on-ground label and hover title. */
  label: string;

  /** Short description of what this loot/card does */
  description: string;

  /**
   * Phaser texture key the client preloaded for this loot's card image.
   * The client shows this image when the player hovers over the loot.
   */
  textureKey: string;

  /** Drop chance between 0 and 1 (e.g. 0.2 = 20%). */
  dropChance: number;
}

/**
 * All loot entries by id.
 * Add new loot definitions here.
 */
export const LOOT_ENTRIES: Record<string, LootEntry> = {
  vortex: {
    type: "card",
    lootId: "vortex",
    category: "Card",
    label: "Vortex",
    description: "Pulls all nearby enemies toward the caster. Radius 2x Pulse.",
    textureKey: "card_skill_vortex",
    dropChance: 0.2, // 20% drop chance
  },
  claw_card: {
    type: "card",
    lootId: "claw",
    category: "Card",
    label: "Claw",
    description: "Melee cone attack. Damages all enemies in front of you.",
    textureKey: "card_skill_sword",
    dropChance: 0.2,
  },
  bolter_card: {
    type: "card",
    lootId: "bolt_gun",
    category: "Card",
    label: "Bolter",
    description: "Fires a bolter round toward the mouse cursor.",
    textureKey: "card_skill_boltgun",
    dropChance: 0.2,
  },
  blink_card: {
    type: "card",
    lootId: "blink",
    category: "Card",
    label: "Blink",
    description: "Teleport 100px in facing direction. Brief invincibility.",
    textureKey: "card_skill_blink",
    dropChance: 0.05,
  },
};

/** Get a loot entry by id. */
export function getLootEntry(id: string): LootEntry | undefined {
  return LOOT_ENTRIES[id];
}
