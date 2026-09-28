/**
 * Map Registry
 * ============
 * Single source of truth for all maps in the game.
 *
 * ONE ROOM = ONE GAME SESSION (one party of players). The room runs a
 * single GAMEPLAY map at a time (the "main" map, where enemies spawn).
 * Players also have a `currentMapId` field:
 *
 *   - "lobby"   = safe zone (no enemies). Each player can be in the
 *                 lobby independently; they can roam and click the
 *                 "Play" polygon to leave the lobby and join the
 *                 room's main gameplay map.
 *   - "map1" / "map2" = gameplay maps. The room's main gameplay map
 *                 is `state.mapId` and rotates map1 -> map2 -> map1
 *                 on exits (server-authoritative). Only players whose
 *                 `currentMapId === state.mapId` participate in the
 *                 enemy / pickup simulation.
 *
 * Rotation: map1 -> map2 -> map1 -> ... (see `next`).
 */
import { LAYERED_MAP } from "./layeredMap";
import { LAYERED_MAP_2 } from "./layeredMap2";
import { LOBBY_MAP } from "./lobbyMap";
import type { ModifierId } from "./modifiers";

export type MapId = "lobby" | "map1" | "map2";

/** Subset of MapIds used as the room's ROTATING gameplay map. */
export type GameMapId = Exclude<MapId, "lobby">;

/** The per-map data every room system needs to run a map. */
export interface MapDef {
  /** Collision grid + spawn/exit/zone data parsed from Tiled export. */
  data: LayeredMapData;
  /** Gameplay modifiers active on this map. */
  modifiers: ModifierId[];
  /** Display info (map info button tooltip). */
  info: { name: string; description: string };
  /** The gameplay map players go to when they clear this one. */
  next: GameMapId;
}

/**
 * The subset of LayeredMapConfig/LayeredMap2Config the systems use.
 * Both layeredMap.ts and layeredMap2.ts must produce this shape
 * (exitPoint included). The lobby also produces this shape but with
 * empty enemySpawnZones and a zero-sized exitPoint.
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
  lobby: {
    data: LOBBY_MAP as LayeredMapData,
    modifiers: [],
    info: {
      name: "Lobby",
      description: "Safe zone. Free movement, click Play to begin a run.",
    },
    // The lobby never rotates out - clicking Play always drops the
    // player onto the room's current gameplay map (or map1 by default).
    next: "map1",
  },
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

/** The first gameplay map a new room starts on. */
export const DEFAULT_MAP: GameMapId = "map1";
