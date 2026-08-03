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
