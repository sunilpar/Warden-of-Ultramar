/**
 * Layered Map Data (from Tiled editor export)
 * ============================================
 * Parses layerbasedMap1.json (the map) + bigobssym.json (the tileset
 * properties) to build all runtime data: layers for rendering, a collision
 * grid for O(1) collision, spawn/exit points, and enemy spawn zones.
 *
 * TILE NUMBERING:
 *   The map uses Tiled global ids (firstgid = 1).
 *   Tile 0 in a layer = empty (nothing to draw).
 *   The tileset uses local ids (0-indexed); globalId = localId + firstgid.
 *
 * TILESET PROPERTIES (bigobssym.json):
 *   collide:true    → tile blocks movement
 *   spawnpoint:true → player spawn location
 *   exitpoint:true  → map exit zone
 *
 * LAYERS:
 *   "baselayer"    → floor tiles, always drawn (depth 0)
 *   "interactive"  → walls, decor, spawn/exit markers; tile 0 = skip (depth 1)
 *   "ememy spawn"  → object layer with rectangles defining enemy spawn zones
 */

import mapJson from "./layerbasedMap1.json";
import tilesetJson from "./bigobssym.json";

// ============================================================
// TYPES
// ============================================================

export interface EnemySpawnZone {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayeredMapData {
  id: string;
  name: string;
  tileSize: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  /** Baselayer tile grid [row][col] — always drawn. */
  baselayer: number[][];
  /** Interactive layer tile grid [row][col] — 0 means empty/skip. */
  interactiveLayer: number[][];
  /** Flat collision grid: 1 = blocked, 0 = walkable. Index = row * cols + col. */
  collisionGrid: Uint8Array;
  /** Tileset columns (for computing source-rect from tile id). */
  tilesetColumns: number;
  /** Phaser texture key for the spritesheet (loaded in SceneSelector). */
  tilesetKey: string;
  /** firstgid from the map (globalId = localId + firstgid). */
  firstgid: number;
  /** Player spawn position in pixels (center of spawn tile). */
  spawnPoint: { x: number; y: number };
  /** Exit zone in pixels. */
  exitPoint: { x: number; y: number; width: number; height: number };
  /** Enemy spawn zones from the Tiled object layer. */
  enemySpawnZones: EnemySpawnZone[];
}

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
const enemySpawnRaw = layers.find((l) => l.name === "ememy spawn");

if (!baselayerRaw?.data) throw new Error("baselayer not found in map JSON");
if (!interactiveRaw?.data)
  throw new Error("interactive layer not found in map JSON");

// ---- Convert flat arrays to 2D grids ----
function to2D(flat: number[], cols: number): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < flat.length / cols; r++) {
    rows.push(flat.slice(r * cols, (r + 1) * cols));
  }
  return rows;
}

const baselayer = to2D(baselayerRaw.data, COLS);
const interactiveLayer = to2D(interactiveRaw.data, COLS);

// ---- Build collision grid (O(1) lookup at runtime) ----
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

export const LAYERED_MAP: LayeredMapData = {
  id: "map_layered_1",
  name: "The First Hall (Layered)",
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

// ============================================================
// O(1) GRID COLLISION RESOLUTION
// ============================================================
// MUST MATCH server's resolveTileCollision() exactly.
// The player is a circle (radius < tileSize/2). It can overlap at most
// 4 grid cells, so we check a 3×3 neighborhood — constant time.

export function resolveTileCollision(
  x: number,
  y: number,
  radius: number,
  grid: Uint8Array,
  cols: number,
  rows: number,
  tileSize: number,
): { x: number; y: number } {
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      if (!grid[r * cols + c]) continue;

      // Cell rect bounds
      const cellX = c * tileSize;
      const cellY = r * tileSize;

      // Closest point on the cell rect to the circle center
      const closestX = Math.max(cellX, Math.min(x, cellX + tileSize));
      const closestY = Math.max(cellY, Math.min(y, cellY + tileSize));
      const dx = x - closestX;
      const dy = y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.0001) {
          // Push circle out along the penetration vector
          const push = radius - dist;
          x += (dx / dist) * push;
          y += (dy / dist) * push;
        } else {
          // Center is inside the cell — push out along nearest edge
          const dLeft = x - cellX;
          const dRight = cellX + tileSize - x;
          const dTop = y - cellY;
          const dBottom = cellY + tileSize - y;
          const minD = Math.min(dLeft, dRight, dTop, dBottom);
          if (minD === dLeft) x = cellX - radius;
          else if (minD === dRight) x = cellX + tileSize + radius;
          else if (minD === dTop) y = cellY - radius;
          else y = cellY + tileSize + radius;
        }
      }
    }
  }

  return { x, y };
}
