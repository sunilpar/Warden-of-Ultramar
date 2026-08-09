/**
 * Layered Map (Server-Side Authoritative)
 * =======================================
 * Parses the 32px Tiled export (map1 32bit.json) + tileset properties
 * (32symtric..json) to build the collision grid used by the server for
 * authoritative O(1) tile collision.
 *
 * 32px MIGRATION
 *   - tileSize is now 32 (was 64); cols/rows are 80x40 (was 40x20).
 *   - Tileset property names changed: "collision", "starting point",
 *     "exit point" (were "collide", "spawnpoint", "exitpoint").
 *   - Collision tiles live in a layer named "collision" (was "interactive").
 *   - Spawn markers live in the "baselayer" tiles (read from baselayer data).
 *   - Enemy spawn zones live in the "enemy spawn" object layer.
 *
 * MUST produce the EXACT same collision grid as the client
 * (client/src/maps/layeredMapData.ts). Keep them in sync.
 */

import mapJson from "./maps/map1 32bit.json";
import tilesetJson from "./maps/32symtric..json";

export interface EnemySpawnZone {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayeredMapConfig {
  tileSize: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  /** Flat collision grid: 1 = blocked, 0 = walkable. Index = row * cols + col. */
  collisionGrid: Uint8Array;
  /** Player spawn position in pixels (center of the 2x2 spawn tile block). */
  spawnPoint: { x: number; y: number };
  /** Enemy spawn zones from the Tiled object layer ("enemy spawn"). */
  enemySpawnZones: EnemySpawnZone[];
}

function buildLayeredMap(): LayeredMapConfig {
  const tileSize: number = mapJson.tilewidth; // 32
  const cols: number = mapJson.width; // 80
  const rows: number = mapJson.height; // 40
  const firstGid: number = mapJson.tilesets[0].firstgid;

  // ---- Build the set of colliding tile ids from the tileset properties ----
  const collisionTileIds = new Set<number>();
  for (const tile of tilesetJson.tiles as Array<{
    id: number;
    properties: Array<{ name: string; value: any }>;
  }>) {
    const globalId = tile.id + firstGid;
    for (const prop of tile.properties) {
      // New 32px property name is "collision".
      if (prop.name === "collision" && prop.value === true) {
        collisionTileIds.add(globalId);
      }
    }
  }

  // ---- Find layers (32px: collision tiles live in "collision" layer) ----
  const layers = mapJson.layers as Array<{
    name: string;
    data?: number[];
    type: string;
    objects?: Array<{ x: number; y: number; width: number; height: number }>;
  }>;
  const baselayer = layers.find((l) => l.name === "baselayer");
  const collisionLayer = layers.find((l) => l.name === "collision");
  if (!baselayer?.data) throw new Error("baselayer not found in map1 32bit");
  if (!collisionLayer?.data)
    throw new Error("collision layer not found in map1 32bit");

  const baselayerData = baselayer.data;
  const collisionData = collisionLayer.data;

  // ---- Build collision grid from the "collision" layer ----
  const collisionGrid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tid = collisionData[r * cols + c];
      if (collisionTileIds.has(tid)) {
        collisionGrid[r * cols + c] = 1;
      }
    }
  }

  // ---- Find spawn tiles ("starting point" property, 4 tiles forming a 2x2) ----
  const spawnTileIds = new Set<number>();
  for (const tile of tilesetJson.tiles as Array<{
    id: number;
    properties: Array<{ name: string; value: any }>;
  }>) {
    const globalId = tile.id + firstGid;
    for (const prop of tile.properties) {
      if (prop.name === "starting point" && prop.value === true) {
        spawnTileIds.add(globalId);
      }
    }
  }

  // The 4 spawn tiles form a 2x2 block in the baselayer. Compute the
  // bounding box of all spawn tiles and use its CENTER as the spawn point.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let found = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (spawnTileIds.has(baselayerData[r * cols + c])) {
        found = true;
        minX = Math.min(minX, c * tileSize);
        minY = Math.min(minY, r * tileSize);
        maxX = Math.max(maxX, c * tileSize + tileSize);
        maxY = Math.max(maxY, r * tileSize + tileSize);
      }
    }
  }
  const spawnPoint = found
    ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    : { x: tileSize, y: tileSize };

  // ---- Extract enemy spawn zones from the "enemy spawn" object layer ----
  const enemySpawnZones: EnemySpawnZone[] = [];
  const enemySpawnLayer = layers.find((l) => l.name === "enemy spawn");
  if (enemySpawnLayer?.objects) {
    enemySpawnLayer.objects.forEach((obj, i) => {
      enemySpawnZones.push({
        name: `enemy_zone_${i + 1}`,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
      });
    });
  }

  return {
    tileSize,
    cols,
    rows,
    widthPx: cols * tileSize,
    heightPx: rows * tileSize,
    collisionGrid,
    spawnPoint,
    enemySpawnZones,
  };
}

export const LAYERED_MAP = buildLayeredMap();
