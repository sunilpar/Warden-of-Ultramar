/**
 * Layered Map 2 Data (32px — from Tiled editor export)
 * =====================================================
 * Parses map2_32bit.json (the map) + 32symtric.json (the tileset
 * properties) to build all runtime data: layers for rendering, a
 * collision grid for O(1) collision, spawn/exit points, and enemy
 * spawn zones.
 *
 * Same format as map1 (see layeredMapData.ts):
 *   - tileSize 32; cols/rows 80x40; tileset 32symtric.tsx (firstgid 1).
 *   - Collision tiles live in a layer named "collision".
 *   - Spawn/exit markers live in "baselayer" tiles (2x2 blocks).
 *   - Enemy spawn zones live in the "enemy spawn" object layer.
 *   - Reuses the same tileset texture "bigobs_tiles_32" (BIGOBS64sym.png
 *     loaded at 32px frames: 14 cols x 12 rows = 168 tiles).
 */

import mapJson from "./map2_32bit.json";
import tilesetJson from "./32symtric.json";

import type {
  EnemySpawnZone,
  LayeredMapData,
} from "./layeredMapData";

// ============================================================
// PARSING
// ============================================================

const TILE_SIZE: number = mapJson.tilewidth; // 32
const COLS: number = mapJson.width; // 80
const ROWS: number = mapJson.height; // 40
const FIRST_GID: number = mapJson.tilesets[0].firstgid; // 1

// ---- Build tile-property sets from the tileset ----
const collisionTileIds = new Set<number>();
const spawnTileIds = new Set<number>();
const exitTileIds = new Set<number>();

for (const tile of tilesetJson.tiles as Array<{
  id: number;
  properties: Array<{ name: string; value: any }>;
}>) {
  const globalId = tile.id + FIRST_GID;
  for (const prop of tile.properties) {
    if (prop.name === "collision" && prop.value === true)
      collisionTileIds.add(globalId);
    if (prop.name === "starting point" && prop.value === true)
      spawnTileIds.add(globalId);
    if (prop.name === "exit point" && prop.value === true)
      exitTileIds.add(globalId);
  }
}

// ---- Extract layers by name ----
const layers = mapJson.layers as Array<{
  name: string;
  data?: number[];
  type: string;
  objects?: Array<{ x: number; y: number; width: number; height: number }>;
}>;

const baselayerRaw = layers.find((l) => l.name === "baselayer");
const collisionRaw = layers.find((l) => l.name === "collision");
const enemySpawnRaw = layers.find((l) => l.name === "enemy spawn");

if (!baselayerRaw?.data) throw new Error("baselayer not found in map2 32bit JSON");
if (!collisionRaw?.data)
  throw new Error("collision layer not found in map2 32bit JSON");

// ---- Convert flat arrays to 2D grids ----
function to2D(flat: number[], cols: number): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < flat.length / cols; r++) {
    rows.push(flat.slice(r * cols, (r + 1) * cols));
  }
  return rows;
}

const baselayer = to2D(baselayerRaw.data, COLS);
// Kept under the name "interactiveLayer" for rendering compatibility.
const interactiveLayer = to2D(collisionRaw.data, COLS);

// ---- Build collision grid from the "collision" layer ----
const collisionGrid = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (collisionTileIds.has(interactiveLayer[r][c])) {
      collisionGrid[r * COLS + c] = 1;
    }
  }
}

// ---- Find spawn tiles in baselayer (4 tiles forming a 2x2 block) ----
let spawnMinX = Infinity,
  spawnMinY = Infinity,
  spawnMaxX = -Infinity,
  spawnMaxY = -Infinity;
let spawnFound = false;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (spawnTileIds.has(baselayer[r][c])) {
      spawnFound = true;
      spawnMinX = Math.min(spawnMinX, c * TILE_SIZE);
      spawnMinY = Math.min(spawnMinY, r * TILE_SIZE);
      spawnMaxX = Math.max(spawnMaxX, c * TILE_SIZE + TILE_SIZE);
      spawnMaxY = Math.max(spawnMaxY, r * TILE_SIZE + TILE_SIZE);
    }
  }
}
const spawnPoint = spawnFound
  ? { x: (spawnMinX + spawnMaxX) / 2, y: (spawnMinY + spawnMaxY) / 2 }
  : { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };

// ---- Find exit tiles in baselayer (4 tiles forming a 2x2 block) ----
let exitMinX = Infinity,
  exitMinY = Infinity,
  exitMaxX = -Infinity,
  exitMaxY = -Infinity;
let exitFound = false;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (exitTileIds.has(baselayer[r][c])) {
      exitFound = true;
      exitMinX = Math.min(exitMinX, c * TILE_SIZE);
      exitMinY = Math.min(exitMinY, r * TILE_SIZE);
      exitMaxX = Math.max(exitMaxX, c * TILE_SIZE + TILE_SIZE);
      exitMaxY = Math.max(exitMaxY, r * TILE_SIZE + TILE_SIZE);
    }
  }
}
const exitPoint = exitFound
  ? {
      x: exitMinX,
      y: exitMinY,
      width: exitMaxX - exitMinX,
      height: exitMaxY - exitMinY,
    }
  : { x: 0, y: 0, width: TILE_SIZE, height: TILE_SIZE };

// ---- Extract enemy spawn zones from the object layer ----
const enemySpawnZones: EnemySpawnZone[] = [];
if (enemySpawnRaw?.objects) {
  enemySpawnRaw.objects.forEach((obj, i) => {
    enemySpawnZones.push({
      name: `enemy_zone_${i + 1}`,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
    });
  });
}

// ============================================================
// EXPORT
// ============================================================

export const LAYERED_MAP_2: LayeredMapData = {
  id: "map_layered_2",
  name: "Sector 2: Deep Hive (32px)",
  tileSize: TILE_SIZE,
  cols: COLS,
  rows: ROWS,
  widthPx: COLS * TILE_SIZE,
  heightPx: ROWS * TILE_SIZE,
  baselayer,
  interactiveLayer,
  collisionGrid,
  tilesetColumns: tilesetJson.columns,
  tilesetKey: "bigobs_tiles_32",
  firstgid: FIRST_GID,
  spawnPoint,
  exitPoint,
  enemySpawnZones,
};
