/**
 * Map Registry
 * ============
 * Single source of truth for all maps in the game.
 *
 * ONE ROOM = ONE GAME SESSION (one party of players). Maps are DATA:
 * when this map is cleared and players reach the exit, the SAME room
 * swaps to the next map in place — the socket connection and Player
 * objects (cards/XP/inventory) are never torn down. Per-map state
 * (enemies, ground cards, bookkeeping) resets.
 *
 * Rotation: map1 -> map2 -> map1 -> ... (see `next`).
 */
import { LAYERED_MAP } from "./layeredMap";
import { LAYERED_MAP_2 } from "./layeredMap2";
import type { ModifierId } from "./modifiers";

export type MapId = "map1" | "map2";

/** The per-map data every room system needs to run a map. */
export interface MapDef {
  /** Collision grid + spawn/exit/zone data parsed from Tiled export. */
  data: LayeredMapData;
  /** Gameplay modifiers active on this map. */
  modifiers: ModifierId[];
  /** Display info (map info button tooltip). */
  info: { name: string; description: string };
  /** The map players go to when they clear this one. */
  next: MapId;
}

/**
 * The subset of LayeredMapConfig/LayeredMap2Config the systems use.
 * Both layeredMap.ts and layeredMap2.ts must produce this shape
 * (exitPoint included).
 */
export interface LayeredMapData {
  tileSize: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  collisionGrid: Uint8Array;
  spawnPoint: { x: number; y: number };
  exitPoint: { x: number; y: number; width: number; height: number };
  enemySpawnZones: {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export const MAPS: Record<MapId, MapDef> = {
  map1: {
    data: LAYERED_MAP as LayeredMapData,
    modifiers: [],
    info: {
      name: "Sector 1: Outskirts",
      description: "The entrance to the hive. Tyranids and Orcks roam freely.",
    },
    next: "map2",
  },
  map2: {
    data: LAYERED_MAP_2 as LayeredMapData,
    modifiers: ["swift_movement"],
    info: {
      name: "Sector 2: Deep Hive",
      description: "The tunnels deepen. Swift movement is afoot.",
    },
    next: "map1",
  },
};

/** Default starting map for fresh rooms. */
export const DEFAULT_MAP: MapId = "map1";
