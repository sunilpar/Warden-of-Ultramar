/**
 * Client-side Modifier Display Config
 * ==================================
 * Mirrors the server-side modifier definitions for display purposes.
 * The actual modifier effects are applied server-side; this file only
 * provides display metadata (title, description, icon color).
 */

export type ModifierId =
  | "swift_movement"
  | "veteran_enemies"
  | "rich_loot"
  | "glass_cannon"
  | "regeneration";

export interface ModifierDisplay {
  id: ModifierId;
  title: string;
  description: string;
  color: string;
}

export const MODIFIER_DISPLAY: Record<ModifierId, ModifierDisplay> = {
  swift_movement: {
    id: "swift_movement",
    title: "Swift Movement",
    description: "All entities move 30% faster.",
    color: "#4fc3f7",
  },
  veteran_enemies: {
    id: "veteran_enemies",
    title: "Veteran Enemies",
    description: "Enemies have +50% HP and +25% ATK, but reward 50% more XP.",
    color: "#ef5350",
  },
  rich_loot: {
    id: "rich_loot",
    title: "Rich Loot",
    description: "Enemies reward double XP and have improved loot rarity.",
    color: "#ffd700",
  },
  glass_cannon: {
    id: "glass_cannon",
    title: "Glass Cannon",
    description: "Players deal 2x damage but have 50% less health.",
    color: "#ff7043",
  },
  regeneration: {
    id: "regeneration",
    title: "Regeneration",
    description: "Players regenerate 5 HP per second.",
    color: "#66bb6a",
  },
};

/**
 * Map display info per room name (mirrors server MAP_INFO).
 */
export const MAP_INFO: Record<string, { name: string; description: string }> = {
  game_room: {
    name: "Sector 1: Outskirts",
    description: "The entrance to the hive. Tyranids and Orcks roam freely.",
  },
  game_room_2: {
    name: "Sector 2: Deep Hive",
    description: "The tunnels deepen. Swift movement is afoot.",
  },
};
