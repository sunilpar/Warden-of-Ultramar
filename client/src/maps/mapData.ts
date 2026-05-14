/**
 * Client-Side Map Data
 * =====================
 * Mirror of the server's map configuration.
 * KEEP IN SYNC with server/src/config/maps.ts!
 */

export interface MapRect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ObstacleType = "small" | "big";

export interface MapObstacle extends MapRect {
  obstacleType: ObstacleType;
}

export interface EnemySpawnZone extends MapRect {
  enemyTypes: string[];
  maxAlive: number;
  intervalMs: number;
}

export interface PlayerSpawnPoint {
  name: string;
  x: number;
  y: number;
}

export interface MapExitPoint {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  enemySpawnZones: EnemySpawnZone[];
  exitPoint: MapExitPoint;
  tilesetColumns: number;
}

function generateFloorTiles(rows: number, cols: number): number[][] {
  const tiles: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const tileRow: number[] = [];
    for (let col = 0; col < cols; col++) {
      tileRow.push(((row + col) % 4) + 1);
    }
    tiles.push(tileRow);
  }
  return tiles;
}

export const MAP_1: MapDefinition = {
  id: "map_1_first_hall",
  name: "The First Hall",
  widthPx: 40 * 64,   // 2560 pixels
  heightPx: 50 * 64,  // 3200 pixels
  tileSize: 64,
  tiles: generateFloorTiles(50, 40),
  obstacles: [
    { name: "big_obstacle_1", x: 768, y: 192, width: 256, height: 192, obstacleType: "big" },
    { name: "big_obstacle_2", x: 1280, y: 2048, width: 256, height: 192, obstacleType: "big" },
    { name: "small_obstacle_1", x: 384, y: 576, width: 96, height: 96, obstacleType: "small" },
    { name: "small_obstacle_2", x: 1728, y: 2560, width: 96, height: 96, obstacleType: "small" },
  ],
  playerSpawns: [
    { name: "spawn_start", x: 192, y: 192 },
    { name: "checkpoint_mid", x: 1280, y: 1600 },
  ],
  enemySpawnZones: [
    { name: "enemy_zone_top", x: 512, y: 128, width: 192, height: 192, enemyTypes: ["elder"], maxAlive: 3, intervalMs: 3000 },
    { name: "enemy_zone_right", x: 1920, y: 256, width: 192, height: 256, enemyTypes: ["ork"], maxAlive: 2, intervalMs: 4000 },
    { name: "enemy_zone_bottom", x: 896, y: 2560, width: 256, height: 192, enemyTypes: ["elder", "ork"], maxAlive: 4, intervalMs: 2500 },
  ],
  exitPoint: { name: "exit_bottom_right", x: 2304, y: 3008, width: 192, height: 128 },
  tilesetColumns: 4,
};