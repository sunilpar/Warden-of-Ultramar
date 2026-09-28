/**
 * Lobby Map (Server-Side)
 * =======================
 * Parses the lobby Tiled export ("Lobby map.json") + its tileset
 * ("lobby tilesheet.json") to build the collision grid the server uses
 * for authoritative O(1) tile collision.
 *
 * LOBBY vs GAME MAPS
 *   - The lobby is a SAFE ZONE: no enemies, no elite, no spawn zones.
 *     This map has no `enemySpawnZones` and a zero-sized `exitPoint`
 *     (the room never transitions out of the lobby via the exit gate).
 *   - No "starting point" tile markers exist in the tileset, so the
 *     spawn point is hard-coded to the center of the map.
 *
 *   - Layer names follow the user's Tiled export:
 *       "base"        = TILE LAYER (visual + collision source).
 *       "interactive" = OBJECT LAYER carrying the "Play" polygon (and
 *                       other unused buttons). It has NO `data` array
 *                       because it's an objectgroup, not a tile layer.
 *   - Collision is computed from the `base` (baselayer) tile grid using
 *     the `collision` bool on each tileset tile. The lobby does NOT use
 *     a separate collision layer like map1/map2 do.
 *
 * MUST produce the EXACT same collision grid as the client
 * (client/src/maps/lobbyMapData.ts). Keep them in sync.
 */
import mapJson from "./maps/Lobby map.json";
import tilesetJson from "./maps/lobby tilesheet.json";
import type { LayeredMapData } from "./mapRegistry";

function buildLobbyMap(): LayeredMapData {
  const tileSize: number = mapJson.tilewidth; // 32
  const cols: number = mapJson.width; // 45
  const rows: number = mapJson.height; // 33
  const firstGid: number = mapJson.tilesets[0].firstgid; // 1

  // ---- Build the set of colliding tile ids from the tileset properties ----
  const collisionTileIds = new Set<number>();
  for (const tile of tilesetJson.tiles as Array<{
    id: number;
    properties: Array<{ name: string; value: any }>;
  }>) {
    const globalId = tile.id + firstGid;
    for (const prop of tile.properties) {
      if (prop.name === "collision" && prop.value === true) {
        collisionTileIds.add(globalId);
      }
    }
  }

  // ---- Find the BASE TILE layer (visual + collision source) ----
  // Older lobby exports name this layer "base"; newer ones follow the
  // game-map convention "baselayer". Accept either.
  const layers = mapJson.layers as Array<{
    name: string;
    data?: number[];
    type: string;
  }>;
  const baseLayer = layers.find((l) => {
    const n = l.name.toLowerCase();
    return n === "baselayer" || n === "base";
  });
  if (!baseLayer?.data) {
    throw new Error(
      `"baselayer" tile layer not found in Lobby map.json (layers seen: ${layers
        .map((l) => l.name)
        .join(", ")})`,
    );
  }

  // ---- Build collision grid from the "base" layer ----
  // (Same approach as the client: check each baselayer tile id against
  // the tileset's `collision` set. The "interactive" object layer is
  // IGNORED for collision - it only carries the Play polygon, which is
  // a click target on the client, not a collision shape.)
  const collisionGrid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tid = baseLayer.data[r * cols + c];
      if (collisionTileIds.has(tid)) {
        collisionGrid[r * cols + c] = 1;
      }
    }
  }

  // ---- No spawn/exit tiles in the lobby tileset - hard-code to the
  //      center of the map so arriving players spawn mid-lobby. ----
  const spawnPoint = { x: (cols * tileSize) / 2, y: (rows * tileSize) / 2 };
  const exitPoint = { x: 0, y: 0, width: 0, height: 0 };

  return {
    tileSize,
    cols,
    rows,
    widthPx: cols * tileSize,
    heightPx: rows * tileSize,
    collisionGrid,
    spawnPoint,
    exitPoint,
    enemySpawnZones: [],
  };
}

/**
 * The lobby as a LayeredMapData (shape compatible with the game-map
 * MapSystem). Marked `id`/`name` are unused by the server but the client
 * rendering layer reads them, so we fill in placeholder values.
 */
export const LOBBY_MAP: LayeredMapData = buildLobbyMap();

/**
 * Spawn point of the lobby in pixel coordinates (center of the map).
 * Re-exported so the room code can move a player back to the lobby
 * without instantiating a MapSystem just to read the spawn.
 */
export const LOBBY_SPAWN_POINT = LOBBY_MAP.spawnPoint;
