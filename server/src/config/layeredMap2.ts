/**
 * Layered Map 2 (Server-Side Authoritative)
 * =========================================
 * Parses Map2.json + tileset properties (bigobssym.json) to build the
 * collision grid used by the server for authoritative O(1) tile collision
 * in game_room_2.
 *
 * MUST produce the EXACT same collision grid as the client
 * (client/src/maps/layeredMap2Data.ts). Keep them in sync.
 */
import mapJson from "./maps/Map2.json";
import tilesetJson from "./maps/bigobssym.json";

export interface LayeredMap2Config {
  tileSize: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  /** Flat collision grid: 1 = blocked, 0 = walkable. Index = row * cols + col. */
  collisionGrid: Uint8Array;
  spawnPoint: { x: number; y: number };
}

function buildLayeredMap2(): LayeredMap2Config {
  const tileSize: number = mapJson.tilewidth;
  const cols: number = mapJson.width;
  const rows: number = mapJson.height;
  const firstGid: number = mapJson.tilesets[0].firstgid;

  // ---- Build the set of colliding tile ids from the tileset properties ----
  const collisionTileIds = new Set<number>();
  for (const tile of tilesetJson.tiles as Array<{
    id: number;
    properties: Array<{ name: string; value: any }>;
  }>) {
    const globalId = tile.id + firstGid;
    for (const prop of tile.properties) {
      if (prop.name === "collide" && prop.value === true) {
        collisionTileIds.add(globalId);
      }
    }
  }

  // ---- Find the interactive layer (where walls / collide tiles live) ----
  const layers = mapJson.layers as Array<{
    name: string;
    data?: number[];
  }>;
  const interactive = layers.find((l) => l.name === "interactive");
  if (!interactive?.data) throw new Error("interactive layer not found in Map2");

  const interactiveData = interactive.data;

  // ---- Build collision grid ----
  const collisionGrid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tid = interactiveData[r * cols + c];
      if (collisionTileIds.has(tid)) {
        collisionGrid[r * cols + c] = 1;
      }
    }
  }

  // ---- Find spawn tile ----
  const spawnTileIds = new Set<number>();
  for (const tile of tilesetJson.tiles as Array<{
    id: number;
    properties: Array<{ name: string; value: any }>;
  }>) {
    const globalId = tile.id + firstGid;
    for (const prop of tile.properties) {
      if (prop.name === "spawnpoint" && prop.value === true) {
        spawnTileIds.add(globalId);
      }
    }
  }

  let spawnPoint = { x: tileSize / 2, y: tileSize / 2 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (spawnTileIds.has(interactiveData[r * cols + c])) {
        spawnPoint = {
          x: c * tileSize + tileSize / 2,
          y: r * tileSize + tileSize / 2,
        };
      }
    }
  }

  return {
    tileSize,
    cols,
    rows,
    widthPx: cols * tileSize,
    heightPx: rows * tileSize,
    collisionGrid,
    spawnPoint,
  };
}

export const LAYERED_MAP_2 = buildLayeredMap2();
