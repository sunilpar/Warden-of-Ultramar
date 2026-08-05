/**
 * Layered Map 2 Data (Map2 — from Tiled editor export)
 * ====================================================
 * Same parsing logic as layeredMapData.ts but for Map2.json.
 * Uses the same tileset (bigobssym.json) as Map1.
 *
 * Map2 has a spawn tile but NO exit tile, so it is a terminal map
 * for now (no onward transition).
 */
import mapJson from "./Map2.json";
import tilesetJson from "./bigobssym.json";
import type { LayeredMapData, EnemySpawnZone } from "./layeredMapData";

// ============================================================
// PARSING
// ============================================================
const TILE_SIZE: number = mapJson.tilewidth; // 64
const COLS: number = mapJson.width; // 40
const ROWS: number = mapJson.height; // 20
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
    if (prop.name === "collide" && prop.value === true)
      collisionTileIds.add(globalId);
    if (prop.name === "spawnpoint" && prop.value === true)
      spawnTileIds.add(globalId);
    if (prop.name === "exitpoint" && prop.value === true)
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
const interactiveRaw = layers.find((l) => l.name === "interactive");
const enemySpawnRaw = layers.find((l) => l.name === "enemy spawn");

if (!baselayerRaw?.data) throw new Error("baselayer not found in Map2 JSON");
if (!interactiveRaw?.data)
  throw new Error("interactive layer not found in Map2 JSON");

// ---- Convert flat arrays to 2D grids ----
const baselayer: number[][] = [];
const interactiveLayer: number[][] = [];
for (let r = 0; r < ROWS; r++) {
  baselayer.push(baselayerRaw.data.slice(r * COLS, (r + 1) * COLS));
  interactiveLayer.push(
    interactiveRaw.data.slice(r * COLS, (r + 1) * COLS),
  );
}

// ---- Build collision grid ----
const collisionGrid = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (collisionTileIds.has(interactiveLayer[r][c])) {
      collisionGrid[r * COLS + c] = 1;
    }
  }
}

// ---- Find spawn & exit tiles in the interactive layer ----
let spawnPoint = { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
let exitPoint = {
  x: 0,
  y: 0,
  width: TILE_SIZE,
  height: TILE_SIZE,
};

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const tid = interactiveLayer[r][c];
    if (spawnTileIds.has(tid)) {
      spawnPoint = {
        x: c * TILE_SIZE + TILE_SIZE / 2,
        y: r * TILE_SIZE + TILE_SIZE / 2,
      };
    }
    if (exitTileIds.has(tid)) {
      exitPoint = {
        x: c * TILE_SIZE,
        y: r * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      };
    }
  }
}

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
  name: "The Second Hall (Map2)",
  tileSize: TILE_SIZE,
  cols: COLS,
  rows: ROWS,
  widthPx: COLS * TILE_SIZE,
  heightPx: ROWS * TILE_SIZE,
  baselayer,
  interactiveLayer,
  collisionGrid,
  tilesetColumns: tilesetJson.columns,
  tilesetKey: "bigobs_tiles",
  firstgid: FIRST_GID,
  spawnPoint,
  exitPoint,
  enemySpawnZones,
};
