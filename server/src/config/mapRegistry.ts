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
 * Rotation: map1 -> map1 -> ... (see `next`). map2 was removed; it will be
 * re-added when a new map 2 JSON is provided.
 */
import { LAYERED_MAP } from "./layeredMap";
import type { ModifierId } from "./modifiers";

export type MapId = "map1";

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
 * The subset of LayeredMapConfig the systems use.
 * layeredMap.ts must produce this shape (exitPoint included).
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
    next: "map1",
  },
};

/** Default starting map for fresh rooms. */
export const DEFAULT_MAP: MapId = "map1";
