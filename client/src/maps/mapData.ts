/**
 * Client-Side Map Data
 * ====================
 * Mirror of the server's map1.json definition.
 * The client needs this to render the map (tiles, obstacles, spawn points, exit).
 *
 * KEEP IN SYNC with server/src/config/maps/map1.json!
 */

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface HitboxOverride {
  width: number;
  height: number;
}

export interface MapObstacle {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spriteFrame: number;
  hitbox?: HitboxOverride;
}

export interface PlayerSpawnPoint {
  name: string;
  x: number;
  y: number;
  visualSize?: number;
}

export interface MapExitPoint {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hitbox?: HitboxOverride;
}

export interface SpriteSheetConfig {
  path: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
  tileSize: number;
  tiles: number[][];
  obstacles: MapObstacle[];
  playerSpawns: PlayerSpawnPoint[];
  exitPoint: MapExitPoint;
  spriteSheets: {
    tiles: SpriteSheetConfig;
    obstacles: SpriteSheetConfig;
  };
  playerSpawnTileFrame: number;
  exitTileFrame: number;
}

// ============================================================
// HELPERS
// ============================================================

/** Compute the effective collision rect (centered, smaller if hitbox defined). */
export function getHitboxRect(
  x: number,
  y: number,
  width: number,
  height: number,
  hitbox?: HitboxOverride,
): { x: number; y: number; width: number; height: number } {
  if (!hitbox) return { x, y, width, height };
  const offsetX = (width - hitbox.width) / 2;
  const offsetY = (height - hitbox.height) / 2;
  return {
    x: x + offsetX,
    y: y + offsetY,
    width: hitbox.width,
    height: hitbox.height,
  };
}

/** Generate the floor tile grid (matches server logic). */
function generateFloorTiles(rows: number, cols: number): number[][] {
  const tiles: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const tileRow: number[] = [];
    for (let col = 0; col < cols; col++) {
      const rand = Math.random();
      if (rand < 0.45) {
        tileRow.push(2);
      } else if (rand < 0.90) {
        tileRow.push(3);
      } else {
        tileRow.push(5 + Math.floor(Math.random() * 4));
      }
    }
    tiles.push(tileRow);
  }
  return tiles;
}

// ============================================================
// MAP 1 DEFINITION (from map1.json)
// ============================================================

const MAP1_JSON = {
  id: "map_1_first_hall",
  name: "The First Hall",
  widthPx: 4320,
  heightPx: 4320,
  tileSize: 64,
  spriteSheets: {
    tiles: {
      path: "assets/maps/map1/MapTilesSpriteSheet64.png",
      frameWidth: 64,
      frameHeight: 64,
      columns: 4,
      rows: 2,
    },
    obstacles: {
      path: "assets/maps/map1/MapObsSpriteSheet128.png",
      frameWidth: 128,
      frameHeight: 128,
      columns: 4,
      rows: 4,
    },
  },
  playerSpawnTileFrame: 0,
  exitTileFrame: 3,
  obstacles: [
    { name: "obs_1", x: 896, y: 320, width: 128, height: 128, spriteFrame: 0, hitbox: { width: 90, height: 105 } },
    { name: "obs_2", x: 2560, y: 320, width: 128, height: 128, spriteFrame: 1, hitbox: { width: 95, height: 100 } },
    { name: "obs_3", x: 256, y: 1344, width: 128, height: 128, spriteFrame: 2, hitbox: { width: 90, height: 110 } },
    { name: "obs_4", x: 3264, y: 1344, width: 128, height: 128, spriteFrame: 3, hitbox: { width: 85, height: 108 } },
    { name: "obs_5", x: 1280, y: 2304, width: 128, height: 128, spriteFrame: 4, hitbox: { width: 93, height: 103 } },
    { name: "obs_6", x: 3008, y: 2688, width: 128, height: 128, spriteFrame: 5, hitbox: { width: 88, height: 105 } },
    { name: "obs_7", x: 448, y: 3328, width: 128, height: 128, spriteFrame: 6, hitbox: { width: 90, height: 100 } },
    { name: "obs_8", x: 2176, y: 3648, width: 128, height: 128, spriteFrame: 7, hitbox: { width: 95, height: 108 } },
  ],
  playerSpawns: [
    { name: "spawn_start", x: 320, y: 320, visualSize: 64 },
  ],
  exitPoint: {
    name: "exit_south",
    x: 3456,
    y: 4032,
    width: 256,
    height: 128,
    hitbox: { width: 200, height: 90 },
  },
};

const rows = Math.ceil(MAP1_JSON.heightPx / MAP1_JSON.tileSize);
const cols = Math.ceil(MAP1_JSON.widthPx / MAP1_JSON.tileSize);

export const MAP_1: MapDefinition = {
  ...MAP1_JSON,
  tiles: generateFloorTiles(rows, cols),
} as MapDefinition;


// ============================================================
// MAP 1 — TILED EXPORT (from map164file.js / ALLNEWMAP64.png)
// ============================================================
// This is a SEPARATE map definition produced by the Tiled editor.
// The tile grid below is a direct 1:1 copy of the Tiled layer data
// (60 cols x 40 rows, 64px tiles -> 3840x2560px).
//
// Tile IDs are Tiled global ids, firstgid = 1:
//   - Tile id 0  = empty (not drawn)
//   - Tile id 1  = PLAYER SPAWN (row 6, col 5 -> center px 352,416)
//   - Tile id 4  = MAP EXIT     (row 34, col 52 -> px 3328,2176)
// The tileset ALLNEWMAP64.png is 448x384 = 7 columns x 6 rows (42 tiles).
// To draw a tile, use frame index = (tileId - 1); frameCol = idx % 7.

export interface TiledMapDefinition {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
  tileSize: number;
  /** Texture key loaded in SceneSelector.preload(). */
  tilesetKey: string;
  /** Tileset columns (for computing source-rect from tile id). */
  tilesetColumns: number;
  /** Special tile ids that mark logic points (kept in the grid for rendering). */
  spawnTileId: number;
  exitTileId: number;
  /** The raw Tiled layer data (row-major, [row][col]). */
  tiles: number[][];
  /** Spawn position in pixels (center of the spawn tile). */
  playerSpawns: PlayerSpawnPoint[];
  /** Exit zone in pixels (the exit tile rect). */
  exitPoint: MapExitPoint;
  /**
   * Custom hitboxes to be added later. Hand-authored after designing in Tiled.
   * Empty for now — the Tiled export only describes floor art + logic tiles.
   */
  obstacles: MapObstacle[];
}

// Player spawn: tile id 1 at row 6, col 5 -> center pixel (352, 416).
// Exit:       tile id 4 at row 34, col 52 -> top-left (3328, 2176), 64x64.
const T1 = 64; // tile size for this map
const SPAWN_COL = 5,  SPAWN_ROW = 6;
const EXIT_COL  = 52, EXIT_ROW  = 34;

export const MAP_1_TILED: TiledMapDefinition = {
  id: "map_1_tiled",
  name: "The First Hall (Tiled)",
  widthPx: 3840,
  heightPx: 2560,
  tileSize: T1,
  tilesetKey: "map1_tiled_tiles",
  tilesetColumns: 7,
  spawnTileId: 1,
  exitTileId: 4,
  tiles: [
    [5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7],
    [12, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 14],
    [12, 26, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28, 14],
    [12, 33, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 35, 14],
    [12, 33, 34, 35, 40, 41, 41, 41, 41, 41, 41, 41, 41, 41, 28, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 42, 33, 34, 35, 14],
    [12, 33, 34, 35, 22, 3, 3, 18, 2, 2, 2, 2, 2, 34, 35, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 17, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 2, 11, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 3, 1, 2, 2, 2, 2, 2, 2, 2, 34, 35, 2, 2, 2, 2, 16, 2, 2, 2, 2, 2, 3, 2, 16, 2, 2, 2, 2, 2, 16, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 17, 3, 3, 11, 11, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 3, 2, 2, 2, 2, 2, 2, 2, 2, 34, 35, 2, 2, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 39, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 2, 2, 16, 3, 3, 3, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 3, 2, 2, 26, 27, 28, 2, 2, 2, 34, 35, 2, 26, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28, 2, 2, 26, 27, 28, 2, 2, 3, 2, 3, 2, 3, 3, 3, 3, 3, 33, 34, 35, 14],
    [12, 33, 34, 35, 18, 2, 2, 33, 37, 35, 2, 2, 2, 34, 35, 34, 34, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 35, 34, 2, 33, 3, 35, 3, 3, 2, 2, 3, 2, 3, 3, 3, 3, 3, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 2, 2, 40, 41, 42, 2, 2, 2, 34, 35, 18, 2, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 42, 25, 2, 2, 2, 35, 3, 2, 2, 2, 3, 3, 3, 2, 2, 3, 3, 33, 34, 35, 14],
    [12, 33, 34, 35, 26, 2, 2, 27, 27, 27, 27, 27, 27, 27, 27, 27, 2, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28, 16, 2, 34, 2, 33, 3, 35, 3, 3, 26, 27, 28, 3, 2, 3, 3, 3, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 34, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 34, 2, 33, 3, 35, 2, 3, 33, 2, 35, 2, 2, 3, 3, 3, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 40, 23, 2, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 30, 41, 41, 41, 41, 30, 41, 34, 30, 41, 41, 41, 41, 41, 41, 34, 41, 2, 2, 17, 34, 2, 33, 3, 35, 2, 2, 40, 41, 42, 3, 2, 3, 3, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 2, 2, 2, 2, 36, 2, 2, 2, 2, 2, 36, 2, 2, 36, 36, 2, 2, 2, 2, 2, 2, 2, 34, 26, 27, 27, 27, 27, 27, 28, 34, 26, 27, 28, 2, 34, 2, 33, 3, 35, 2, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 23, 2, 2, 2, 2, 2, 2, 2, 2, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 34, 33, 36, 36, 36, 36, 36, 35, 34, 33, 2, 35, 2, 34, 2, 33, 3, 35, 23, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 26, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 40, 41, 41, 41, 41, 41, 42, 34, 40, 41, 42, 2, 34, 2, 33, 3, 35, 26, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 2, 34, 2, 2, 2, 2, 37, 2, 2, 23, 2, 2, 2, 2, 2, 2, 2, 2, 37, 2, 2, 18, 26, 27, 28, 2, 34, 34, 2, 2, 2, 2, 34, 2, 33, 3, 35, 33, 10, 10, 10, 10, 10, 10, 10, 10, 10, 35, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 2, 34, 2, 26, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 28, 18, 33, 38, 35, 2, 34, 2, 2, 36, 2, 2, 34, 2, 33, 3, 35, 40, 41, 41, 41, 41, 41, 41, 41, 41, 41, 42, 33, 34, 35, 14],
    [12, 33, 34, 35, 23, 33, 34, 35, 18, 18, 2, 33, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 31, 35, 18, 33, 38, 35, 2, 34, 34, 2, 2, 26, 27, 34, 34, 40, 41, 42, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 18, 34, 2, 40, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 42, 18, 33, 38, 35, 2, 2, 34, 2, 2, 33, 2, 35, 34, 34, 34, 34, 34, 34, 24, 2, 2, 18, 3, 2, 2, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 18, 18, 2, 26, 27, 28, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 18, 33, 38, 35, 2, 17, 34, 2, 36, 40, 41, 42, 2, 2, 2, 2, 2, 34, 2, 2, 2, 18, 3, 2, 2, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 2, 18, 2, 33, 2, 35, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 18, 18, 38, 35, 2, 17, 34, 36, 36, 2, 2, 2, 2, 2, 37, 2, 2, 34, 24, 2, 2, 18, 3, 2, 2, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 2, 18, 2, 33, 41, 35, 2, 2, 2, 2, 3, 2, 2, 3, 3, 3, 3, 2, 3, 2, 2, 2, 18, 38, 35, 2, 2, 34, 2, 2, 2, 2, 36, 2, 2, 2, 2, 17, 34, 2, 3, 2, 18, 2, 26, 27, 28, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 2, 18, 2, 33, 41, 35, 2, 30, 30, 2, 3, 3, 3, 3, 39, 39, 3, 3, 3, 3, 2, 2, 18, 38, 35, 2, 2, 34, 2, 2, 2, 2, 2, 2, 2, 2, 3, 17, 34, 24, 3, 2, 18, 2, 33, 2, 35, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 18, 34, 2, 33, 41, 35, 2, 2, 2, 2, 3, 2, 3, 23, 3, 23, 2, 3, 2, 3, 2, 2, 40, 41, 42, 34, 34, 2, 2, 2, 2, 3, 2, 2, 2, 34, 2, 2, 34, 2, 2, 2, 18, 2, 40, 41, 42, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 18, 34, 34, 33, 41, 35, 2, 2, 2, 2, 3, 2, 2, 3, 3, 3, 3, 3, 3, 3, 34, 34, 34, 34, 34, 28, 2, 2, 2, 2, 2, 3, 2, 2, 2, 34, 36, 2, 34, 34, 37, 34, 34, 34, 34, 2, 2, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 18, 2, 34, 33, 41, 35, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 34, 34, 34, 34, 2, 2, 2, 33, 2, 35, 2, 2, 2, 26, 27, 28, 2, 2, 2, 2, 34, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 34, 35, 18, 2, 34, 33, 41, 35, 2, 2, 2, 2, 2, 2, 2, 2, 2, 34, 34, 40, 42, 26, 28, 2, 2, 40, 41, 42, 3, 18, 18, 33, 2, 35, 2, 2, 2, 2, 34, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 41, 35, 18, 2, 34, 40, 41, 42, 3, 2, 2, 2, 2, 2, 2, 2, 34, 34, 26, 27, 28, 40, 42, 18, 18, 18, 18, 18, 18, 18, 2, 40, 41, 42, 26, 34, 34, 34, 34, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 41, 35, 18, 2, 34, 34, 2, 2, 2, 2, 2, 2, 34, 34, 34, 34, 34, 2, 33, 2, 35, 2, 2, 3, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 35, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 41, 35, 26, 27, 28, 34, 34, 34, 34, 34, 34, 34, 34, 2, 2, 18, 18, 18, 40, 41, 42, 18, 18, 18, 2, 2, 2, 26, 27, 28, 2, 2, 2, 2, 40, 41, 42, 2, 2, 2, 26, 27, 28, 2, 18, 18, 18, 18, 18, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 33, 2, 35, 33, 2, 35, 26, 27, 28, 18, 26, 27, 18, 18, 27, 27, 18, 18, 26, 27, 28, 2, 18, 27, 34, 2, 2, 2, 33, 2, 35, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 33, 2, 35, 2, 18, 3, 3, 3, 18, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 40, 41, 42, 40, 41, 42, 33, 2, 35, 18, 33, 2, 18, 18, 2, 35, 35, 18, 33, 2, 35, 2, 18, 2, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 3, 16, 3, 18, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 8, 34, 18, 18, 18, 34, 34, 34, 34, 18, 34, 18, 18, 34, 34, 34, 34, 34, 34, 34, 34, 18, 18, 18, 18, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 18, 2, 4, 2, 18, 2, 33, 34, 35, 14],
    [12, 33, 34, 35, 2, 2, 2, 2, 2, 18, 18, 18, 18, 18, 18, 2, 18, 18, 18, 2, 2, 8, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 8, 36, 36, 36, 36, 36, 36, 36, 36, 36, 2, 2, 8, 2, 2, 18, 18, 18, 18, 18, 2, 33, 34, 35, 14],
    [12, 33, 34, 40, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 42, 34, 35, 14],
    [12, 33, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 35, 14],
    [12, 40, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 42, 14],
    [40, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 42],
  ],
  playerSpawns: [
    { name: "spawn_start", x: SPAWN_COL * T1 + T1 / 2, y: SPAWN_ROW * T1 + T1 / 2, visualSize: T1 },
  ],
  exitPoint: {
    name: "exit_east",
    x: EXIT_COL * T1,
    y: EXIT_ROW * T1,
    width: T1,
    height: T1,
  },
  // Hand-authored hitboxes will be appended here later.
  obstacles: [],
};
