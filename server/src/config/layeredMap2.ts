/**
 * Layered Map 2 (Server-Side Authoritative)
 * ==========================================
 * Parses the new 32px Tiled export (map2 32bit.json) + tileset properties
 * (32symtric..json) to build the collision grid used by the server for
 * authoritative O(1) tile collision.
 *
 * Same format as map1 (see layeredMap.ts):
 *   - tileSize 32; cols/rows 80x40; tileset 32symtric.tsx (firstgid 1).
 *   - Collision tiles live in the "collision" layer.
 *   - Spawn/exit markers live in the "baselayer" tiles (2x2 blocks).
 *   - Enemy spawn zones live in the "enemy spawn" object layer.
 *
 * MUST produce the EXACT same collision grid as the client
 * (client/src/maps/layeredMap2Data.ts). Keep them in sync.
 */

import mapJson from "./maps/map2 32bit.json";
import tilesetJson from "./maps/32symtric..json";

import type { EnemySpawnZone, LayeredMapConfig } from "./layeredMap";

function buildLayeredMap2(): LayeredMapConfig {
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
      if (prop.name === "collision" && prop.value === true) {
        collisionTileIds.add(globalId);
      }
    }
  }

  // ---- Find layers ----
  const layers = mapJson.layers as Array<{
    name: string;
    data?: number[];
    type: string;
    objects?: Array<{ x: number; y: number; width: number; height: number }>;
  }>;
  const baselayer = layers.find((l) => l.name === "baselayer");
  const collisionLayer = layers.find((l) => l.name === "collision");
  if (!baselayer?.data) throw new Error("baselayer not found in map2 32bit");
  if (!collisionLayer?.data)
    throw new Error("collision layer not found in map2 32bit");

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

  // ---- Find exit tiles ("exit point" property, 2x2 block in baselayer) ----
  const exitTileIds = new Set<number>();
  for (const tile of tilesetJson.tiles as Array<{
    id: number;
    properties: Array<{ name: string; value: any }>;
  }>) {
    const globalId = tile.id + firstGid;
    for (const prop of tile.properties) {
      if (prop.name === "exit point" && prop.value === true) {
        exitTileIds.add(globalId);
      }
    }
  }
  let exMinX = Infinity,
    exMinY = Infinity,
    exMaxX = -Infinity,
    exMaxY = -Infinity;
  let exitFound = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (exitTileIds.has(baselayerData[r * cols + c])) {
        exitFound = true;
        exMinX = Math.min(exMinX, c * tileSize);
        exMinY = Math.min(exMinY, r * tileSize);
        exMaxX = Math.max(exMaxX, c * tileSize + tileSize);
        exMaxY = Math.max(exMaxY, r * tileSize + tileSize);
      }
    }
  }
  const exitPoint = exitFound
    ? {
        x: exMinX,
        y: exMinY,
        width: exMaxX - exMinX,
        height: exMaxY - exMinY,
      }
    : { x: 0, y: 0, width: 0, height: 0 };

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
    exitPoint,
    enemySpawnZones,
  };
}

export const LAYERED_MAP_2 = buildLayeredMap2();
