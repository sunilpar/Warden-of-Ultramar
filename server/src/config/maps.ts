/**
 * Map Configuration (JSON-driven)
 * ================================
 * Loads map definitions from JSON files in the maps/ directory.
 * Currently only map1.json is loaded.
 *
 * HOW TO ADD A NEW MAP:
 *   1. Create maps/map2.json (same structure as map1.json)
 *   2. Import and registerMap() it below
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Load map JSON at runtime ----
const map1Data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "maps", "map1.json"), "utf-8"),
);

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

// ============================================================
// JSON MAP LOADER
// ============================================================

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
    exitPoint: data.exitPoint as MapExitPoint,
    spriteSheets: data.spriteSheets as any,
    playerSpawnTileFrame: data.playerSpawnTileFrame,
    exitTileFrame: data.exitTileFrame,
  };
}

// Register map1
registerMap(loadMapFromJSON(map1Data));
