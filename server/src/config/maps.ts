/**
 * Map Configuration System (JSON-driven)
 * ========================================
 * Maps are defined as JSON files in this directory.
 * This module loads them and provides the runtime MapDefinition interface.
 *
 * HOW TO ADD A NEW MAP:
 *   1. Create a JSON file: maps/map2.json
 *   2. Follow the same schema as map1.json
 *   3. Import and register it below
 *
 * SPRITE SHEET LAYOUT:
 *   - MapTilesSpriteSheet.png: 2 rows x 4 cols, 256x256 each
 *     Frame 0 = player spawn, 1-2 = basic tiles, 3 = exit, 4-7 = special
 *   - MapObsSpriteSheet.png: 4 rows x 4 cols, 512x512 each
 *     Frames 0-11 = obstacles, Frames 12-15 = enemy spawn points
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load map JSON files at runtime
const map1Data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "maps", "map1.json"), "utf-8")
);

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface HitboxOverride {
  width: number;
  height: number;
}

export type ObstacleType = "small" | "big";

export interface MapObstacle {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Frame index in the obstacle sprite sheet */
  spriteFrame: number;
  hitbox?: HitboxOverride;
}

export interface EnemySpawnZone {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Frame index in the obstacle sprite sheet (enemy spawns are in the same sheet) */
  spriteFrame: number;
  enemyTypes: string[];
  maxAlive: number;
  intervalMs: number;
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
  enemySpawnZones: EnemySpawnZone[];
  exitPoint: MapExitPoint;
  spriteSheets: {
    tiles: SpriteSheetConfig;
    obstacles: SpriteSheetConfig;
  };
  playerSpawnTileFrame: number;
  exitTileFrame: number;
  obstacleSpriteFrames: number[];
  enemySpawnSpriteFrames: number[];
  nextMapId: string | null;
}

// ============================================================
// JSON MAP LOADER
// ============================================================

/**
 * Convert a JSON map definition into a runtime MapDefinition.
 * Handles tile grid generation if tiles === "generated".
 */
function loadMapFromJSON(data: any): MapDefinition {
  const rows = Math.ceil(data.heightPx / data.tileSize);
  const cols = Math.ceil(data.widthPx / data.tileSize);

  let tiles: number[][];
  if (data.tiles === "generated") {
    tiles = generateFloorTiles(rows, cols);
  } else {
    tiles = data.tiles as number[][];
  }

  return {
    id: data.id,
    name: data.name,
    widthPx: data.widthPx,
    heightPx: data.heightPx,
    tileSize: data.tileSize,
    tiles,
    obstacles: data.obstacles as MapObstacle[],
    playerSpawns: data.playerSpawns as PlayerSpawnPoint[],
    enemySpawnZones: data.enemySpawnZones as EnemySpawnZone[],
    exitPoint: data.exitPoint as MapExitPoint,
    spriteSheets: data.spriteSheets as any,
    playerSpawnTileFrame: data.playerSpawnTileFrame,
    exitTileFrame: data.exitTileFrame,
    obstacleSpriteFrames: data.obstacleSpriteFrames,
    enemySpawnSpriteFrames: data.enemySpawnSpriteFrames,
    nextMapId: data.nextMapId,
  };
}

// ============================================================
// MAP REGISTRY
// ============================================================

const mapRegistry: Map<string, MapDefinition> = new Map();

export function registerMap(map: MapDefinition): void {
  mapRegistry.set(map.id, map);
}

export function getMap(id: string): MapDefinition | undefined {
  return mapRegistry.get(id);
}

export function getDefaultMap(): MapDefinition | undefined {
  return mapRegistry.values().next().value;
}

// Register all maps (load from JSON)
registerMap(loadMapFromJSON(map1Data));

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate a floor tile grid with random basic tile IDs (2 or 3).
 * IDs 1 = player spawn, 4 = exit (placed separately).
 * IDs 5-8 = special tiles (placed rarely).
 */
function generateFloorTiles(rows: number, cols: number): number[][] {
  const tiles: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const tileRow: number[] = [];
    for (let col = 0; col < cols; col++) {
      // 90% basic tiles (2 or 3), 10% special tiles (5-8)
      const rand = Math.random();
      if (rand < 0.45) {
        tileRow.push(2); // basicTile1
      } else if (rand < 0.90) {
        tileRow.push(3); // basicTile2
      } else {
        tileRow.push(5 + Math.floor(Math.random() * 4)); // special tiles 5-8
      }
    }
    tiles.push(tileRow);
  }
  return tiles;
}